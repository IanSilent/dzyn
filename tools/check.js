// Headless checks of the real simulation (no DOM). Usage: node tools/check.js
const fs = require('fs'), path = require('path'), vm = require('vm');

const ctx = { console, Math, Date, JSON, Object, Array, Infinity, performance: { now: () => Date.now() } };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['config', 'util', 'world', 'player', 'peds', 'score', 'tower', 'game']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
}
const SK = ctx.SK, C = SK.CFG, G = SK.game;
C.controlMode = 'relative'; // the physics checks steer the handlebar; street mode has its own section

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   ' + name + (extra !== undefined ? '  (' + JSON.stringify(extra) + ')' : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
const section = (s) => console.log('\n' + s);
const r2 = (v) => Math.round(v * 100) / 100;
const hold = (o) => () => o;
// input fn: held keys plus one-shot presses at given step indices
const script = (held, presses) => (t, i) => Object.assign({}, held, (presses && presses[i]) || {});

// the left lane of the street, clear of the road ramps in the middle; riding forward (-y)
const LANE = 10, FWD = -Math.PI / 2;
function onRoad() { G.init({ peds: 0, hitch: 0 }); G.place(LANE, G.world.spawn.y, FWD, 0); return G.world; }

section('World');
G.init({});
const W = G.world;
ok(W.rows.size === 5, 'five chunks of street around the start', W.rows.size);
ok(G.peds.list.length > 50, 'pedestrians spawned with the chunks', G.peds.list.length);
ok(W.ramps.length >= 1, 'ramps exist', W.ramps.length);
ok(W.rails.length >= 3, 'grind rails exist', W.rails.length);
let badNodes = 0;
for (const n of W.nodes) if (W.collide(n.x, n.y, 0.3, W.groundZ(n.x, n.y)).length) badNodes++;
ok(badNodes === 0, 'walk graph nodes are clear of solids', badNodes);
// every edge sampled with ±1 m offset is clear (peds walk there)
let badEdges = 0;
W.nodes.forEach((a) => a.adj.forEach((b) => {
  if (b.x + b.y * 1e4 < a.x + a.y * 1e4) return;
  const L = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
  for (let s = 0.5; s < L - 0.5; s += 0.5) for (const o of [-1, 0, 1]) {
    const x = a.x + ux * s - uy * o, y = a.y + uy * s + ux * o;
    if (W.collide(x, y, 0.2, W.groundZ(x, y)).some((c) => c.s.kind !== 'ramp')) { badEdges++; return; }
  }
}));
ok(badEdges === 0, 'walk graph edges (±1 m) are clear of solids', badEdges);
const sp = W.spawn;
ok(W.collide(sp.x, sp.y, C.radius, W.groundZ(sp.x, sp.y)).length === 0, 'spawn is clear');

section('Riding');
onRoad();
G.advance(4, hold({ up: true }));
let p = G.player;
ok(p.speed > C.maxSpeed * 0.88 && p.speed <= C.maxSpeed + 0.01, 'full throttle reaches ~max speed in 4 s', r2(p.speed));
ok(Math.abs(p.x - LANE) < 0.05 && p.state === 'ride', 'straight line stays straight', r2(p.x));
const v0 = p.speed;
G.advance(1.5, hold({}));
ok(p.speed < v0 && p.speed > v0 * 0.7, 'coasting loses speed slowly', r2(p.speed));
let minSp = 99;
G.advance(1.5, () => { minSp = Math.min(minSp, p.speed); return { down: true }; });
ok(minSp < 0.2, 'brake stops', r2(minSp));
ok(p.speed <= C.reverseSpeed + 0.01, 'then only a slow roll back', r2(p.speed));

onRoad();
G.advance(3, hold({ up: true }));
p = G.player;
const h0 = p.heading, s0 = p.speed;
G.advance(0.6, hold({ up: true, right: true }));
ok(p.heading - h0 > 0.5, 'steering turns', r2(p.heading - h0));
ok(p.speed > s0 * 0.85, 'normal turning keeps most speed', [r2(s0), r2(p.speed)]);

