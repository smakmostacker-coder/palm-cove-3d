// Palm Cove — main orchestrator: boot, menus, input, loop.
// Built to the module contracts; THREE is a global from the vendor script.

import { G, resetRunState } from './state.js';
import { TUNING, SPAWN, HOME_DOOR, HOSPITAL_POS } from './config.js';
import { seedWith } from './random.js';
import { buildWorld, updateCity, isLand, floorHeight, collideWorld } from './city.js';
import {
  player, partner, buildLead, buildPartner, placeAt, startWakeUp, isWaking,
  updatePlayer, updatePartner, cam, updateCamera,
} from './player.js';
import {
  vehicles, spawnVehicles, nearestVehicle, enterVehicle, exitVehicle,
  updateDriving, adoptVehicle, damageVehicle,
} from './driving.js';
import { initTraffic, updateTraffic } from './traffic.js';
import { peds, initPeds, updatePeds, hurtPed } from './pedestrians.js';
import { buildPolice, commitCrime, updatePolice, tryJackCop } from './police.js';
import { initCombat, updateCombat } from './combat.js';
import { initFire, updateFire, spawnFire } from './fire.js';
import { INV, selectSlot, buildPickups, updatePickups } from './inventory.js';
import {
  buildInteriors, interiorSpot, updateFacilities, updatePrison, sendToPrison, DOORS,
} from './facilities.js';
import { initMissions, updateMissions, getQuests, ENDINGS, startWakeFlow } from './missions.js';
import {
  initHud, updateHud, showOverlay, setHudVisible, say, showBanner, setObjective,
  openMap, closeMap, isMapOpen, isShopOpen, isChoiceOpen, renderQuests,
  showStats, showEnding,
} from './hud.js';
import { saveGame, loadGame, applySave, wipeSave } from './save.js';
import { applyVisualSettings, frameInterval } from './settings.js';
import { initAudio, sfx, radio } from './audio.js';
import { applyShotStaging } from './shots.js';

// --- tiny DOM helper -------------------------------------------------------
const $ = (id) => document.getElementById(id);
const appEl = $('app');

// --- shared run-time state (not part of G: pure UI / input bookkeeping) ----
let autosaveClock = 0;
let settingsReturn = 'menu'; // 'menu' | 'pause'
let statsReturn = 'menu'; // 'menu' | 'pause'
let overlayReturn = null; // overlay we came from, for quests/stats closes
let lastDriving = null; // last G.driving value seen, to sync touch controls
let titleAngle = 0; // slow orbit angle for the title backdrop
let hudVisible = false; // mirrors setHudVisible so the loop can cheaply test it

// Input state lives in stage 2 but is referenced by helpers defined here,
// so declare the queues up front and let stage 2 fill the handlers.
let interactQueued = false;
let vehicleQueued = false;
let attackPressQueued = false;

// --- renderer / scene / camera ---------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
appEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Dusk look: deep violet-pink sky so neon and sunset light read against it.
scene.background = new THREE.Color(0x2b1538);
scene.fog = new THREE.Fog(0x3d1d42, 120, 900);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(0, 40, 120);
camera.lookAt(0, 4, 0);

// Hemisphere fill keeps shadowed streets readable at dusk; a pink-violet
// sky against a darker warm ground gives the sunset grade its contrast.
const hemi = new THREE.HemisphereLight(0xb07cc6, 0x1f0f18, 0.85);
scene.add(hemi);

// Low warm sun, angled like it is about to set over the bay.
const sun = new THREE.DirectionalLight(0xff7a2e, 1.25);
sun.position.set(-180, 90, 60);
sun.castShadow = true;
scene.add(sun);

// --- world build (order matters: ground first, actors after) --------------
seedWith(20261124);
buildWorld(scene);
buildInteriors(scene);
buildPolice(scene);
initPeds(scene);
spawnVehicles(scene);
initTraffic(scene);
buildPickups(scene);
initMissions(scene);
initFire(scene);
initCombat(scene);
initHud();

// Visual settings touch both the page container and the renderer.
applyVisualSettings(appEl, renderer);

// Shadows follow the quality setting; applyVisualSettings may have changed
// it, so sync the sun once here — later changes re-run applyVisualSettings.
sun.castShadow = G.settings.quality !== 'low';

