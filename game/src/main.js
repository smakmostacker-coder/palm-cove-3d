// Palm Cove boot and game loop: the dusk peninsula world, the wake-up
// opening in the lead's own home, a first-run tutorial, branching endings,
// sniper + fire + damkar, five vehicle classes, the 5-slot hotbar, walk-in
// interiors, working facilities + prison, a quest log with free tracking,
// and the settings system (volume, FPS cap, Standard/HD graphics,
// brightness, virtual joystick). All full-screen overlays go through one
// state machine (showOverlay/enforceChrome below) — no handler pokes an
// overlay's display directly — and touch drags on the canvas orbit the
// camera through the same orbitCamera() path as the mouse.
import { G, resetStats } from './state.js';
import { districtAt, SPAWN, HOSPITAL } from './config.js';
import { buildCity, updateLights, landmarkAt, makeProtagonist, buildingCounts, worldLength, NORTH_END } from './city.js';
import { buildTraffic, updateTraffic, parkedCars, trafficCars } from './traffic.js';
import { buildPeds, updatePeds, peds } from './pedestrians.js';
import { buildPlayer, player, updatePlayer, updateCamera, orbitCamera, setCharacter, strideState } from './player.js';
import { nearestStealable, nearestJackable, carjack, enterCar, exitCar, updateDriving, vehicleHitCheck } from './driving.js';
import { buildPolice, updatePolice, commitCrime, policePositions, cops, officers } from './police.js';
import { punch, shoot } from './combat.js';
import { initMissions, updateMissions, onAction, onEnterCar, startRace, startTaxi, sidePrompt, missionTarget, startCurrentMission, setEndingHandler, replayFinale, computeEnding, finishFinale, setPartner, ENDINGS, questLogData, setTrackedQuest, getTrackedQuest } from './missions.js';
import { initHud, updateHud, showDialogue, showBanner, drawFullMap } from './hud.js';
import { saveGame, loadSave, applySave, clearSave } from './save.js';
import { parseShot, stageShot } from './shots.js';
import { sfx, radio } from './audio.js';
import { initFire, updateFire, fireState, forceIgnite } from './fire.js';
import { buildFacilities, nearestFacility, buyItem, sendToPrison, updatePrison, payBail, FACILITIES, nearestInterior, enterInterior, updateInteriors, tryInteriorAction, setInteriorExitHook, startWakeUp, updateWake, cancelWake, isWaking, ENTERABLES } from './facilities.js';
import { addItem, selectSlot, useSelected, syncWeapon, emptyInv, ITEM_DEFS } from './inventory.js';
import { settings, loadSettings, applySettings, onGraphics } from './settings.js';

loadSettings();
const { shot, seed } = parseShot();
G.seed = seed;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 420);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.className = 'webgl';
document.getElementById('app').appendChild(renderer.domElement);

const city = buildCity(scene, seed);
// Character-choice display pair: both leads stand on the beach in front of
// the deco strip, in the title/choice camera frame.
for (const [who, z] of [['vera', 100], ['dax', 109]]) {
  const disp = makeProtagonist(who);
  disp.scale.setScalar(1.7);
  disp.position.set(207, 0.3, z);
  disp.rotation.y = Math.PI / 2;
  scene.add(disp);
}
buildTraffic(scene, seed);
buildPeds(scene, seed);
buildPlayer(scene);
buildPolice(scene);
buildFacilities(scene);
initFire(scene);
initHud();
initMissions(scene, city.marker, showDialogue);

const $ = (id) => document.getElementById(id);
const menu = $('menu'), hud = $('hud'), pauseMenu = $('pauseMenu'), statsMenu = $('statsMenu');
const shopMenu = $('shopMenu'), endingMenu = $('endingMenu'), mapMenu = $('mapMenu'), settingsMenu = $('settingsMenu');
const questMenu = $('questMenu'), controlsMenu = $('controlsMenu');