section('Hop and drift');
onRoad();
G.advance(3, hold({ up: true }));
p = G.player;
let air = 0, peak = 0;
G.advance(1.2, (t, i) => { if (!p.grounded) { air += G.DT; peak = Math.max(peak, p.z); } return { up: true, hopPressed: i === 0, hop: i < 5 }; });
ok(air > 0.5 && air < 0.8, 'hop airtime ~0.6 s', r2(air));
ok(peak > 0.6 && peak < 1.0, 'hop peak height', r2(peak));

// drift: hop with steer held, keep Space held, release later → boost
// on an empty flat plane, so curbs and walls do not interfere
G.init({ peds: 0, hitch: 0 });
G.world.collide = () => [];
G.world.groundZ = () => 0;
G.world.rampVz = () => 0;
G.place(50, 50, 0, 0);
G.advance(2, hold({ up: true }));
p = G.player;
let drifted = false, maxLv = 0, maxSlide = 0;
G.advance(2.0, (t, i) => {
  if (p.drift) { drifted = true; maxLv = Math.max(maxLv, p.drift.level); maxSlide = Math.max(maxSlide, Math.abs(SK.U.wrap(p.heading - Math.atan2(p.vy, p.vx)))); }
  return { up: true, right: true, hop: true, hopPressed: i === 0 }; });
ok(drifted, 'hop + held Space + steer → drift');
ok(maxLv === 2, 'a tight drift charges boost level 2', maxLv);
ok(maxSlide > 0.3 && maxSlide < 0.8, 'drift slide angle is a slide, not a spin-out', r2(maxSlide));
ok(p.speed > C.maxSpeed * 0.7, 'drift keeps most of the speed', r2(p.speed));
const before = p.speed;
G.advance(0.05, hold({ up: true }));
ok(p.boostT > 0 && p.speed > before + 1.5, 'releasing Space fires the boost', [r2(before), r2(p.speed)]);
ok(G.score.pool > 0, 'drift scores into the stream', G.score.pool);

section('Walls and crashes');
G.init({ peds: 0, hitch: 0 });
// a building on the right whose -x face is the edge of the right sidewalk
const bld = G.world.solids.find((s) => s.kind === 'building' && s.x0 === G.world.width && s.y1 < G.world.spawn.y);
// ride at the building's -x face from the sidewalk, straight in
G.place(bld.x0 - 3.2, (bld.y0 + bld.y1) / 2, 0, C.maxSpeed);
G.advance(0.6, hold({ up: true }));
p = G.player;
ok(p.state === 'crash', 'full speed into a wall → crash', p.state);
G.advance(C.crashTime + 0.2, hold({}));
ok(p.state === 'ride' && p.invulnT > 0, 'get back up after crashTime', p.state);
G.place(bld.x0 - 1.5, (bld.y0 + bld.y1) / 2, 0, 3);
G.advance(0.8, hold({}));
ok(p.state === 'ride' && p.x < bld.x0, 'slow bump does not crash and does not pass through', [p.state, r2(p.x), bld.x0]);

section('Ramps');
G.init({ peds: 0, hitch: 0 });
const rp = G.world.ramps.find((r) => r.h >= 1.3) || G.world.ramps[0];
const start = { x: (rp.x0 + rp.x1) / 2 - rp.dx * (rp.len / 2 + 8), y: (rp.y0 + rp.y1) / 2 - rp.dy * (rp.len / 2 + 8) };
G.place(start.x, start.y, Math.atan2(rp.dy, rp.dx), C.maxSpeed);
p = G.player;
let rpeak = 0, rair = 0;
G.advance(2.5, () => { rpeak = Math.max(rpeak, p.z); if (!p.grounded && p.state === 'ride') rair += G.DT; return { up: true }; });
ok(rpeak > rp.top + 0.4, 'ramp launches above its lip', [r2(rp.top), r2(rpeak)]);
ok(p.state === 'ride', 'and lands clean', p.state);
ok(rair > 0.7, 'ramp airtime', r2(rair));
// tricks happen by themselves and never make you fall
G.place(start.x, start.y, Math.atan2(rp.dy, rp.dx), C.maxSpeed);
let sawSpin = 0;
G.advance(2.5, () => { if (p.spin) sawSpin = Math.max(sawSpin, p.spin.target / (2 * Math.PI)); return { up: true }; });
ok(p.state === 'ride' && G.score.pool >= C.spinPts, 'the big ramp does a trick by itself and lands', [p.state, G.score.pool, sawSpin]);
onRoad();
G.advance(2, hold({ up: true }));
p = G.player;
let tricked = false, fell = false;
G.advance(30, (t, i) => { if (p.spin || p.whip) tricked = true; if (p.state === 'crash') fell = true; return { up: true, hopPressed: i % 100 === 0 }; });
ok(tricked && !fell, '30 hops in a row: a trick every time, never a bail', [tricked, fell]);

