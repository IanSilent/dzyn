// Keyboard → actions. sample() returns held keys plus one-shot presses since the last sample.
(function () {
  const SK = window.SK;
  const MAP = {
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    Space: 'hop', KeyE: 'bell', KeyF: 'bell', KeyR: 'reset',
  };
  const held = {}, pressed = {};

  window.addEventListener('keydown', (e) => {
    const a = MAP[e.code];
    if (!a) return;
    if (!held[a]) pressed[a] = true;
    held[a] = true;
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { const a = MAP[e.code]; if (a) held[a] = false; });
  window.addEventListener('blur', () => { for (const k in held) held[k] = false; });

  SK.input = {
    sample() {
      const s = {
        up: !!held.up, down: !!held.down, left: !!held.left, right: !!held.right, hop: !!held.hop,
        hopPressed: !!pressed.hop, bellPressed: !!pressed.bell, resetPressed: !!pressed.reset,
      };
      for (const k in pressed) delete pressed[k];
      return s;
    },
  };
})();