// ---- Overlay state machine ---------------------------------------------------
// Single source of truth for which full-screen overlay is visible. Handlers
// call showOverlay(name) (null = none) and never poke overlay displays
// directly; enforceChrome() runs every frame and keeps the overlays, the
// HUD and the touch controls consistent with overlayNow and G.mode.
const OVERLAYS = {
  menu: menu, choice: $('choiceMenu'), pause: pauseMenu, stats: statsMenu,
  settings: settingsMenu, shop: shopMenu, ending: endingMenu, map: mapMenu,
  quest: questMenu, controls: controlsMenu,
};
let overlayNow = 'menu';
function showOverlay(name) {
  overlayNow = name;
  for (const [key, el] of Object.entries(OVERLAYS)) {
    if (el) el.style.display = key === name ? 'flex' : 'none';
  }
}
function enforceChrome() {
  for (const [key, el] of Object.entries(OVERLAYS)) {
    if (!el) continue;
    const want = key === overlayNow ? 'flex' : 'none';
    if (el.style.display !== want) el.style.display = want;
  }
  const hudWant = G.mode !== 'title' && !(G.mode === 'stats' && G.prevMode === 'title') ? 'block' : 'none';
  if (hud.style.display !== hudWant) hud.style.display = hudWant;
  const joyOn = settings.joystick && G.mode === 'playing';
  const joyEl = $('joy'), joyBtnsEl = $('joyBtns');
  const joyWant = joyOn ? 'block' : 'none';
  if (joyEl.style.display !== joyWant) joyEl.style.display = joyWant;
  const btnsWant = joyOn ? 'flex' : 'none';
  if (joyBtnsEl.style.display !== btnsWant) joyBtnsEl.style.display = btnsWant;
  // RUN and GAS swap by mode: RUN is the on-foot sprint button, GAS is
  // the driving boost button — only the one that applies is shown.
  const runEl = $('joyRun'), gasEl = $('joyGas');
  if (runEl && gasEl) {
    const runWant = G.driving ? 'none' : '';
    const gasWant = G.driving ? '' : 'none';
    if (runEl.style.display !== runWant) runEl.style.display = runWant;
    if (gasEl.style.display !== gasWant) gasEl.style.display = gasWant;
  }
}
onGraphics((s) => {
  if (s.quality === 'hd') { renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); if (scene.fog) scene.fog.far = 560; camera.far = 760; }
  else { renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.25)); if (scene.fog) scene.fog.far = 320; camera.far = 420; }
  camera.updateProjectionMatrix();
});
applySettings();
// Boot state: exactly the title menu — no choice overlay, no touch controls.
showOverlay('menu');
enforceChrome();

function refreshSaveInfo() {
  const s = loadSave();
  $('saveInfo').textContent = s
    ? 'Save found: $' + s.money + ' · missions ' + Math.min(4, s.stats ? s.stats.missions : 0) + '/4 · endings ' + ((s.endingsUnlocked || []).length) + '/6 · ' + new Date(s.savedAt).toLocaleString()
    : 'No save yet — New Game starts the story.';
  $('btnContinue').style.opacity = s ? '1' : '0.45';
  $('btnContinue').textContent = s ? 'LOAD GAME' : 'LOAD GAME (no save yet)';
}
refreshSaveInfo();

// The story intro (Lucia's first message + the mission marker) fires when
// the lead first steps out of the home — not before.
let introPending = false;
setInteriorExitHook((id) => {
  tutFlags.interacted = true;
  if (id === 'home' && introPending) {
    introPending = false;
    startCurrentMission(true);
  }
});

function startPlaying(useSave) {
  cancelWake(player);
  if (useSave) { applySave(loadSave()); syncWeapon(); }
  else {
    clearSave();
    G.money = 120; G.missionIndex = 0; G.missionStage = 0; G.storyDone = false;
    G.weapon = 'Fists'; G.weapons = ['Fists']; G.sniperAmmo = 0; G.armour = 0; G.bankVault = 0;
    G.inventory = emptyInv(); G.selectedSlot = 0; G.endingsUnlocked = []; G.lastEnding = ''; G.inPrison = 0;
    resetStats();
  }
  setCharacter(G.character || 'vera');
  setPartner();
  G.health = 100; G.wanted = 0; G.bust = 0; G.scoped = false;
  if (G.driving) exitCar();
  player.pos.set(SPAWN.x, 0.3, SPAWN.z);
  player.mesh.visible = true;
  G.onFoot = true;
  G.mode = 'playing';
  showOverlay(null);
  window.__titleCam = null;
  if (useSave) {
    startCurrentMission(true);
  } else {
    // Wake-up opening: the chosen lead starts in their own bed, at home.
    introPending = true;
    startWakeUp(player);
  }
  saveGame();
}