section('Grind');
G.init({ peds: 0, hitch: 0 });
const ledge = G.world.rails.find((r) => r.owner.kind === 'ledge') || G.world.rails.find((r) => r.owner.kind === 'bench');
const off = 0.7; // ride parallel next to it
const nxr = -ledge.uy, nyr = ledge.ux;
G.place(ledge.ax - ledge.ux * 3 + nxr * off, ledge.ay - ledge.uy * 3 + nyr * off, Math.atan2(ledge.uy, ledge.ux), 9);
p = G.player;
let grinded = false;
G.advance(1.5, (t, i) => { if (p.state === 'grind') grinded = true; return { up: true, hopPressed: i === 24, left: i > 24 && i < 30 }; });
ok(grinded, 'hop onto a ledge next to you → grind', ledge.owner.kind);

section('Pedestrians and scoring');
function pedTest(offset, speed, phone, coast) {
  G.init({ peds: 0, hitch: 0 });
  const y = G.world.spawn.y;
  const d = G.addPed(LANE + offset, y - 10);
  G.place(LANE, y, FWD, speed);
  Object.assign(d, { x: LANE + offset, y: y - 10, state: 'angry', st: 99, type: phone ? 'phone' : 'norm', T: SK.Peds.TYPES[phone ? 'phone' : 'norm'] });
  d.T = Object.assign({}, d.T, { dodge: 0 });
  G.advance(1.6, hold({ up: !coast }));
  return d;
}
pedTest(1.0, C.maxSpeed);
ok(G.player.state === 'ride' && G.score.pool > 0, 'near miss at 1 m scores', G.score.pool);
const nearClose = G.score.pool;
G.advance(0.8, hold({}));
ok(G.fx.heartsIn > 0 && G.streak.n === 1, 'a near miss sends hearts to the counter and starts a streak', [G.fx.heartsIn, G.streak.n]);
G.init({ peds: 0, hitch: 0 });
G.place(LANE, G.world.spawn.y, FWD, C.maxSpeed);
for (let i = 1; i <= 3; i++) { const dd = G.addPed(LANE + 1, G.world.spawn.y - 6 * i); dd.state = 'angry'; dd.st = 99; dd.T = Object.assign({}, dd.T, { dodge: 0 }); }
let calls = [];
G.advance(2, () => { for (const c of G.fx.callouts) if (!calls.includes(c.text)) calls.push(c.text); return {}; });
ok(G.streak.n === 3 && calls.includes('СЕРИЯ ×3'), 'three close passes in a row → СЕРИЯ ×3', [G.streak.n, calls]);
pedTest(1.6, C.maxSpeed);
ok(G.score.pool > 0 && G.score.pool < nearClose, 'farther miss scores less', [G.score.pool, nearClose]);
pedTest(0.2, C.maxSpeed);
ok(G.player.state === 'crash' && G.peds.list[0].state === 'down', 'hitting a pedestrian → both fall', [G.player.state, G.peds.list[0].state]);
pedTest(0.2, 1.5, false, true);
ok(G.player.state === 'ride', 'walking pace bump just pushes', G.player.state);
pedTest(3.0, C.maxSpeed);
ok(G.score.pool === 0, 'passing at 3 m scores nothing', G.score.pool);

