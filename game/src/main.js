// Palm Cove boot and game loop: builds the city, wires every system together,
// runs the title / playing / paused / stats state machine and the frame loop.
import { G, resetStats } from './state.js';
import { districtAt, SPAWN, POLICE_STATION, HOSPITAL } from './config.js';
import { buildCity } from './city.js';
import { buildTraffic, updateTraffic, parkedCars } from './traffic.js';
import { buildPeds, updatePeds, peds } from './pedestrians.js';
import { buildPlayer, player, updatePlayer, updateCamera } from './player.js';
import { nearestStealable, enterCar, exitCar, updateDriving, vehicleHitCheck } from './driving.js';
import { buildPolice, updatePolice, commitCrime, policePositions, cops } from './police.js';
import { punch, shoot } from './combat.js';
import { initMissions, updateMissions, onAction, onEnterCar, startRace, startTaxi, sidePrompt, missionTarget, startCurrentMission } from './missions.js';
import { initHud, updateHud, showDialogue, showBanner } from './hud.js';
import { saveGame, loadSave, applySave, clearSave } from './save.js';
import { parseShot, stageShot } from './shots.js';
import { sfx } from './audio.js';

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
buildTraffic(scene, seed);
buildPeds(scene, seed);
buildPlayer(scene);
buildPolice(scene);
initHud();
initMissions(scene, city.marker, showDialogue);

const menu = document.getElementById('menu');
const hud = document.getElementById('hud');
const pauseMenu = document.getElementById('pauseMenu');
const statsMenu = document.getElementById('statsMenu');
function refreshSaveInfo() {
  const s = loadSave();
  document.getElementById('saveInfo').textContent = s
    ? 'Save found: $' + s.money + ' · mission ' + Math.min(4, (s.missionIndex || 0) + 1) + '/4 · ' + new Date(s.savedAt).toLocaleString()
    : 'No save yet — New Game starts Vera\'s story.';
  document.getElementById('btnContinue').style.opacity = s ? '1' : '0.45';
}
refreshSaveInfo();

function startPlaying(useSave) {
  if (useSave) applySave(loadSave());
  else { clearSave(); G.money = 120; G.missionIndex = 0; G.missionStage = 0; G.storyDone = false; G.weapon = 'Fists'; resetStats(); }
  G.health = 100; G.wanted = 0; G.bust = 0;
  if (G.driving) exitCar();
  player.pos.set(SPAWN.x, 0.3, SPAWN.z); player.mesh.visible = true; G.onFoot = true;
  G.mode = 'playing';
  menu.style.display = 'none'; pauseMenu.style.display = 'none'; statsMenu.style.display = 'none';
  hud.style.display = 'block';
  startCurrentMission(true);
  saveGame();
}

function showStats() {
  G.prevMode = G.mode; G.mode = 'stats';
  pauseMenu.style.display = 'none'; menu.style.display = 'none'; statsMenu.style.display = 'flex';
  const total = 4 + 2;
  const done = Math.min(4, G.stats.missions) + Math.min(2, G.stats.side > 0 ? 1 : 0);
  const pct = G.storyDone ? 100 : Math.round((G.stats.missions / 4) * 80 + Math.min(20, G.stats.side * 10));
  document.getElementById('statsBody').innerHTML =
    'Cars stolen: <b>' + G.stats.stolen + '</b><br>' +
    'Distance driven: <b>' + G.stats.drivenKm.toFixed(2) + ' km</b><br>' +
    'Story missions completed: <b>' + G.stats.missions + ' / 4</b><br>' +
    'Side activities done: <b>' + G.stats.side + '</b><br>' +
    'Punches thrown: <b>' + G.stats.punches + '</b> · Shots fired: <b>' + G.stats.shotsFired + '</b><br>' +
    'Money: <b>$' + G.money + '</b><br>Completion: <b>' + pct + '%</b>';
}
function closeStats() {
  statsMenu.style.display = 'none';
  if (G.prevMode === 'playing' || G.prevMode === 'paused') { G.mode = 'paused'; pauseMenu.style.display = 'flex'; hud.style.display = 'block'; }
  else { G.mode = 'title'; menu.style.display = 'flex'; }
}
document.getElementById('btnNew').onclick = () => startPlaying(false);
document.getElementById('btnContinue').onclick = () => { if (loadSave()) startPlaying(true); };
document.getElementById('btnResume').onclick = () => { G.mode = 'playing'; pauseMenu.style.display = 'none'; };
document.getElementById('btnRestart').onclick = () => startPlaying(false);
document.getElementById('btnStats2').onclick = showStats;
document.getElementById('btnStatsBack').onclick = closeStats;
// A Stats button on the title screen too (via keyboard S is handled below).

function pauseGame() {
  if (G.mode !== 'playing') return;
  G.mode = 'paused'; pauseMenu.style.display = 'flex'; saveGame();
}
function gameOver(kind) {
  G.mode = 'over'; G.overKind = kind; G.overTimer = 3;
  showBanner(kind === 'busted' ? 'BUSTED' : 'WASTED', 3);
  sfx.fail();
  if (kind === 'busted') { G.money = Math.max(0, G.money - 150); }
  G.wanted = 0; G.bust = 0; G.health = 100;
  if (G.driving) exitCar();
  const at = kind === 'busted' ? POLICE_STATION : HOSPITAL;
  player.pos.set(at.x + 12, 0.3, at.z + 12); player.mesh.visible = true; G.onFoot = true;
  saveGame();
}