function completionPct() {
  return Math.min(100, Math.round((Math.min(4, G.stats.missions) / 4) * 50 + Math.min(20, G.stats.side * 10) + Math.min(30, G.endingsUnlocked.length * 10)));
}
function showStats() {
  G.prevMode = G.mode;
  G.mode = 'stats';
  showOverlay('stats');
  const bc = G.stats.byClass || {};
  $('statsBody').innerHTML =
    'Vehicles stolen: <b>' + G.stats.stolen + '</b> (car ' + (bc.car || 0) + ' · moto ' + (bc.moto || 0) + ' · truck ' + (bc.truck || 0) + ' · police ' + (bc.police || 0) + ' · fire truck ' + (bc.firetruck || 0) + ')<br>' +
    'Distance driven: <b>' + G.stats.drivenKm.toFixed(2) + ' km</b><br>' +
    'Story missions completed: <b>' + G.stats.missions + ' / 4</b><br>' +
    'Side activities done: <b>' + G.stats.side + '</b><br>' +
    'Debtors spared: <b>' + G.track.spared + '</b> · taken out: <b>' + G.track.tookOut + '</b> · Times busted: <b>' + G.track.busted + '</b><br>' +
    'Endings unlocked: <b>' + G.endingsUnlocked.length + ' / 6</b>' + (G.endingsUnlocked.length ? ' — ' + G.endingsUnlocked.map((e) => ENDINGS[e].name).join(', ') : '') + '<br>' +
    'Punches thrown: <b>' + G.stats.punches + '</b> · Shots fired: <b>' + G.stats.shotsFired + '</b><br>' +
    'Money: <b>$' + G.money + '</b> · Earned (story): <b>$' + G.track.earned + '</b><br>Completion: <b>' + completionPct() + '%</b>';
}
function closeStats() {
  if (G.prevMode === 'playing' || G.prevMode === 'paused') { G.mode = 'paused'; showOverlay('pause'); }
  else { G.mode = 'title'; showOverlay('menu'); }
}
function showEnding(id, def) {
  G.mode = 'ending';
  $('endingName').textContent = def.name;
  $('endingText').textContent = def.text.replaceAll('Vera', G.character === 'dax' ? 'Dax' : 'Vera');
  $('endingMeta').textContent = 'Ending ' + G.endingsUnlocked.length + ' of 6 unlocked · Spared ' + G.track.spared + ' · Took out ' + G.track.tookOut + ' · Earned $' + G.track.earned + ' · Busted ×' + G.track.busted;
  showOverlay('ending');
  sfx.success();
}
setEndingHandler(showEnding);
$('btnNew').onclick = () => {
  showOverlay('choice');
  window.__titleCam = { pos: [246, 10, 168], look: [168, 9, 108] };
};
$('btnPickVera').onclick = () => { G.character = 'vera'; startPlaying(false); };
$('btnPickDax').onclick = () => { G.character = 'dax'; startPlaying(false); };
$('btnChoiceBack').onclick = () => { showOverlay('menu'); window.__titleCam = null; };
$('btnContinue').onclick = () => { if (loadSave()) startPlaying(true); };
$('btnResume').onclick = () => { G.mode = 'playing'; showOverlay(null); };
$('btnRestart').onclick = () => startPlaying(false);
$('btnStats2').onclick = showStats;
$('btnStatsBack').onclick = closeStats;
$('btnEndContinue').onclick = () => { showOverlay(null); G.mode = 'playing'; };
$('btnEndReplay').onclick = () => { showOverlay(null); replayFinale(); G.mode = 'playing'; };
$('btnReplayFinale').onclick = () => { showOverlay(null); replayFinale(); G.mode = 'playing'; };
// ---- Full map: two ways in, and closing returns to wherever it opened from -
// From the pause menu (mapFrom 'pause') closing goes back to the pause
// overlay with the mode still 'paused'; from a tap on the HUD minimap
// (mapFrom 'game') the world freezes (mode 'paused') while the map is up
// and closing drops straight back into gameplay.
let mapFrom = 'pause';
function openMap(from) {
  mapFrom = from;
  if (from === 'game') G.mode = 'paused';
  showOverlay('map');
  drawFullMap();
}
function closeMap() {
  if (mapFrom === 'game') { showOverlay(null); G.mode = 'playing'; }
  else showOverlay('pause');
}
$('btnMap').onclick = () => openMap('pause');
$('btnMapClose').onclick = closeMap;
// Tapping the HUD minimap (and only the minimap — it is a DOM canvas above
// the WebGL canvas, so taps on it never reach the touch-orbit handler)
// opens the full map straight from gameplay.
$('minimap').addEventListener('click', () => {
  if (G.mode !== 'playing') return;
  openMap('game');
});

// ---- Settings panel ---------------------------------------------------------
let settingsFrom = 'title';
function openSettings(from) {
  settingsFrom = from;
  syncSettingsUI();
  showOverlay('settings');
}
function closeSettings() {
  if (settingsFrom === 'pause') { G.mode = 'paused'; showOverlay('pause'); }
  else { G.mode = 'title'; showOverlay('menu'); }
}
function syncSettingsUI() {
  $('setVol').value = Math.round(settings.volume * 100);
  $('setMute').checked = settings.muted;
  $('setFps').value = String(settings.fpsCap);
  $('setQuality').value = settings.quality;
  $('setBright').value = Math.round(settings.brightness * 100);
  $('setJoy').checked = settings.joystick;
  $('setRadio').value = settings.radioOn ? String(settings.radioStation) : 'off';
  syncRadioUI();
}
// ---- Radio (backsound): starts on the first gesture, K / pause button /
// touch RADIO button / Settings row all cycle the same stations + Off.
function syncRadioUI() {
  const btn = $('btnRadio');
  if (btn) btn.textContent = 'Radio: ' + radio.stationName;
}
function cycleRadio() {
  const name = radio.cycle();
  syncRadioUI();
  showDialogue('Radio', name === 'Off' ? 'Radio off.' : 'Now playing: ' + name, 2.5);
}
$('btnRadio').onclick = cycleRadio;
syncRadioUI();
addEventListener('pointerdown', () => radio.start(), { once: true });
addEventListener('keydown', () => radio.start(), { once: true });
$('btnSettings').onclick = () => openSettings('title');
$('btnSettings2').onclick = () => openSettings('pause');
$('btnSettingsBack').onclick = closeSettings;
$('setVol').oninput = (e) => { settings.volume = e.target.value / 100; applySettings(); sfx.pickup(); };
$('setMute').onchange = (e) => { settings.muted = e.target.checked; applySettings(); };
$('setFps').onchange = (e) => { settings.fpsCap = parseInt(e.target.value, 10); applySettings(); };
$('setQuality').onchange = (e) => { settings.quality = e.target.value; applySettings(); };
$('setBright').oninput = (e) => { settings.brightness = e.target.value / 100; applySettings(); };
$('setRadio').onchange = (e) => {
  if (e.target.value === 'off') radio.setOn(false);
  else radio.setStation(parseInt(e.target.value, 10));
  syncRadioUI();
};
$('setJoy').onchange = (e) => {
  settings.joystick = e.target.checked;
  applySettings(); // enforceChrome() owns the joy/joyBtns display now
};

