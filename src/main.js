(function () {
  const SK = window.SK;
  const canvas = document.getElementById('c');
  SK.game.init({ seed: 7 });
  SK.render.init(canvas);
  SK.ui.init();

  let started = false, last = performance.now();
  function start() {
    if (started) return;
    started = true;
    document.getElementById('intro').classList.add('hidden');
    SK.audio.start();
    SK.input.sample(); // drop the key that closed the intro
  }

  window.addEventListener('keydown', (e) => {
    if (!started) { if (!e.repeat) start(); return; }
    if (e.code === 'Backquote') SK.ui.toggleDebug();
    else if (e.code === 'KeyM') SK.audio.toggle();
    else if (e.code === 'KeyC') {
      const order = ['street', 'relative', 'screen'];
      SK.CFG.controlMode = order[(order.indexOf(SK.CFG.controlMode) + 1) % order.length];
      SK.saveCfg();
      SK.ui.showMode();
    }
  });
  document.getElementById('intro').addEventListener('click', start);

  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (started) SK.game.frame(dt);
    SK.audio.handle(SK.game.drain());
    SK.audio.update(SK.game);
    SK.render.draw(SK.game);
    SK.ui.update(SK.game, dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
