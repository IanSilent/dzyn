// Passengers. Hitchhikers wave at the curb; ride into one and they climb onto the top of a tower of people
// standing on the rider's shoulders. Every passenger raises the payout of everything you do.
// The tower is a damped spring (two axes: roll across the street, pitch along it) driven by the scooter's
// acceleration. The axes are the street's, not the scooter's, so the sway always reads on the iso screen: every swing of the nose kicks it, and a taller tower is softer and swings wider. Past
// towerMax the top passengers fly off. A lamp head or a tree crown at their height knocks off everyone from
// that level up. A crash throws the whole tower. Fallen passengers get up and walk away as pedestrians.
(function () {
  const SK = window.SK, U = SK.U;
  const T = {};
  const LINES = {
    pick: ['Подбросишь?', 'Мне до метро!', 'Я с вами!', 'Двигайтесь!', 'Ещё один влезет!', 'По тройному тарифу!', 'Я только до угла!'],
    ride: ['Гони!', 'Мне на следующей', 'Я снимаю!', 'Держитесь крепче!', 'Кто наступил мне на голову?', 'Нас тут двое по паспорту', 'Не тряси!', 'А шлем кому-нибудь дали?'],
    fall: ['Аааа!', 'Я выхожу!', 'Остановите здесь!', 'Верните деньги!', 'Мама!'],
    ground: ['Ну и водитель!', 'Одна звезда!', 'Чаевых не будет!', 'Я на тебя жалобу!', 'Где тут выход?'],
    bell: ['ДЗЫНЬ!', 'С дороги!', 'Посторонись!', 'Би-бип!'],
  };
  T.LINES = LINES;
  const SHOULDER = 1.45; // rider's shoulders above the deck
  const POSES = ['stand', 'stand', 'sit', 'hand'];

  T.create = () => ({ pax: [], flyers: [], roll: 0, vroll: 0, pitch: 0, vpitch: 0, squash: 0, bubble: null, chatT: 3, pvx: 0, pvy: 0 });

  T.count = (tw) => tw.pax.length;
  T.mult = (tw) => 1 + tw.pax.length * SK.CFG.paxBonus;

  // height a passenger takes up in the tower, by pose
  function span(q) {
    if (q.pose === 'sit') return 0.95;
    if (q.pose === 'hand') return q.d.h + 0.05;
    return SHOULDER * q.d.h / 1.75;
  }
  // base height (relative to the deck) of every passenger, plus the top
  T.levels = function (tw, crouch) {
    const out = [];
    let z = SHOULDER - (crouch || 0);
    for (const q of tw.pax) { out.push(z); z += span(q); }
    out.push(z);
    return out;
  };
  // how far the tower reaches above the deck; 0 with nobody on board
  T.height = (tw) => (tw.pax.length ? T.levels(tw)[tw.pax.length] + 0.35 : 0);

  function say(tw, rng, kind) { tw.bubble = { text: U.pick(rng, LINES[kind]), t: 1.8 }; }
  T.say = say;

  T.pickup = function (tw, d, g) {
    const S = g.peds, C = SK.CFG;
    S.list.splice(S.list.indexOf(d), 1);
    d.hitch = false;
    d.bubble = null;
    let pose = d.type === 'baba' ? 'sit' : U.pick(g.rng, POSES);
    if (d.type === 'phone') pose = 'stand';
    tw.pax.push({ d, pose, join: 0, fx: d.x, fy: d.y, fz: d.z, wave: g.rng() * 6.28 });
    tw.vroll += (g.rng() - 0.5) * 0.6;
    say(tw, g.rng, 'pick');
    g.emit('pickup', { n: tw.pax.length });
    g.award('ПАССАЖИР ×' + tw.pax.length, C.paxPickPts, '#8cff9e', d.x, d.y, d.z);
  };

  // passengers from index i up leave the tower and fly
  T.knock = function (tw, i, g, side, why) {
    const p = g.player, lv = T.levels(tw);
    const gone = tw.pax.splice(i);
    if (!gone.length) return 0;
    for (let k = 0; k < gone.length; k++) {
      const q = gone[k], z = p.z + lv[i + k] + 0.6;
      const off = tw.roll * (lv[i + k] + 0.6);
      const r = g.rng;
      tw.flyers.push({
        d: q.d, t: 0,
        x: p.x + off, y: p.y, z,
        vx: p.vx * 0.7 + side * (2 + r() * 2) + (r() - 0.5) * 1.5,
        vy: p.vy * 0.7 + (r() - 0.5) * 1.5,
        vz: 1.5 + r() * 2.5, rot: r() * 6, vr: (r() < 0.5 ? -1 : 1) * (5 + r() * 6), heading: p.heading,
      });
    }
    tw.flyers[tw.flyers.length - 1].d.bubble = { text: U.pick(g.rng, LINES.fall), t: 1.4 };
    g.emit('paxFall', { n: gone.length });
    if (why !== 'crash') g.popup(p.x, p.y, p.z + lv[i] + 1, gone.length > 1 ? 'МИНУС ' + gone.length + ' ПАССАЖИРА' : 'ПАССАЖИР ВЫПАЛ', '#ff8a8a', 0);
    return gone.length;
  };

  T.collapse = function (tw, g) {
    if (!tw.pax.length) return;
    T.knock(tw, 0, g, tw.roll >= 0 ? 1 : -1, 'crash');
    tw.roll = tw.vroll = tw.pitch = tw.vpitch = 0;
  };

  T.update = function (tw, dt, g) {
    const C = SK.CFG, p = g.player, n = tw.pax.length;
    // acceleration of the scooter in its own frame: what the people on top feel
    const ax = (p.vx - tw.pvx) / dt, ay = (p.vy - tw.pvy) / dt;
    tw.pvx = p.vx; tw.pvy = p.vy;
    if (tw.bubble && (tw.bubble.t -= dt) <= 0) tw.bubble = null;
    tw.squash = Math.max(0, tw.squash - dt * 4);
    for (const q of tw.pax) q.join = Math.min(1, q.join + dt / 0.35);
    updateFlyers(tw, dt, g);
    if (!n || p.state === 'crash') { tw.roll += (0 - tw.roll) * Math.min(1, dt * 6); tw.vroll = 0; tw.pitch = 0; tw.vpitch = 0; return; }

    const aLat = U.clamp(ax, -150, 150), aFwd = U.clamp(-ay, -150, 150); // the street runs toward -y
    const w = C.towerFreq / Math.sqrt(1 + C.towerSoften * (n - 1));
    const drive = C.towerDrive * (1 + C.towerTall * (n - 1));
    const damp = 2 * C.towerDamp * w;
    tw.vroll += (-w * w * tw.roll - damp * tw.vroll - aLat * drive) * dt;
    tw.vpitch += (-w * w * tw.pitch - damp * tw.vpitch - aFwd * drive * 0.5) * dt;
    tw.roll += tw.vroll * dt;
    tw.pitch += tw.vpitch * dt;

    const lean = Math.hypot(tw.roll, tw.pitch);
    if (lean > C.towerMax) {
      const k = Math.min(n, 1 + Math.floor((lean - C.towerMax) / 0.2));
      T.knock(tw, n - k, g, tw.roll >= 0 ? 1 : -1, 'sway');
      const f = C.towerMax * 0.6 / lean;
      tw.roll *= f; tw.pitch *= f; tw.vroll *= 0.3; tw.vpitch *= 0.3;
    }
    if (tw.pax.length) clipProps(tw, g);

    if (tw.pax.length && (tw.chatT -= dt) <= 0) {
      tw.chatT = 3 + g.rng() * 4;
      if (!tw.bubble) say(tw, g.rng, 'ride');
    }
  };

  // landing: the tower squashes and gets a random sideways shove
  T.land = function (tw, fall, g) {
    if (!tw.pax.length) return;
    tw.squash = Math.min(1, fall / 6);
    tw.vroll += (g.rng() - 0.5) * 2 * fall * SK.CFG.towerLandKick;
    tw.vpitch -= fall * SK.CFG.towerLandKick * 0.5;
  };

  // lamp heads and tree crowns knock off whoever is at their height, and everyone above
  function clipProps(tw, g) {
    const p = g.player, lv = T.levels(tw);
    for (const s of g.world.near('solids', p.x, p.y, 2.5)) {
      if (s.kind !== 'lamp' && s.kind !== 'tree') continue;
      const band = s.kind === 'lamp' ? [s.z0 + 4.1, s.z0 + 4.8, 0.55] : [s.z0 + 2.7, s.z0 + 4.5, 0.9];
      for (let i = 0; i < tw.pax.length; i++) {
        const zb = p.z + lv[i], zt = p.z + lv[i + 1];
        if (zt < band[0] || zb > band[1]) continue;
        const off = tw.roll * (lv[i] + lv[i + 1]) / 2;
        if (Math.hypot(p.x + off - s.x, p.y - s.y) > band[2] + 0.25) continue;
        const side = s.x > p.x ? -1 : 1;
        g.popup(s.x, s.y, s.z0 + 4.8, s.kind === 'lamp' ? 'ФОНАРЬ!' : 'ВЕТКА!', '#ff8a8a', 0);
        g.emit('clip');
        T.knock(tw, i, g, side, 'clip');
        return;
      }
    }
  }

  function updateFlyers(tw, dt, g) {
    const W = g.world, C = SK.CFG;
    for (const f of tw.flyers) {
      f.t += dt;
      f.vz -= C.gravity * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      f.rot += f.vr * dt;
      for (const c of W.collide(f.x, f.y, 0.3, f.z - 0.2)) {
        f.x += c.nx * c.depth; f.y += c.ny * c.depth;
        const vn = -(f.vx * c.nx + f.vy * c.ny);
        if (vn > 0) { f.vx += c.nx * vn * 1.3; f.vy += c.ny * vn * 1.3; }
      }
      f.x = U.clamp(f.x, W.xMin + 0.5, W.xMax - 0.5);
      if (f.d.bubble && (f.d.bubble.t -= dt) <= 0) f.d.bubble = null;
      const gz = W.groundZ(f.x, f.y);
      if (f.z <= gz + 0.2 && f.vz < 0) { f.done = true; land(f, g, gz); }
    }
    tw.flyers = tw.flyers.filter((f) => !f.done);
  }

  // a fallen passenger lies down for a moment, then gets up and walks off as an ordinary pedestrian
  function land(f, g, gz) {
    const d = f.d, W = g.world;
    if (f.y > W.yBack - 1 || f.y < W.yFront) return; // outside the living street: just gone
    d.x = f.x; d.y = f.y; d.z = gz; d.jz = 0; d.vz = 0;
    d.face = Math.atan2(f.vy, f.vx);
    d.state = 'down'; d.st = 1.4;
    d.to = W.nearestNode(d.x, d.y);
    d.from = d.to.adj[0] || d.to;
    d.nm.inside = false;
    d.cd.near = 1.5; d.cd.scare = 1;
    d.bubble = { text: U.pick(g.rng, LINES.ground), t: 1.8 };
    g.peds.list.push(d);
  }

  SK.Tower = T;
})();
