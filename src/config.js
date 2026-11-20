// Tunable numbers. Every key listed in CFG_META gets a slider in the tuning panel (` key).
// Units: metres, seconds, radians. Changed values persist in localStorage ('dzyn.cfg').
window.SK = window.SK || {};
(function () {
  const SK = window.SK;
  const D = {
    // riding
    maxSpeed: 12, accel: 10, brake: 18, reverseSpeed: 1.5, drag: 0.08, rollDrag: 0.3, grassDrag: 1.2,
    turnRate: 4.2, turnLowSpeed: 3.5, turnFalloff: 0.03, steerResponse: 20, grip: 18, gripKeep: 0.95, radius: 0.35,
    // drift and boost
    driftMinSpeed: 5, driftGrip: 6, driftTurnMin: 0.5, driftTurnMax: 1.5, driftKeep: 0.8,
    driftLv1: 0.8, driftLv2: 1.7, boostKick1: 2.5, boostKick2: 4.2, boostTime1: 0.6, boostTime2: 1.1, boostSpeed: 4,
    // air and tricks
    hopVz: 4.4, gravity: 14, airSteer: 0.35, rampLaunch: 1.35, maxStep: 0.3,
    spinTime: 0.38,
    grindCatchR: 0.8, grindCatchZ: 0.3, grindMaxAngle: 0.9, grindFriction: 0.6, grindMinSpeed: 4,
    // collisions
    crashImpact: 7, crashTime: 1.3, invulnTime: 1.2, wallBounce: 0.15, wallFriction: 0.35,
    curbPenalty: 0.85, curbMinSpeed: 3, hitR: 0.62, hitMinSpeed: 2.5,
    // scoring
    nearMissR: 1.8, nearMinSpeed: 4.5, nearBase: 6, nearBonus: 18,
    overR: 1.0, overH: 1.15, overPts: 100,
    bellR: 6.5, bellCooldown: 0.4, scareCooldown: 5,
    spinPts: 20, whipPts: 15, grindStartPts: 10, grindPts: 30, airMin: 0.75, airPts: 25, driftPts1: 15, driftPts2: 35,
    comboTime: 2.6, chainStep: 0.15, maxMult: 6,
    // a close call slows time for a moment (real seconds, time scale)
    slowMoTime: 0.12, slowMoScale: 0.3,
    // pedestrians
    pedsPerChunk: 22, dodgeChance: 1,
    // passengers: hitchhikers per chunk, pickup radius, max tower, payout per passenger, extra bell radius,
    // top speed lost per passenger; the tower sway spring (frequency, softening and extra drive per passenger,
    // damping ratio, drive by acceleration, lean where the top falls off, kick on landing)
    hitchPerChunk: 2, paxPickR: 1.0, paxMax: 12, paxBonus: 0.25, paxPickPts: 15, paxBellR: 0.5, paxSpeedLoss: 0.12,
    towerFreq: 6, towerSoften: 0.25, towerTall: 0.12, towerDamp: 0.35, towerDrive: 0.15, towerMax: 0.6, towerLandKick: 0.12,
    // camera and look
    pxPerM: 34, lookAhead: 0.35, forwardBias: 4, camLerp: 6, zoomAtMax: 0.8, leanK: 0.9,
    // 'street': always full throttle, A/D toward a side of the street, the nose returns forward;
    // 'relative': A/D turn the handlebar; 'screen': WASD point the way on screen
    controlMode: 'street',
    streetAngle: 0.85, streetTurn: 14, streetMaxOmega: 8, streetDriftMin: 0.5, streetDriftMax: 1.1,
  };

  // [key, label, min, max, step]; a one-element entry is a section header
  SK.CFG_META = [
    ['Управление «по улице»'],
    ['streetAngle', 'Макс. угол к оси улицы, рад', 0.2, 1.4, 0.05],
    ['streetTurn', 'Резкость руля', 2, 25, 0.5],
    ['streetMaxOmega', 'Макс. скорость поворота', 1, 15, 0.5],
    ['streetDriftMin', 'Дрифт: угол min, рад', 0.1, 1.2, 0.05],
    ['streetDriftMax', 'Дрифт: угол max, рад', 0.4, 1.5, 0.05],
    ['Езда'],
    ['maxSpeed', 'Макс. скорость, м/с', 6, 20, 0.5],
    ['accel', 'Разгон', 3, 25, 0.5],
    ['brake', 'Тормоз', 5, 40, 1],
    ['drag', 'Сопротивление воздуха', 0, 0.4, 0.01],
    ['rollDrag', 'Сопротивление качению', 0, 2, 0.05],
    ['turnRate', 'Поворот на скорости', 1, 6, 0.1],
    ['turnLowSpeed', 'Поворот на малой скорости', 0.5, 5, 0.1],
    ['turnFalloff', 'Спад поворота от скорости', 0, 0.3, 0.01],
    ['steerResponse', 'Отклик руля', 2, 30, 1],
    ['grip', 'Сцепление', 2, 30, 0.5],
    ['gripKeep', 'Сохранение скорости в повороте', 0, 1, 0.05],
    ['Дрифт и буст'],
    ['driftGrip', 'Сцепление в дрифте', 0.3, 8, 0.1],
    ['driftTurnMin', 'Дрифт: поворот min', 0, 1.5, 0.05],
    ['driftTurnMax', 'Дрифт: поворот max', 0.8, 3, 0.05],
    ['driftKeep', 'Дрифт: сохранение скорости', 0, 1, 0.05],
    ['driftLv1', 'Заряд буста 1, с', 0.2, 3, 0.1],
    ['driftLv2', 'Заряд буста 2, с', 0.5, 4, 0.1],
    ['boostKick1', 'Буст 1: толчок', 0, 8, 0.1],
    ['boostKick2', 'Буст 2: толчок', 0, 10, 0.1],
    ['boostSpeed', 'Буст: прибавка к макс.', 0, 10, 0.5],
    ['Прыжки и трюки'],
    ['hopVz', 'Сила прыжка', 2, 8, 0.1],
    ['gravity', 'Гравитация', 6, 30, 0.5],
    ['airSteer', 'Руление в воздухе', 0, 1, 0.05],
    ['rampLaunch', 'Сила трамплина', 0.5, 3, 0.05],
    ['spinTime', 'Авто-трюк: мин. время на оборот, с', 0.2, 1.2, 0.02],
    ['grindCatchR', 'Захват грайнда, м', 0.2, 1.5, 0.05],
    ['grindFriction', 'Трение грайнда', 0, 4, 0.1],
    ['Столкновения'],
    ['crashImpact', 'Удар до падения, м/с', 3, 15, 0.5],
    ['crashTime', 'Время на подъём, с', 0.3, 3, 0.1],
    ['curbPenalty', 'Бордюр: остаток скорости', 0.4, 1, 0.01],
    ['wallBounce', 'Отскок от стен', 0, 1, 0.05],
    ['hitMinSpeed', 'Сбить пешехода от, м/с', 0.5, 8, 0.1],
    ['Очки'],
    ['nearMissR', 'Впритирку: радиус, м', 0.8, 3.5, 0.05],
    ['nearMinSpeed', 'Впритирку: мин. скорость', 0, 12, 0.5],
    ['bellR', 'Дзынь: радиус, м', 2, 14, 0.5],
    ['comboTime', 'Окно комбо, с', 0.5, 6, 0.1],
    ['dodgeChance', 'Пешеходы уворачиваются', 0, 2, 0.1],
    ['slowMoTime', 'Впритирку: замедление, с', 0, 0.4, 0.01],
    ['slowMoScale', 'Впритирку: скорость времени', 0.05, 1, 0.05],
    ['Пассажиры'],
    ['hitchPerChunk', 'Попутчиков на 40 м', 0, 8, 1],
    ['paxPickR', 'Радиус подбора, м', 0.4, 2.5, 0.05],
    ['paxMax', 'Макс. пассажиров', 1, 20, 1],
    ['paxBonus', 'Прибавка к очкам за пассажира', 0, 1, 0.05],
    ['paxSpeedLoss', 'Потеря скорости за пассажира', 0, 0.6, 0.01],
    ['towerFreq', 'Башня: жёсткость', 1, 15, 0.1],
    ['towerSoften', 'Башня: мягче с ростом', 0, 1, 0.01],
    ['towerTall', 'Башня: раскачка с ростом', 0, 0.5, 0.01],
    ['towerDamp', 'Башня: затухание', 0.05, 1.5, 0.01],
    ['towerDrive', 'Башня: чувствительность к рулю', 0, 0.4, 0.005],
    ['towerMax', 'Башня: наклон до падения, рад', 0.2, 1.5, 0.05],
    ['towerLandKick', 'Башня: толчок при приземлении', 0, 0.4, 0.01],
    ['Камера'],
    ['pxPerM', 'Масштаб', 10, 50, 1],
    ['lookAhead', 'Взгляд вперёд, с', 0, 1.2, 0.05],
    ['forwardBias', 'Сдвиг камеры по ходу, м', 0, 15, 0.5],
    ['camLerp', 'Жёсткость камеры', 0.5, 15, 0.5],
    ['zoomAtMax', 'Отдаление на скорости', 0.5, 1.2, 0.01],
    ['leanK', 'Крен в повороте', 0, 2, 0.05],
  ];

  // bump when defaults change in a way old saved tuning should not override
  const VERSION = 6;
  SK.CFG_DEFAULTS = D;
  SK.CFG = Object.assign({}, D);
  try {
    const saved = JSON.parse(localStorage.getItem('dzyn.cfg') || '{}');
    if (saved._v === VERSION) for (const k in saved) if (k in D && typeof saved[k] === typeof D[k]) SK.CFG[k] = saved[k];
  } catch (e) { /* no storage (file:// in some browsers, node) */ }

  SK.saveCfg = function () {
    try {
      const diff = {};
      for (const k in D) if (SK.CFG[k] !== D[k]) diff[k] = SK.CFG[k];
      diff._v = VERSION;
      localStorage.setItem('dzyn.cfg', JSON.stringify(diff));
    } catch (e) { /* ignore */ }
  };
})();
