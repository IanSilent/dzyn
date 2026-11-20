// Synthesised sound: an electric whine that follows speed, wind, drift/grind hiss, and one-shots for game events.
(function () {
  const SK = window.SK;
  const A = { ctx: null, on: true };
  let master, motor, motor2, motorGain, wind, windF, windGain, hiss, hissF, hissGain, noiseBuf;

  A.start = function () {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (A.ctx = new AC());
    master = c.createGain();
    master.gain.value = A.on ? 0.55 : 0;
    master.connect(c.destination);

    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1400;
    motorGain = c.createGain(); motorGain.gain.value = 0;
    motor = c.createOscillator(); motor.type = 'sawtooth'; motor.frequency.value = 120;
    motor2 = c.createOscillator(); motor2.type = 'sine'; motor2.frequency.value = 240;
    motor.connect(lp); motor2.connect(lp); lp.connect(motorGain); motorGain.connect(master);
    motor.start(); motor2.start();

    const loopNoise = (type, f, q) => {
      const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const filt = c.createBiquadFilter(); filt.type = type; filt.frequency.value = f; filt.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(filt); filt.connect(g); g.connect(master); src.start();
      return [filt, g];
    };
    [windF, windGain] = loopNoise('bandpass', 500, 0.7);
    [hissF, hissGain] = loopNoise('bandpass', 3000, 5);
  };

  A.toggle = function () {
    A.on = !A.on;
    if (master) master.gain.setTargetAtTime(A.on ? 0.55 : 0, A.ctx.currentTime, 0.05);
    return A.on;
  };

  A.update = function (g) {
    if (!A.ctx) return;
    const p = g.player, t = A.ctx.currentTime, C = SK.CFG;
    const sp = p.state === 'crash' ? 0 : p.speed;
    const on = p.state !== 'crash' && p.grounded;
    motor.frequency.setTargetAtTime(110 + sp * 38 + (p.throttle ? 30 : 0) + (p.boostT > 0 ? 120 : 0), t, 0.08);
    motor2.frequency.setTargetAtTime(220 + sp * 76, t, 0.08);
    motorGain.gain.setTargetAtTime(sp > 0.3 || p.throttle ? 0.018 + 0.03 * p.throttle + sp / C.maxSpeed * 0.02 : 0, t, 0.06);
    windF.frequency.setTargetAtTime(300 + sp * 70, t, 0.1);
    windGain.gain.setTargetAtTime(Math.min(0.16, (sp / 14) ** 2 * 0.14), t, 0.1);
    const grind = p.state === 'grind';
    hissF.frequency.setTargetAtTime(grind ? 1400 : 2600 + (p.drift ? p.drift.level * 500 : 0), t, 0.05);
    hissGain.gain.setTargetAtTime(grind ? 0.12 : p.drift && on ? 0.05 + p.drift.level * 0.025 : 0, t, 0.04);
  };

  function tone(freq, dur, type, gain, freqEnd, delay) {
    const c = A.ctx, t = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, f, gain, type, delay) {
    const c = A.ctx, t = c.currentTime + (delay || 0);
    const s = c.createBufferSource(); s.buffer = noiseBuf;
    const fl = c.createBiquadFilter(); fl.type = type || 'lowpass'; fl.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  function bell() {
    for (const [d, k] of [[0, 1], [0.12, 0.8]]) {
      tone(2350, 0.9, 'sine', 0.22 * k, null, d);
      tone(3150, 0.55, 'sine', 0.1 * k, null, d);
      tone(5200, 0.2, 'sine', 0.04 * k, null, d);
    }
  }

  A.handle = function (events) {
    if (!A.ctx || !A.on) return;
    for (const e of events) {
      switch (e.type) {
        case 'bell': bell(); break;
        case 'hop': tone(180, 0.08, 'triangle', 0.08, 120); break;
        case 'launch': tone(200, 0.25, 'sawtooth', 0.05, 500); break;
        case 'land': noise(0.12, 300, Math.min(0.35, 0.08 + e.v * 0.03)); tone(90, 0.12, 'sine', 0.15, 50); break;
        case 'curb': noise(0.08, 900, 0.18); tone(140, 0.06, 'square', 0.04); break;
        case 'bump': noise(0.1, 600, Math.min(0.3, e.v * 0.04)); break;
        case 'crash': noise(0.5, 900, 0.45); tone(110, 0.35, 'sawtooth', 0.12, 40); break;
        case 'hitPed': tone(700, 0.2, 'square', 0.05, 300); break;
        case 'near':
          noise(0.18, 1800, 0.12 + e.close * 0.1, 'bandpass');
          // a chime that climbs with the streak
          tone(880 * Math.pow(1.0595, Math.min(18, e.streak || 0)), 0.16, 'triangle', 0.06 + e.close * 0.04);
          if (e.close > 0.75) tone(1760 * Math.pow(1.0595, Math.min(18, e.streak || 0)), 0.22, 'sine', 0.05, null, 0.05);
          break;
        case 'streak': if (e.n % 5 === 0) [0, 4, 7, 12].forEach((s, i) => tone(523 * Math.pow(1.0595, s + Math.min(12, e.n / 5)), 0.14, 'square', 0.04, null, i * 0.05)); break;
        case 'panic': noise(0.6, 2400, 0.12, 'bandpass'); [0, 3, 7].forEach((s, i) => tone(660 * Math.pow(1.0595, s), 0.3, 'sawtooth', 0.03, 990, i * 0.04)); break;
        case 'score': tone(660 * Math.pow(1.06, Math.min(24, e.chain)), 0.09, 'square', 0.035); break;
        case 'yelp': tone(e.who === 'baba' ? 900 : 650, 0.16, 'sine', 0.05, e.who === 'baba' ? 1300 : 950); break;
        case 'driftStart': noise(0.15, 2500, 0.08, 'bandpass'); break;
        case 'driftLevel': tone(e.level === 2 ? 1320 : 990, 0.12, 'triangle', 0.08); break;
        case 'boost': tone(300, 0.35, 'sawtooth', 0.07, 900); noise(0.3, 1500, 0.1, 'highpass'); break;
        case 'grindStart': noise(0.08, 2000, 0.15, 'bandpass'); tone(260, 0.06, 'square', 0.04); break;
        case 'pickup': [440, 554, 659].forEach((f, i) => tone(f * Math.pow(1.03, Math.min(12, e.n)), 0.1, 'triangle', 0.07, null, i * 0.05)); break;
        case 'paxFall': tone(900, 0.5, 'sine', 0.07, 250); noise(0.2, 700, 0.12, 'lowpass', 0.25); break;
        case 'clip': noise(0.12, 1800, 0.25, 'bandpass'); tone(320, 0.1, 'square', 0.05); break;
        case 'bank': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'triangle', 0.08, null, i * 0.06)); break;
        case 'lost': [392, 330, 262].forEach((f, i) => tone(f, 0.22, 'sawtooth', 0.05, null, i * 0.1)); break;
      }
    }
  };

  SK.audio = A;
})();
