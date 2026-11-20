// The scooter. Arcade model: forward speed with an electric torque curve, steering that tightens at low
// speed, lateral grip that bleeds sideways velocity (low grip = drift). Hop on Space; holding Space through
// the landing while steering starts a drift that charges a boost. Every jump does a trick by itself (360s and
// tailwhips sized to the airtime); tricks never make you fall.
// Landing on a bench, ledge or lawn fence while moving along it starts a grind.
(function () {
  const SK = window.SK, U = SK.U, TAU = U.TAU;
  const Pl = {};

  Pl.create = function (x, y, heading, z) {
    return {
      x, y, z: z || 0, vx: 0, vy: 0, vz: 0, heading, steer: 0, steerIn: 0, throttle: 0, omega: 0, lean: 0, speed: 0,
      grounded: true, state: 'ride', drift: null, boostT: 0, airT: 0, spin: null, whip: null, grind: null, grindCD: 0,
      crashT: 0, crashCause: null, rag: null, invulnT: 1, wobble: 0, curbCD: 0, rampVz: 0,
    };
  };

  const FWD_ANGLE = -Math.PI / 2; // the street runs toward -y

  function controls(p, inp, C) {
    let steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let thr = inp.up ? 1 : 0, brk = inp.down ? 1 : 0;
    if (C.controlMode === 'street') {
      // always full throttle, no brake: only left and right are yours
      thr = 1;
      brk = 0;
    } else if (C.controlMode === 'screen') {
      // WASD is a direction on screen; turn the iso screen direction into a world heading
      const sx = steer, sy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      steer = 0; thr = 0; brk = 0;
      if (sx || sy) {
        const want = Math.atan2(sy * 2 - sx / 0.866, sx / 0.866 + sy * 2);
        const diff = U.wrap(want - p.heading);
        const sp = Math.hypot(p.vx, p.vy);
        steer = U.clamp(diff * 2.5, -1, 1);
        if (Math.abs(diff) < 1.9) thr = 1; else if (sp > 3) brk = 1; else thr = 0.35;
      }
    }
    return { steer, thr, brk };
  }

  Pl.update = function (p, dt, inp, g) {
    const C = SK.CFG;
    p.invulnT = Math.max(0, p.invulnT - dt);
    p.boostT = Math.max(0, p.boostT - dt);
    p.curbCD -= dt;
    p.grindCD -= dt;
    p.wobble = Math.max(0, p.wobble - dt * 2.5);
    if (p.state === 'crash') updateCrash(p, dt, g);
    else if (p.state === 'grind') updateGrind(p, dt, inp, g);
    else updateRide(p, dt, inp, g);
    p.speed = Math.hypot(p.vx, p.vy);
    let lean = p.lean;
    if (p.state === 'ride' && p.grounded) lean = U.clamp(p.omega * p.speed / 9.8 * C.leanK, -0.6, 0.6);
    else if (p.state === 'grind') lean = Math.sin(g.t * 9) * 0.08;
    p.lean += (lean - p.lean) * Math.min(1, dt * 10);
  };

  function updateRide(p, dt, inp, g) {
    const C = SK.CFG, W = g.world;
    const ctl = controls(p, inp, C);
    p.steerIn = ctl.steer;
    p.steer += (ctl.steer - p.steer) * Math.min(1, C.steerResponse * dt);
    p.throttle = ctl.thr;

    if (p.grounded && inp.hopPressed) {
      p.grounded = false;
      p.vz = C.hopVz;
      p.airT = 0;
      g.emit('hop');
      startTricks(p, g);
    }

    const ch = Math.cos(p.heading), sh = Math.sin(p.heading);
    if (p.grounded && p.drift) {
      if (!inp.hop || p.vx * ch + p.vy * sh < C.driftMinSpeed * 0.6) endDrift(p, g);
      else {
        const tight = (p.steer * p.drift.dir + 1) / 2;
        p.drift.t += dt * (0.6 + 0.8 * tight);
        const lv = p.drift.t > C.driftLv2 ? 2 : p.drift.t > C.driftLv1 ? 1 : 0;
        if (lv > p.drift.level) { p.drift.level = lv; g.emit('driftLevel', { level: lv }); }
      }
    }
    // read after endDrift, which may have just added the boost kick
    let fwd = p.vx * ch + p.vy * sh;
    const lat = -p.vx * sh + p.vy * ch;

    if (p.grounded) {
      // every passenger is a bit of extra weight
      const load = g.tower ? g.tower.pax.length * C.paxSpeedLoss : 0;
      const maxSp = C.maxSpeed - load + (p.boostT > 0 ? C.boostSpeed : 0);
      if (ctl.thr > 0 && fwd < maxSp) {
        const k = U.clamp(fwd / maxSp, 0, 1);
        fwd += C.accel * (1 - k * k) * ctl.thr * dt;
      }
      if (ctl.brk > 0) {
        if (fwd > 0.1) fwd = Math.max(0, fwd - C.brake * dt);
        else if (C.controlMode !== 'street') fwd = Math.max(-C.reverseSpeed, fwd - 3 * dt);
      }
      const grass = W.surface(p.x, p.y) === 'grass';
      fwd -= (C.drag + (grass ? C.grassDrag : 0)) * fwd * dt;
      const roll = C.rollDrag * dt;
      fwd = Math.abs(fwd) <= roll ? 0 : fwd - Math.sign(fwd) * roll;
      if (fwd > maxSp) fwd -= (fwd - maxSp) * 2.5 * dt;

      const sp = Math.abs(fwd);
      const base = U.lerp(C.turnLowSpeed, C.turnRate, U.smooth(0, 3, sp)) / (1 + C.turnFalloff * sp);
      let omega;
      if (C.controlMode === 'street') omega = streetOmega(p, C, 1);
      else if (p.drift) {
        const tight = (p.steer * p.drift.dir + 1) / 2;
        omega = p.drift.dir * base * U.lerp(C.driftTurnMin, C.driftTurnMax, tight);
      } else omega = p.steer * base * (fwd < -0.1 ? -1 : 1);
      p.omega = omega;
      p.heading += omega * dt;

      // re-project velocity on the new heading; grip eats the sideways part, some of it returns as speed
      const vx = ch * fwd - sh * lat, vy = sh * fwd + ch * lat;
      const nc = Math.cos(p.heading), ns = Math.sin(p.heading);
      let f2 = vx * nc + vy * ns;
      const l2 = -vx * ns + vy * nc;
      const l3 = l2 * Math.exp(-(p.drift ? C.driftGrip : C.grip) * dt);
      const gained = (l2 * l2 - l3 * l3) * (p.drift ? C.driftKeep : C.gripKeep);
      f2 = (f2 < 0 ? -1 : 1) * Math.sqrt(f2 * f2 + gained);
      p.vx = nc * f2 - ns * l3;
      p.vy = ns * f2 + nc * l3;
      if (p.drift) g.sparks(p, p.drift.level);
    } else {
      p.airT += dt;
      p.vz -= C.gravity * dt;
      const om = C.controlMode === 'street' ? streetOmega(p, C, C.airSteer) : p.steer * C.turnRate * C.airSteer;
      p.omega = om;
      p.heading += om * dt;
      const c = Math.cos(om * dt), s = Math.sin(om * dt);
      const vx = p.vx * c - p.vy * s;
      p.vy = p.vx * s + p.vy * c;
      p.vx = vx;
      let n = advTrick(p.spin, dt);
      if (n) g.award(n === 1 ? '360' : 360 * n + '°', C.spinPts * n, '#7fd4ff');
      n = advTrick(p.whip, dt);
      if (n) g.award(n === 1 ? 'ТЕЙЛВИП' : 'ТЕЙЛВИП ×' + n, C.whipPts * n, '#7fd4ff');
    }
    if (p.boostT > 0) g.trail(p);

    moveAxis(p, p.vx * dt, 0, g);
    if (p.state !== 'ride') return;
    moveAxis(p, 0, p.vy * dt, g);
    if (p.state !== 'ride') return;
    collideSolids(p, g);
    if (p.state !== 'ride') return;

    const gz = W.groundZ(p.x, p.y);
    if (p.grounded) {
      if (gz < p.z - 0.03) {
        // rolled off an edge: a ramp lip launches, a curb is a tiny drop
        p.grounded = false;
        p.vz = Math.max(0, p.rampVz) * C.rampLaunch;
        p.airT = 0;
        if (p.vz > 2) { g.emit('launch'); startTricks(p, g); }
      } else {
        p.z = gz;
        p.rampVz = W.rampVz(p.x, p.y, p.vx, p.vy);
      }
    } else {
      p.z += p.vz * dt;
      if (p.vz <= 0 && p.grindCD <= 0 && tryGrind(p, g)) return;
      if (p.z <= gz) land(p, gz, inp, g);
    }
  }

  // street mode: A/D lean the nose toward a side of the street, releasing brings it back to forward.
  // In a drift the nose swings further out and the low grip turns that into a slide across the street.
  function streetOmega(p, C, k) {
    let want = FWD_ANGLE + p.steer * C.streetAngle;
    if (p.drift) {
      const tight = (p.steer * p.drift.dir + 1) / 2;
      want = FWD_ANGLE + p.drift.dir * U.lerp(C.streetDriftMin, C.streetDriftMax, tight);
    }
    return U.clamp(U.wrap(want - p.heading) * C.streetTurn * k, -C.streetMaxOmega, C.streetMaxOmega);
  }

  // pick a trick that fits the jump: estimate the airtime, then as many 360s as fit, sometimes with a tailwhip.
  // Each trick turns at the rate that finishes it a little before touchdown.
  function startTricks(p, g) {
    const C = SK.CFG, W = g.world;
    let T = 2 * p.vz / C.gravity;
    for (let it = 0; it < 2; it++) {
      const zl = W.groundZ(p.x + p.vx * T, p.y + p.vy * T);
      T = (p.vz + Math.sqrt(Math.max(0, p.vz * p.vz + 2 * C.gravity * (p.z - zl)))) / C.gravity;
    }
    p.spin = null;
    p.whip = null;
    const span = T * 0.85;
    if (span < C.spinTime * 0.8) return;
    const r = g.rng();
    const spins = Math.min(3, Math.max(1, Math.floor(span / C.spinTime)));
    const big = span > C.spinTime * 1.6;
    if (big || r < 0.6) p.spin = { dir: g.rng() < 0.5 ? -1 : 1, ang: 0, target: TAU * spins, done: 0, rate: TAU * spins / span };
    if (big ? g.rng() < 0.6 : r >= 0.6) p.whip = { ang: 0, target: TAU, done: 0, rate: TAU / span };
  }

  function advTrick(t, dt) {
    if (!t) return 0;
    t.ang = Math.min(t.target, t.ang + t.rate * dt);
    const n = Math.floor(t.ang / TAU + 1e-6);
    if (n > t.done) { t.done = n; return n; }
    return 0;
  }
  // an unfinished rotation on touchdown snaps round and still counts: tricks are just for fun
  function settleTricks(p, g) {
    const C = SK.CFG;
    if (p.spin) { const n = Math.round(p.spin.target / TAU); if (n > p.spin.done) g.award(n === 1 ? '360' : 360 * n + '°', C.spinPts * n, '#7fd4ff'); }
    if (p.whip) { const n = Math.round(p.whip.target / TAU); if (n > p.whip.done) g.award(n === 1 ? 'ТЕЙЛВИП' : 'ТЕЙЛВИП ×' + n, C.whipPts * n, '#7fd4ff'); }
    p.spin = null;
    p.whip = null;
  }

  function moveAxis(p, dx, dy, g) {
    if (!dx && !dy) return;
    const C = SK.CFG, W = g.world;
    const nx = p.x + dx, ny = p.y + dy;
    const rise = W.groundZ(nx, ny) - p.z;
    if (rise > C.maxStep) {
      // ramp side or back: acts like a wall
      const impact = Math.abs(dx ? p.vx : p.vy);
      if (impact > C.crashImpact && p.state === 'ride') { Pl.crash(p, g, 'wall'); return; }
      if (dx) p.vx = -p.vx * C.wallBounce; else p.vy = -p.vy * C.wallBounce;
      if (impact > 2) g.emit('bump', { v: impact });
      return;
    }
    if (p.grounded && rise > 0.05 && p.curbCD <= 0 && !W.isLowered(nx, ny)) {
      p.curbCD = 0.25;
      if (Math.hypot(p.vx, p.vy) > C.curbMinSpeed) {
        p.vx *= C.curbPenalty;
        p.vy *= C.curbPenalty;
        p.wobble = 1;
        g.cam.shake = Math.min(1, g.cam.shake + 0.12);
        g.emit('curb');
      }
    }
    p.x = nx;
    p.y = ny;
  }

  function collideSolids(p, g) {
    const C = SK.CFG;
    for (let it = 0; it < 2; it++) {
      const cs = g.world.collide(p.x, p.y, C.radius, p.z);
      if (!cs.length) return;
      for (const c of cs) {
        p.x += c.nx * c.depth;
        p.y += c.ny * c.depth;
        const vn = -(p.vx * c.nx + p.vy * c.ny);
        if (vn <= 0) continue;
        if (vn > C.crashImpact && p.state === 'ride') { Pl.crash(p, g, 'wall'); return; }
        p.vx += c.nx * vn * (1 + C.wallBounce);
        p.vy += c.ny * vn * (1 + C.wallBounce);
        const tf = 1 - Math.min(1, vn / 14) * C.wallFriction;
        p.vx *= tf;
        p.vy *= tf;
        if (vn > 2) g.emit('bump', { v: vn });
      }
    }
  }

  function land(p, gz, inp, g) {
    const C = SK.CFG;
    const fall = -p.vz;
    p.z = gz;
    p.vz = 0;
    p.grounded = true;
    settleTricks(p, g);
    if (p.airT > C.airMin) g.award('ВОЗДУХ', Math.round(C.airPts * p.airT), '#b8f27c');
    g.emit('land', { v: fall });
    if (g.tower) SK.Tower.land(g.tower, fall, g);
    if (fall > 4) g.cam.shake = Math.min(1, g.cam.shake + Math.min(0.35, fall * 0.04));
    const sp = Math.hypot(p.vx, p.vy);
    if (!p.drift && inp.hop && Math.abs(p.steerIn) > 0.3 && sp > C.driftMinSpeed) {
      p.drift = { dir: Math.sign(p.steerIn), t: 0, level: 0 };
      g.emit('driftStart');
    }
    p.airT = 0;
  }

  function endDrift(p, g) {
    const C = SK.CFG, d = p.drift;
    p.drift = null;
    if (!d || d.level === 0) return;
    const kick = d.level === 2 ? C.boostKick2 : C.boostKick1;
    p.vx += Math.cos(p.heading) * kick;
    p.vy += Math.sin(p.heading) * kick;
    p.boostT = d.level === 2 ? C.boostTime2 : C.boostTime1;
    g.emit('boost', { level: d.level });
    g.award(d.level === 2 ? 'СУПЕР-ДРИФТ' : 'ДРИФТ', d.level === 2 ? C.driftPts2 : C.driftPts1, '#ffb02e');
  }

  function tryGrind(p, g) {
    const C = SK.CFG;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp < 2) return false;
    for (const r of g.world.near('rails', p.x, p.y, 1)) {
      const cp = U.segClosest(p.x, p.y, r.ax, r.ay, r.bx, r.by);
      if (cp.t <= 0.02 || cp.t >= 0.98) continue;
      if (Math.hypot(p.x - cp.x, p.y - cp.y) > C.grindCatchR) continue;
      const dz = p.z - r.top;
      if (dz > 0.5 || dz < -C.grindCatchZ) continue;
      const along = p.vx * r.ux + p.vy * r.uy;
      if (Math.abs(along) < sp * Math.cos(C.grindMaxAngle)) continue;
      settleTricks(p, g);
      p.state = 'grind';
      p.drift = null;
      p.grind = { rail: r, s: cp.t * r.len, dir: Math.sign(along), speed: Math.max(C.grindMinSpeed, Math.abs(along)), t: 0 };
      p.x = cp.x;
      p.y = cp.y;
      p.z = r.top;
      p.vz = 0;
      p.grounded = false;
      p.heading = Math.atan2(r.uy * p.grind.dir, r.ux * p.grind.dir);
      g.emit('grindStart');
      g.award('ГРАЙНД', C.grindStartPts, '#7fd4ff');
      return true;
    }
    return false;
  }

  function updateGrind(p, dt, inp, g) {
    const C = SK.CFG, gr = p.grind, r = gr.rail;
    const ctl = controls(p, inp, C);
    p.steerIn = ctl.steer;
    gr.t += dt;
    gr.speed = Math.max(0, gr.speed - C.grindFriction * dt);
    gr.s += gr.dir * gr.speed * dt;
    p.x = r.ax + r.ux * gr.s;
    p.y = r.ay + r.uy * gr.s;
    p.z = r.top;
    p.vx = r.ux * gr.dir * gr.speed;
    p.vy = r.uy * gr.dir * gr.speed;
    p.vz = 0;
    p.omega = 0;
    g.flow(C.grindPts * dt);
    const off = gr.s < 0 || gr.s > r.len;
    if (inp.hopPressed || off || gr.speed < 1.5) {
      p.state = 'ride';
      p.grind = null;
      p.grounded = false;
      p.airT = 0;
      p.grindCD = 0.2;
      p.vz = inp.hopPressed ? C.hopVz * 0.9 : 1.2;
      startTricks(p, g);
      if (inp.hopPressed && ctl.steer) {
        // hop off sideways in the steering direction
        const a = ctl.steer * 0.35, c = Math.cos(a), s = Math.sin(a);
        const vx = p.vx * c - p.vy * s;
        p.vy = p.vx * s + p.vy * c;
        p.vx = vx;
        p.heading += a;
      }
      g.emit(inp.hopPressed ? 'hop' : 'grindEnd');
    }
  }

  Pl.crash = function (p, g, cause) {
    if (p.state === 'crash') return;
    p.state = 'crash';
    p.crashT = 0;
    p.crashCause = cause;
    p.drift = null;
    p.spin = null;
    p.whip = null;
    p.grind = null;
    p.boostT = 0;
    const sp = Math.hypot(p.vx, p.vy);
    p.rag = { x: p.x, y: p.y, z: p.z + 0.9, vx: p.vx * 0.9, vy: p.vy * 0.9, vz: 2.5 + sp * 0.15, rot: 0, vr: 6 + sp * 0.6, heading: p.heading };
    p.vx *= 0.5;
    p.vy *= 0.5;
    SK.Score.crash(g.score, g);
    if (g.tower) SK.Tower.collapse(g.tower, g);
    g.emit('crash', { cause });
    g.cam.shake = Math.min(1, g.cam.shake + 0.6);
  };

  function updateCrash(p, dt, g) {
    const C = SK.CFG, W = g.world;
    p.crashT += dt;
    p.omega = 0;
    const f = Math.exp(-3 * dt);
    p.vx *= f;
    p.vy *= f;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    collideSolids(p, g);
    const gz = W.groundZ(p.x, p.y);
    if (p.z > gz) { p.vz -= C.gravity * dt; p.z = Math.max(gz, p.z + p.vz * dt); } else { p.z = gz; p.vz = 0; }

    const r = p.rag;
    r.vz -= C.gravity * dt;
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    r.z += r.vz * dt;
    const rg = W.groundZ(r.x, r.y) + 0.2;
    if (r.z < rg) {
      r.z = rg;
      if (r.vz < 0) r.vz = -r.vz * 0.3;
      const k = Math.exp(-5 * dt);
      r.vx *= k;
      r.vy *= k;
      r.vr *= Math.exp(-4 * dt);
    }
    r.rot += r.vr * dt;
    for (const c of W.collide(r.x, r.y, 0.3, r.z - 0.2)) {
      r.x += c.nx * c.depth;
      r.y += c.ny * c.depth;
      const vn = -(r.vx * c.nx + r.vy * c.ny);
      if (vn > 0) { r.vx += c.nx * vn * 1.3; r.vy += c.ny * vn * 1.3; }
    }

    if (p.crashT > C.crashTime) {
      p.state = 'ride';
      p.vx = 0;
      p.vy = 0;
      p.vz = 0;
      p.grounded = true;
      p.z = gz;
      p.steer = 0;
      p.invulnT = C.invulnTime;
      p.rag = null;
      g.emit('recover');
    }
  }

  SK.Player = Pl;
})();
