// One endless straight street going forward toward -y (up-right on screen). Cross-section along x:
//   facades + pocket squares | left sidewalk 0..8 | road 8..18 | right sidewalk 18..26 | low facades
// The street is generated in chunks of CHUNK metres ahead of the rider and dropped behind; a concrete
// barrier closes the back. Each sidewalk has three zones: by the facade (a rare bench or granite ledge), the
// pedestrian lane in the middle, and by the curb (a lamp or tree, sometimes a small ramp facing forward).
// Furniture is sparse on purpose: the point is riding close to people.
// Everything is axis-aligned rects and circles; pedestrians walk a node graph along the sidewalks and zebras.
(function () {
  const SK = window.SK, U = SK.U;
  const CHUNK = 40, SZ = 0.15;
  const ROAD0 = 8, ROAD1 = 18, WIDTH = 26; // left sidewalk 0..ROAD0, right sidewalk ROAD1..WIDTH
  const LANE_L = 4, LANE_R = 22;           // pedestrian lanes
  const AHEAD = 3, BEHIND = 2;              // chunks kept around the rider's chunk
  const SHOPS = ['ШАУРМА 24', 'ЦВЕТЫ', 'АПТЕКА', 'ВЕЙП', 'КРАФТ КОФЕ', 'МИКРОЗАЙМЫ', 'РАЗЛИВНОЕ', 'БАРБЕРШОП',
    'РЕМОНТ ТЕЛЕФОНОВ', 'СУШИ-ПИЦЦА', 'ЗАЙМЫ ПОД ПТС', 'ПРОДУКТЫ', 'НОГТИ', 'ЛОМБАРД', 'ОПТИКА', 'ПВЗ', 'ПЕКАРНЯ'];
  const BCOL = ['#e7c27d', '#d98f6e', '#a7bfd1', '#bba6cf', '#e2d7c3', '#c9d6a3', '#e5a9a0', '#9fcfc4', '#d7c7a0'];
  const SIGNCOL = ['#d6453d', '#2f6fd6', '#1f9a5a', '#e0902a', '#7a3fc4', '#2a2a2a'];
  const FWD = [0, -1];
  const KEYS = ['solids', 'rails', 'ramps', 'crosswalks', 'nodes', 'slabs', 'lawns', 'pockets'];

  function create(seed) {
    const W = {
      seed, CHUNK, SZ, ROAD0, ROAD1, width: WIDTH, xMin: -10, xMax: WIDTH + 10,
      rows: new Map(), jFront: 2, jBack: 1, back: null, spawn: null,
    };
    for (const k of KEYS) W[k] = [];
    attachQueries(W);
    for (let j = 1; j >= -AHEAD; j--) addRow(W, j);
    rebuild(W);
    W.spawn = { x: (ROAD0 + ROAD1) / 2, y: CHUNK - 8, heading: -Math.PI / 2 };
    return W;
  }

  // keep chunks [rider chunk - AHEAD, rider chunk + BEHIND]; returns the chunks that came and went
  function update(W, py) {
    const jp = Math.floor(py / CHUNK);
    const added = [], removed = [];
    while (W.jFront > jp - AHEAD) added.push(addRow(W, W.jFront - 1));
    while (W.jBack > jp + BEHIND && W.jBack > W.jFront) removed.push(removeRow(W, W.jBack));
    if (added.length || removed.length) rebuild(W);
    return { added, removed };
  }

  function removeRow(W, j) {
    const row = W.rows.get(j);
    W.rows.delete(j);
    W.jBack = j - 1;
    const gone = new Set(row.nodes);
    const next = W.rows.get(j - 1);
    if (next) for (const n of next.nodes) n.adj = n.adj.filter((m) => !gone.has(m));
    return row;
  }

  function rebuild(W) {
    const js = [...W.rows.keys()].sort((a, b) => a - b);
    for (const k of KEYS) W[k] = [];
    for (const j of js) { const row = W.rows.get(j); for (const k of KEYS) for (const o of row[k]) W[k].push(o); }
    const yb = (W.jBack + 1) * CHUNK - 1;
    W.back = { shape: 'box', kind: 'border', id: -1, x0: W.xMin - 14, x1: W.xMax + 14, y0: yb, y1: yb + 1, z0: 0, top: 1.1 };
    W.solids.push(W.back);
    W.yFront = W.jFront * CHUNK;
    W.yBack = yb + 1;
  }

  function addRow(W, j) {
    const r = U.rng(((W.seed * 73856093) ^ (j * 19349663)) >>> 0);
    const y0 = j * CHUNK, y1 = y0 + CHUNK;
    const row = { j, y0, y1 };
    for (const k of KEYS) row[k] = [];
    let nid = 0;

    const node = (x, y) => { const n = { x, y, adj: [], row: j }; row.nodes.push(n); return n; };
    const link = (a, b) => { if (!a.adj.includes(b)) { a.adj.push(b); b.adj.push(a); } };
    const solid = (o) => {
      if (o.shape === 'circ') { o.x0 = o.x - o.r; o.y0 = o.y - o.r; o.x1 = o.x + o.r; o.y1 = o.y + o.r; }
      o.id = Math.abs(j) * 1000 + nid++;
      row.solids.push(o);
      return o;
    };
    const boxSolid = (kind, x0, y0_, x1, y1_, top, extra) =>
      solid(Object.assign({ shape: 'box', kind, x0, y0: y0_, x1, y1: y1_, z0: SZ, top }, extra));
    const circ = (kind, x, y, rad, top) => solid({ shape: 'circ', kind, x, y, r: rad, z0: SZ, top });
    const rail = (owner, ax, ay, bx, by, top) => {
      const len = Math.hypot(bx - ax, by - ay);
      row.rails.push({
        ax, ay, bx, by, ux: (bx - ax) / len, uy: (by - ay) / len, len, top, owner,
        x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by),
      });
    };
    // a grindable box: bench, granite ledge
    const bench = (cx, cy, axis, len = 1.8, h = 0.45, kind = 'bench', depth = 0.55) => {
      const hx = axis === 'x' ? len / 2 : depth / 2, hy = axis === 'x' ? depth / 2 : len / 2;
      const o = boxSolid(kind, cx - hx, cy - hy, cx + hx, cy + hy, SZ + h, { axis });
      if (axis === 'x') rail(o, cx - hx, cy, cx + hx, cy, SZ + h);
      else rail(o, cx, cy - hy, cx, cy + hy, SZ + h);
      return o;
    };
    // dir points uphill
    const ramp = (cx, cy, dir, len, w, h, base) => {
      const [dx, dy] = dir;
      const hx = dx !== 0 ? len / 2 : w / 2, hy = dx !== 0 ? w / 2 : len / 2;
      row.ramps.push({ kind: 'ramp', x0: cx - hx, y0: cy - hy, x1: cx + hx, y1: cy + hy, dx, dy, len, w, h, base, top: base + h });
    };
    // signFace: which visible face looks at the street ('x' for the left side, 'y' otherwise)
    const building = (x0, ya, x1, yb, low, signFace) => {
      const floors = low ? 1 + Math.floor(r() * 2) : 2 + Math.floor(r() * 5);
      boxSolid('building', x0, ya, x1, yb, SZ + floors * 3 + 0.6, {
        floors, color: U.pick(r, BCOL), sign: r() < 0.8 ? U.pick(r, SHOPS) : null, signColor: U.pick(r, SIGNCOL), signFace,
      });
    };

    row.slabs.push({ x0: 0, y0, x1: ROAD0, y1 }, { x0: ROAD1, y0, x1: WIDTH, y1 });
    row.crosswalks.push({ axis: 'x', x0: ROAD0, x1: ROAD1, y0: y0 + 1, y1: y0 + 4.5 });

    // facades: three buildings per side, one may give way to a pocket square
    const lanes = { L: [], R: [] };          // extra sidewalk nodes (pocket entrances)
    const busy = { L: [], R: [] };           // y ranges by the facade that must stay clear
    for (const left of [true, false]) {
      const s = left ? 'L' : 'R', low = !left; // the right side sits between camera and road: keep it low
      const fx0 = left ? -14 : WIDTH, fx1 = left ? 0 : WIDTH + 14;
      const cuts = [y0, y0 + CHUNK / 3 + (r() - 0.5) * 6, y0 + CHUNK * 2 / 3 + (r() - 0.5) * 6, y1];
      const pocket = r() < 0.15 && !(j === 0 && left) ? Math.floor(r() * 3) : -1;
      for (let q = 0; q < 3; q++) {
        const ya = cuts[q], yb = cuts[q + 1];
        if (q !== pocket) { building(fx0, ya, fx1, yb, low, left ? 'x' : 'y'); continue; }
        const px0 = left ? -10 : WIDTH, px1 = left ? 0 : WIDTH + 10;
        const pk = { x0: px0, y0: ya, x1: px1, y1: yb };
        row.slabs.push(pk);
        row.pockets.push(pk);
        building(left ? -24 : WIDTH + 10, ya, left ? -10 : WIDTH + 24, yb, low, left ? 'x' : 'y');
        const cy = (ya + yb) / 2, cx = (px0 + px1) / 2;
        const inner = node(cx, cy), gate = node(left ? LANE_L : LANE_R, cy);
        link(inner, gate);
        lanes[s].push(gate);
        busy[s].push([cy - 1.8, cy + 1.8]);
        // a little square: two granite ledges across it, benches against the back wall
        for (const o of [-2.4, 2.4]) bench(cx, cy + o, 'x', 6, 0.5, 'ledge', 0.6);
        const bx = left ? px0 + 0.5 : px1 - 0.5;
        bench(bx, ya + 2, 'y');
        bench(bx, yb - 2, 'y');
      }
    }

    // pedestrian lanes: a chain front to back, linked to the chunk behind and across the zebra
    for (const [s, x] of [['L', LANE_L], ['R', LANE_R]]) {
      const chain = [node(x, y0 + 2.75), ...lanes[s], node(x, y0 + 2.75 + CHUNK / 2)].sort((a, b) => a.y - b.y);
      for (let k = 1; k < chain.length; k++) link(chain[k - 1], chain[k]);
      lanes[s] = chain;
    }
    link(lanes.L[0], lanes.R[0]);
    // and people who cross wherever they like, mid-block, no zebra
    link(lanes.L[lanes.L.length - 1], lanes.R[lanes.R.length - 1]);
    row.ends = { L: lanes.L, R: lanes.R };
    const behind = W.rows.get(j + 1);
    if (behind) { link(lanes.L[lanes.L.length - 1], behind.ends.L[0]); link(lanes.R[lanes.R.length - 1], behind.ends.R[0]); }

    // sidewalk furniture, kept sparse: the street is for weaving between people
    for (const left of [true, false]) {
      const s = left ? 'L' : 'R';
      const lampX = left ? 7.55 : 18.45, rampX = left ? 6.45 : 19.55;
      // by the curb: sometimes a small forward ramp, now and then a lamp or a tree (they clip the passenger tower)
      const y = y0 + 10 + r() * 20, k = r();
      if (k < 0.2) ramp(rampX, y, FWD, 3, 1.7, 0.7, SZ);
      else if (k < 0.45) circ(r() < 0.5 ? 'lamp' : 'tree', lampX, y, 0.14, SZ + 4.5);
      // by the facade: a granite ledge (a grind line along the street), benches, bins
      const free = (a, b) => busy[s].every(([u, v]) => b < u || a > v);
      const bzX = left ? 1.3 : WIDTH - 1.3;
      if (j === 0 && left) busy[s].push([y0 + 8, y0 + 20]);
      if ((j === 0 && left) || r() < 0.15) {
        const len = 6 + Math.floor(r() * 5), cy = j === 0 && left ? y0 + 14 : y0 + 8 + len / 2 + r() * (CHUNK - 16 - len);
        if (free(cy - len / 2, cy + len / 2) || (j === 0 && left)) { bench(bzX, cy, 'y', len, 0.5, 'ledge', 0.6); busy[s].push([cy - len / 2, cy + len / 2]); }
      }
      const cy = y0 + 7 + r() * (CHUNK - 10);
      if (r() < 0.25 && free(cy - 1.4, cy + 1.4)) bench(left ? 1.0 : WIDTH - 1.0, cy, 'y');
    }

    // somebody left a big ramp in the middle of the road
    if (j === -1 || (j < -1 && r() < 0.15)) ramp((ROAD0 + ROAD1) / 2, y0 + 20, FWD, 4.2, 2.6, 1.3, 0);

    W.rows.set(j, row);
    W.jFront = Math.min(W.jFront, j);
    W.jBack = Math.max(W.jBack, j);
    return row;
  }

  function rampT(rp, x, y) {
    if (rp.dx === 1) return (x - rp.x0) / rp.len;
    if (rp.dx === -1) return (rp.x1 - x) / rp.len;
    if (rp.dy === 1) return (y - rp.y0) / rp.len;
    return (rp.y1 - y) / rp.len;
  }

  function attachQueries(W) {
    W.update = (py) => update(W, py);

    W.near = function (key, x, y, r) {
      const out = [];
      const j0 = Math.floor((y - r) / CHUNK), j1 = Math.floor((y + r) / CHUNK);
      for (let j = j0; j <= j1; j++) {
        const row = W.rows.get(j);
        if (!row) continue;
        for (const o of row[key]) if (o.x1 >= x - r && o.x0 <= x + r && o.y1 >= y - r && o.y0 <= y + r) out.push(o);
      }
      const b = W.back;
      if (key === 'solids' && b && b.y1 >= y - r && b.y0 <= y + r) out.push(b);
      return out;
    };

    W.onSidewalk = (x) => x < ROAD0 || x > ROAD1;

    W.rampAt = function (x, y) {
      const row = W.rows.get(Math.floor(y / CHUNK));
      if (!row) return null;
      let best = null, bz = -1;
      for (const rp of row.ramps) {
        if (x < rp.x0 || x > rp.x1 || y < rp.y0 || y > rp.y1) continue;
        const z = rp.base + rp.h * rampT(rp, x, y);
        if (z > bz) { bz = z; best = rp; }
      }
      return best ? { rp: best, z: bz } : null;
    };

    W.groundZ = function (x, y) {
      const z = W.onSidewalk(x) ? SZ : 0;
      const ra = W.rampAt(x, y);
      return ra && ra.z > z ? ra.z : z;
    };

    // vertical speed you get from riding up a ramp at (vx, vy)
    W.rampVz = function (x, y, vx, vy) {
      const ra = W.rampAt(x, y);
      if (!ra) return 0;
      return (vx * ra.rp.dx + vy * ra.rp.dy) * ra.rp.h / ra.rp.len;
    };

    W.surface = function (x, y) {
      if (!W.onSidewalk(x)) return W.inCrosswalk(x, y, 0) ? 'cross' : 'road';
      const row = W.rows.get(Math.floor(y / CHUNK));
      if (row) for (const l of row.lawns) if (x > l.x0 && x < l.x1 && y > l.y0 && y < l.y1) return 'grass';
      return 'walk';
    };

    W.inCrosswalk = function (x, y, pad) {
      const row = W.rows.get(Math.floor(y / CHUNK));
      if (!row) return false;
      for (const c of row.crosswalks) {
        const px = c.axis === 'x' ? pad : 0, py = c.axis === 'y' ? pad : 0;
        if (x >= c.x0 - px && x <= c.x1 + px && y >= c.y0 - py && y <= c.y1 + py) return true;
      }
      return false;
    };
    // curbs are lowered where a crosswalk meets the sidewalk
    W.isLowered = (x, y) => W.inCrosswalk(x, y, 1.2);

    W.collide = function (x, y, r, z) {
      const out = [];
      for (const s of W.near('solids', x, y, r + 0.5)) {
        if (z >= s.top - 0.05 || z + 1.7 < s.z0) continue;
        let nx, ny, depth;
        if (s.shape === 'circ') {
          const dx = x - s.x, dy = y - s.y, d = Math.hypot(dx, dy);
          if (d >= r + s.r) continue;
          if (d < 1e-6) { nx = 1; ny = 0; } else { nx = dx / d; ny = dy / d; }
          depth = r + s.r - d;
        } else {
          const cx = U.clamp(x, s.x0, s.x1), cy = U.clamp(y, s.y0, s.y1);
          const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            nx = dx / d; ny = dy / d; depth = r - d;
          } else {
            const l = x - s.x0, rr = s.x1 - x, t = y - s.y0, bb = s.y1 - y, m = Math.min(l, rr, t, bb);
            if (m === l) { nx = -1; ny = 0; depth = l + r; }
            else if (m === rr) { nx = 1; ny = 0; depth = rr + r; }
            else if (m === t) { nx = 0; ny = -1; depth = t + r; }
            else { nx = 0; ny = 1; depth = bb + r; }
          }
        }
        out.push({ nx, ny, depth, s });
      }
      return out;
    };

    W.nearestNode = function (x, y) {
      let best = W.nodes[0], bd = Infinity;
      for (const n of W.nodes) { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bd && n.adj.length) { bd = d; best = n; } }
      return best;
    };
  }

  SK.World = { create, CHUNK, WIDTH, ROAD0, ROAD1 };
})();