// ---- Controls help: one screen, both input methods, from pause or settings -
let controlsFrom = 'pause';
function openControls(from) {
  controlsFrom = from;
  showOverlay('controls');
}
$('btnControls').onclick = () => openControls('pause');
$('btnControls2').onclick = () => openControls('settings');
$('btnControlsBack').onclick = () => {
  if (controlsFrom === 'settings') showOverlay('settings');
  else if (G.mode === 'paused') showOverlay('pause');
  else showOverlay('menu');
};

// ---- Quest log ---------------------------------------------------------------
function openQuestLog() {
  if (G.mode === 'playing') G.mode = 'paused';
  renderQuestLog();
  showOverlay('quest');
}
function renderQuestLog() {
  const data = questLogData();
  const row = (q, kind) => {
    const tracked = data.tracked === q.id && (kind === 'side' || q.state === 'current');
    const tick = q.state === 'done' ? '☑' : q.state === 'locked' ? '🔒' : '☐';
    return '<div class="qrow' + (tracked ? ' tracked' : '') + '" data-qid="' + q.id + '" data-kind="' + kind + '">' +
      '<div class="qtitle">' + tick + ' ' + q.title + (tracked ? ' <span class="qtrack">TRACKED</span>' : '') + (q.count ? ' <span class="qcount">×' + q.count + '</span>' : '') + '</div>' +
      '<div class="qdesc">' + q.desc + '</div>' +
      (q.reward ? '<div class="qmeta">Reward: ' + q.reward + ' · ' + q.hint + '</div>' : '') +
      '</div>';
  };
  $('questBody').innerHTML =
    '<h2 class="qhead">MAIN QUEST — Lucia\'s debt</h2>' + data.main.map((q) => row(q, 'main')).join('') +
    '<h2 class="qhead">SIDE QUESTS — whenever you like</h2>' + data.side.map((q) => row(q, 'side')).join('') +
    '<p class="qmeta">Tap a quest to track it — the HUD objective and the world marker switch to it. One tracked at a time; switching is free.</p>';
  for (const el of $('questBody').querySelectorAll('.qrow')) {
    el.addEventListener('click', () => {
      const qid = el.dataset.qid;
      if (el.dataset.kind === 'side' || qid === 'main') setTrackedQuest(qid);
      renderQuestLog();
    });
  }
}
$('btnQuests').onclick = openQuestLog;
$('btnQuestHud').onclick = () => { if (G.mode === 'playing') openQuestLog(); };
$('btnQuestClose').onclick = () => {
  if (G.mode === 'paused') showOverlay('pause');
  else showOverlay(null);
};

// ---- Shops -------------------------------------------------------------------
let shopFac = null;
function openShop(fac) {
  shopFac = fac;
  G.mode = 'shop';
  $('shopTitle').textContent = fac.name;
  renderShop('Welcome to ' + fac.name + '. Cash: $' + G.money);
  showOverlay('shop');
}
function renderShop(msg) {
  $('shopMsg').textContent = msg;
  const body = $('shopBody');
  body.innerHTML = '';
  if (!shopFac.shop.length) { body.innerHTML = '<p>Nothing for sale here.</p>'; return; }
  for (const row of shopFac.shop) {
    const b = document.createElement('button');
    b.textContent = ITEM_DEFS[row.item].icon + ' ' + ITEM_DEFS[row.item].name + ' — $' + row.price;
    b.onclick = () => renderShop(buyItem(shopFac, row.item, showDialogue) + ' Cash: $' + G.money);
    body.appendChild(b);
  }
}
$('btnShopClose').onclick = () => { showOverlay(null); G.mode = 'playing'; };