// Input
addEventListener('keydown', (e) => {
  G.keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (G.mode === 'playing') {
    if (e.code === 'Escape' || e.code === 'KeyP') pauseGame();
    else if (e.code === 'KeyE') {
      if (G.driving) exitCar();
      else { const car = nearestStealable(); if (car) { const wasTarget = car.isTarget; enterCar(car); onEnterCar(car); } }
    } else if (e.code === 'KeyF') {
      if (!G.driving) { punch(player.pos); onAction('punch', player.pos); }
    } else if (e.code === 'KeyR') { startRace(player.pos); }
    else if (e.code === 'KeyT') { startTaxi(); }
  } else if (G.mode === 'paused' && (e.code === 'Escape' || e.code === 'KeyP')) {
    G.mode = 'playing'; pauseMenu.style.display = 'none';
  } else if (G.mode === 'title' && e.code === 'KeyS') showStats();
});
addEventListener('keyup', (e) => { G.keys[e.code] = false; });
addEventListener('mousemove', (e) => {
  if (G.mode !== 'playing') return;
  if (e.buttons || document.pointerLockElement) { G.camYaw -= (e.movementX || 0) * 0.004; G.camPitch = Math.max(0.05, Math.min(1.1, G.camPitch + (e.movementY || 0) * 0.003)); }
});
addEventListener('mousedown', (e) => {
  if (G.mode === 'playing' && e.target === renderer.domElement) {
    if (shoot(player.pos, scene)) onAction('aim', player.pos);
  }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Collisions on foot: walking into a pedestrian knocks them down only when sprinting.
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
  vehicleHitCheck((kind) => {
    sfx.crash(); commitCrime(Math.max(1, G.wanted), 'Vehicle collision');
    G.health = Math.max(1, G.health - 4);
  });
  // Running down a pedestrian in a car: serious heat and damage.
  if (G.driving && Math.abs(G.driving.speed) > 4) {
    for (const p of peds) {
      if (p.down <= 0 && p.mesh.position.distanceTo(G.driving.pos) < 2.2) {
        p.down = 4; commitCrime(Math.max(2, G.wanted), 'Pedestrian run down'); sfx.crash();
      }
    }
  }
}

let last = performance.now(), titleAngle = 0, fpsCount = 0, fpsTime = 0;
window.__fps = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.08, (now - last) / 1000); last = now;
  if (dt <= 0) dt = 0.016;
  G.time += dt;
  fpsCount++; fpsTime += dt;
  if (fpsTime >= 0.5) { window.__fps = Math.round(fpsCount / fpsTime); fpsCount = 0; fpsTime = 0; }
  city.diamond.rotation.y += dt * 2; city.diamond.position.y = 6 + Math.sin(G.time * 3) * 0.5;
  city.ocean.position.y = -0.25 + Math.sin(G.time * 0.8) * 0.06;

  if (G.mode === 'title' || G.mode === 'stats' && G.prevMode === 'title') {
    titleAngle += dt * 0.07;
    camera.position.set(Math.cos(titleAngle) * 55, 26, 58 + Math.sin(titleAngle) * 55);
    camera.lookAt(0, 4, 58);
    updateTraffic(dt, player.pos);
    updatePeds(dt, null, 0);
  } else if (G.mode === 'playing' || G.mode === 'over') {
    if (G.mode === 'over') { G.overTimer -= dt; if (G.overTimer <= 0) G.mode = 'playing'; }
    const speedNow = G.driving ? G.driving.speed : player.speedNow;
    if (G.driving) { updateDriving(dt, camera, null); driveCollisions(); }
    else { updatePlayer(dt, camera); footCollisions(dt); }
    updateTraffic(dt, player.pos);
    const danger = G.wanted > 0 || (G.driving && Math.abs(G.driving.speed) > 12) ? player.pos : null;
    updatePeds(dt, danger, 9);
    updateMissions(dt, player.pos);
    updatePolice(dt, player.pos, speedNow, () => gameOver('busted'));
    if (G.health <= 0) gameOver('wasted');
    // Regenerate a little health when calm and unhunted.
    if (G.wanted === 0 && G.health < 100) G.health = Math.min(100, G.health + dt * 2);
    G.district = districtAt(player.pos.x, player.pos.z);
    // Context prompt
    if (!G.driving) { const car = nearestStealable(); G.prompt = car ? 'Press E to steal the ' + car.name : ''; }
    else G.prompt = sidePrompt(player.pos) || 'Press E to exit · R race (Old Town) · T taxi fare';
    if (G.missionIndex === 2 && !G.storyDone) G.prompt = G.prompt || '';
    updateHud(player.pos, missionTarget(), policePositions());
  }
  renderer.render(scene, camera);
}
window.__game = { G, player, startPlaying, renderer, scene, camera, cops };
stageShot(shot, (intro) => startPlaying(false));
if (shot) {
  if (shot !== 'title') { menu.style.display = 'none'; hud.style.display = 'block'; }
  // Let staged scenes settle for a moment, then flag readiness for captures.
  setTimeout(() => { window.__shotReady = true; }, 600);
}
refreshSaveInfo();
requestAnimationFrame(frame);