// --- partner placement helper ----------------------------------------------
// The partner waits at home until the story moves them; buildPartner only
// creates the mesh, so main owns the initial placement.
function placePartnerAtHome() {
  if (partner && partner.mesh) {
    partner.mesh.position.set(HOME_DOOR.x, 0, HOME_DOOR.z);
    if (partner.pos) partner.pos.set(HOME_DOOR.x, 0, HOME_DOOR.z);
  }
}

// --- entering play -----------------------------------------------------------
function enterPlaying() {
  G.mode = 'playing';
  showOverlay(null);
  setHudVisible(true);
  hudVisible = true;
  syncTouchControls();
  autosaveClock = 0;
}

// --- new game ----------------------------------------------------------------
function startGame(leadId) {
  resetRunState();
  G.lead = leadId;
  G.partner = leadId === 'vera' ? 'dax' : 'vera';
  buildLead(scene, leadId);
  buildPartner(scene, G.partner);
  placePartnerAtHome();
  // Wake-up opens inside the home interior, not on the street.
  const spot = interiorSpot('home');
  G.interior = 'home';
  placeAt(spot.x, spot.z, 0);
  startWakeUp(spot);
  startWakeFlow();
  enterPlaying();
}

// --- loaded game ---------------------------------------------------------------
function startLoadedGame(data) {
  // applySave restores lead/money/stats first so the meshes match the save.
  applySave(data);
  const leadId = G.lead || 'vera';
  buildLead(scene, leadId);
  buildPartner(scene, G.partner || (leadId === 'vera' ? 'dax' : 'vera'));
  placePartnerAtHome();
  const p = data && data.playerPos ? data.playerPos : SPAWN;
  placeAt(p.x, p.z, p.angle || 0);
  G.interior = null;
  enterPlaying();
}

// --- settings / stats plumbing (full wiring in stage 3, entry points here) ---
function openSettings(returnTo) {
  settingsReturn = returnTo || 'menu';
  // Reflect current settings into the controls before showing the panel.
  const s = G.settings;
  const setSound = $('setSound'); if (setSound) setSound.value = String(!!s.sound);
  const setFps = $('setFps'); if (setFps) setFps.value = String(s.fps);
  const setQuality = $('setQuality'); if (setQuality) setQuality.value = String(s.quality);
  const setBrightness = $('setBrightness'); if (setBrightness) setBrightness.value = String(s.brightness);
  const setJoystick = $('setJoystick'); if (setJoystick) setJoystick.value = String(s.joystick);
  showOverlay('settings');
  if (settingsReturn === 'menu') G.mode = 'settings';
  else G.mode = 'paused';
}

function openStats(returnTo) {
  statsReturn = returnTo || 'menu';
  showStats();
  if (statsReturn === 'menu') G.mode = 'stats';
  else G.mode = 'paused';
}

function backFromSettings() {
  if (settingsReturn === 'menu') {
    showOverlay('menu');
    G.mode = 'title';
  } else {
    showOverlay('pause');
    G.mode = 'paused';
  }
}

function backFromStats() {
  if (statsReturn === 'menu') {
    showOverlay('menu');
    G.mode = 'title';
  } else {
    showOverlay('pause');
    G.mode = 'paused';
  }
}

// --- menu wiring ---------------------------------------------------------------
// Audio needs a user gesture, so every menu click primes it.
function primeAudio() {
  try { initAudio(); } catch (e) { /* audio is optional; never block boot */ }
}
document.addEventListener('pointerdown', primeAudio, { once: true });

const btnNew = $('btnNew');
if (btnNew) btnNew.addEventListener('click', () => { primeAudio(); showOverlay('choice'); G.mode = 'choice'; });

const btnVera = $('btnVera');
if (btnVera) btnVera.addEventListener('click', () => { primeAudio(); startGame('vera'); });

const btnDax = $('btnDax');
if (btnDax) btnDax.addEventListener('click', () => { primeAudio(); startGame('dax'); });

const btnLoad = $('btnLoad');
if (btnLoad) {
  // Probe once at boot: no save means the button stays disabled.
  let probe = null;
  try { probe = loadGame(); } catch (e) { probe = null; }
  if (!probe) btnLoad.disabled = true;
  btnLoad.addEventListener('click', () => {
    primeAudio();
    const data = loadGame();
    if (data) startLoadedGame(data);
    else btnLoad.disabled = true;
  });
}