G.init({ peds: 0, hitch: 0 });
const d = G.addPed(LANE, G.world.spawn.y - 3);
G.place(LANE, G.world.spawn.y, FWD, 0);
G.advance(0.05, (t, i) => ({ bellPressed: i === 0 }));
ok(G.score.pool > 0 && d.state === 'startle', 'bell in range scares and scores', [G.score.pool, d.state]);
const pool1 = G.score.pool;
G.advance(0.6, (t, i) => ({ bellPressed: i === 0 }));
ok(G.score.pool === pool1, 'same pedestrian cannot be farmed during the cooldown', G.score.pool);
G.advance(C.comboTime + 0.5, hold({}));
ok(G.score.bank > 0 && G.score.pool === 0, 'stream cools down into likes', G.score.bank);

section('Street controls');
C.controlMode = 'street';
G.init({ peds: 0, hitch: 0 });
G.place(LANE, G.world.spawn.y, FWD, 0);
p = G.player;
G.advance(4, hold({}));
ok(p.speed > C.maxSpeed * 0.88, 'no keys: speeds up to full by itself', r2(p.speed));
ok(Math.abs(SK.U.wrap(p.heading - FWD)) < 0.05, 'nose points along the street', r2(p.heading));
let x0 = p.x;
G.advance(0.5, hold({ right: true }));
ok(p.x - x0 > 1.5, 'D for 0.5 s moves you well to the right', r2(p.x - x0));
G.advance(0.4, hold({}));
ok(Math.abs(SK.U.wrap(p.heading - FWD)) < 0.15, 'release: the nose comes back forward', r2(SK.U.wrap(p.heading - FWD)));
G.place(LANE + 5, G.world.spawn.y, FWD, 12);
x0 = p.x;
G.advance(0.5, hold({ left: true }));
ok(x0 - p.x > 2.5, 'at full speed, A for 0.5 s crosses a lane and more', r2(x0 - p.x));
G.place(LANE, G.world.spawn.y, FWD, 6);
G.advance(1, hold({ down: true }));
ok(p.speed > 6, 'S does nothing: there is no brake', r2(p.speed));

section('Passengers');
C.controlMode = 'street';
G.init({});
let hitch = G.peds.list.filter((dd) => dd.hitch);
ok(hitch.length >= 6 && hitch.every((dd) => dd.state === 'wait'), 'hitchhikers wait along the street', hitch.length);
// ride into one: they climb on instead of being run over
function crewRide(n) {
  G.init({ peds: 0, hitch: 0 });
  G.place(13, G.world.spawn.y, FWD, 12);
  for (let i = 0; i < n; i++) {
    const dd = G.addPed(13, G.player.y - 4);
    Object.assign(dd, { hitch: true, state: 'wait' });
    G.advance(0.5, hold({}));
  }
  G.advance(0.5, hold({}));
  return G.tower;
}
let tw = crewRide(1);
ok(tw.pax.length === 1 && G.player.state === 'ride' && G.peds.list.length === 0, 'riding into a hitchhiker picks them up', [tw.pax.length, G.player.state]);
const award1 = (() => { const b = G.score.pool; G.award('x', 10); return G.score.pool - b; })();
ok(award1 === Math.round(10 * (1 + C.paxBonus)), 'a passenger raises every payout', award1);
tw = crewRide(5);
ok(tw.pax.length === 5, 'five hitchhikers in a row make a tower of five', tw.pax.length);
const top5 = SK.Tower.height(tw);
ok(top5 > 6, 'the tower is absurdly tall', r2(top5));
G.advance(5, hold({}));
ok(tw.pax.length === 5, 'riding straight keeps everyone on', tw.pax.length);
// one dodge and back is fine; weaving in rhythm with the sway throws the top off
G.advance(1.2, (t) => ({ right: t % 2 < 0.4 }));
ok(tw.pax.length === 5, 'a single swerve keeps a tower of five', tw.pax.length);
tw = crewRide(8);
const t8 = G.t;
G.advance(6, (t) => { const m = (t - t8) % 1.5; return { right: m < 0.4, left: m >= 0.75 && m < 1.15 }; });
ok(tw.pax.length < 8 && tw.pax.length > 0, 'weaving with the sway throws the top off a tower of eight', tw.pax.length);
// fallen passengers become pedestrians again
G.advance(3, hold({}));
ok(tw.flyers.length === 0 && G.peds.list.some((dd) => !dd.hitch && dd.from && dd.to), 'fallen passengers get up and walk', G.peds.list.length);
// a crash throws the whole tower
tw = crewRide(4);
SK.Player.crash(G.player, G, 'test');
ok(tw.pax.length === 0 && tw.flyers.length === 4, 'a crash throws the whole tower', [tw.pax.length, tw.flyers.length]);
// the bell reaches further with a crew
tw = crewRide(4);
const far = G.addPed(13 + C.bellR + 1, G.player.y);
far.T = Object.assign({}, far.T, { dodge: 0 });
G.advance(0.05, (t, i) => ({ bellPressed: i === 0 }));
ok(far.state === 'startle', 'the crew shouts along: the bell reaches further', far.state);