function pauseGame() {
  if (G.mode !== 'playing') return;
  G.mode = 'paused';
  showOverlay('pause');
  saveGame();
}
function gameOver(kind) {
  G.overKind = kind;
  G.overTimer = 3;
  showBanner(kind === 'busted' ? 'BUSTED' : 'WASTED', 3);
  sfx.fail();
  G.wanted = 0; G.bust = 0; G.health = 100; G.scoped = false;
  if (G.driving) exitCar();
  cancelWake(player);
  if (kind === 'busted') {
    G.track.busted++;
    G.mode = 'over';
    G.money = Math.max(0, G.money - 50);
    const cell = sendToPrison();
    player.pos.set(cell.x, 0.3, cell.z);
    showDialogue('Guard', 'Processing done. Serve your time in the yard — or post bail with B.', 5);
  } else {
    G.track.wasted++;
    G.mode = 'over';
    const fee = G.money >= 50 ? 50 : G.money;
    G.money -= fee;
    player.pos.set(HOSPITAL.x + 12, 0.3, HOSPITAL.z + 12);
    if (fee) showDialogue('Hospital', 'Treatment fee: $' + fee + '. Try not to need us again today.', 4);
  }
  player.mesh.visible = true;
  G.onFoot = true;
  saveGame();
}

// ---- Tutorial -----------------------------------------------------------------
// First-run only, woven into the wake-up: one contextual prompt at a time,
// labelled for the input method in use, advancing only when the player
// actually does the thing. It never blocks input and hides in menus.
// State persists in localStorage: done or skipped means never again.
const TUT_KEY = 'palm-cove-tutorial-v1';
const tutFlags = { interacted: false, slot: false, combat: false };
let tutStep = 0, tutDone = false, tutAnchor = null, tutYawAcc = 0, tutLastYaw = 0;
try {
  const t = JSON.parse(localStorage.getItem(TUT_KEY) || 'null');
  if (t && t.done) tutDone = true;
  else if (t) tutStep = t.step || 0;
} catch (e) { /* fresh tutorial */ }
function tutPersist() {
  try { localStorage.setItem(TUT_KEY, JSON.stringify({ done: tutDone, step: tutStep })); } catch (e) { /* best effort */ }
}
const isTouch = () => settings.joystick || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
const TUT_STEPS = [
  { d: 'Move — W A S D or the arrow keys', t: 'Move — drag the joystick', done: () => tutAnchor && Math.hypot(player.pos.x - tutAnchor.x, player.pos.z - tutAnchor.z) > 4 },
  { d: 'Look around — drag the mouse', t: 'Look around — drag on the screen', done: () => tutYawAcc > 0.7 },
  { d: 'Sprint — hold Shift while moving', t: 'Sprint — hold the RUN button while moving', done: () => player.sprinting },
  { d: 'Interact — E at doors, shops and cars. Head out of the house', t: 'Interact — tap E at doors, shops and cars. Head out of the house', done: () => tutFlags.interacted },
  { d: 'Hotbar — press 1–5 to select a slot, X uses an item', t: 'Hotbar — tap a slot to select it, X uses an item', done: () => tutFlags.slot },
  { d: 'Steal a vehicle — walk to a car and press E', t: 'Steal a vehicle — walk to a car and tap E', done: () => !!G.driving },
  { d: 'Drive — W A S D · hold Space for a GAS boost, E gets out', t: 'Drive — joystick steers · hold GAS to boost, E gets out', done: () => G.driving && Math.abs(G.driving.speed) > 8 },
  { d: 'Fight — F punches · mouse click fires an equipped weapon', t: 'Fight — F punches · the fire button shoots an equipped weapon', done: () => tutFlags.combat },
];
function updateTutorial() {
  const box = $('tutBox');
  if (tutDone || G.mode !== 'playing') { box.style.display = 'none'; return; }
  const step = TUT_STEPS[tutStep];
  if (!step) { tutDone = true; tutPersist(); box.style.display = 'none'; return; }
  if (!tutAnchor) { tutAnchor = { x: player.pos.x, z: player.pos.z }; tutLastYaw = G.camYaw; }
  tutYawAcc += Math.abs(((G.camYaw - tutLastYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  tutLastYaw = G.camYaw;
  box.style.display = 'flex';
  $('tutText').textContent = 'TUTORIAL ' + (tutStep + 1) + '/' + TUT_STEPS.length + ' — ' + (isTouch() ? step.t : step.d);
  if (step.done()) {
    tutStep++;
    tutAnchor = null; tutYawAcc = 0;
    tutPersist();
    sfx.pickup();
    if (tutStep >= TUT_STEPS.length) {
      tutDone = true; tutPersist();
      showDialogue('Palm Cove', 'Tutorial complete — the Cove is yours. Lucia\'s work is on the marker.', 4);
    }
  }
}
$('btnTutSkip').onclick = () => { tutDone = true; tutPersist(); $('tutBox').style.display = 'none'; };

// ---- Input ---------------------------------------------------------------------
function doInteract() {
  tutFlags.interacted = true;
  if (G.interior) return; // leaving a room is by walking through its door
  if (G.driving) { exitCar(); return; }
  const ent = nearestInterior(player.pos);
  if (ent) { enterInterior(ent, player.pos); return; }
  const fac = nearestFacility(player.pos);
  if (fac) { openShop(fac); return; }
  const jk = nearestJackable();
  if (jk) { carjack(jk); onEnterCar(jk.car); return; }
  const car = nearestStealable();
  if (car) { enterCar(car); onEnterCar(car); }
}
function doPunch() {
  if (G.driving) return;
  if (G.interior && tryInteriorAction(player.pos, showDialogue)) return;
  punch(player.pos);
  tutFlags.combat = true;
  onAction('punch', player.pos);
}
function doSelectSlot(i) { selectSlot(i); tutFlags.slot = true; }
window.__selectSlot = (i) => { if (G.mode === 'playing') doSelectSlot(i); };
addEventListener('keydown', (e) => {
  G.keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if ((G.mode === 'playing' || G.mode === 'over') && e.code === 'KeyB' && G.inPrison > 0) payBail(player.pos, showDialogue);
  else if (G.mode === 'playing') {
    if (e.code === 'Escape' || e.code === 'KeyP') pauseGame();
    else if (e.code === 'KeyE') doInteract();
    else if (e.code === 'KeyF') doPunch();
    else if (e.code === 'KeyR') startRace(player.pos);
    else if (e.code === 'KeyT') startTaxi();
    else if (e.code === 'KeyX') useSelected();
    else if (e.code === 'KeyK') cycleRadio();
    else if (e.code === 'KeyV' && G.weapon === 'Sniper') G.scoped = !G.scoped;
    else if (/^Digit[1-5]$/.test(e.code)) doSelectSlot(parseInt(e.code.slice(5), 10) - 1);
  } else if (overlayNow === 'map' && e.code === 'Escape') {
    closeMap();
  } else if (G.mode === 'paused' && (e.code === 'Escape' || e.code === 'KeyP')) {
    G.mode = 'playing';
    showOverlay(null);
  } else if (G.mode === 'shop' && e.code === 'Escape') { showOverlay(null); G.mode = 'playing'; }
  else if (G.mode === 'title' && e.code === 'KeyS') showStats();
});
addEventListener('keyup', (e) => { G.keys[e.code] = false; });
addEventListener('mousemove', (e) => {
  if (G.mode !== 'playing') return;
  if (e.buttons || document.pointerLockElement) orbitCamera(e.movementX || 0, e.movementY || 0);
});
// Touch orbit: a touch drag on the canvas orbits the camera through the
// exact same orbitCamera() the mouse uses — orbitCamera offsets
// G.camYaw/G.camPitch and holds the auto-follow off briefly (dragHold), so
// a manual orbit holds while the lead is still and the follow re-engages
// as the lead turns, identical to the mouse. Mouse pointers are ignored
// here (the mousemove handler above owns them). The joystick (#joy) and
// the RUN/E/F/X buttons are separate DOM elements above the canvas, so
// touches that start on them never fire canvas pointer events — no other
// exclusion zones are needed.
(function initTouchOrbit() {
  const el = renderer.domElement;
  let pid = null, lastX = 0, lastY = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || G.mode !== 'playing' || pid !== null) return;
    pid = e.pointerId; lastX = e.clientX; lastY = e.clientY;
    try { el.setPointerCapture(pid); } catch (err) { /* capture is best-effort */ }
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    orbitCamera(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
  });
  const end = (e) => { if (e.pointerId === pid) pid = null; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
})();
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousedown', (e) => {
  if (G.mode === 'playing' && e.target === renderer.domElement) {
    if (e.button === 2) { if (G.weapon === 'Sniper') G.scoped = true; return; }
    if (e.button === 0 && shoot(player.pos, scene)) { tutFlags.combat = true; onAction('shoot', player.pos); }
  }
});
addEventListener('mouseup', (e) => { if (e.button === 2) G.scoped = false; });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
// Virtual joystick: ANALOG — it publishes a continuous vector on
// G.joyVec and player.js reads direction + magnitude from it. (It used
// to threshold the stick into WASD keys at 0.35, so a thumb hovering
// near the threshold flickered A/D on and off and the walk veered
// constantly.) Driving reads the SAME vector proportionally in
// driving.js (stick Y = throttle, stick X = steering, per-axis
// deadzone) — it must NOT be thresholded into keys any more: that
// mapping was the "tilt a little, rocket off" bug, any forward tilt
// became a held KeyW at full throttle. Buttons fire the same actions
// as the keyboard, including the hold-to-sprint RUN button
// (G.sprintTouch) and the driving-only hold-to-boost GAS button
// (G.boostTouch).
(function initJoystick() {
  const base = $('joy'), knob = $('joyKnob');
  let pid = null;
  const setKeys = (dx, dy) => {
    G.keys['KeyW'] = dy < -0.35; G.keys['KeyS'] = dy > 0.35;
    G.keys['KeyA'] = dx < -0.35; G.keys['KeyD'] = dx > 0.35;
  };
  base.addEventListener('pointerdown', (e) => { pid = e.pointerId; base.setPointerCapture(pid); move(e); });
  base.addEventListener('pointermove', (e) => { if (e.pointerId === pid) move(e); });
  const end = () => { pid = null; knob.style.transform = 'translate(-50%,-50%)'; G.joyVec.x = 0; G.joyVec.y = 0; setKeys(0, 0); };
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);
  function move(e) {
    const r = base.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    knob.style.transform = 'translate(calc(-50% + ' + dx * 34 + 'px), calc(-50% + ' + dy * 34 + 'px))';
    G.joyVec.x = dx; G.joyVec.y = dy;
    // No setKeys() here: on foot player.js reads joyVec, and driving.js
    // reads joyVec proportionally — neither wants binary keys any more.
  }
  $('joyRadio').onclick = () => { if (G.mode === 'playing') cycleRadio(); };
  $('joyE').onclick = () => { if (G.mode === 'playing') doInteract(); };
  $('joyF').onclick = () => { if (G.mode === 'playing') doPunch(); };
  $('joyX').onclick = () => { if (G.mode === 'playing') useSelected(); };
  const run = $('joyRun');
  if (run) {
    run.addEventListener('pointerdown', (e) => { e.preventDefault(); G.sprintTouch = true; });
    run.addEventListener('pointerup', () => { G.sprintTouch = false; });
    run.addEventListener('pointercancel', () => { G.sprintTouch = false; });
    run.addEventListener('pointerleave', () => { G.sprintTouch = false; });
  }
  const gas = $('joyGas');
  if (gas) {
    gas.addEventListener('pointerdown', (e) => { e.preventDefault(); G.boostTouch = true; });
    gas.addEventListener('pointerup', () => { G.boostTouch = false; });
    gas.addEventListener('pointercancel', () => { G.boostTouch = false; });
    gas.addEventListener('pointerleave', () => { G.boostTouch = false; });
  }
})();

