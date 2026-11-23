// Palm Cove boot and game loop v2: dusk peninsula world, branching endings,
// sniper + fire + damkar, five vehicle classes, 5-slot hotbar inventory,
// working facilities + prison, and the Part G settings system (volume, FPS
// cap, Standard/HD graphics, brightness, virtual joystick).
import { G, resetStats } from './state.js';
import { districtAt, SPAWN, HOSPITAL } from './config.js';
import { buildCity, updateLights, landmarkAt, makeProtagonist } from './city.js';
import { buildTraffic, updateTraffic, parkedCars, trafficCars } from './traffic.js';
import { buildPeds, updatePeds, peds } from './pedestrians.js';
import { buildPlayer, player, updatePlayer, updateCamera, setCharacter } from './player.js';
import { nearestStealable, enterCar, exitCar, updateDriving, vehicleHitCheck } from './driving.js';
import { buildPolice, updatePolice, commitCrime, policePositions, cops } from './police.js';
import { punch, shoot } from './combat.js';
import { initMissions, updateMissions, onAction, onEnterCar, startRace, startTaxi, sidePrompt, missionTarget, startCurrentMission, setEndingHandler, replayFinale, computeEnding, finishFinale, setPartner, ENDINGS } from './missions.js';
import { initHud, updateHud, showDialogue, showBanner, drawFullMap } from './hud.js';
import { saveGame, loadSave, applySave, clearSave } from './save.js';
import { parseShot, stageShot } from './shots.js';
import { sfx } from './audio.js';
import { initFire, updateFire, fireState, forceIgnite } from './fire.js';
import { buildFacilities, nearestFacility, buyItem, sendToPrison, updatePrison, payBail, FACILITIES } from './facilities.js';
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
// Character-choice display pair (Part M): both protagonists stand side by side
// on the beach in front of the deco strip, in the title/choice camera frame.
for (const [who, z] of [['vera', 100], ['dax', 109]]) {
  const disp = makeProtagonist(who);
  disp.scale.setScalar(1.7);
  disp.position.set(207, 0.3, z); disp.rotation.y = Math.PI / 2;
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
onGraphics((s) => {
  if (s.quality === 'hd') { renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); if (scene.fog) scene.fog.far = 560; camera.far = 760; }
  else { renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.25)); if (scene.fog) scene.fog.far = 320; camera.far = 420; }
  camera.updateProjectionMatrix();
});
applySettings();
$('joy').style.display = settings.joystick ? 'block' : 'none';
$('joyBtns').style.display = settings.joystick ? 'flex' : 'none';

function refreshSaveInfo() {
  const s = loadSave();
  $('saveInfo').textContent = s
    ? 'Save found: $' + s.money + ' · missions ' + Math.min(4, s.stats ? s.stats.missions : 0) + '/4 · endings ' + ((s.endingsUnlocked || []).length) + '/6 · ' + new Date(s.savedAt).toLocaleString()
    : 'No save yet — New Game starts Vera\'s story.';
  $('btnContinue').style.opacity = s ? '1' : '0.45';
  $('btnContinue').textContent = s ? 'LOAD GAME' : 'LOAD GAME (no save yet)';
}
refreshSaveInfo();

