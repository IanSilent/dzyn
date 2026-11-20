// Fixed-step simulation (120 Hz). No DOM here, so tools/check.js can run it in node.
// step(dt, input) advances everything; frame(realDt) feeds it from the keyboard; advance(sec, fn) is for tests.
(function () {
  const SK = window.SK, U = SK.U;
  const DT = 1 / 120;
  const NONE = {};
  const G = { DT };

  G.init = function (opts) {
    opts = opts || {};
    this.seed = opts.seed || 7;
    this.world = SK.World.create(this.seed);
    this.rng = U.rng(this.seed * 31 + 1);
    this.pedDensity = opts.peds != null ? opts.peds : SK.CFG.pedsPerChunk;
    this.peds = SK.Peds.create(this.rng);
    this.hitchDensity = opts.hitch != null ? opts.hitch : SK.CFG.hitchPerChunk;
    for (const row of this.world.rows.values()) spawnRow(this, row);
    this.tower = SK.Tower.create();
    this.score = SK.Score.create();
    // juice: callouts are big centre-screen words, hearts fly from a scared person into the stream counter,
    // marks are "!" over heads, flash tints the screen edges, slowT is a brief slow motion on a close call
    this.fx = { popups: [], particles: [], rings: [], callouts: [], hearts: [], marks: [], flash: null, heartsIn: 0 };
    this.streak = { n: 0, t: 0 };
    this.slowT = 0;
    this.events = [];
    this.t = 0;
    this.acc = 0;
    this.bellCD = 0;
    const sp = this.world.spawn;
    this.player = SK.Player.create(sp.x, sp.y, sp.heading, this.world.groundZ(sp.x, sp.y));
    this.cam = { x: sp.x, y: sp.y, zoom: 1, shake: 0 };
    this.startY = sp.y;
    this.dist = 0;
    try { this.best = +localStorage.getItem('dzyn.best') || 0; } catch (e) { this.best = 0; }
  };

  G.addPed = function (x, y) { return SK.Peds.add(this.peds, this.world, x, y); };

  G.emit = function (type, data) {
    const e = data || {};
    e.type = type;
    this.events.push(e);
    if (this.events.length > 300) this.events.shift();
  };
  G.drain = function () { const e = this.events; this.events = []; return e; };

  G.place = function (x, y, heading, speed) {
    const p = this.player;
    Object.assign(p, SK.Player.create(x, y, heading, this.world.groundZ(x, y)));
    p.vx = Math.cos(heading) * (speed || 0);
    p.vy = Math.sin(heading) * (speed || 0);
    p.invulnT = 0;
    this.cam.x = x;
    this.cam.y = y;
  };

  // every passenger on the tower raises the payout
  G.award = function (label, pts, color, x, y, z) {
    const p = this.player;
    pts = Math.round(pts * SK.Tower.mult(this.tower));
    SK.Score.add(this.score, pts);
    this.popup(x != null ? x : p.x, y != null ? y : p.y, (z != null ? z : p.z) + 2.1, label + ' +' + pts, color || '#fff', pts);
    this.emit('score', { label, pts, chain: this.score.chain });
  };
  G.flow = function (pts) { SK.Score.flow(this.score, pts); };
  G.popup = function (x, y, z, text, color, pts) {
    const list = this.fx.popups;
    list.push({ x, y, z, text, color, t: 0, life: 1.3, size: pts >= 80 ? 1.5 : pts >= 30 ? 1.2 : 1 });
    if (list.length > 40) list.shift();
  };

  // ---------- juice ----------
  const STREAK_WORDS = [[25, 'ЛЕГЕНДА РАЙОНА'], [15, 'БЕЗУМИЕ'], [10, 'ОГОНЬ'], [6, 'ЖЕСТЬ'], [3, 'ЕЩЁ!']];
  G.callout = function (text, sub, color, size) {
    const list = this.fx.callouts;
    for (const c of list) c.old = true;
    list.push({ text, sub, color, size: size || 1, t: 0, life: 1.15, tilt: (this.rng() - 0.5) * 0.12 });
    if (list.length > 3) list.shift();
  };
  G.hearts = function (x, y, z, n, color) {
    for (let i = 0; i < n; i++) {
      this.fx.hearts.push({ x, y, z, t: -i * 0.04, life: 0.75, color, dx: (this.rng() - 0.5) * 2, dy: -this.rng() });
    }
    if (this.fx.hearts.length > 80) this.fx.hearts.splice(0, this.fx.hearts.length - 80);
  };
  G.burst = function (x, y, z, n, colors, speed) {
    const r = this.rng, list = this.fx.particles;
    for (let i = 0; i < n; i++) {
      const a = r() * U.TAU, v = speed * (0.5 + r());
      list.push({ x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 2 + r() * 4, t: 0, life: 0.4 + r() * 0.4, color: U.pick(r, colors), size: 0.07 + r() * 0.06 });
    }
    if (list.length > 400) list.splice(0, list.length - 400);
  };
  // one more person annoyed in a row: the streak grows and says so
  function streakUp(g, by) {
    const s = g.streak;
    s.n = s.t > 0 ? s.n + by : by;
    s.t = SK.CFG.comboTime;
    if (s.n < 2) return;
    let word = '';
    for (const [k, w] of STREAK_WORDS) if (s.n >= k) { word = w; break; }
    const hot = Math.min(1, s.n / 15);
    g.callout('СЕРИЯ ×' + s.n, word, hot > 0.6 ? '#ff4fd8' : hot > 0.3 ? '#ff7a3d' : '#ffe14d', 1 + hot * 0.5);
    g.emit('streak', { n: s.n });
  }

  const SPARK = ['#a8d8ff', '#ffb02e', '#ff4fd8'];
  G.sparks = function (p, level) {
    const r = this.rng, list = this.fx.particles;
    if (r() > 0.5 + level * 0.25) return;
    const c = Math.cos(p.heading), s = Math.sin(p.heading);
    list.push({
      x: p.x - c * 0.45, y: p.y - s * 0.45, z: p.z + 0.05,
      vx: -c * 2 + (r() - 0.5) * 3, vy: -s * 2 + (r() - 0.5) * 3, vz: 1 + r() * 2,
      t: 0, life: 0.25 + r() * 0.2, color: SPARK[level], size: 0.05 + level * 0.02,
    });
    if (list.length > 400) list.shift();
  };
  G.trail = function (p) {
    const r = this.rng;
    if (r() > 0.6) return;
    this.fx.particles.push({
      x: p.x + (r() - 0.5) * 0.3, y: p.y + (r() - 0.5) * 0.3, z: p.z + 0.3 + r() * 0.8,
      vx: 0, vy: 0, vz: 0, t: 0, life: 0.35, color: '#7ff0ff', size: 0.09, streak: true,
    });
  };

  G.step = function (dt, inp) {
    this.t += dt;
    if (inp.resetPressed) {
      const sp = this.world.spawn;
      // a fresh run: back to the start of a fresh city
      this.init({ seed: this.seed, peds: this.pedDensity, hitch: this.hitchDensity });
      return;
    }
    SK.Player.update(this.player, dt, inp, this);
    SK.Tower.update(this.tower, dt, this);
    streamWorld(this);
    SK.Peds.update(this.peds, dt, this);
    interact(this, inp, dt);
    SK.Score.tick(this.score, dt, this);
    updateFx(this, dt);
    updateCam(this, dt);
  };

  G.frame = function (realDt) {
    realDt = Math.min(realDt, 0.1);
    if (this.slowT > 0) { this.slowT -= realDt; realDt *= SK.CFG.slowMoScale; }
    this.acc += realDt;
    while (this.acc >= DT) { this.step(DT, SK.input.sample()); this.acc -= DT; }
  };

  G.advance = function (sec, inputFn) {
    const n = Math.round(sec / DT);
    for (let i = 0; i < n; i++) this.step(DT, inputFn ? inputFn(this.t, i) : NONE);
  };

  function spawnRow(g, row) {
    SK.Peds.spawnRow(g.peds, g.world, row, g.pedDensity);
    SK.Peds.spawnHitch(g.peds, g.world, row, g.hitchDensity);
  }

  // generate rows ahead, drop rows behind, keep pedestrians in step; track the distance record
  function streamWorld(g) {
    const ch = g.world.update(g.player.y);
    for (const row of ch.added) spawnRow(g, row);
    if (ch.removed.length) SK.Peds.dropRows(g.peds, ch.removed, g.world);
    const d = Math.max(0, g.startY - g.player.y);
    if (d > g.dist) g.dist = d;
    if (g.dist > g.best + 1) {
      g.best = g.dist;
      try { localStorage.setItem('dzyn.best', String(Math.round(g.best))); } catch (e) { /* ignore */ }
    }
  }

  function interact(g, inp, dt) {
    const C = SK.CFG, p = g.player, S = g.peds;
    g.bellCD -= dt;
    if (p.state === 'crash') { for (const d of S.list) d.nm.inside = false; return; }
    const sp = Math.hypot(p.vx, p.vy);

    if (inp.bellPressed && g.bellCD <= 0) {
      // the passengers shout along: a taller tower is heard further
      const n = SK.Tower.count(g.tower), bellR = C.bellR + n * C.paxBellR;
      g.bellCD = C.bellCooldown;
      g.emit('bell', { n });
      g.fx.rings.push({ x: p.x, y: p.y, z: p.z, t: 0, r: bellR }, { x: p.x, y: p.y, z: p.z, t: -0.12, r: bellR * 0.8 });
      g.cam.punch = 0.6;
      g.cam.shake = Math.min(1, g.cam.shake + 0.15);
      if (n) SK.Tower.say(g.tower, g.rng, 'bell');
      let hits = 0;
      for (const d of S.list) {
        if (d.hitch || d.state === 'down' || d.state === 'getup' || d.cd.scare > 0) continue;
        const dist = Math.hypot(d.x - p.x, d.y - p.y);
        if (dist > bellR) continue;
        const pts = Math.max(1, Math.round(d.T.scare * (0.6 + 0.8 * (1 - dist / bellR)) / (1 + d.annoy * 0.5)));
        d.annoy += 1;
        d.cd.scare = C.scareCooldown;
        SK.Peds.react(S, d, 'bell', g);
        g.award('ДЗЫНЬ!', pts, '#ffe14d', d.x, d.y, d.z);
        g.fx.marks.push({ d, t: 0 });
        g.hearts(d.x, d.y, d.z + d.h, Math.min(5, 1 + Math.round(pts / 6)), '#ffe14d');
        hits++;
      }
      if (hits) {
        streakUp(g, hits);
        g.fx.flash = { color: '255,225,77', t: 0, life: 0.35, a: Math.min(0.5, 0.2 + hits * 0.07) };
      }
      if (hits >= 3) {
        g.award('ПАНИКА ×' + hits, hits * 10, '#ff7a3d');
        g.callout('ПАНИКА ×' + hits, 'весь тротуар в шоке', '#ff7a3d', 1.4);
        g.cam.shake = Math.min(1, g.cam.shake + 0.3);
        g.emit('panic', { n: hits });
      } else if (hits === 0) g.popup(p.x, p.y, p.z + 2.4, 'дзынь…', '#9aa0aa', 0);
    }

    for (let k = S.list.length - 1; k >= 0; k--) {
      const d = S.list[k];
      const dx = d.x - p.x, dy = d.y - p.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) { d.nm.inside = false; continue; }
      if (d.hitch) {
        if (Math.hypot(dx, dy) < C.paxPickR && p.z - d.z < 1.5 && SK.Tower.count(g.tower) < C.paxMax) SK.Tower.pickup(g.tower, d, g);
        continue;
      }
      if (d.state === 'down' || d.state === 'getup') { d.nm.inside = false; continue; }
      const dist = Math.hypot(dx, dy);
      const above = p.z - d.z;
      if (dist < C.hitR && above < d.h * 0.75) {
        if (p.invulnT > 0) continue;
        if (sp > C.hitMinSpeed) {
          SK.Peds.react(S, d, 'hit', g);
          g.popup(d.x, d.y, d.z + 2.2, 'ДТП!', '#ff5a5a', 0);
          g.emit('hitPed');
          SK.Player.crash(p, g, 'ped');
          return;
        }
        const l = dist || 1;
        d.x += dx / l * (C.hitR - dist);
        d.y += dy / l * (C.hitR - dist);
        continue;
      }
      if (dist < C.overR && above > C.overH && d.cd.over <= 0) {
        d.cd.over = 2;
        d.cd.near = 1.5;
        d.nm.inside = false;
        SK.Peds.react(S, d, 'over', g);
        g.award('ПЕРЕПРЫГ', C.overPts, '#ff7ad9', d.x, d.y, d.z);
        continue;
      }
      if (dist < C.nearMissR && sp > C.nearMinSpeed && above < d.h) {
        if (!d.nm.inside) { d.nm.inside = true; d.nm.minD = dist; d.nm.sp = sp; }
        else { d.nm.minD = Math.min(d.nm.minD, dist); d.nm.sp = Math.max(d.nm.sp, sp); }
      } else if (d.nm.inside && dist > C.nearMissR * 1.1) {
        d.nm.inside = false;
        if (d.cd.near > 0) continue;
        d.cd.near = 1.5;
        const close = U.clamp(1 - (d.nm.minD - C.hitR) / (C.nearMissR - C.hitR), 0, 1);
        const spF = U.clamp(d.nm.sp / C.maxSpeed, 0.4, 1.4);
        const pts = Math.round((C.nearBase + C.nearBonus * close * close) * spF);
        SK.Peds.react(S, d, 'near', g);
        const tight = close > 0.75;
        g.award(tight ? 'ВПРИТИРКУ!' : 'БЛИЗКО', pts, tight ? '#ff7a3d' : '#ffd36b', d.x, d.y, d.z);
        g.burst(d.x, d.y, d.z + 1, tight ? 18 : 8, tight ? ['#ff7a3d', '#ffe14d', '#ffffff'] : ['#ffd36b', '#ffffff'], tight ? 4 : 2.5);
        g.hearts(d.x, d.y, d.z + d.h, tight ? 4 : 2, '#ff5c93');
        g.cam.punch = Math.max(g.cam.punch || 0, tight ? 1 : 0.4);
        if (tight) {
          g.slowT = C.slowMoTime;
          g.fx.flash = { color: '255,122,61', t: 0, life: 0.3, a: 0.35 };
        }
        streakUp(g, 1);
        g.emit('near', { close, streak: g.streak.n });
      }
    }
  }

  function updateFx(g, dt) {
    const fx = g.fx;
    for (const q of fx.popups) q.t += dt;
    fx.popups = fx.popups.filter((q) => q.t < q.life);
    for (const q of fx.particles) {
      q.t += dt;
      q.vz -= 9 * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z = Math.max(0, q.z + q.vz * dt);
    }
    fx.particles = fx.particles.filter((q) => q.t < q.life);
    for (const q of fx.rings) q.t += dt;
    fx.rings = fx.rings.filter((q) => q.t < 0.5);
    for (const q of fx.callouts) q.t += dt;
    fx.callouts = fx.callouts.filter((q) => q.t < q.life);
    for (const q of fx.hearts) { q.t += dt; if (q.t >= q.life && !q.in) { q.in = true; fx.heartsIn++; } }
    fx.hearts = fx.hearts.filter((q) => q.t < q.life);
    for (const q of fx.marks) q.t += dt;
    fx.marks = fx.marks.filter((q) => q.t < 0.7);
    if (fx.flash && (fx.flash.t += dt) > fx.flash.life) fx.flash = null;
    if (g.streak.t > 0) g.streak.t -= dt;
  }

  function updateCam(g, dt) {
    const C = SK.CFG, p = g.player, c = g.cam;
    // look where you are going, plus a constant nudge forward along the strip (-y)
    const tx = p.x + p.vx * C.lookAhead, ty = p.y + p.vy * C.lookAhead - C.forwardBias;
    const k = 1 - Math.exp(-C.camLerp * dt);
    c.x += (tx - c.x) * k;
    c.y += (ty - c.y) * k;
    const sp = Math.hypot(p.vx, p.vy);
    const zt = U.lerp(1, C.zoomAtMax, U.clamp(sp / C.maxSpeed, 0, 1.3));
    c.zoom += (zt - c.zoom) * (1 - Math.exp(-1.5 * dt));
    c.shake = Math.max(0, c.shake - dt * 2);
    c.punch = Math.max(0, (c.punch || 0) - dt * 5);
    const lift = Math.min(SK.Tower.height(g.tower), 14) * 0.45;
    c.lift = (c.lift || 0) + (lift - (c.lift || 0)) * (1 - Math.exp(-2 * dt));
  }

  SK.game = G;
})();
