// On-foot controller and the third-person camera.
//
// Movement is camera-relative WASD. Two gaits, genuinely different:
//   walk  — TUNING.walkSpeed, a relaxed stride (phase rate ~1.5x speed),
//           modest leg swing, arms counter-swinging gently, upright torso.
//   sprint — Shift, or G.sprintTouch held (the flag the touch RUN button
//           binds to), TUNING.sprintSpeed, a faster phase rate, a much
//           longer stride, a hard arm pump and a forward torso lean.
// The figure itself is articulated in city.js (hip/shoulder pivots), and
// posePerson() is fed the phase and amplitudes computed here. Standing still
// is not a statue either: an idle phase keeps the chest breathing, the head
// drifting and the weight shifting.
//
// Camera (the POV fix): dragging the mouse orbits freely at any time and
// takes priority; while the lead moves and the mouse has been left alone for
// a moment, the camera EASES around behind the direction of travel — an
// angular lerp, never a snap — so turning left or right brings the view
// round with you. Driving keeps its own chase camera in driving.js.
import { G } from './state.js';
import { TUNING, SPAWN } from './config.js';
import { collideBuildings, groundHeightAt, makeProtagonist, posePerson } from './city.js';

export const player = { mesh: null, pos: null, angle: 0, swing: 0, speedNow: 0, sprinting: false, idle: 0 };
let playerScene = null;
let dragHold = 0; // seconds of auto-follow suppression left after a mouse drag

export function buildPlayer(scene) {
  playerScene = scene;
  player.mesh = makeProtagonist(G.character || 'vera');
  player.mesh.position.set(SPAWN.x, 0.3, SPAWN.z);
  player.pos = player.mesh.position;
  player.angle = Math.PI;
  scene.add(player.mesh);
  return player;
}

export function setCharacter(who) {
  G.character = who;
  if (!playerScene || !player.mesh) return;
  const old = player.mesh, pos = old.position.clone(), rot = old.rotation.y;
  playerScene.remove(old);
  player.mesh = makeProtagonist(who);
  player.mesh.position.copy(pos);
  player.mesh.rotation.y = rot;
  player.pos = player.mesh.position;
  playerScene.add(player.mesh);
}

// Called by the mouse handler in main.js whenever the player drags: orbit
// immediately, and hold off the auto-follow briefly so the two never fight.
export function orbitCamera(dx, dy) {
  G.camYaw -= dx * 0.0042;
  G.camPitch = Math.max(0.05, Math.min(1.1, G.camPitch + dy * 0.003));
  dragHold = 1.4;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function updatePlayer(dt, camera) {
  const k = G.keys;
  let ix = 0, iz = 0;
  if (k['KeyW'] || k['ArrowUp']) iz -= 1;
  if (k['KeyS']) iz += 1;
  if (k['KeyA']) ix -= 1;
  if (k['KeyD']) ix += 1;
  // Sprint: Shift on the keyboard, or the touch flag (bound by the RUN
  // button in main.js; the mobile stage can bind the same flag).
  const wantSprint = k['ShiftLeft'] || k['ShiftRight'] || G.sprintTouch;
  const moving = ix !== 0 || iz !== 0;
  player.sprinting = !!(moving && wantSprint);
  const speed = player.sprinting ? TUNING.sprintSpeed : TUNING.walkSpeed;
  player.speedNow = moving ? speed : 0;
  if (dragHold > 0) dragHold -= dt;

  if (moving) {
    const len = Math.hypot(ix, iz); ix /= len; iz /= len;
    const sin = Math.sin(G.camYaw), cos = Math.cos(G.camYaw);
    const wx = ix * cos - iz * sin, wz = ix * sin + iz * cos;
    // Sub-step the move so a long frame (dt can reach 0.15 s) can never carry
    // the player clean across a thin prop shell — collision resolves after
    // every hop of at most ~0.35 units.
    const hops = Math.max(1, Math.ceil((speed * dt) / 0.35));
    const hdt = dt / hops;
    for (let h = 0; h < hops; h++) {
      player.pos.x += wx * speed * hdt;
      player.pos.z += wz * speed * hdt;
      collideBuildings(player.pos, 0.7);
    }
    player.angle = Math.atan2(wx, wz);
    // Stride phase: the sprint cycle turns over far faster than the walk.
    player.swing += dt * speed * (player.sprinting ? 1.95 : 1.5);
    player.idle = 0;
    // Auto-follow: ease the camera behind the heading while moving.
    if (dragHold <= 0 && !G.driving) {
      const want = Math.PI - player.angle;
      G.camYaw += wrapAngle(want - G.camYaw) * Math.min(1, dt * 3.0);
    }
  } else {
    player.idle += dt;
  }
  collideBuildings(player.pos, 0.7);
  player.mesh.position.y = 0.3 + groundHeightAt(player.pos.x, player.pos.z, null);
  player.mesh.rotation.y = player.angle;

  // Pose: walk, run and idle are three distinct settings of the same rig.
  if (moving && player.sprinting) {
    posePerson(player.mesh, player.swing, 1.02, 1.05, 0.24, player.idle);
  } else if (moving) {
    posePerson(player.mesh, player.swing, 0.62, 0.58, 0.07, player.idle);
  } else {
    // Idle: legs settle, arms hang with a whisper of sway, breathing runs.
    posePerson(player.mesh, player.idle * 1.6, 0, 0.045, 0.01, player.idle * 2.2);
  }
  updateCamera(dt, camera, player.pos, 9);
}

export function updateCamera(dt, camera, target, dist) {
  // Forward (W) is (sin yaw, -cos yaw); the camera sits opposite, behind.
  const bx = target.x - Math.sin(G.camYaw) * Math.cos(G.camPitch) * dist;
  const bz = target.z + Math.cos(G.camYaw) * Math.cos(G.camPitch) * dist;
  camera.position.set(bx, target.y + 2 + Math.sin(G.camPitch) * dist, bz);
  camera.lookAt(target.x, target.y + 1.6, target.z);
}

// Test/debug surface: current stride phase and limb angles.
export function strideState() {
  const u = player.mesh ? player.mesh.userData : {};
  return {
    phase: player.swing, speedNow: player.speedNow, sprinting: player.sprinting,
    legL: u.legL ? u.legL.rotation.x : 0, legR: u.legR ? u.legR.rotation.x : 0,
    armL: u.armL ? u.armL.rotation.x : 0, camYaw: G.camYaw, angle: player.angle,
  };
}