function startPlaying(useSave) {
  if (useSave) { applySave(loadSave()); syncWeapon(); }
  else {
    clearSave(); G.money = 120; G.missionIndex = 0; G.missionStage = 0; G.storyDone = false;
    G.weapon = 'Fists'; G.weapons = ['Fists']; G.sniperAmmo = 0; G.armour = 0;
    G.inventory = emptyInv(); G.selectedSlot = 0; G.endingsUnlocked = []; G.lastEnding = ''; G.inPrison = 0;
    resetStats();
  }
  setCharacter(G.character || 'vera'); setPartner();
  G.health = 100; G.wanted = 0; G.bust = 0; G.scoped = false;
  if (G.driving) exitCar();
  player.pos.set(SPAWN.x, 0.3, SPAWN.z); player.mesh.visible = true; G.onFoot = true;
  G.mode = 'playing';
  menu.style.display = 'none'; pauseMenu.style.display = 'none'; statsMenu.style.display = 'none';
  endingMenu.style.display = 'none'; mapMenu.style.display = 'none'; shopMenu.style.display = 'none';
  $('choiceMenu').style.display = 'none'; window.__titleCam = null;
  hud.style.display = 'block';
  startCurrentMission(true);
  saveGame();
}
function completionPct() {
  return Math.min(100, Math.round((Math.min(4, G.stats.missions) / 4) * 50 + Math.min(20, G.stats.side * 10) + Math.min(30, G.endingsUnlocked.length * 10)));
}
function showStats() {
  G.prevMode = G.mode; G.mode = 'stats';
  pauseMenu.style.display = 'none'; menu.style.display = 'none'; statsMenu.style.display = 'flex';
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
  statsMenu.style.display = 'none';
  if (G.prevMode === 'playing' || G.prevMode === 'paused') { G.mode = 'paused'; pauseMenu.style.display = 'flex'; hud.style.display = 'block'; }
  else { G.mode = 'title'; menu.style.display = 'flex'; }
}
function showEnding(id, def) {
  G.mode = 'ending';
  $('endingName').textContent = def.name;
  $('endingText').textContent = def.text.replaceAll('Vera', G.character === 'dax' ? 'Dax' : 'Vera');
  $('endingMeta').textContent = 'Ending ' + G.endingsUnlocked.length + ' of 6 unlocked · Spared ' + G.track.spared + ' · Took out ' + G.track.tookOut + ' · Earned $' + G.track.earned + ' · Busted ×' + G.track.busted;
  endingMenu.style.display = 'flex';
  sfx.success();
}
setEndingHandler(showEnding);
$('btnNew').onclick = () => {
  menu.style.display = 'none';
  $('choiceMenu').style.display = 'flex';
  window.__titleCam = { pos: [246, 10, 168], look: [168, 9, 108] };
};
$('btnPickVera').onclick = () => { G.character = 'vera'; startPlaying(false); };
$('btnPickDax').onclick = () => { G.character = 'dax'; startPlaying(false); };
$('btnChoiceBack').onclick = () => { $('choiceMenu').style.display = 'none'; menu.style.display = 'flex'; window.__titleCam = null; };
$('btnContinue').onclick = () => { if (loadSave()) startPlaying(true); };
$('btnResume').onclick = () => { G.mode = 'playing'; pauseMenu.style.display = 'none'; };
$('btnRestart').onclick = () => startPlaying(false);
$('btnStats2').onclick = showStats;
$('btnStatsBack').onclick = closeStats;
$('btnEndContinue').onclick = () => { endingMenu.style.display = 'none'; G.mode = 'playing'; };
$('btnEndReplay').onclick = () => { endingMenu.style.display = 'none'; replayFinale(); G.mode = 'playing'; };
$('btnReplayFinale').onclick = () => { pauseMenu.style.display = 'none'; replayFinale(); G.mode = 'playing'; };
$('btnMap').onclick = () => { pauseMenu.style.display = 'none'; mapMenu.style.display = 'flex'; drawFullMap(); };
$('btnMapClose').onclick = () => { mapMenu.style.display = 'none'; if (G.mode === 'paused') pauseMenu.style.display = 'flex'; };
// Settings (Part G): one panel, opened from title or pause.
let settingsFrom = 'title';
function openSettings(from) {
  settingsFrom = from; syncSettingsUI();
  menu.style.display = 'none'; pauseMenu.style.display = 'none'; settingsMenu.style.display = 'flex';
}
function closeSettings() {
  settingsMenu.style.display = 'none';
  if (settingsFrom === 'pause') { G.mode = 'paused'; pauseMenu.style.display = 'flex'; }
  else { G.mode = 'title'; menu.style.display = 'flex'; }
}
function syncSettingsUI() {
  $('setVol').value = Math.round(settings.volume * 100);
  $('setMute').checked = settings.muted;
  $('setFps').value = String(settings.fpsCap);
  $('setQuality').value = settings.quality;
  $('setBright').value = Math.round(settings.brightness * 100);
  $('setJoy').checked = settings.joystick;
}
$('btnSettings').onclick = () => openSettings('title');
$('btnSettings2').onclick = () => openSettings('pause');
$('btnSettingsBack').onclick = closeSettings;
$('setVol').oninput = (e) => { settings.volume = e.target.value / 100; applySettings(); sfx.pickup(); };
$('setMute').onchange = (e) => { settings.muted = e.target.checked; applySettings(); };
$('setFps').onchange = (e) => { settings.fpsCap = parseInt(e.target.value, 10); applySettings(); };
$('setQuality').onchange = (e) => { settings.quality = e.target.value; applySettings(); };
$('setBright').oninput = (e) => { settings.brightness = e.target.value / 100; applySettings(); };
$('setJoy').onchange = (e) => { settings.joystick = e.target.checked; $('joy').style.display = settings.joystick ? 'block' : 'none'; $('joyBtns').style.display = settings.joystick ? 'flex' : 'none'; applySettings(); };
// Shops (Part I)
let shopFac = null;
function openShop(fac) {
  shopFac = fac; G.mode = 'shop';
  $('shopTitle').textContent = fac.name;
  renderShop('Welcome to ' + fac.name + '. Cash: $' + G.money);
  shopMenu.style.display = 'flex';
}
function renderShop(msg) {
  $('shopMsg').textContent = msg;
  const body = $('shopBody'); body.innerHTML = '';
  if (!shopFac.shop.length) { body.innerHTML = '<p>ATM — balance: <b>$' + G.money + '</b>. No items for sale.</p>'; return; }
  for (const row of shopFac.shop) {
    const b = document.createElement('button');
    b.textContent = ITEM_DEFS[row.item].icon + ' ' + ITEM_DEFS[row.item].name + ' — $' + row.price;
    b.onclick = () => renderShop(buyItem(shopFac, row.item, showDialogue) + ' Cash: $' + G.money);
    body.appendChild(b);
  }
}
$('btnShopClose').onclick = () => { shopMenu.style.display = 'none'; G.mode = 'playing'; };