// ---- Per-frame collisions and pickups -----------------------------------------
let pedCooldown = 0;
function footCollisions(dt) {
  pedCooldown -= dt;
  if (pedCooldown > 0) return;
  for (const p of peds) {
    if (p.down <= 0 && p.mesh.position.distanceTo(player.pos) < 1.1 && player.speedNow > 9) {
      p.down = 2;
      pedCooldown = 1;
      commitCrime(Math.max(1, G.wanted), 'Pedestrian hit');
      G.health = Math.max(1, G.health - 2);
    }
  }
}
function driveCollisions() {
  vehicleHitCheck(() => {
    sfx.crash();
    commitCrime(Math.max(1, G.wanted), 'Vehicle collision');
    G.health = Math.max(1, G.health - 4);
  });
  if (G.driving && Math.abs(G.driving.speed) > 4) {
    for (const p of peds) {
      if (p.down <= 0 && p.mesh.position.distanceTo(G.driving.pos) < 2.2) {
        p.down = 4;
        commitCrime(Math.max(2, G.wanted), 'Pedestrian run down');
        sfx.crash();
      }
    }
  }
}
function checkPickups() {
  if (G.driving || G.interior) return;
  for (const pk of city.pickups) {
    if (pk.taken) continue;
    if (Math.hypot(player.pos.x - pk.x, player.pos.z - pk.z) < 2.4) {
      if (addItem(pk.kind)) {
        pk.taken = true;
        pk.grp.visible = false;
        if (pk.kind === 'sniper') {
          G.sniperAmmo += 24;
          showDialogue('Cache', 'Sniper Rifle found — 24 rounds. Select its slot, hold right-mouse or V to scope.', 5);
        } else showDialogue('Pickup', ITEM_DEFS[pk.kind].name + ' added to your hotbar.', 3);
        sfx.pickup();
        saveGame();
      } else G.prompt = 'Inventory full — use or drop something first (slots 1–5, X uses).';
    }
  }
}

