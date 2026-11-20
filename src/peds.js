// Pedestrians. Three kinds: an ordinary passer-by (notices you, sometimes steps aside), a phone zombie
// (notices nothing until the bell) and a babushka (slow, loud, holds a grudge). They walk the sidewalk
// graph with a personal side offset, so two-way traffic keeps to its side.
(function () {
  const SK = window.SK, U = SK.U;
  const TYPES = {
    norm: { speed: [1.1, 1.5], h: 1.75, flee: 3.2, dodge: 0.35, scare: 6, colors: ['#4a6fa5', '#7a5c99', '#c46a4a', '#3f8f6b', '#8a8a8a', '#c9a227', '#3b3b3b'] },
    phone: { speed: [0.7, 1.0], h: 1.72, flee: 3.6, dodge: 0, scare: 10, colors: ['#2e3440', '#5e81ac', '#6b6f7a', '#a3485a'] },
    baba: { speed: [0.55, 0.8], h: 1.55, flee: 1.3, dodge: 0.15, scare: 12, colors: ['#8e5ea2', '#a05252', '#6b5b45', '#4f6d7a'] },
  };
  const SKIN = ['#f1c7a0', '#e0ac85', '#c68a62', '#f5d5b8', '#a8714f'];
  const LINES = {
    near: {
      norm: ['Эй!', 'Куда прёшь?!', 'Тротуар для людей!', 'Понакупили самокатов…', 'Смотри куда едешь!', 'Ну ё-моё!'],
      phone: ['А?', '…', 'Чё?', '*не заметил*'],
      baba: ['Хулиган!', 'Наркоман!', 'Я на тебя напишу!', 'Ох, сердце…', 'Распустились!', 'Куда мать смотрит!'],
    },
    bell: {
      norm: ['Ай!', 'Сам дзынь!', 'Да чтоб тебя!', 'Господи!', 'Ты нормальный?!'],
      phone: ['А?! Что?!', 'Мама!', '*уронил телефон*', 'Я в созвоне!'],
      baba: ['Батюшки!', 'Ирод!', 'Полицию вызову!', 'Тьфу на тебя!', 'Чтоб у тебя колесо отвалилось!'],
    },
    over: {
      norm: ['Чего?!', 'Это что сейчас было?', 'Акробат, блин'],
      phone: ['О, контент', '*снимает*'],
      baba: ['Свят-свят-свят!', 'Цирк уехал, а ты остался!'],
    },
    hit: {
      norm: ['Ну всё, я снимаю!', 'Номер запомнил!', 'Ай-ай-ай!'],
      phone: ['Мой экран!', 'Это в сторис!'],
      baba: ['Убили!', 'Скорую!', 'Я до министра дойду!'],
    },
  };

  const HITCH = ['Подвезёшь?', 'Эй, самокат!', 'Возьми меня!', 'До метро?', 'Я лёгкий!'];

  const P = { TYPES };

  function target(d) {
    const a = d.from, b = d.to;
    let ex = b.x - a.x, ey = b.y - a.y;
    const L = Math.hypot(ex, ey) || 1;
    ex /= L; ey /= L;
    return [b.x - ey * d.off, b.y + ex * d.off];
  }

  P.create = (rng) => ({ list: [], rng });

  function make(S, W, from, to, t) {
    const rng = S.rng;
    const tr = rng(), type = tr < 0.5 ? 'norm' : tr < 0.8 ? 'phone' : 'baba', T = TYPES[type];
    const d = {
      type, T, h: T.h * U.lerp(0.95, 1.05, rng()), color: U.pick(rng, T.colors), skin: U.pick(rng, SKIN),
      speed: U.lerp(T.speed[0], T.speed[1], rng()), off: (rng() * 2 - 1) * 1.0,
      from, to, x: 0, y: 0, z: 0, jz: 0, vz: 0, face: 0, moving: 0, phase: rng() * 6.28,
      state: 'walk', st: 0, ax: 0, ay: 0, bubble: null, annoy: 0,
      nm: { inside: false, minD: 9, sp: 0 }, cd: { scare: 0, near: 0, over: 0, dodge: 0 },
    };
    const [tx, ty] = target(d);
    d.x = U.lerp(from.x, tx, t);
    d.y = U.lerp(from.y, ty, t);
    d.z = W.groundZ(d.x, d.y);
    d.face = Math.atan2(ty - from.y, tx - from.x);
    S.list.push(d);
    return d;
  }

  // scatter pedestrians over the walk graph of a freshly generated row
  P.spawnRow = function (S, W, row, count) {
    const edges = [];
    for (const n of row.nodes) for (const m of n.adj) if (m.row === row.j || m.row > row.j) edges.push([n, m]);
    if (!edges.length) return;
    for (let k = 0; k < count; k++) {
      const [a, b] = edges[Math.floor(S.rng() * edges.length)];
      make(S, W, a, b, S.rng());
    }
  };

  // hitchhikers: stand still at the curb or in the crowd, wave, wait to be picked up
  P.spawnHitch = function (S, W, row, count) {
    for (let k = 0, tries = 0; k < count && tries < 40; tries++) {
      const left = S.rng() < 0.5, curb = S.rng() < 0.6;
      const x = left ? (curb ? 7.1 : 2 + S.rng() * 4.5) : (curb ? 18.9 : 19.5 + S.rng() * 4.5);
      const y = row.y0 + 6 + S.rng() * (row.y1 - row.y0 - 8);
      if (W.collide(x, y, 0.6, W.groundZ(x, y)).length) continue;
      const d = P.add(S, W, x, y);
      d.hitch = true;
      d.state = 'wait';
      d.face = left ? 0 : Math.PI;
      k++;
    }
  };

  // one pedestrian at the walk node nearest to (x, y); used by tests
  P.add = function (S, W, x, y) {
    const n = W.nearestNode(x, y);
    const d = make(S, W, n.adj[0], n, 1);
    d.x = x; d.y = y; d.z = W.groundZ(x, y);
    return d;
  };

  // drop everyone walking on or toward rows that no longer exist
  P.dropRows = function (S, rows, W) {
    const gone = new Set(rows.map((r) => r.j));
    const cut = W.yBack;
    S.list = S.list.filter((d) => !gone.has(d.from.row) && !gone.has(d.to.row) && d.y < cut);
  };

  function say(S, d, kind) {
    const lines = LINES[kind][d.type];
    d.bubble = { text: U.pick(S.rng, lines), t: 1.8 };
  }

  P.react = function (S, d, kind, g) {
    if (kind === 'bell') {
      d.state = 'startle'; d.st = 0.45; d.vz = 3.2; say(S, d, 'bell');
      g.emit('yelp', { who: d.type });
    } else if (kind === 'near') {
      if (d.type === 'baba') { d.state = 'angry'; d.st = 1.3; say(S, d, 'near'); g.emit('yelp', { who: d.type }); }
      else if (d.type === 'norm') {
        if (S.rng() < 0.6) say(S, d, 'near');
        d.state = 'flinch'; d.st = 0.35; d.vz = 1.8;
      } else if (S.rng() < 0.3) say(S, d, 'near');
    } else if (kind === 'over') {
      d.state = 'startle'; d.st = 0.4; d.vz = 0; say(S, d, 'over');
    } else if (kind === 'hit') {
      d.state = 'down'; d.st = 2.6; d.jz = 0; d.vz = 0;
      d.face = Math.atan2(g.player.vy, g.player.vx);
      say(S, d, 'hit');
    }
  };

  function backToPath(W, d) {
    d.to = W.nearestNode(d.x, d.y);
    d.from = d.to.adj[0];
    d.state = 'walk';
  }

  P.update = function (S, dt, g) {
    const W = g.world, p = g.player, C = SK.CFG;
    for (const d of S.list) {
      d.cd.scare -= dt; d.cd.near -= dt; d.cd.over -= dt; d.cd.dodge -= dt;
      d.annoy = Math.max(0, d.annoy - dt * 0.05);
      if (d.bubble && (d.bubble.t -= dt) <= 0) d.bubble = null;
      d.st -= dt;
      if (d.jz > 0 || d.vz > 0) {
        d.vz -= 14 * dt;
        d.jz += d.vz * dt;
        if (d.jz <= 0) { d.jz = 0; d.vz = 0; }
      }
      let mx = 0, my = 0;
      switch (d.state) {
        case 'walk': {
          const [tx, ty] = target(d);
          const dx = tx - d.x, dy = ty - d.y, dist = Math.hypot(dx, dy);
          if (dist < 0.35) {
            const adj = d.to.adj;
            let next = adj[Math.floor(S.rng() * adj.length)];
            if (next === d.from && adj.length > 1) next = adj[(adj.indexOf(next) + 1) % adj.length];
            if (!next) next = d.from;
            d.from = d.to;
            d.to = next;
          } else { mx = dx / dist * d.speed; my = dy / dist * d.speed; }
          // see a scooter coming straight at you → maybe step aside
          if (d.T.dodge > 0 && d.cd.dodge <= 0 && p.state !== 'crash') {
            const rx = d.x - p.x, ry = d.y - p.y, pv2 = p.vx * p.vx + p.vy * p.vy;
            if (pv2 > 36 && rx * rx + ry * ry < 25) {
              const tca = (rx * p.vx + ry * p.vy) / pv2;
              if (tca > 0 && tca < 0.55) {
                let ox = rx - p.vx * tca, oy = ry - p.vy * tca;
                if (ox * ox + oy * oy < 1.96) {
                  d.cd.dodge = 2.5;
                  if (S.rng() < d.T.dodge * C.dodgeChance) {
                    const ol = Math.hypot(ox, oy);
                    if (ol < 0.05) { ox = -p.vy; oy = p.vx; }
                    const l = Math.hypot(ox, oy);
                    d.ax = ox / l; d.ay = oy / l;
                    d.state = 'dodge'; d.st = 0.45;
                  }
                }
              }
            }
          }
          break;
        }
        case 'flee': {
          const rx = d.x - p.x, ry = d.y - p.y, l = Math.hypot(rx, ry) || 1;
          mx = rx / l * d.T.flee; my = ry / l * d.T.flee;
          if (d.st <= 0) backToPath(W, d);
          break;
        }
        case 'dodge':
          mx = d.ax * 2.8; my = d.ay * 2.8;
          if (d.st <= 0) backToPath(W, d);
          break;
        case 'flinch':
          if (d.st <= 0) d.state = 'walk';
          break;
        case 'startle':
          if (d.st <= 0) { if (d.type === 'baba') { d.state = 'angry'; d.st = 1.2; } else { d.state = 'flee'; d.st = 0.9; } }
          break;
        case 'angry':
          d.face = Math.atan2(p.y - d.y, p.x - d.x);
          if (d.st <= 0) d.state = 'walk';
          break;
        case 'wait':
          if (!d.bubble && S.rng() < dt * 0.25) d.bubble = { text: U.pick(S.rng, HITCH), t: 1.6 };
          break;
        case 'down':
          if (d.st <= 0) { d.state = 'getup'; d.st = 0.6; }
          break;
        case 'getup':
          if (d.st <= 0) backToPath(W, d);
          break;
      }
      d.x += mx * dt;
      d.y += my * dt;
      const sp = Math.hypot(mx, my);
      d.moving = Math.min(1, sp / 1.2);
      if (sp > 0.05) {
        const want = Math.atan2(my, mx);
        d.face += U.wrap(want - d.face) * Math.min(1, dt * 10);
        d.phase += sp * dt * 5.5;
      }
      if (d.state !== 'walk') {
        for (const c of W.collide(d.x, d.y, 0.27, d.z)) { d.x += c.nx * c.depth; d.y += c.ny * c.depth; }
        d.x = U.clamp(d.x, W.xMin + 0.5, W.xMax - 0.5);
      }
      d.z = W.groundZ(d.x, d.y);
    }
  };

  SK.Peds = P;
})();