function pauseGame() {
  if (G.mode !== 'playing') return;
  G.mode = 'paused'; pauseMenu.style.display = 'flex'; saveGame();
}
function gameOver(kind) {
  G.overKind = kind; G.overTimer = 3;
  showBanner(kind === 'busted' ? 'BUSTED' : 'WASTED', 3);
  sfx.fail();
  G.wanted = 0; G.bust = 0; G.health = 100; G.scoped = false;
  if (G.driving) exitCar();
  if (kind === 'busted') {
    G.track.busted++; G.mode = 'over';
    G.money = Math.max(0, G.money - 50); // processing fee; the real price is time inside
    const cell = sendToPrison();
    player.pos.set(cell.x, 0.3, cell.z);
    showDialogue('Guard', 'Processing done. Serve your time in the yard — or post bail with B.', 5);
  } else {
    G.track.wasted++; G.mode = 'over';
    const fee = G.money >= 50 ? 50 : G.money;
    G.money -= fee;
    player.pos.set(HOSPITAL.x + 12, 0.3, HOSPITAL.z + 12);
    if (fee) showDialogue('Hospital', 'Treatment fee: $' + fee + '. Try not to need us again today.', 4);
  }
  player.mesh.visible = true; G.onFoot = true;
  saveGame();
}
// Actions shared by keyboard, mouse, hotbar clicks and joystick buttons.
function doInteract() {
  if (G.driving) { exitCar(); return; }
  const fac = nearestFacility(player.pos);
  if (fac) { openShop(fac); return; }
  const car = nearestStealable();
  if (car) { enterCar(car); onEnterCar(car); }
}
function doPunch() { if (!G.driving) { punch(player.pos); onAction('punch', player.pos); } }
window.__selectSlot = (i) => { if (G.mode === 'playing') selectSlot(i); };
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
    else if (e.code === 'KeyV' && G.weapon === 'Sniper') G.scoped = !G.scoped;
    else if (/^Digit[1-5]$/.test(e.code)) selectSlot(parseInt(e.code.slice(5), 10) - 1);
  } else if (G.mode === 'paused' && (e.code === 'Escape' || e.code === 'KeyP')) {
    G.mode = 'playing'; pauseMenu.style.display = 'none'; mapMenu.style.display = 'none';
  } else if (G.mode === 'shop' && e.code === 'Escape') { shopMenu.style.display = 'none'; G.mode = 'playing'; }
  else if (G.mode === 'title' && e.code === 'KeyS') showStats();
});
addEventListener('keyup', (e) => { G.keys[e.code] = false; });
addEventListener('mousemove', (e) => {
  if (G.mode !== 'playing') return;
  if (e.buttons || document.pointerLockElement) { G.camYaw -= (e.movementX || 0) * 0.004; G.camPitch = Math.max(0.05, Math.min(1.1, G.camPitch + (e.movementY || 0) * 0.003)); }
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousedown', (e) => {
  if (G.mode === 'playing' && e.target === renderer.domElement) {
    if (e.button === 2) { if (G.weapon === 'Sniper') G.scoped = true; return; }
    if (e.button === 0 && shoot(player.pos, scene)) onAction('shoot', player.pos);
  }
});
addEventListener('mouseup', (e) => { if (e.button === 2) G.scoped = false; });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
// Virtual joystick (Part G): drag sets WASD-style keys; buttons fire actions.
(function initJoystick() {
  const base = $('joy'), knob = $('joyKnob');
  let pid = null;
  const setKeys = (dx, dy) => {
    G.keys['KeyW'] = dy < -0.35; G.keys['KeyS'] = dy > 0.35;
    G.keys['KeyA'] = dx < -0.35; G.keys['KeyD'] = dx > 0.35;
  };
  base.addEventListener('pointerdown', (e) => { pid = e.pointerId; base.setPointerCapture(pid); move(e); });
  base.addEventListener('pointermove', (e) => { if (e.pointerId === pid) move(e); });
  const end = () => { pid = null; knob.style.transform = 'translate(-50%,-50%)'; setKeys(0, 0); };
  base.addEventListener('pointerup', end); base.addEventListener('pointercancel', end);
  function move(e) {
    const r = base.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    knob.style.transform = 'translate(calc(-50% + ' + dx * 34 + 'px), calc(-50% + ' + dy * 34 + 'px))';
    setKeys(dx, dy);
  }
  $('joyE').onclick = () => { if (G.mode === 'playing') doInteract(); };
  $('joyF').onclick = () => { if (G.mode === 'playing') doPunch(); };
  $('joyX').onclick = () => { if (G.mode === 'playing') useSelected(); };
})();
// Collisions on foot.
let pedCooldown = 0;
function footCollisions(dt) {
  pedCooldown -= dt;
  if (pedCooldown > 0) return;
  for (const p of peds) {
    if (p.down <= 0 && p.mesh.position.distanceTo(player.pos) < 1.1 && player.speedNow > 9) {
      p.down = 2; pedCooldown = 1; commitCrime(Math.max(1, G.wanted), 'Pedestrian hit');
      G.health = Math.max(1, G.health - 2);
    }
  }
}
function driveCollisions() {
  vehicleHitCheck(() => {
    sfx.crash(); commitCrime(Math.max(1, G.wanted), 'Vehicle collision');
    G.health = Math.max(1, G.health - 4);
  });
  if (G.driving && Math.abs(G.driving.speed) > 4) {
    for (const p of peds) {
      if (p.down <= 0 && p.mesh.position.distanceTo(G.driving.pos) < 2.2) {
        p.down = 4; commitCrime(Math.max(2, G.wanted), 'Pedestrian run down'); sfx.crash();
      }
    }
  }
}
// World pickups (Parts C/H/I): walk over a glowing cache to take the item.
function checkPickups() {
  if (G.driving) return;
  for (const pk of city.pickups) {
    if (pk.taken) continue;
    if (Math.hypot(player.pos.x - pk.x, player.pos.z - pk.z) < 2.4) {
      if (addItem(pk.kind)) {
        pk.taken = true; pk.grp.visible = false;
        if (pk.kind === 'sniper') { G.sniperAmmo += 24; showDialogue('Cache', 'Sniper Rifle found — 24 rounds. Select its slot, hold right-mouse or V to scope.', 5); }
        else showDialogue('Pickup', ITEM_DEFS[pk.kind].name + ' added to your hotbar.', 3);
        sfx.pickup(); saveGame();
      } else G.prompt = 'Inventory full — use or drop something first (slots 1–5, X uses).';
    }
  }
}
let last = performance.now(), titleAngle = 0, fpsCount = 0, fpsTime = 0, prevHealth = 100, renderAcc = 0;
window.__fps = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let rawDt = Math.min(0.15, (now - last) / 1000); last = now;
  if (rawDt <= 0) rawDt = 0.016;
  // FPS cap (Part G): at 30 the world updates/renders on alternate frames.
  renderAcc += rawDt;
  const minStep = settings.fpsCap === 30 ? 1 / 30.5 : 0;
  if (renderAcc < minStep) return;
  const dt = renderAcc; renderAcc = 0;
  G.time += dt;
  fpsCount++; fpsTime += rawDt; // real elapsed, so __fps is the true frame rate
  if (fpsTime >= 0.5) { window.__fps = Math.round(fpsCount / fpsTime); fpsCount = 0; fpsTime = 0; }
  city.diamond.rotation.y += dt * 2; city.diamond.position.y = 6 + Math.sin(G.time * 3) * 0.5;
  city.ocean.position.y = -0.35 + Math.sin(G.time * 0.8) * 0.06;
  updateLights(G.time);
  window.__playerPos = player.pos;
  // Scope: narrow the FOV while the sniper is aimed.
  const targetFov = G.scoped && G.weapon === 'Sniper' ? 20 : 62;
  if (Math.abs(camera.fov - targetFov) > 0.2) { camera.fov += (targetFov - camera.fov) * 0.35; camera.updateProjectionMatrix(); }
  $('scope').style.display = G.scoped && G.weapon === 'Sniper' && G.mode === 'playing' ? 'block' : 'none';

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
    if (G.driving) { updateDriving(dt, camera, null); driveCollisions(); }
    else { updatePlayer(dt, camera); footCollisions(dt); }
    // Prison walls hold Vera until time is served or bail is paid.
    const prisonMsg = updatePrison(dt, player.pos, showDialogue);
    updateTraffic(dt, player.pos);
    const danger = G.wanted > 0 || (G.driving && Math.abs(G.driving.speed) > 12) ? player.pos : null;
    updatePeds(dt, danger, 9);
    updateMissions(dt, player.pos);
    updatePolice(dt, player.pos, speedNow, () => gameOver('busted'));
    updateFire(dt, player.pos);
    checkPickups();
    if (G.health <= 0) gameOver('wasted');
    // Armour vest absorbs 60% of any damage taken while it lasts.
    if (G.health < prevHealth && G.armour > 0 && G.mode === 'playing') {
      const absorbed = Math.min(G.armour, (prevHealth - G.health) * 0.6);
      G.health += absorbed; G.armour -= absorbed;
    }
    if (G.wanted === 0 && G.health < 100 && G.inPrison <= 0) G.health = Math.min(100, G.health + dt * 2);
    G.district = landmarkAt(player.pos.x, player.pos.z) || districtAt(player.pos.x, player.pos.z);
    if (prisonMsg) G.prompt = prisonMsg;
    else if (!G.driving) {
      const fac = nearestFacility(player.pos);
      const car = nearestStealable();
      G.prompt = fac ? 'Press E to enter ' + fac.name : car ? 'Press E to steal the ' + car.name : '';
    } else G.prompt = sidePrompt(player.pos) || 'Press E to exit · R race (Marina Mile) · T taxi fare';
    updateHud(player.pos, missionTarget(), policePositions());
  }
  renderer.render(scene, camera);
}
window.__game = {
  G, player, startPlaying, renderer, scene, camera, cops, parkedCars, trafficCars, peds,
  fireState, forceIgnite, computeEnding, settings,
  seedEnding: (patch) => { Object.assign(G.track, patch || {}); },
  finishFinale, gameOver,
  selectSlot, useSelected, addItem, buyItem, FACILITIES, replayFinale, payBail,
  teleport: (x, z) => { player.pos.set(x, 0.3, z); if (G.driving) { G.driving.pos.set(x, 0, z); } },
};
stageShot(shot, () => startPlaying(false));
if (shot) {
  if (shot !== 'title') { menu.style.display = 'none'; hud.style.display = 'block'; }
  setTimeout(() => { window.__shotReady = true; }, 600);
}
refreshSaveInfo();
requestAnimationFrame(frame);