const btnSettings = $('btnSettings');
if (btnSettings) btnSettings.addEventListener('click', () => { primeAudio(); openSettings('menu'); });

const btnStats = $('btnStats');
if (btnStats) btnStats.addEventListener('click', () => { primeAudio(); openStats('menu'); });

// --- screenshot staging --------------------------------------------------------
// Staging must run after boot so a ?shot= URL can skip the menu entirely.
const shotApi = {
  startGame,
  startLoadedGame,
  placeAt,
  teleport: placeAt,
  enterNearestCar,
  setWanted(n) { G.wanted = n; },
  openMap,
  commitCrime,
  G,
  player,
  scene,
  camera,
};

function enterNearestCar() {
  // Staging-only helper: parked cars jitter up to 6 units from their
  // nominal spots, so the search radius must clear that plus a margin.
  const v = nearestVehicle(player.pos, 10);
  if (!v) return false;
  enterVehicle(v, player.pos);
  if (player.mesh) player.mesh.visible = false;
  syncTouchControls();
  return true;
}

let staged = false;
try {
  staged = applyShotStaging(location.search, shotApi) === true;
} catch (e) {
  staged = false;
}
if (!staged) {
  G.mode = G.mode || 'title';
  showOverlay('menu');
  setHudVisible(false);
  hudVisible = false;
}

// ===========================================================================
// STAGE 2 — input: keyboard, touch joystick/buttons, mouse camera.
// Queues (interact / vehicle / attack press) are edge-triggered and consumed
// exactly once per frame by the loop in stage 3.
// ===========================================================================

const keys = new Set(); // e.code values currently held
const joyVec = { x: 0, y: 0 }; // analog stick, -1..1 per axis
let touchRun = false;
let touchBoost = false;
let touchAttack = false;
let padThrottle = 0; // -1 | 0 | 1 from the driving D-pad
let padSteer = 0; // -1 | 0 | 1 from the driving D-pad
let mouseHeld = false;

function isDown(code) { return keys.has(code); }
function anyDown(...codes) { return codes.some((c) => keys.has(c)); }

// --- overlay helpers shared by keyboard and touch ---------------------------
function toggleMap() {
  if (isMapOpen()) { closeMap(); return; }
  if (G.mode === 'playing') openMap();
}

function openQuests() {
  if (G.mode !== 'playing' && G.mode !== 'paused') return;
  overlayReturn = G.mode === 'paused' ? 'pause' : null;
  renderQuests(getQuests());
  showOverlay('quests');
  G.mode = 'paused'; // quests pause the world; close returns to playing
}

function closeQuests() {
  showOverlay(overlayReturn === 'pause' ? 'pause' : null);
  G.mode = overlayReturn === 'pause' ? 'paused' : 'playing';
  overlayReturn = null;
}

function pauseGame() {
  if (G.mode !== 'playing') return;
  G.mode = 'paused';
  showOverlay('pause');
}

function resumeGame() {
  showOverlay(null);
  G.mode = 'playing';
}

// Escape closes the topmost overlay first, and only pauses when none is open.
function handleEscape() {
  if (isMapOpen()) { closeMap(); return; }
  if (isChoiceOpen && isChoiceOpen()) { showOverlay('menu'); G.mode = 'title'; return; }
  const mode = G.mode;
  if (mode === 'paused') {
    // Figure out which paused panel is up by checking overlay visibility.
    const quest = $('questOverlay');
    if (quest && !quest.classList.contains('hidden') && quest.style.display !== 'none' && quest.offsetParent !== null) { closeQuests(); return; }
    resumeGame();
    return;
  }
  if (mode === 'settings') { backFromSettings(); return; }
  if (mode === 'stats') { backFromStats(); return; }
  if (mode === 'playing') pauseGame();
}