// ---- The frame loop --------------------------------------------------------------
let last = performance.now(), titleAngle = 0, fpsCount = 0, fpsTime = 0, prevHealth = 100, renderAcc = 0, clubModeOn = false;
window.__fps = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let rawDt = Math.min(0.15, (now - last) / 1000);
  last = now;
  if (rawDt <= 0) rawDt = 0.016;
  renderAcc += rawDt;
  const minStep = settings.fpsCap === 30 ? 1 / 30.5 : 0;
  if (renderAcc < minStep) return;
  const dt = renderAcc;
  renderAcc = 0;
  G.time += dt;
  fpsCount++; fpsTime += rawDt;
  if (fpsTime >= 0.5) { window.__fps = Math.round(fpsCount / fpsTime); fpsCount = 0; fpsTime = 0; }
  city.diamond.rotation.y += dt * 2;
  city.diamond.position.y = 6 + Math.sin(G.time * 3) * 0.5;
  city.ocean.position.y = -0.35 + Math.sin(G.time * 0.8) * 0.06;
  updateLights(G.time);
  window.__playerPos = player.pos;
  const targetFov = G.scoped && G.weapon === 'Sniper' ? 20 : 62;
  if (Math.abs(camera.fov - targetFov) > 0.2) {
    camera.fov += (targetFov - camera.fov) * 0.35;
    camera.updateProjectionMatrix();
  }
  $('scope').style.display = G.scoped && G.weapon === 'Sniper' && G.mode === 'playing' ? 'block' : 'none';
  enforceChrome();
  // Club mode: inside CLUB NEON PALMS the radio is the club's music.
  const inClub = G.interior === 'club';
  if (inClub !== clubModeOn) { clubModeOn = inClub; radio.setClubMode(inClub); }

  if (G.mode === 'title' || (G.mode === 'stats' && G.prevMode === 'title')) {
    titleAngle += dt * 0.07;
    if (window.__titleCam) { camera.position.set(...window.__titleCam.pos); camera.lookAt(...window.__titleCam.look); }
    else {
      camera.position.set(Math.cos(titleAngle) * 55, 26, 58 + Math.sin(titleAngle) * 55);
      camera.lookAt(0, 4, 58);
    }
    updateTraffic(dt, player.pos);
    updatePeds(dt, null, 0);
  } else if (G.mode === 'playing' || G.mode === 'over') {
    if (G.mode === 'over') { G.overTimer -= dt; if (G.overTimer <= 0) G.mode = 'playing'; }
    prevHealth = G.health;
    const speedNow = G.driving ? G.driving.speed : player.speedNow;
    const waking = updateWake(dt);
    if (waking) {
      updateCamera(dt, camera, player.pos, 7); // the camera watches the rise
    } else if (G.driving) {
      updateDriving(dt, camera, null);
      driveCollisions();
    } else {
      updatePlayer(dt, camera);
      footCollisions(dt);
    }
    updateTutorial();
    if (G.interior) {
      // Inside a room the street systems pause; the room owns the prompt.
      G.prompt = updateInteriors(dt, player.pos, showDialogue);
      updateTraffic(dt, player.pos);
      updatePeds(dt, null, 0);
    } else {
      const prisonMsg = updatePrison(dt, player.pos, showDialogue);
      updateTraffic(dt, player.pos);
      const danger = G.wanted > 0 || (G.driving && Math.abs(G.driving.speed) > 12) ? player.pos : null;
      updatePeds(dt, danger, 9);
      updateMissions(dt, player.pos);
      updatePolice(dt, player.pos, speedNow, () => gameOver('busted'));
      updateFire(dt, player.pos);
      checkPickups();
      if (G.health <= 0) gameOver('wasted');
      if (G.health < prevHealth && G.armour > 0 && G.mode === 'playing') {
        const absorbed = Math.min(G.armour, (prevHealth - G.health) * 0.6);
        G.health += absorbed;
        G.armour -= absorbed;
      }
      if (G.wanted === 0 && G.health < 100 && G.inPrison <= 0) G.health = Math.min(100, G.health + dt * 2);
      G.district = landmarkAt(player.pos.x, player.pos.z) || districtAt(player.pos.x, player.pos.z);
      if (prisonMsg) G.prompt = prisonMsg;
      else if (!G.driving) {
        const ent = nearestInterior(player.pos);
        const fac = nearestFacility(player.pos);
        const jk = nearestJackable();
        const car = nearestStealable();
        G.prompt = ent ? 'Press E to enter ' + ent.name
          : fac ? 'Press E to enter ' + fac.name
          : jk ? 'Press E to carjack the ' + jk.name
          : car ? 'Press E to steal the ' + car.name : '';
      } else G.prompt = sidePrompt(player.pos) || 'Press E to exit · R race (Marina Mile) · T taxi fare';
    }
    updateHud(player.pos, missionTarget(), policePositions());
  }
  renderer.render(scene, camera);
}