section('Endless street');
G.init({ peds: 0, hitch: 0 });
const lane = LANE;
G.place(lane, G.world.spawn.y, FWD, 0);
p = G.player;
let maxRows = 0, maxSolids = 0, okRide = true;
G.advance(60, () => { maxRows = Math.max(maxRows, G.world.rows.size); maxSolids = Math.max(maxSolids, G.world.solids.length); if (p.state !== 'ride') okRide = false; return { up: true }; });
ok(G.dist > 600, 'a minute straight ahead covers > 600 m', Math.round(G.dist));
ok(okRide, 'the lane is clear all the way');
ok(maxRows <= 7 && maxSolids < 1000, 'only a few chunks are kept alive', [maxRows, maxSolids]);
// turn back: the barrier behind stops you
C.controlMode = 'relative';
G.place(lane, p.y, Math.PI / 2, 0);
let maxBackY = -Infinity;
G.advance(25, () => { maxBackY = Math.max(maxBackY, p.y); return { up: true }; });
ok(maxBackY < G.world.yBack, 'riding back ends at the barrier', [Math.round(maxBackY), Math.round(G.world.yBack)]);
// with pedestrians: the crowd follows you and stays bounded
C.controlMode = 'street';
G.init({});
G.place(lane, G.world.spawn.y, FWD, 0);
let maxPeds = 0, near = 0;
G.advance(60, () => { maxPeds = Math.max(maxPeds, G.peds.list.length); return { up: true }; });
for (const dd of G.peds.list) if (Math.abs(dd.y - G.player.y) < 60) near++;
ok(maxPeds < 400, 'pedestrian count stays bounded', maxPeds);
ok(near > 20, 'and there are people around you far ahead', near);
ok(G.peds.list.every((dd) => isFinite(dd.x + dd.y) && dd.to && dd.from), 'pedestrians stay valid');

section('Fuzz');
G.init({});
const rnd = SK.U.rng(99);
let held = {}, nan = 0, stuck = 0, crashes = 0, maxSp = 0, maxPen = 0;
const t0 = Date.now();
G.advance(90, (t, i) => {
  if (i % 40 === 0) held = { up: rnd() < 0.8, down: rnd() < 0.1, left: rnd() < 0.3, right: rnd() < 0.3, hop: rnd() < 0.3 };
  const pp = G.player;
  if (!isFinite(pp.x + pp.y + pp.z + pp.vx + pp.vy)) nan++;
  if (pp.state === 'crash' && pp.crashT === 0) crashes++;
  maxSp = Math.max(maxSp, pp.speed);
  if (pp.state === 'ride' && pp.grounded) for (const c of G.world.collide(pp.x, pp.y, C.radius, pp.z)) maxPen = Math.max(maxPen, c.depth);
  return Object.assign({}, held, { hopPressed: rnd() < 0.01, bellPressed: rnd() < 0.01, });
});
const ms = Date.now() - t0;
ok(nan === 0, '90 s of random input: no NaN');
ok(maxPen < 0.12, 'never deep inside a solid while riding on the ground', r2(maxPen));
ok(maxSp < C.maxSpeed + C.boostSpeed + C.boostKick2 + 1, 'speed stays bounded', r2(maxSp));
for (const dd of G.peds.list) if (!isFinite(dd.x + dd.y)) stuck++;
ok(stuck === 0, 'pedestrians stay finite');
ok(ms < 4000, '90 s simulated with the crowd fast enough', ms + ' ms');
console.log('  info: crashes ' + crashes + ', bank ' + G.score.bank);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