// --- keyboard -----------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  const code = e.code;
  if (code === 'Space') e.preventDefault(); // keep the page from scrolling
  const wasDown = keys.has(code);
  keys.add(code);
  if (e.repeat) return; // edges below fire once per physical press
  switch (code) {
    case 'KeyE': interactQueued = true; break;
    case 'KeyF': vehicleQueued = true; break;
    case 'KeyX': attackPressQueued = true; break;
    case 'KeyK': try { radio.toggle(); } catch (err) { /* radio optional */ } break;
    case 'KeyM': toggleMap(); break;
    case 'KeyQ': if (G.mode === 'playing') openQuests(); break;
    case 'KeyP': if (G.mode === 'playing') pauseGame(); else if (G.mode === 'paused') resumeGame(); break;
    case 'Escape': handleEscape(); break;
    case 'Digit1': selectSlot(0); break;
    case 'Digit2': selectSlot(1); break;
    case 'Digit3': selectSlot(2); break;
    case 'Digit4': selectSlot(3); break;
    case 'Digit5': selectSlot(4); break;
    default: break;
  }
  void wasDown;
});
window.addEventListener('keyup', (e) => { keys.delete(e.code); });
window.addEventListener('blur', () => {
  // Losing focus must not leave a movement key stuck on.
  keys.clear();
  touchRun = false; touchBoost = false; touchAttack = false;
  padThrottle = 0; padSteer = 0; mouseHeld = false;
});

// --- touch joystick -------------------------------------------------------------
const joyEl = $('joy');
const joyKnob = $('joyKnob');
let joyPointerId = null;

function setKnob(dx, dy) {
  if (joyKnob) joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

if (joyEl) {
  joyEl.addEventListener('pointerdown', (e) => {
    joyPointerId = e.pointerId;
    joyEl.setPointerCapture(e.pointerId);
    moveJoy(e);
  });
  joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === joyPointerId) moveJoy(e); });
  const endJoy = (e) => {
    if (e.pointerId !== joyPointerId) return;
    joyPointerId = null;
    joyVec.x = 0; joyVec.y = 0;
    setKnob(0, 0);
  };
  joyEl.addEventListener('pointerup', endJoy);
  joyEl.addEventListener('pointercancel', endJoy);
}

function moveJoy(e) {
  const rect = joyEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = e.clientX - cx;
  let dy = e.clientY - cy;
  const len = Math.hypot(dx, dy);
  const max = 44; // knob travel clamp, px
  if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
  setKnob(dx, dy);
  joyVec.x = dx / max;
  joyVec.y = dy / max;
}

// --- touch buttons: hold vs tap ---------------------------------------------------
// Hold buttons set a flag while the finger is down; tap buttons queue an edge.
function bindHold(el, set) {
  if (!el) return;
  const on = (e) => { e.preventDefault(); set(true); };
  const off = (e) => { e.preventDefault(); set(false); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
}
function bindTap(el, fn) {
  if (!el) return;
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
}

bindHold($('btnRun'), (v) => { touchRun = v; });
bindHold($('btnGas'), (v) => { touchBoost = v; });
bindHold($('btnAttack'), (v) => { if (v) attackPressQueued = true; touchAttack = v; });
bindHold($('padUp'), (v) => { padThrottle = v ? 1 : (padThrottle > 0 ? 0 : padThrottle); });
bindHold($('padDown'), (v) => { padThrottle = v ? -1 : (padThrottle < 0 ? 0 : padThrottle); });
// Left pad means steer -1, right pad steer +1 (screen direction, not key code).
bindHold($('padLeft'), (v) => { padSteer = v ? -1 : (padSteer < 0 ? 0 : padSteer); });
bindHold($('padRight'), (v) => { padSteer = v ? 1 : (padSteer > 0 ? 0 : padSteer); });

bindTap($('btnInteract'), () => { interactQueued = true; });
bindTap($('btnEnter'), () => { vehicleQueued = true; });
bindTap($('btnRadio'), () => { try { radio.toggle(); } catch (err) { /* optional */ } });
bindTap($('btnPause'), () => { if (G.mode === 'playing') pauseGame(); });
bindTap($('btnQuests'), () => { if (G.mode === 'playing') openQuests(); });
// Minimap zoom is owned by hud.js: its btnZoom click handler cycles
// G.minimapZoom through the NEAR/MID/FAR strings hud's drawMinimap reads.
// A second writer here (numeric 1..3) corrupted that string state and
// wedged the cycle, so main deliberately does not bind btnZoom.

// A real click on the minimap opens the full map (drags are for the camera).
const minimapEl = $('minimap');
if (minimapEl) minimapEl.addEventListener('click', () => { if (G.mode === 'playing') openMap(); });

// --- mouse camera + click attack ----------------------------------------------------
const canvas = renderer.domElement;
let dragId = null;
let dragStartX = 0;
let dragStartY = 0;
let dragMoved = false;
let lastDragX = 0;
let lastDragY = 0;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  dragId = e.pointerId;
  dragStartX = lastDragX = e.clientX;
  dragStartY = lastDragY = e.clientY;
  dragMoved = false;
  mouseHeld = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== dragId) return;
  const dx = e.clientX - lastDragX;
  const dy = e.clientY - lastDragY;
  lastDragX = e.clientX;
  lastDragY = e.clientY;
  if (!dragMoved && Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > 4) dragMoved = true;
  // Only a real drag orbits; a click must stay a click (it becomes an attack).
  if (dragMoved) cam.orbitBy(dx, dy);
});
const endDrag = (e) => {
  if (e.pointerId !== dragId) return;
  dragId = null;
  mouseHeld = false;
  if (!dragMoved && G.mode === 'playing') attackPressQueued = true;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.dist = Math.max(5, Math.min(14, cam.dist + (e.deltaY > 0 ? 1 : -1)));
}, { passive: false });