window.__game = {
  G, player, startPlaying, renderer, scene, camera, cops, officers, parkedCars, trafficCars, peds,
  commitCrime, nearestJackable, carjack,
  fireState, forceIgnite, computeEnding, settings, radio,
  seedEnding: (patch) => { Object.assign(G.track, patch || {}); },
  finishFinale, gameOver,
  selectSlot: doSelectSlot, useSelected, addItem, buyItem, FACILITIES, replayFinale, payBail,
  // Stage-2 verification surface: world scale, density, animation, camera,
  // interiors, tutorial and quest log — all readable from a test harness.
  buildingCounts, worldLength, NORTH_END, strideState,
  ENTERABLES, enterInteriorById: (id) => {
    const e = ENTERABLES.find((x) => x.id === id);
    return e ? enterInterior(e, player.pos) : null;
  },
  questLogData, setTrackedQuest, getTrackedQuest,
  tutorial: () => ({ step: tutStep, done: tutDone }),
  teleport: (x, z) => { player.pos.set(x, 0.3, z); if (G.driving) G.driving.pos.set(x, 0, z); },
};
stageShot(shot, () => startPlaying(false));
if (window.__shotOverlay) showOverlay(window.__shotOverlay);
if (shot === 'map') setTimeout(drawFullMap, 350);
if (shot) {
  setTimeout(() => { window.__shotReady = true; }, 600);
}
refreshSaveInfo();
requestAnimationFrame(frame);
