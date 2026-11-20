// DOM HUD (likes, stream combo, speedometer, toasts) and the tuning panel.
(function () {
  const SK = window.SK;
  const UI = {};
  const $ = (id) => document.getElementById(id);
  const el = {};
  let lastFlash = null, toastT = 0, heartsSeen = 0;
  const shown = {};
  function set(node, key, text) { if (shown[key] !== text) { shown[key] = text; node.textContent = text; } }

  UI.init = function () {
    for (const id of ['dist', 'best', 'crew', 'likes', 'pool', 'mult', 'bar', 'combo', 'speed', 'state', 'toast', 'mode', 'debug']) el[id] = $(id);
    buildDebug();
    UI.showMode();
  };

  UI.update = function (g, dt) {
    const s = g.score, p = g.player, C = SK.CFG;
    set(el.likes, 'likes', s.bank.toLocaleString('ru-RU'));
    set(el.dist, 'dist', Math.round(g.dist).toLocaleString('ru-RU') + ' м');
    set(el.best, 'best', g.best > 0 ? 'рекорд ' + Math.round(g.best).toLocaleString('ru-RU') + ' м' : '');
    // every heart that lands in the counter makes it jump
    if (g.fx.heartsIn !== heartsSeen) {
      heartsSeen = g.fx.heartsIn;
      el.combo.classList.remove('bump');
      void el.combo.offsetWidth;
      el.combo.classList.add('bump');
    }
    el.combo.classList.toggle('hot', g.streak.t > 0 && g.streak.n >= 6);
    if (s.pool > 0) {
      el.combo.classList.add('on');
      set(el.pool, 'pool', '+' + Math.round(s.pool));
      set(el.mult, 'mult', '×' + SK.Score.mult(s).toFixed(2).replace(/0$/, ''));
      el.bar.style.transform = `scaleX(${Math.max(0, s.timer / C.comboTime)})`;
    } else el.combo.classList.remove('on');
    const n = SK.Tower.count(g.tower);
    set(el.crew, 'crew', n ? n + ' · очки ×' + SK.Tower.mult(g.tower).toFixed(2).replace(/\.?0+$/, '') : '0');
    set(el.speed, 'speed', String(Math.round(p.speed * 3.6)));
    let st = '';
    if (p.state === 'crash') st = 'упал';
    else if (p.state === 'grind') st = 'грайнд';
    else if (p.drift) st = ['дрифт', 'дрифт ▸ буст', 'дрифт ▸▸ супербуст'][p.drift.level];
    else if (p.boostT > 0) st = 'буст!';
    else if (!p.grounded) st = 'в воздухе';
    set(el.state, 'state', st);
    if (s.flash && s.flash !== lastFlash) {
      lastFlash = s.flash;
      el.toast.className = s.flash.kind;
      el.toast.textContent = s.flash.kind === 'bank'
        ? `+${s.flash.amount} ❤ в копилку`
        : `завалился — ${s.flash.amount} ❤ сгорело`;
      toastT = 2;
    }
    if (toastT > 0 && (toastT -= dt) <= 0) el.toast.className = '';
  };

  const MODES = { street: 'по улице', relative: 'рулём', screen: 'по экрану' };
  UI.showMode = function () {
    el.mode.textContent = 'управление: ' + MODES[SK.CFG.controlMode] + ' (C — сменить)';
  };

  UI.toggleDebug = function () { el.debug.classList.toggle('hidden'); };

  function buildDebug() {
    const C = SK.CFG, D = SK.CFG_DEFAULTS;
    const box = el.debug;
    box.innerHTML = '<div class="dh">Тюнинг <span>` — закрыть</span></div>';
    const inputs = {};
    for (const m of SK.CFG_META) {
      if (m.length === 1) { const h = document.createElement('div'); h.className = 'ds'; h.textContent = m[0]; box.appendChild(h); continue; }
      const [key, label, min, max, step] = m;
      const row = document.createElement('label');
      row.className = 'dr';
      row.innerHTML = `<span class="dl">${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><span class="dv"></span>`;
      const inp = row.querySelector('input'), val = row.querySelector('.dv');
      const sync = () => { inp.value = C[key]; val.textContent = (+C[key]).toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0); row.classList.toggle('changed', C[key] !== D[key]); };
      inp.addEventListener('input', () => { C[key] = parseFloat(inp.value); sync(); SK.saveCfg(); });
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      inputs[key] = sync;
      sync();
      box.appendChild(row);
    }
    const btns = document.createElement('div');
    btns.className = 'db';
    btns.innerHTML = '<button data-a="reset">Сбросить всё</button><button data-a="copy">Скопировать изменения</button>';
    btns.addEventListener('click', (e) => {
      const a = e.target.dataset.a;
      if (a === 'reset') { for (const k in D) C[k] = D[k]; SK.saveCfg(); for (const k in inputs) inputs[k](); UI.showMode(); }
      if (a === 'copy') {
        const diff = {};
        for (const k in D) if (C[k] !== D[k]) diff[k] = C[k];
        const text = JSON.stringify(diff, null, 1);
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
          () => { e.target.textContent = 'Скопировано'; },
          () => { window.prompt('Изменённые значения:', text); });
      }
    });
    box.appendChild(btns);
  }

  SK.ui = UI;
})();