// --- touch control layout -------------------------------------------------------------
// Driving swaps the stick for the D-pad: the two layouts never show together.
function syncTouchControls() {
  const driving = !!G.driving;
  const joy = $('joy'); const joyBtns = $('joyBtns');
  const dpad = $('dpad'); const btnGas = $('btnGas');
  if (driving) {
    if (joy) joy.style.display = 'none';
    if (joyBtns) joyBtns.style.display = 'none';
    if (dpad) dpad.style.display = '';
    if (btnGas) btnGas.style.display = '';
  } else {
    if (joy) joy.style.display = '';
    if (joyBtns) joyBtns.style.display = '';
    if (dpad) dpad.style.display = 'none';
    if (btnGas) btnGas.style.display = 'none';
  }
  lastDriving = G.driving;
}

// --- per-frame input shaping ------------------------------------------------------------
// Keyboard axes plus the analog stick, rotated by camera yaw into world space.
function computeWish() {
  let ix = 0;
  let iz = 0;
  if (anyDown('KeyW', 'ArrowUp')) iz -= 1;
  if (anyDown('KeyS', 'ArrowDown')) iz += 1;
  if (anyDown('KeyA', 'ArrowLeft')) ix -= 1;
  if (anyDown('KeyD', 'ArrowRight')) ix += 1;
  ix += joyVec.x;
  iz += joyVec.y;
  let mag = Math.hypot(ix, iz);
  if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }
  // Camera yaw defines "forward" on screen; rotate the screen vector by it.
  const sin = Math.sin(cam.yaw);
  const cos = Math.cos(cam.yaw);
  const mx = ix * cos - iz * sin;
  const mz = ix * sin + iz * cos;
  const run = anyDown('ShiftLeft', 'ShiftRight') || touchRun;
  return { mx, mz, mag, run };
}

// Driving input is digital by design: D-pad on touch, keys on desktop.
function computeDriveInput() {
  let throttle = 0;
  if (anyDown('KeyW', 'ArrowUp')) throttle += 1;
  if (anyDown('KeyS', 'ArrowDown')) throttle -= 1;
  throttle += padThrottle;
  throttle = Math.max(-1, Math.min(1, throttle));
  let steer = 0;
  if (anyDown('KeyA', 'ArrowLeft')) steer -= 1;
  if (anyDown('KeyD', 'ArrowRight')) steer += 1;
  steer += padSteer;
  steer = Math.max(-1, Math.min(1, steer));
  const boost = isDown('Space') || touchBoost;
  return { throttle, steer, boost };
}

function attackHeldNow() {
  return isDown('KeyX') || touchAttack || (mouseHeld && dragMoved === false && dragId !== null) || (mouseHeld && !dragId);
}

// ===========================================================================
// STAGE 3 — pause/settings plumbing, game-over flow, and the frame loop.
// World systems only advance in mode 'playing'; overlays freeze the world
// but never the rendering, so menus always sit over a live city.
// ===========================================================================

