// Isometric canvas renderer. World (x, y, z) in metres → screen via a 2:1 iso projection.
// Ground is drawn first as flat polygons; everything standing up (buildings, props, people, the rider)
// is depth-sorted with a topological sort over screen-overlapping footprints.
(function () {
  const SK = window.SK, U = SK.U;
  const CX = 0.8660254, CY = 0.5, ZS = 0.95;
  const R = {};
  let cv, ctx, W = 0, H = 0, dpr = 1;
  let ox = 0, oy = 0, sc = 1, camx = 0, camy = 0;

  R.init = function (canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  };
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.width = Math.floor(innerWidth * dpr);
    H = cv.height = Math.floor(innerHeight * dpr);
    cv.style.width = innerWidth + 'px';
    cv.style.height = innerHeight + 'px';
  }

  const px = (x, y) => ox + ((x - camx) - (y - camy)) * CX * sc;
  const py = (x, y, z) => oy + ((x - camx) + (y - camy)) * CY * sc - z * ZS * sc;
  const mv = (x, y, z) => ctx.moveTo(px(x, y), py(x, y, z));
  const ln = (x, y, z) => ctx.lineTo(px(x, y), py(x, y, z));
  function quadPath(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
    mv(ax, ay, az); ln(bx, by, bz); ln(cx, cy, cz); ln(dx, dy, dz); ctx.closePath();
  }
  function fillQuad(color, ...a) { ctx.fillStyle = color; ctx.beginPath(); quadPath(...a); ctx.fill(); }
  function flatRect(x0, y0, x1, y1, z) { quadPath(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z); }
  function line3(ax, ay, az, bx, by, bz) { ctx.beginPath(); mv(ax, ay, az); ln(bx, by, bz); ctx.stroke(); }
  function dot3(x, y, z, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px(x, y), py(x, y, z), r, 0, U.TAU); ctx.fill(); }
  // a world circle on the ground is an axis-aligned ellipse on screen
  function groundEllipse(x, y, z, r) {
    ctx.beginPath();
    ctx.ellipse(px(x, y), py(x, y, z), r * 1.4142 * CX * sc, r * 1.4142 * CY * sc, 0, 0, U.TAU);
  }

  const shadeCache = {};
  function shade(hex, f) {
    const k = hex + f;
    if (shadeCache[k]) return shadeCache[k];
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    return (shadeCache[k] = `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`);
  }

  function box(x0, y0, x1, y1, z0, z1, cTop, cX, cY) {
    fillQuad(cY, x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1); // +y face, lower left
    fillQuad(cX, x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1); // +x face, lower right
    ctx.fillStyle = cTop; ctx.beginPath(); flatRect(x0, y0, x1, y1, z1); ctx.fill();
  }

  function viewRect() {
    const inv = (sx, sy) => {
      const u = (sx - ox) / (CX * sc), v = (sy - oy) / (CY * sc);
      return [camx + (u + v) / 2, camy + (v - u) / 2];
    };
    const tall = 26 * ZS * sc;
    const pts = [inv(0, -40), inv(W, -40), inv(0, H + tall), inv(W, H + tall)];
    return {
      x0: Math.min(...pts.map((q) => q[0])), x1: Math.max(...pts.map((q) => q[0])),
      y0: Math.min(...pts.map((q) => q[1])), y1: Math.max(...pts.map((q) => q[1])),
    };
  }

  R.draw = function (g) {
    const C = SK.CFG, cam = g.cam;
    sc = C.pxPerM * cam.zoom * dpr * (1 + 0.06 * (cam.punch || 0) * (cam.punch || 0));
    camx = cam.x;
    camy = cam.y;
    const sh = cam.shake * cam.shake * 12 * dpr;
    ox = W / 2 + (Math.random() * 2 - 1) * sh;
    // a tall tower of passengers pushes the view down so its top stays on screen
    oy = H / 2 + (cam.lift || 0) * ZS * sc + (Math.random() * 2 - 1) * sh;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#20232a';
    ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const view = viewRect();
    drawGround(g, view);
    drawRings(g);
    const items = collect(g, view);
    const order = sortItems(items);
    markFade(items, order);
    for (const k of order) drawItem(items[k], g);
    drawParticles(g);
    drawHitchTags(g);
    drawMarks(g);
    drawBubbles(g);
    drawPopups(g);
    drawSpeedLines(g);
    drawFlash(g);
    drawHearts(g);
    drawCallouts(g);
  };

  // ---------- ground ----------
  function drawGround(g, v) {
    const w = g.world, SZ = w.SZ, R0 = w.ROAD0, R1 = w.ROAD1;
    const ya = Math.max(w.yFront, v.y0), yb = Math.min(w.yBack, v.y1);
    ctx.fillStyle = '#3b3f47';
    ctx.beginPath(); flatRect(R0, ya, R1, yb, 0); ctx.fill();

    // centre line (dashed) and edge lines
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(236,228,200,0.75)';
    ctx.lineWidth = Math.max(1, 0.14 * sc);
    ctx.setLineDash([2.5 * sc, 3 * sc]);
    ctx.beginPath(); mv((R0 + R1) / 2, ya, 0); ln((R0 + R1) / 2, yb, 0); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(236,228,200,0.35)';
    ctx.beginPath(); mv(R0 + 0.4, ya, 0); ln(R0 + 0.4, yb, 0); mv(R1 - 0.4, ya, 0); ln(R1 - 0.4, yb, 0); ctx.stroke();
    ctx.lineCap = 'round';

    // zebra crossings
    ctx.fillStyle = 'rgba(238,236,228,0.88)';
    ctx.beginPath();
    for (const c of w.crosswalks) {
      if (c.y1 < v.y0 || c.y0 > v.y1) continue;
      for (let x = c.x0 + 0.6; x < c.x1 - 0.5; x += 1.1) flatRect(x, c.y0, x + 0.55, c.y1, 0);
    }
    ctx.fill();

    // sidewalks: the curb face toward the camera, the slab, curb stones
    fillQuad('#6c7078', R0, ya, 0, R0, yb, 0, R0, yb, SZ, R0, ya, SZ);
    ctx.fillStyle = '#a4a8ae';
    ctx.beginPath();
    for (const sl of w.slabs) if (sl.y1 >= v.y0 && sl.y0 <= v.y1) flatRect(sl.x0, Math.max(sl.y0, ya), sl.x1, Math.min(sl.y1, yb), SZ);
    ctx.fill();
    ctx.strokeStyle = '#c9ccd1';
    ctx.lineWidth = Math.max(1, 0.3 * sc);
    ctx.beginPath(); mv(R0 - 0.15, ya, SZ); ln(R0 - 0.15, yb, SZ); mv(R1 + 0.15, ya, SZ); ln(R1 + 0.15, yb, SZ); ctx.stroke();
    // tiles in the pocket squares, lawn strips
    for (const pk of w.pockets) {
      if (pk.y1 < v.y0 || pk.y0 > v.y1) continue;
      ctx.fillStyle = '#c8bda5';
      ctx.beginPath(); flatRect(pk.x0, pk.y0, pk.x1, pk.y1, SZ); ctx.fill();
      ctx.strokeStyle = 'rgba(120,108,88,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = pk.x0 + 2; x < pk.x1; x += 2) { mv(x, pk.y0, SZ); ln(x, pk.y1, SZ); }
      for (let y = pk.y0 + 2; y < pk.y1; y += 2) { mv(pk.x0, y, SZ); ln(pk.x1, y, SZ); }
      ctx.stroke();
    }
    for (const l of w.lawns) {
      if (l.y1 < v.y0 || l.y0 > v.y1) continue;
      ctx.fillStyle = '#5e9a4b';
      ctx.beginPath(); flatRect(l.x0, l.y0, l.x1, l.y1, SZ); ctx.fill();
    }
  }

  function drawRings(g) {
    const C = SK.CFG;
    for (const q of g.fx.rings) {
      if (q.t < 0) continue;
      const k = q.t / 0.5, r = (q.r || C.bellR) * (0.15 + 0.85 * Math.sqrt(k));
      // a soft filled wave and a bright rim
      ctx.fillStyle = `rgba(255,225,77,${(1 - k) * 0.14})`;
      groundEllipse(q.x, q.y, q.z, r);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,240,150,${(1 - k) * 0.95})`;
      ctx.lineWidth = (7 - 5 * k) * dpr;
      ctx.stroke();
    }
  }

  // ---------- depth-sorted items ----------
  function makeItem(kind, o, x0, y0, x1, y1, z0, z1, pad) {
    pad = pad || 0;
    const l = ox + ((x0 - pad - camx) - (y1 + pad - camy)) * CX * sc;
    const r = ox + ((x1 + pad - camx) - (y0 - pad - camy)) * CX * sc;
    const t = oy + ((x0 - pad - camx) + (y0 - pad - camy)) * CY * sc - z1 * ZS * sc;
    const b = oy + ((x1 + pad - camx) + (y1 + pad - camy)) * CY * sc - z0 * ZS * sc;
    if (r < -20 || l > W + 20 || b < -20 || t > H + 20) return null;
    return { kind, o, x0, y0, x1, y1, z0, l, r, t, b, fade: false, flat: kind === 'ramp' };
  }

  function collect(g, v) {
    const items = [], push = (it) => { if (it) items.push(it); };
    const w = g.world;
    for (const s of w.solids) {
      if (s.x1 < v.x0 || s.x0 > v.x1 || s.y1 < v.y0 || s.y0 > v.y1) continue;
      const top = s.kind === 'tree' ? s.z0 + 5.2 : s.kind === 'lamp' ? s.z0 + 4.7 : s.kind === 'planter' ? s.z0 + 4.5 : s.top;
      const pad = s.kind === 'tree' || s.kind === 'planter' ? 1.5 : s.kind === 'lamp' ? 0.7 : 0;
      push(makeItem(s.kind, s, s.x0, s.y0, s.x1, s.y1, s.z0, top, pad));
    }
    for (const rp of w.ramps) {
      if (rp.x1 < v.x0 || rp.x0 > v.x1 || rp.y1 < v.y0 || rp.y0 > v.y1) continue;
      push(makeItem('ramp', rp, rp.x0, rp.y0, rp.x1, rp.y1, rp.base, rp.top));
    }
    for (const d of g.peds.list) {
      if (d.x < v.x0 || d.x > v.x1 || d.y < v.y0 || d.y > v.y1) continue;
      const lying = d.state === 'down' || d.state === 'getup';
      const e = lying ? 1.1 : 0.25;
      push(makeItem('ped', d, d.x - e, d.y - e, d.x + e, d.y + e, d.z, d.z + d.h + d.jz + 0.2));
    }
    const p = g.player;
    const pi = makeItem('player', p, p.x - 0.35, p.y - 0.35, p.x + 0.35, p.y + 0.35, p.z, p.z + 1.9 + SK.Tower.height(g.tower));
    if (pi) { pi.isPlayer = true; items.push(pi); }
    if (p.rag) push(makeItem('rag', p.rag, p.rag.x - 0.5, p.rag.y - 0.5, p.rag.x + 0.5, p.rag.y + 0.5, p.rag.z - 0.4, p.rag.z + 0.6));
    for (const f of g.tower.flyers) push(makeItem('flyer', f, f.x - 0.5, f.y - 0.5, f.x + 0.5, f.y + 0.5, f.z - 0.4, f.z + 0.6));
    return items;
  }

  function sortItems(items) {
    const n = items.length, before = [];
    for (let i = 0; i < n; i++) before.push([]);
    for (let i = 0; i < n; i++) {
      const a = items[i];
      for (let j = i + 1; j < n; j++) {
        const b = items[j];
        if (a.r < b.l || b.r < a.l || a.b < b.t || b.b < a.t) continue;
        const ab = a.x1 <= b.x0 + 1e-3 || a.y1 <= b.y0 + 1e-3;
        const ba = b.x1 <= a.x0 + 1e-3 || b.y1 <= a.y0 + 1e-3;
        let aFirst;
        if (ab !== ba) aFirst = ab;
        else if (a.flat !== b.flat) aFirst = a.flat;
        else if (Math.abs(a.z0 - b.z0) > 0.3) aFirst = a.z0 < b.z0;
        else aFirst = a.x0 + a.x1 + a.y0 + a.y1 < b.x0 + b.x1 + b.y0 + b.y1;
        if (aFirst) before[j].push(i); else before[i].push(j);
      }
    }
    const out = [], mark = new Uint8Array(n);
    const visit = (k) => {
      if (mark[k]) return;
      mark[k] = 1;
      for (const d of before[k]) visit(d);
      out.push(k);
    };
    for (let k = 0; k < n; k++) visit(k);
    return out;
  }

  // tall things drawn after the rider and covering it go see-through
  function markFade(items, order) {
    const pos = order.findIndex((k) => items[k].isPlayer);
    if (pos < 0) return;
    const p = items[order[pos]];
    const cx = (p.l + p.r) / 2, cy = (p.t + p.b) / 2;
    for (let q = pos + 1; q < order.length; q++) {
      const it = items[order[q]];
      if (it.kind !== 'building' && it.kind !== 'tree' && it.kind !== 'planter') continue;
      if (it.l < cx && it.r > cx && it.t < cy && it.b > cy) it.fade = true;
    }
  }

  function drawItem(it, g) {
    const o = it.o;
    if (it.fade) ctx.globalAlpha = 0.3;
    switch (it.kind) {
      case 'building': drawBuilding(o); break;
      case 'bench': box(o.x0, o.y0, o.x1, o.y1, o.z0, o.top, '#c58c55', '#9d6a3d', '#7e5431'); break;
      case 'ledge': box(o.x0, o.y0, o.x1, o.y1, o.z0, o.top, '#b9b3ab', '#948e86', '#7b766f'); break;
      case 'bin': box(o.x0, o.y0, o.x1, o.y1, o.z0, o.top, '#56705a', '#3f5543', '#334536'); break;
      case 'border': box(o.x0, o.y0, o.x1, o.y1, o.z0, o.top, '#9a9b94', '#7d7e78', '#6a6b65'); break;
      case 'planter':
        box(o.x0, o.y0, o.x1, o.y1, o.z0, o.top, '#7a7d74', '#a3a69c', '#8a8d84');
        ctx.fillStyle = '#4b3a2a'; ctx.beginPath(); flatRect(o.x0 + 0.15, o.y0 + 0.15, o.x1 - 0.15, o.y1 - 0.15, o.top + 0.01); ctx.fill();
        drawTree((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, o.top, 0.8);
        break;
      case 'fence': drawFence(o); break;
      case 'lamp': drawLamp(o); break;
      case 'tree': drawTree(o.x, o.y, o.z0, 1); break;
      case 'ramp': drawRamp(o); break;
      case 'ped': drawPed(o, g); break;
      case 'player': drawPlayer(o, g); break;
      case 'rag': drawRag(o, g, RIDER); break;
      case 'flyer': drawRag(o, g, o.d); break;
    }
    ctx.globalAlpha = 1;
  }

  // ---------- props ----------
  function drawBuilding(s) {
    const c = s._c || (s._c = {
      top: shade(s.color, 1.1), fx: shade(s.color, 0.9), fy: shade(s.color, 0.72), roof: shade(s.color, 0.95),
    });
    const { x0, y0, x1, y1, z0, top } = s;
    box(x0, y0, x1, y1, z0, top, c.top, c.fx, c.fy);
    ctx.fillStyle = c.roof;
    ctx.beginPath(); flatRect(x0 + 0.4, y0 + 0.4, x1 - 0.4, y1 - 0.4, top); ctx.fill();

    // windows on both visible faces; ground floor is a shop front
    const dark = new Path2D(), lit = new Path2D();
    const addQ = (path, pts) => {
      path.moveTo(px(pts[0], pts[1]), py(pts[0], pts[1], pts[2]));
      for (let i = 3; i < 12; i += 3) path.lineTo(px(pts[i], pts[i + 1]), py(pts[i], pts[i + 1], pts[i + 2]));
      path.closePath();
    };
    const face = (len, at) => {
      const cols = Math.max(1, Math.floor((len - 1) / 2.6));
      const start = (len - cols * 2.6) / 2 + 0.7;
      for (let f = 1; f < s.floors; f++) {
        const za = z0 + f * 3 + 0.9;
        for (let k = 0; k < cols; k++) {
          const a = start + k * 2.6;
          addQ(((s.id * 7 + f * 13 + k * 31) % 6 === 0) ? lit : dark, at(a, za, a + 1.2, za + 1.4));
        }
      }
      addQ(dark, at(0.5, z0 + 0.35, len - 0.5, z0 + 2.3));
    };
    face(x1 - x0, (a, za, b, zb) => [x0 + a, y1 + 0.02, za, x0 + b, y1 + 0.02, za, x0 + b, y1 + 0.02, zb, x0 + a, y1 + 0.02, zb]);
    face(y1 - y0, (a, za, b, zb) => [x1 + 0.02, y1 - a, za, x1 + 0.02, y1 - b, za, x1 + 0.02, y1 - b, zb, x1 + 0.02, y1 - a, zb]);
    ctx.fillStyle = '#34465f'; ctx.fill(dark);
    ctx.fillStyle = '#f2d68a'; ctx.fill(lit);

    if (s.sign && sc > 8) {
      const k = 1 / 40, zm = z0 + 2.83, onX = s.signFace === 'x';
      const len = onX ? y1 - y0 : x1 - x0;
      ctx.save();
      if (onX) {
        // the +x face looks at the street; text runs along -y so it is not mirrored
        fillQuad(s.signColor, x1 + 0.03, y1 - 0.4, z0 + 2.45, x1 + 0.03, y0 + 0.4, z0 + 2.45, x1 + 0.03, y0 + 0.4, z0 + 3.2, x1 + 0.03, y1 - 0.4, z0 + 3.2);
        const ym = (y0 + y1) / 2;
        ctx.setTransform(CX * sc * k, -CY * sc * k, 0, ZS * sc * k, px(x1, ym), py(x1, ym, zm));
      } else {
        fillQuad(s.signColor, x0 + 0.4, y1 + 0.03, z0 + 2.45, x1 - 0.4, y1 + 0.03, z0 + 2.45, x1 - 0.4, y1 + 0.03, z0 + 3.2, x0 + 0.4, y1 + 0.03, z0 + 3.2);
        const xm = (x0 + x1) / 2;
        ctx.setTransform(CX * sc * k, CY * sc * k, 0, ZS * sc * k, px(xm, y1), py(xm, y1, zm));
      }
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const wpx = ctx.measureText(s.sign).width, maxw = (len - 1) / k;
      if (wpx > maxw) ctx.scale(maxw / wpx, 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(s.sign, 0, 1);
      ctx.restore();
    }
  }

  function drawFence(o) {
    const z0 = o.z0, z1 = o.top;
    ctx.strokeStyle = '#2f7a4c';
    ctx.lineWidth = Math.max(1, 0.07 * sc);
    ctx.beginPath();
    mv(o.ax, o.ay, z1); ln(o.bx, o.by, z1);
    mv(o.ax, o.ay, z0 + 0.2); ln(o.bx, o.by, z0 + 0.2);
    const L = Math.hypot(o.bx - o.ax, o.by - o.ay), n = Math.max(1, Math.round(L / 1.2));
    for (let i = 0; i <= n; i++) {
      const x = U.lerp(o.ax, o.bx, i / n), y = U.lerp(o.ay, o.by, i / n);
      mv(x, y, z0); ln(x, y, z1);
    }
    ctx.stroke();
  }

  function drawLamp(o) {
    const z = o.z0;
    ctx.strokeStyle = '#2f343c';
    ctx.lineWidth = Math.max(1, 0.13 * sc);
    line3(o.x, o.y, z, o.x, o.y, z + 4.4);
    dot3(o.x, o.y, z + 4.5, Math.max(2, 0.2 * sc), '#fff1c2');
  }

  function drawTree(x, y, z, k) {
    ctx.strokeStyle = '#6b4a2f';
    ctx.lineWidth = Math.max(1, 0.24 * sc * k);
    line3(x, y, z, x, y, z + 2.4 * k);
    const r = 1.25 * sc * k;
    dot3(x - 0.3, y + 0.3, z + 3.0 * k, r, '#3f8a3a');
    dot3(x + 0.4, y - 0.2, z + 3.4 * k, r * 0.9, '#4d9c44');
    dot3(x, y, z + 3.9 * k, r * 0.75, '#5db352');
  }

  function drawRamp(o) {
    const { dx, dy, base, h } = o;
    // low edge L0-L1, high edge H0-H1 (ground), T0-T1 (top of the high edge)
    let L0, L1, H0, H1;
    if (dx === 1) { L0 = [o.x0, o.y0]; L1 = [o.x0, o.y1]; H0 = [o.x1, o.y0]; H1 = [o.x1, o.y1]; }
    else if (dx === -1) { L0 = [o.x1, o.y0]; L1 = [o.x1, o.y1]; H0 = [o.x0, o.y0]; H1 = [o.x0, o.y1]; }
    else if (dy === 1) { L0 = [o.x0, o.y0]; L1 = [o.x1, o.y0]; H0 = [o.x0, o.y1]; H1 = [o.x1, o.y1]; }
    else { L0 = [o.x0, o.y1]; L1 = [o.x1, o.y1]; H0 = [o.x0, o.y0]; H1 = [o.x1, o.y0]; }
    const t = base + h;
    // vertical faces visible when their outward normal points toward the camera (+x +y)
    const side = (A, B, nx, ny) => {
      if (nx + ny <= 0) return;
      ctx.fillStyle = '#8f7433';
      ctx.beginPath(); mv(A[0], A[1], base); ln(B[0], B[1], base); ln(B[0], B[1], t); ctx.closePath(); ctx.fill();
    };
    const pnx = -dy, pny = dx; // perpendicular
    const s0 = (L0[0] - L1[0]) * pnx + (L0[1] - L1[1]) * pny > 0 ? 1 : -1;
    side(L0, H0, pnx * s0, pny * s0);
    side(L1, H1, -pnx * s0, -pny * s0);
    if (dx + dy > 0) fillQuad('#76602b', H0[0], H0[1], base, H1[0], H1[1], base, H1[0], H1[1], t, H0[0], H0[1], t);
    fillQuad('#e2b53e', L0[0], L0[1], base, L1[0], L1[1], base, H1[0], H1[1], t, H0[0], H0[1], t);
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = Math.max(1, 0.18 * sc);
    ctx.beginPath();
    for (const f of [0.25, 0.55, 0.85]) {
      const a = [U.lerp(L0[0], H0[0], f), U.lerp(L0[1], H0[1], f)], b = [U.lerp(L1[0], H1[0], f), U.lerp(L1[1], H1[1], f)];
      mv(a[0], a[1], base + h * f); ln(b[0], b[1], base + h * f);
    }
    ctx.stroke();
  }

  // ---------- people ----------
  function shadow(x, y, z, r, a) {
    ctx.fillStyle = `rgba(0,0,0,${a || 0.25})`;
    groundEllipse(x, y, z, r);
    ctx.fill();
  }

  function drawPed(d, g) {
    const x = d.x, y = d.y, z0 = d.z, h = d.h;
    const fx = Math.cos(d.face), fy = Math.sin(d.face), sx = -fy, sy = fx;
    shadow(x, y, z0, 0.32);
    const lie = d.state === 'down' ? 1 : d.state === 'getup' ? U.clamp(d.st / 0.6, 0, 1) : 0;
    if (lie > 0.05) {
      // fallen over along the facing direction
      const ux = fx * lie, uy = fy * lie, uz = 1 - lie, at = (k) => [x + ux * k, y + uy * k, z0 + 0.12 + uz * k];
      const hip = at(0.9), neck = at(h - 0.3), head = at(h - 0.1), feet = at(0);
      ctx.strokeStyle = '#2c3140'; ctx.lineWidth = 0.14 * sc; line3(...feet, ...hip);
      ctx.strokeStyle = d.color; ctx.lineWidth = 0.38 * sc; line3(...hip, ...neck);
      dot3(...head, 0.14 * sc, d.skin);
      return;
    }
    const z = z0 + d.jz;
    const sw = Math.sin(d.phase) * 0.25 * d.moving;
    const hipZ = z + (d.type === 'baba' ? 0.8 : 0.88), neckZ = z + h - 0.32, headZ = z + h - 0.13;
    ctx.strokeStyle = d.type === 'baba' ? '#4a3b3b' : '#2c3140';
    ctx.lineWidth = 0.13 * sc;
    ctx.beginPath();
    mv(x + fx * sw + sx * 0.09, y + fy * sw + sy * 0.09, z); ln(x + sx * 0.08, y + sy * 0.08, hipZ);
    mv(x - fx * sw - sx * 0.09, y - fy * sw - sy * 0.09, z); ln(x - sx * 0.08, y - sy * 0.08, hipZ);
    ctx.stroke();
    ctx.strokeStyle = d.color;
    ctx.lineWidth = (d.type === 'baba' ? 0.44 : 0.36) * sc;
    line3(x, y, hipZ, x, y, neckZ);
    // arms
    ctx.lineWidth = 0.1 * sc;
    const sh = neckZ - 0.05;
    ctx.beginPath();
    if (d.state === 'startle') {
      mv(x + sx * 0.2, y + sy * 0.2, sh); ln(x + sx * 0.4, y + sy * 0.4, z + h + 0.25);
      mv(x - sx * 0.2, y - sy * 0.2, sh); ln(x - sx * 0.4, y - sy * 0.4, z + h + 0.25);
    } else if (d.state === 'angry') {
      const w = Math.sin(g.t * 28) * 0.08;
      mv(x + sx * 0.2, y + sy * 0.2, sh); ln(x + sx * (0.3 + w) + fx * 0.2, y + sy * (0.3 + w) + fy * 0.2, z + h + 0.2);
    } else if (d.hitch) {
      mv(x - sx * 0.2, y - sy * 0.2, sh); ln(x - sx * 0.22, y - sy * 0.22, z + 0.95);
    } else if (d.type === 'phone' && d.state === 'walk') {
      mv(x + sx * 0.18, y + sy * 0.18, sh); ln(x + fx * 0.28, y + fy * 0.28, sh - 0.15);
    } else {
      mv(x + sx * 0.2, y + sy * 0.2, sh); ln(x + sx * 0.22 - fx * sw * 0.6, y + sy * 0.22 - fy * sw * 0.6, z + 0.95);
      mv(x - sx * 0.2, y - sy * 0.2, sh); ln(x - sx * 0.22 + fx * sw * 0.6, y - sy * 0.22 + fy * sw * 0.6, z + 0.95);
    }
    ctx.stroke();
    if (d.hitch) {
      // one arm up, waving for a ride
      const w = Math.sin(g.t * 9 + d.phase) * 0.12;
      ctx.beginPath(); mv(x + sx * 0.2, y + sy * 0.2, sh); ln(x + sx * 0.32 + fx * w, y + sy * 0.32 + fy * w, z + h + 0.3); ctx.stroke();
    }
    if (d.type === 'phone' && d.state === 'walk') dot3(x + fx * 0.3, y + fy * 0.3, sh - 0.12, 0.07 * sc, '#9fe1ff');
    if (d.type === 'baba') {
      ctx.strokeStyle = '#5a4630'; ctx.lineWidth = 0.05 * sc;
      line3(x + sx * 0.3 + fx * 0.2, y + sy * 0.3 + fy * 0.2, z, x + sx * 0.25 + fx * 0.15, y + sy * 0.25 + fy * 0.15, z + 0.95);
    }
    dot3(x, y, headZ, 0.14 * sc, d.skin);
    if (d.type === 'baba') dot3(x - fx * 0.03, y - fy * 0.03, headZ + 0.04, 0.15 * sc, '#c9455a');
  }

  function drawPlayer(p, g) {
    const gz = g.world.groundZ(p.x, p.y);
    const air = Math.max(0, p.z - gz);
    shadow(p.x, p.y, gz, 0.5 * (1 - Math.min(0.5, air / 4)), 0.3 * (1 - Math.min(0.6, air / 4)));
    if (p.state === 'crash') { drawScooter(p, p.heading + 1.2, 0, true); return; }
    if (p.invulnT > 0 && Math.floor(p.invulnT * 12) % 2) ctx.globalAlpha = 0.45;
    const yaw = p.heading + (p.spin ? p.spin.ang * p.spin.dir : 0);
    const roll = p.lean + Math.sin(g.t * 40) * 0.07 * p.wobble;
    drawScooter(p, yaw + (p.whip ? p.whip.ang : 0), roll, false, yaw);
    drawRider(p, yaw, roll);
    drawTower(p, g, yaw, roll);
    ctx.globalAlpha = 1;
  }

  // the tower of passengers on the rider's shoulders. It bends with the sway: the higher, the further out.
  function drawTower(p, g, yaw, roll) {
    const tw = g.tower, n = tw.pax.length;
    if (!n) return;
    const crouch = p.drift ? 0.12 : p.state === 'grind' ? 0.15 : 0;
    const lv = SK.Tower.levels(tw, crouch), top = lv[n];
    const fx = Math.cos(yaw), fy = Math.sin(yaw), sx = -fy, sy = fx;
    const squash = 1 - tw.squash * 0.1;
    const lr = Math.sin(roll); // the rider's lean moves the base (the shoulders), the sway bends the rest
    // point of the tower axis at height z above the deck
    const axis = (z, i) => {
      const bend = z * (0.55 + 0.45 * z / top);
      const wob = Math.sin(g.t * 2.3 + i * 1.7) * 0.012 * z;
      // the rider's lean and crouch follow the scooter; the sway is across (x) and along (-y) the street
      const side = lr * 1.45 + wob, fwd = crouch;
      return [p.x + sx * side + fx * fwd + tw.roll * bend, p.y + sy * side + fy * fwd - tw.pitch * bend, p.z + z * squash];
    };
    for (let i = 0; i < n; i++) {
      const q = tw.pax[i];
      let B = axis(lv[i], i), T = axis(lv[i + 1], i + 1);
      if (q.join < 1) {
        // still climbing up: fly in an arc from where they stood
        const k = U.smooth(0, 1, q.join), arc = Math.sin(Math.PI * q.join) * 1.5;
        const d = [(q.fx - B[0]) * (1 - k), (q.fy - B[1]) * (1 - k), (q.fz - B[2]) * (1 - k) + arc];
        B = [B[0] + d[0], B[1] + d[1], B[2] + d[2]];
        T = [T[0] + d[0], T[1] + d[1], T[2] + d[2]];
      }
      drawPax(q, B, T, fx, fy, sx, sy, g, i === n - 1);
    }
  }

  function drawPax(q, B, T, fx, fy, sx, sy, g, isTop) {
    const d = q.d;
    // a point a forward, b to the side, c of the way up from B to T, plus e metres straight up
    const at = (a, b, c, e) => [B[0] + (T[0] - B[0]) * c + fx * a + sx * b, B[1] + (T[1] - B[1]) * c + fy * a + sy * b, B[2] + (T[2] - B[2]) * c + (e || 0)];
    // every limb gets a dark outline first, so the bodies in the stack read apart
    const L = (w, color, ...pts) => {
      ctx.beginPath(); mv(...pts[0]);
      for (let k = 1; k < pts.length; k++) ln(...pts[k]);
      ctx.strokeStyle = '#15161a'; ctx.lineWidth = w * sc + 2.5 * dpr; ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = w * sc; ctx.stroke();
    };
    const legs = d.type === 'baba' ? '#4a3b3b' : '#2c3140', body = d.type === 'baba' ? 0.44 : 0.36;
    const wave = Math.sin(g.t * 7 + q.wave);
    let head;
    if (q.pose === 'sit') {
      // sitting on the shoulders below, legs dangling in front
      const hip = at(0, 0, 0, 0.08), sh = at(0, 0, 0.62), knee = (b) => at(0.32, b, 0, 0.05), foot = (b) => at(0.38, b, 0, -0.42);
      L(0.13, legs, foot(-0.1), knee(-0.1), at(0, -0.08, 0, 0.08));
      L(0.13, legs, foot(0.1), knee(0.1), at(0, 0.08, 0, 0.08));
      L(body, d.color, hip, sh);
      if (isTop) { L(0.1, d.color, at(0, -0.18, 0.6), at(0.1, -0.4 - wave * 0.05, 1.1)); L(0.1, d.color, at(0, 0.18, 0.6), at(0.1, 0.4 + wave * 0.05, 1.1)); }
      else { L(0.1, d.color, at(0, -0.18, 0.6), at(-0.1, -0.2, 0.95)); L(0.1, d.color, at(0, 0.18, 0.6), at(-0.1, 0.2, 0.95)); }
      head = at(0, 0, 0.85);
      if (d.type === 'baba') L(0.05, '#5a4630', at(0.2, 0.3, 0.55), at(0.45, 0.45, 1.2));
    } else if (q.pose === 'hand') {
      // handstand: hands on the shoulders below, feet up for the next one to stand on
      const sh = at(0, 0, 0.3), hip = at(0, 0, 0.66);
      L(0.1, d.color, at(0, -0.16, 0), at(0, -0.16, 0.3));
      L(0.1, d.color, at(0, 0.16, 0), at(0, 0.16, 0.3));
      L(body, d.color, sh, hip);
      L(0.13, legs, hip, at(0, -0.1 - (isTop ? 0.25 + wave * 0.1 : 0), 1));
      L(0.13, legs, hip, at(0, 0.1 + (isTop ? 0.25 - wave * 0.1 : 0), 1));
      head = at(0, 0, 0.16);
    } else {
      // standing on the shoulders below, arms out for balance
      const hip = at(0, 0, 0.6), sh = at(0, 0, 1);
      L(0.13, legs, at(0, -0.13, 0), hip);
      L(0.13, legs, at(0, 0.13, 0), hip);
      L(body, d.color, hip, sh);
      if (isTop && d.type === 'phone') {
        L(0.1, d.color, at(0, 0.18, 1, -0.05), at(0.15, 0.3, 1, 0.55));
        dot3(...at(0.15, 0.3, 1, 0.6), 0.08 * sc, '#9fe1ff');
        L(0.1, d.color, at(0, -0.18, 1, -0.05), at(0, -0.5, 1, -0.2));
      } else if (isTop) {
        L(0.1, d.color, at(0, -0.18, 1, -0.05), at(0.05, -0.38, 1, 0.6 + wave * 0.1));
        L(0.1, d.color, at(0, 0.18, 1, -0.05), at(0.05, 0.38, 1, 0.6 - wave * 0.1));
      } else {
        L(0.1, d.color, at(0, -0.18, 1, -0.05), at(0, -0.62, 1, 0.1 + wave * 0.12));
        L(0.1, d.color, at(0, 0.18, 1, -0.05), at(0, 0.62, 1, 0.1 - wave * 0.12));
      }
      head = at(0, 0, 1, 0.2);
    }
    dot3(...head, 0.17 * sc + 1.5 * dpr, '#15161a');
    dot3(...head, 0.17 * sc, d.skin);
    if (d.type === 'baba') dot3(head[0], head[1], head[2] + 0.05, 0.17 * sc, '#c9455a');
  }

  // local (a forward, b to the side, c up) → screen, with roll around the forward axis
  function local(p, yaw, roll) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
    return (a, b, c) => {
      const b2 = b * cr + c * sr, c2 = -b * sr + c * cr;
      const wx = p.x + cy * a - sy * b2, wy = p.y + sy * a + cy * b2;
      return [px(wx, wy), py(wx, wy, p.z + c2)];
    };
  }
  const seg = (P, a, b) => { ctx.beginPath(); ctx.moveTo(...P(...a)); ctx.lineTo(...P(...b)); ctx.stroke(); };

  function drawScooter(p, deckYaw, roll, fallen, barYaw) {
    const D = local(p, deckYaw, fallen ? 1.4 : roll);
    ctx.fillStyle = '#1fc767';
    ctx.beginPath();
    ctx.moveTo(...D(-0.42, -0.09, 0.12)); ctx.lineTo(...D(0.4, -0.09, 0.12));
    ctx.lineTo(...D(0.4, 0.09, 0.12)); ctx.lineTo(...D(-0.42, 0.09, 0.12));
    ctx.closePath(); ctx.fill();
    for (const a of [-0.45, 0.45]) { const q = D(a, 0, 0.09); ctx.fillStyle = '#15171b'; ctx.beginPath(); ctx.arc(q[0], q[1], 0.11 * sc, 0, U.TAU); ctx.fill(); }
    const B = fallen ? D : local(p, barYaw, roll);
    ctx.strokeStyle = '#1d2026';
    ctx.lineWidth = 0.07 * sc;
    seg(B, [0.42, 0, 0.12], [0.36, 0, 1.05]);
    seg(B, [0.36, -0.25, 1.05], [0.36, 0.25, 1.05]);
  }

  function drawRider(p, yaw, roll) {
    const Pt = local(p, yaw, roll);
    const crouch = p.drift ? 0.12 : p.state === 'grind' ? 0.15 : 0;
    const hip = [-0.12 + crouch * 0.3, 0, 0.95 - crouch], sh = [0.06 + crouch, 0, 1.45 - crouch], head = [0.12 + crouch, 0, 1.68 - crouch];
    ctx.strokeStyle = '#2b2d42';
    ctx.lineWidth = 0.13 * sc;
    seg(Pt, [-0.08, -0.07, 0.14], [0.04, -0.1, 0.55 - crouch]); seg(Pt, [0.04, -0.1, 0.55 - crouch], hip);
    seg(Pt, [0.08, 0.07, 0.14], [0.14, 0.1, 0.55 - crouch]); seg(Pt, [0.14, 0.1, 0.55 - crouch], hip);
    ctx.strokeStyle = '#ff3e8a';
    ctx.lineWidth = 0.34 * sc;
    seg(Pt, hip, sh);
    ctx.lineWidth = 0.1 * sc;
    seg(Pt, [sh[0], -0.17, sh[2] - 0.05], [0.36, -0.22, 1.05]);
    seg(Pt, [sh[0], 0.17, sh[2] - 0.05], [0.36, 0.22, 1.05]);
    const h = Pt(...head);
    ctx.fillStyle = '#f1c7a0'; ctx.beginPath(); ctx.arc(h[0], h[1], 0.14 * sc, 0, U.TAU); ctx.fill();
    const cap = Pt(head[0] - 0.02, 0, head[2] + 0.07);
    ctx.fillStyle = '#16181d'; ctx.beginPath(); ctx.arc(cap[0], cap[1], 0.12 * sc, Math.PI, 0); ctx.fill();
  }

  const RIDER = { color: '#ff3e8a', skin: '#f1c7a0' };
  function drawRag(r, g, who) {
    shadow(r.x, r.y, g.world.groundZ(r.x, r.y), 0.45);
    const fx = Math.cos(r.heading), fy = Math.sin(r.heading);
    const ax = Math.cos(r.rot) * 0.75, az = Math.sin(r.rot) * 0.75;
    const a = [r.x + fx * ax, r.y + fy * ax, r.z + az], b = [r.x - fx * ax, r.y - fy * ax, r.z - az];
    ctx.strokeStyle = '#2b2d42'; ctx.lineWidth = 0.14 * sc;
    line3(r.x, r.y, r.z, ...b);
    ctx.strokeStyle = who.color; ctx.lineWidth = 0.34 * sc;
    line3(r.x, r.y, r.z, (r.x + a[0]) / 2, (r.y + a[1]) / 2, (r.z + a[2]) / 2);
    dot3(...a, 0.14 * sc, who.skin);
  }

  // ---------- overlays ----------
  function drawParticles(g) {
    for (const q of g.fx.particles) {
      const k = 1 - q.t / q.life;
      ctx.globalAlpha = k;
      if (q.streak) {
        ctx.strokeStyle = q.color; ctx.lineWidth = q.size * sc;
        const p = g.player, l = 0.5;
        line3(q.x, q.y, q.z, q.x - p.vx * l * 0.1, q.y - p.vy * l * 0.1, q.z);
      } else dot3(q.x, q.y, q.z, Math.max(1.5, q.size * sc), q.color);
    }
    ctx.globalAlpha = 1;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // a bobbing "+1" over every hitchhiker, drawn over everything so it can be seen from afar
  function drawHitchTags(g) {
    ctx.font = `900 ${Math.round(12 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const d of g.peds.list) {
      if (!d.hitch) continue;
      const sx = px(d.x, d.y), sy = py(d.x, d.y, d.z + d.h + 0.75) + Math.sin(g.t * 4 + d.phase) * 3 * dpr;
      if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) continue;
      const r = 11 * dpr;
      ctx.fillStyle = '#2fd16a';
      ctx.beginPath(); ctx.arc(sx, sy - r, r, 0, U.TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(sx - 5 * dpr, sy - 3 * dpr); ctx.lineTo(sx, sy + 5 * dpr); ctx.lineTo(sx + 5 * dpr, sy - 3 * dpr); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText('+1', sx, sy - r);
    }
  }

  function drawBubbles(g) {
    ctx.font = `600 ${Math.round(13 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = g.tower, p = g.player, list = g.peds.list.slice();
    for (const f of tw.flyers) if (f.d.bubble) list.push(Object.assign({}, f.d, { x: f.x, y: f.y, z: f.z - 1, h: 1, jz: 0 }));
    if (tw.bubble && tw.pax.length) {
      const h = SK.Tower.height(tw);
      list.push({ bubble: tw.bubble, x: p.x + tw.roll * h, y: p.y - tw.pitch * h, z: p.z, h: h + 0.3, jz: 0 });
    }
    for (const d of list) {
      if (!d.bubble) continue;
      const sx = px(d.x, d.y), sy = py(d.x, d.y, d.z + d.h + 0.55 + d.jz);
      if (sx < -100 || sx > W + 100 || sy < -50 || sy > H + 50) continue;
      ctx.globalAlpha = Math.min(1, d.bubble.t / 0.3);
      const w = ctx.measureText(d.bubble.text).width + 14 * dpr, h = 22 * dpr;
      ctx.fillStyle = '#fffdf6';
      roundRect(sx - w / 2, sy - h, w, h, 7 * dpr);
      ctx.fill();
      ctx.beginPath(); ctx.moveTo(sx - 4 * dpr, sy - 1); ctx.lineTo(sx, sy + 6 * dpr); ctx.lineTo(sx + 5 * dpr, sy - 1); ctx.fill();
      ctx.fillStyle = '#1b1d22';
      ctx.fillText(d.bubble.text, sx, sy - h / 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawPopups(g) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const q of g.fx.popups) {
      const k = q.t / q.life;
      const sx = px(q.x, q.y), sy = py(q.x, q.y, q.z + k * 1.3);
      // slam in big, settle with a little bounce
      const e = Math.min(1, k / 0.16);
      const pop = e < 1 ? 1.9 - 0.9 * (1 - Math.pow(1 - e, 3)) + Math.sin(e * Math.PI) * 0.15 : 1 - Math.min(0.08, (k - 0.16) * 0.2);
      ctx.font = `900 ${Math.round(17 * dpr * q.size * pop)}px system-ui, sans-serif`;
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.lineWidth = 4 * dpr;
      ctx.strokeStyle = '#15161a';
      ctx.strokeText(q.text, sx, sy);
      ctx.fillStyle = q.color;
      ctx.fillText(q.text, sx, sy);
    }
    ctx.globalAlpha = 1;
  }

  // "!" popping over the heads the bell just hit
  function drawMarks(g) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const m of g.fx.marks) {
      const d = m.d, k = m.t / 0.7;
      const s = k < 0.15 ? 0.5 + k / 0.15 * 0.9 : 1.4 - Math.min(0.4, (k - 0.15) * 2);
      const sx = px(d.x, d.y), sy = py(d.x, d.y, d.z + d.h + 0.4 + d.jz) - k * 10 * dpr;
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.font = `900 ${Math.round(26 * dpr * s)}px system-ui, sans-serif`;
      ctx.lineWidth = 5 * dpr; ctx.strokeStyle = '#15161a';
      ctx.strokeText('!', sx, sy);
      ctx.fillStyle = '#ffe14d';
      ctx.fillText('!', sx, sy);
    }
    ctx.globalAlpha = 1;
  }

  // a coloured glow at the screen edges
  function drawFlash(g) {
    const f = g.fx.flash;
    if (!f) return;
    const a = f.a * (1 - f.t / f.life);
    const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    gr.addColorStop(0, `rgba(${f.color},0)`);
    gr.addColorStop(1, `rgba(${f.color},${a})`);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
  }

  // hearts fly from the person you annoyed into the stream counter at the top
  function drawHearts(g) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tx = W / 2, ty = 40 * dpr;
    for (const h of g.fx.hearts) {
      if (h.t < 0) continue;
      const k = h.t / h.life, e = k * k;
      const x0 = px(h.x, h.y), y0 = py(h.x, h.y, h.z);
      // first a little hop out, then a swoop to the counter
      const ox = h.dx * 40 * dpr * Math.sin(k * Math.PI), oy = (h.dy * 30 - 30) * dpr * Math.sin(k * Math.PI);
      const sx = x0 + (tx - x0) * e + ox, sy = y0 + (ty - y0) * e + oy;
      const s = (k < 0.15 ? k / 0.15 : 1) * (1.2 - 0.6 * k);
      ctx.font = `900 ${Math.round(20 * dpr * s)}px system-ui, sans-serif`;
      ctx.lineWidth = 4 * dpr; ctx.strokeStyle = '#15161a';
      ctx.strokeText('❤', sx, sy);
      ctx.fillStyle = h.color;
      ctx.fillText('❤', sx, sy);
    }
  }

  // big words in the middle of the screen: streaks, panic
  function drawCallouts(g) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const list = g.fx.callouts;
    for (let i = 0; i < list.length; i++) {
      const c = list[i], k = c.t / c.life;
      const e = Math.min(1, c.t / 0.18);
      const s = c.size * (e < 1 ? 2.2 - 1.2 * (1 - Math.pow(1 - e, 3)) : 1 + Math.sin((c.t - 0.18) * 14) * 0.04 * (1 - k));
      const y = H * 0.24 - (c.old ? 40 * dpr * (1 + k) : 0);
      ctx.globalAlpha = (c.old ? 0.45 : 1) * (k > 0.75 ? (1 - k) / 0.25 : 1);
      ctx.save();
      ctx.translate(W / 2, y);
      ctx.rotate(c.tilt);
      ctx.scale(s, s);
      ctx.font = `900 ${Math.round(40 * dpr)}px system-ui, sans-serif`;
      ctx.lineWidth = 9 * dpr; ctx.strokeStyle = '#15161a';
      ctx.strokeText(c.text, 0, 0);
      ctx.fillStyle = '#ff3e8a';
      ctx.fillText(c.text, 3 * dpr, 3 * dpr);
      ctx.fillStyle = c.color;
      ctx.fillText(c.text, 0, 0);
      if (c.sub && !c.old) {
        ctx.font = `900 ${Math.round(17 * dpr)}px system-ui, sans-serif`;
        ctx.lineWidth = 5 * dpr;
        ctx.strokeText(c.sub, 0, 32 * dpr);
        ctx.fillStyle = '#fff';
        ctx.fillText(c.sub, 0, 32 * dpr);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // streaks at the screen edges when you are going fast
  const streaks = [];
  function drawSpeedLines(g) {
    const p = g.player, C = SK.CFG;
    const k = U.clamp((p.speed - C.maxSpeed * 0.85) / (C.boostSpeed + 2), 0, 1);
    if (k <= 0) { streaks.length = 0; return; }
    while (streaks.length < 18) streaks.push({ a: Math.random() * U.TAU, d: 0.55 + Math.random() * 0.5, t: Math.random() });
    ctx.strokeStyle = `rgba(255,255,255,${0.25 * k})`;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    const R0 = Math.hypot(W, H) / 2;
    for (const s of streaks) {
      s.t += 0.08;
      if (s.t > 1) { s.t = 0; s.a = Math.random() * U.TAU; s.d = 0.55 + Math.random() * 0.5; }
      const r0 = R0 * (s.d + s.t * 0.3), r1 = r0 + R0 * 0.12;
      ctx.moveTo(W / 2 + Math.cos(s.a) * r0, H / 2 + Math.sin(s.a) * r0);
      ctx.lineTo(W / 2 + Math.cos(s.a) * r1, H / 2 + Math.sin(s.a) * r1);
    }
    ctx.stroke();
  }

  SK.render = R;
})();
