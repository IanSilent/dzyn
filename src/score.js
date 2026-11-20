// Combo bank, Tony Hawk style: every stunt goes into the "stream" pool and raises the multiplier.
// While you drift, grind or fly the stream does not cool down. When it cools down, pool × multiplier is
// banked as likes. A crash burns the whole unbanked pool.
(function () {
  const SK = window.SK;
  const S = {};
  S.create = () => ({ bank: 0, pool: 0, chain: 0, timer: 0, best: 0, flash: null });
  S.mult = (s) => 1 + Math.min(s.chain * SK.CFG.chainStep, SK.CFG.maxMult - 1);
  S.add = function (s, pts) { s.pool += pts; s.chain += 1; s.timer = SK.CFG.comboTime; };
  // continuous income (grinding): feeds the pool without growing the chain
  S.flow = function (s, pts) { s.pool += pts; s.timer = Math.max(s.timer, SK.CFG.comboTime * 0.5); };
  S.tick = function (s, dt, g) {
    if (s.flash && (s.flash.t -= dt) <= 0) s.flash = null;
    if (s.pool <= 0) { s.timer = 0; return; }
    const p = g.player;
    const flowing = p.state === 'grind' || !!p.drift || (p.state === 'ride' && !p.grounded);
    if (!flowing) s.timer -= dt;
    if (s.timer <= 0) {
      const gain = Math.round(s.pool * S.mult(s));
      s.bank += gain;
      s.best = Math.max(s.best, gain);
      s.flash = { kind: 'bank', amount: gain, t: 2.2 };
      s.pool = 0;
      s.chain = 0;
      g.emit('bank', { amount: gain });
    }
  };
  S.crash = function (s, g) {
    if (s.pool > 0) {
      const lost = Math.round(s.pool * S.mult(s));
      s.flash = { kind: 'lost', amount: lost, t: 2.2 };
      g.emit('lost', { amount: lost });
    }
    s.pool = 0;
    s.chain = 0;
    s.timer = 0;
  };
  SK.Score = S;
})();