// --- small shape helpers ------------------------------------------------------
// Vehicle/ped objects expose pos directly or through their mesh; accept both
// so main never has to know which module built the object.
function objPos(o) {
  if (!o) return null;
  if (o.pos) return o.pos;
  if (o.mesh && o.mesh.position) return o.mesh.position;
  if (o.position) return o.position;
  return null;
}
function objAngle(o) {
  if (!o) return 0;
  if (typeof o.angle === 'number') return o.angle;
  if (typeof o.heading === 'number') return o.heading;
  if (o.mesh && o.mesh.rotation) return o.mesh.rotation.y;
  return 0;
}
function dist2D(a, b) {
  if (!a || !b) return Infinity;
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

// --- pause / settings / stats / quests / map / shop wiring ---------------------
const btnResume = $('btnResume');
if (btnResume) btnResume.addEventListener('click', () => resumeGame());

const btnPauseSettings = $('btnPauseSettings');
if (btnPauseSettings) btnPauseSettings.addEventListener('click', () => openSettings('pause'));

const btnPauseStats = $('btnPauseStats');
if (btnPauseStats) btnPauseStats.addEventListener('click', () => openStats('pause'));

const btnSettingsBack = $('btnSettingsBack');
if (btnSettingsBack) btnSettingsBack.addEventListener('click', () => backFromSettings());

const btnStatsBack = $('btnStatsBack');
if (btnStatsBack) btnStatsBack.addEventListener('click', () => backFromStats());

const btnQuestClose = $('btnQuestClose');
if (btnQuestClose) btnQuestClose.addEventListener('click', () => {
  showOverlay(null);
  G.mode = 'playing';
  overlayReturn = null;
});

const btnQuitToTitle = $('btnQuitToTitle');
if (btnQuitToTitle) btnQuitToTitle.addEventListener('click', () => {
  G.mode = 'title';
  setHudVisible(false);
  hudVisible = false;
  showOverlay('menu');
});

// The full-map buttons (btnMapClose / btnMapReset / btnMapIn / btnMapOut)
// are wired once in hud.js initHud(), where they drive the map view
// (mapView.scale and resetMapView). Duplicate listeners here wrote numeric
// values into G.minimapZoom — a minimap-only string state — corrupting the
// minimap zoom label and range, so main leaves these buttons to hud.

const btnShopClose = $('btnShopClose');
if (btnShopClose) btnShopClose.addEventListener('click', () => {
  showOverlay(null);
  if (G.mode !== 'title' && G.mode !== 'choice') G.mode = 'playing';
});

const btnEndingClose = $('btnEndingClose');
if (btnEndingClose) btnEndingClose.addEventListener('click', () => {
  // An ending closes back into free roam, not into a new run.
  showOverlay(null);
  G.mode = 'playing';
});

// Settings controls write straight into G.settings, then visuals re-apply.
function parseSetting(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}
function wireSetting(id, apply) {
  const el = $(id);
  if (!el) return;
  el.addEventListener('change', () => {
    apply(el.value);
    applyVisualSettings(appEl, renderer);
    // Shadow cost follows quality, so keep the sun in sync with the setting.
    sun.castShadow = G.settings.quality !== 'low';
  });
}
wireSetting('setSound', (v) => { G.settings.sound = parseSetting(v); });
wireSetting('setFps', (v) => { G.settings.fps = parseInt(v, 10) || G.settings.fps; });
wireSetting('setQuality', (v) => { G.settings.quality = v; });
wireSetting('setBrightness', (v) => {
  const n = parseFloat(v);
  G.settings.brightness = Number.isFinite(n) ? n : G.settings.brightness;
});
wireSetting('setJoystick', (v) => { G.settings.joystick = parseSetting(v); });

// --- fade blink (busted) ---------------------------------------------------------
function fadeBlink() {
  const fade = $('fadeEl');
  if (!fade) return;
  fade.style.transition = 'none';
  fade.style.opacity = '1';
  // Two nested timeouts: hold the black frame briefly, then fade back in.
  setTimeout(() => {
    fade.style.transition = 'opacity 0.6s ease';
    fade.style.opacity = '0';
  }, 350);
}

// --- game over ---------------------------------------------------------------------
function gameOver(kind) {
  if (kind === 'busted') {
    G.stats.busted++;
    fadeBlink();
    showBanner('BUSTED', 2.5);
    G.wanted = 0;
    G.bust = 0;
    G.health = 100;
    G.scoped = false;
    if (G.driving) {
      // Silent exit: no placement here, prison decides where the player is.
      try { exitVehicle(); } catch (e) { G.driving = null; }
      G.driving = null;
      if (player.mesh) player.mesh.visible = true;
    }
    sendToPrison();
    return;
  }
  if (kind === 'wasted') {
    G.stats.wasted++;
    showBanner('WASTED', 2.5);
    // The hospital takes its cut: 10% of carried money, never below zero.
    G.money = Math.max(0, G.money - Math.floor(G.money * 0.1));
    G.health = 100;
    G.wanted = 0;
    G.bust = 0;
    G.scoped = false;
    if (G.driving) {
      try { exitVehicle(); } catch (e) { G.driving = null; }
      G.driving = null;
      if (player.mesh) player.mesh.visible = true;
    }
    G.interior = null;
    placeAt(HOSPITAL_POS.x, HOSPITAL_POS.z - 14, 0);
  }
}

// --- endings -------------------------------------------------------------------------
function finishEnding(id) {
  const e = ENDINGS[id];
  if (!e) return;
  G.mode = 'ending';
  const found = Array.isArray(G.endingsFound) ? G.endingsFound.length : 0;
  showEnding(
    e.name,
    e.text,
    'Endings found ' + found + ' of 6 · Earned $' + G.stats.earned + ' · Busted ×' + G.stats.busted,
  );
}

// --- vehicle enter / exit ----------------------------------------------------------------
// Order inside a frame is fixed by the loop; this helper only does the swap.
function handleVehicleQueue() {
  if (G.driving) {
    const exitPos = exitVehicle();
    G.driving = null;
    if (exitPos) placeAt(exitPos.x, exitPos.z, player.angle);
    if (player.mesh) player.mesh.visible = true;
    return;
  }
  // Jacking a cop car is its own crime path: tryJackCop already applied the
  // wanted level, so enterVehicle (which would add another) is bypassed.
  const cop = tryJackCop(player.pos);
  if (cop) {
    const v = adoptVehicle(cop);
    if (v) {
      v.driver = 'player';
      G.driving = v;
      if (player.mesh) player.mesh.visible = false;
    }
    return;
  }
  const v = nearestVehicle(player.pos, 3.4);
  if (v) {
    enterVehicle(v, player.pos);
    if (G.driving && player.mesh) player.mesh.visible = false;
  }
}

// --- per-frame world update (playing only) ----------------------------------------------
function updateWorld(dt) {
  G.time += dt;

  // Capture and clear the edge queues exactly once, before any consumer runs.
  const attackPressed = attackPressQueued;
  attackPressQueued = false;
  const ctx = {
    interactPressed: interactQueued,
    playerPos: player.pos,
    driving: G.driving,
    attackPressed,
    attackHeld: attackHeldNow(),
  };
  interactQueued = false;
  const wantVehicle = vehicleQueued;
  vehicleQueued = false;

  // (1) Prison runs first: release changes where the player stands this frame.
  const prisonEvent = updatePrison(dt, ctx);
  if (prisonEvent === 'bailed') showBanner('Bailed out', 2.5);
  else if (prisonEvent === 'served') showBanner('Sentence served', 2.5);

  // (2) Movement: exactly one of driving / on-foot drives the lead each frame.
  if (G.driving) updateDriving(dt, computeDriveInput());
  else updatePlayer(dt, computeWish());
  updatePartner(dt);

  // (3) Vehicle enter/exit, after movement so positions are current.
  if (wantVehicle) handleVehicleQueue();
  if (G.driving !== lastDriving) syncTouchControls();

  // (4) Traffic around the player.
  updateTraffic(dt, player.pos);

  // (5) Pedestrians flee only from a wanted or fast-moving player.
  const drivingFast = G.driving && Math.abs(G.driving.speed || 0) > 12;
  const danger = (G.wanted > 0 || drivingFast) ? player.pos : null;
  updatePeds(dt, danger);

  // (6) Vehicle-vs-pedestrian hits: cooldown per ped stops multi-counting.
  if (G.driving && Math.abs(G.driving.speed || 0) > 6) {
    const vPos = objPos(G.driving) || player.pos;
    const speed = Math.abs(G.driving.speed || 0);
    for (const ped of peds) {
      const pPos = objPos(ped);
      if (!pPos || dist2D(vPos, pPos) > 1.7) continue;
      if (G.time - (ped.hurtAt || 0) <= 2) continue;
      hurtPed(ped, 40, vPos);
      ped.hurtAt = G.time;
      if (speed > 14) commitCrime(2, 'Pedestrian run down', { pos: pPos });
      else commitCrime(1, 'Pedestrian hit', { pos: pPos });
    }
  }

  // (7) Police chase the thing that is actually moving: car or lead.
  const target = G.driving || player;
  const targetPos = G.driving ? (objPos(G.driving) || player.pos) : player.pos;
  const targetSpeed = G.driving ? (G.driving.speed || 0) : (player.speedNow || 0);
  void target;
  updatePolice(dt, targetPos, targetSpeed, () => gameOver('busted'));

  // (8) Combat, (9) fire: both read the live player position.
  updateCombat(dt, { attackPressed, attackHeld: ctx.attackHeld });
  updateFire(dt, player.pos);

  // (10) Facilities (doors, interiors, shops), then (11) missions/story.
  updateFacilities(dt, ctx);
  const ev = updateMissions(dt, ctx);
  if (typeof ev === 'string' && ev.startsWith('ending:')) finishEnding(ev.slice(7));

  // (12) Pickups get whatever interact press is left in ctx.
  const got = updatePickups(dt, player.pos, ctx.interactPressed);
  if (got) {
    showBanner('Picked up ' + got, 1.6);
    try { sfx.pickup(); } catch (e) { /* sfx optional */ }
  }

  // (13) Radio keeps playing under everything else.
  try { radio.update(); } catch (e) { /* radio optional */ }

  // (14) Quiet regen only when nobody is looking for the player.
  if (G.wanted === 0 && !G.inPrison && G.health < 100) {
    G.health = Math.min(100, G.health + 2 * dt);
  }
  if (G.health <= 0) { gameOver('wasted'); return; }

  // (15) Autosave once a minute; interiors save their world door instead,
  // because an interior position means nothing once the scene reloads.
  autosaveClock += dt;
  if (autosaveClock >= 60) {
    autosaveClock = 0;
    try { saveGame(G.interior ? HOME_DOOR : player.pos); } catch (e) { /* save optional */ }
  }

  // (16) Ambient city motion last, so it never feeds back into gameplay.
  updateCity(dt, G.time);
}

// --- camera focus ---------------------------------------------------------------------------
function updateFrameCamera(dt) {
  const mode = G.mode;
  const titleLike = mode === 'title' || mode === 'choice'
    || ((mode === 'settings' || mode === 'stats') && settingsReturn === 'menu' && statsReturn === 'menu');
  if (titleLike) {
    // Slow orbit: the menu shows the living city, not a static backdrop.
    titleAngle += dt * 0.05;
    camera.position.set(Math.sin(titleAngle) * 120, 40, Math.cos(titleAngle) * 120);
    camera.lookAt(0, 4, 0);
    return;
  }
  if (!player || !player.pos) return;
  if (G.driving) {
    const vPos = objPos(G.driving) || player.pos;
    updateCamera(dt, camera, vPos, objAngle(G.driving), true);
  } else {
    updateCamera(dt, camera, player.pos, player.angle || 0, false);
  }
}

// --- resize -------------------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- main loop ------------------------------------------------------------------------------------
// frameInterval may report seconds or milliseconds depending on settings;
// normalise once per frame by magnitude instead of assuming a unit.
function frameIntervalSeconds() {
  let iv = 0;
  try { iv = frameInterval(); } catch (e) { iv = 0; }
  if (!iv || !Number.isFinite(iv) || iv <= 0) return 0;
  return iv > 1 ? iv / 1000 : iv;
}

let lastFrameStamp = 0;
function frame(nowMs) {
  requestAnimationFrame(frame);
  const now = nowMs || performance.now();
  if (!lastFrameStamp) lastFrameStamp = now;
  const elapsed = (now - lastFrameStamp) / 1000;
  const minInterval = frameIntervalSeconds();
  // Frame cap: skip this cadence entirely; elapsed keeps accumulating
  // because lastFrameStamp is only advanced on a rendered frame.
  if (minInterval > 0 && elapsed < minInterval) return;
  lastFrameStamp = now;
  const dt = Math.min(elapsed, 0.05);

  if (G.mode === 'playing') updateWorld(dt);
  updateFrameCamera(dt);
  if (hudVisible) updateHud(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
