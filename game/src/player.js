// On-foot controller and the third-person camera.
//
// Movement is camera-relative WASD (or the analog joystick vector,
// G.joyVec). The input names a DESIRED heading; the character steers
// toward it at a capped turn rate and moves along its own heading, so a
// held input converges to a straight line instead of curving with the
// follow camera. Two gaits, genuinely different:
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
// Swimming: the state is derived per frame from the position — past the
// shoreline (city.js isLand) the same input path swims instead of walks,
// slower, floating at the surface with a stroke pose, bounded only by
// city.js clampSea far offshore. Stepping back onto land resumes walking
// in the same movement; there is no mode switch anywhere else.
//
// Camera (the POV fix): dragging the mouse orbits freely at any time and
// takes priority; while the lead moves and the mouse has been left alone for
// a moment, the camera EASES around behind the direction of travel — an
// angular lerp, never a snap — so turning left or right brings the view
// round with you. Driving (driving.js) uses the same composition: the
// chase yaw eases behind the car at the same rate, and the same dragHold
// suppresses that ease while the player orbits manually.
import { G } from './state.js';
import { TUNING, SPAWN } from './config.js';
import { collideBuildings, groundHeightFor, isLand, makeProtagonist, posePerson } from './city.js';

export const player = { mesh: null, pos: null, angle: 0, swing: 0, speedNow: 0, sprinting: false, idle: 0, surfMode: null, surfY: 0, swimming: false, swimBlend: 0 };
// Swimming: slower than a run, with a small sprint boost. The mesh floats
// with the ocean surface (-0.35) cutting mid-torso: the rig stands ~1.8
// tall from a feet origin and rides at y=0.3 on land, so the swim height
// is -0.85, plus a gentle bob.
const SWIM_SPEED = 4.5, SWIM_SPRINT_SPEED = 6, SWIM_Y = -0.85, SWIM_BOB_AMP = 0.06;
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
// Sign convention (player's terms): dragging LEFT turns the view LEFT and
// dragging RIGHT turns it RIGHT. The view direction is (sin camYaw,
// -cos camYaw), so a larger camYaw turns the view to its right — hence
// camYaw INCREASES with a rightward drag (dx > 0) and decreases with a
// leftward one. (Round 3 had this mirrored; flipped in round 4.)
export function orbitCamera(dx, dy) {
  G.camYaw += dx * 0.0042;
  G.camPitch = Math.max(0.05, Math.min(1.1, G.camPitch + dy * 0.003));
  dragHold = 1.4;
}

// Decay the post-drag auto-follow suppression. Exactly one call per frame:
// updatePlayer() on foot, updateDriving() (driving.js) while driving — the
// two never run in the same frame, so there is no double decay.
export function tickDragHold(dt) {
  if (dragHold > 0) dragHold -= dt;
}

// True while a recent drag should keep the auto-follow / chase ease from
// fighting the player's manual orbit (on foot and while driving alike).
export function dragHoldActive() {
  return dragHold > 0;
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function updatePlayer(dt, camera) {
  const k = G.keys;
  let ix = 0, iz = 0, mag = 0;
  if (k['KeyW'] || k['ArrowUp']) iz -= 1;
  if (k['KeyS']) iz += 1;
  if (k['KeyA']) ix -= 1;
  if (k['KeyD']) ix += 1;
  if (ix !== 0 || iz !== 0) mag = 1;
  // Analog joystick (main.js initJoystick keeps G.joyVec continuous):
  // past the deadzone the stick's direction replaces the keys and its
  // magnitude scales the speed, so a half-pushed stick walks slowly in
  // one steady direction instead of flickering between digital ones.
  const jv = G.joyVec;
  if (jv) {
    const jl = Math.hypot(jv.x, jv.y);
    if (jl > 0.18) {
      mag = Math.min(1, (jl - 0.18) / 0.82);
      ix = jv.x / jl; iz = jv.y / jl;
    }
  }
  // Sprint: Shift on the keyboard, or the touch flag (bound by the RUN
  // button in main.js; the mobile stage can bind the same flag).
  const wantSprint = k['ShiftLeft'] || k['ShiftRight'] || G.sprintTouch;
  const moving = mag > 0;
  player.sprinting = !!(moving && wantSprint);
  // Swimming is DERIVED from the position every frame, never latched:
  // over water (city.js isLand) means swimming, over land means walking,
  // so entering/leaving the sea needs no event and a save made mid-swim
  // self-heals on load. Re-derived after the move below as well.
  player.swimming = !isLand(player.pos.x, player.pos.z);
  G.swimming = player.swimming;
  const speed = (player.swimming
    ? (player.sprinting ? SWIM_SPRINT_SPEED : SWIM_SPEED)
    : (player.sprinting ? TUNING.sprintSpeed : TUNING.walkSpeed)) * mag;
  player.speedNow = moving ? speed : 0;
  tickDragHold(dt);

  if (moving) {
    const len = Math.hypot(ix, iz); ix /= len; iz /= len;
    const sin = Math.sin(G.camYaw), cos = Math.cos(G.camYaw);
    const wx = ix * cos - iz * sin, wz = ix * sin + iz * cos;
    // Straight-line model: the camera-relative input only names the
    // desired heading. The character steers toward it at a capped turn
    // rate (twin-stick style) and moves along its OWN heading — never
    // directly along the live camera vector — so once the heading and
    // the follow camera settle, a held input is a straight line.
    const desired = Math.atan2(wx, wz);
    const maxTurn = 8 * dt;
    player.angle += Math.max(-maxTurn, Math.min(maxTurn, wrapAngle(desired - player.angle)));
    const fx = Math.sin(player.angle), fz = Math.cos(player.angle);
    // Sub-step the move so a long frame (dt can reach 0.15 s) can never carry
    // the player clean across a thin prop shell — collision resolves after
    // every hop of at most ~0.35 units.
    const hops = Math.max(1, Math.ceil((speed * dt) / 0.35));
    const hdt = dt / hops;
    for (let h = 0; h < hops; h++) {
      player.pos.x += fx * speed * hdt;
      player.pos.z += fz * speed * hdt;
      // Per-hop region test: a hop that lands in the sea collides WITHOUT
      // the land clamp (clampSea bounds it offshore instead), so walking
      // off a beach starts swimming and swimming back onto the shallows
      // exits in the same continuous movement — nothing fights either
      // crossing. Building/prop collision applies in both modes.
      collideBuildings(player.pos, 0.7, !isLand(player.pos.x, player.pos.z) ? { sea: true } : null);
    }
    // Stride phase: the sprint cycle turns over far faster than the walk;
    // the swim stroke cycles at ~1 Hz at swim speed.
    player.swing += dt * speed * (player.swimming ? 1.4 : player.sprinting ? 1.95 : 1.5);
    player.idle = 0;
    // Auto-follow: ease the camera behind the heading while moving.
    if (dragHold <= 0 && !G.driving) {
      const want = Math.PI - player.angle;
      G.camYaw += wrapAngle(want - G.camYaw) * Math.min(1, dt * 3.0);
    }
  } else {
    player.idle += dt;
  }
  player.swimming = !isLand(player.pos.x, player.pos.z);
  G.swimming = player.swimming;
  collideBuildings(player.pos, 0.7, player.swimming ? { sea: true } : null);
  // Vertical: on land the mesh rides the ground exactly as before. While
  // swimming it floats at SWIM_Y plus a gentle bob. swimBlend eases over
  // ~0.35 s between the two heights, so entering and leaving the water
  // never snaps.
  const landY = 0.3 + groundHeightFor(player, player.pos.x, player.pos.z, null);
  const blendStep = dt / 0.35;
  if (player.swimming) player.swimBlend = Math.min(1, player.swimBlend + blendStep);
  else player.swimBlend = Math.max(0, player.swimBlend - blendStep);
  if (player.swimBlend <= 0) player.mesh.position.y = landY;
  else {
    const b = player.swimBlend, s = b * b * (3 - 2 * b);
    const swimY = SWIM_Y + Math.sin(G.time * 2.1) * SWIM_BOB_AMP;
    player.mesh.position.y = landY + (swimY - landY) * s;
  }
  player.mesh.rotation.y = player.angle;

  // Pose: walk, run, swim and idle are distinct settings of the same rig.
  if (player.swimming && moving) {
    // Freestyle-ish stroke: big arm cycle, small flutter kick, body
    // pitched forward so it reads prone at the surface.
    posePerson(player.mesh, player.swing, 0.25, 1.2, 0.45, G.time * 1.5);
  } else if (player.swimming) {
    // Treading water: slow small arm cycle, gentle flutter, slight lean.
    posePerson(player.mesh, G.time * 1.8, 0.18, 0.35, 0.3, G.time * 2.2);
  } else if (moving && player.sprinting) {
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
  // The chase camera stays LEVEL: up is pinned to world +Y before every
  // lookAt, so the horizon can never pick up roll from the follow ease.
  camera.up.set(0, 1, 0);
  const bx = target.x - Math.sin(G.camYaw) * Math.cos(G.camPitch) * dist;
  const bz = target.z + Math.cos(G.camYaw) * Math.cos(G.camPitch) * dist;
  camera.position.set(bx, target.y + 2 + Math.sin(G.camPitch) * dist, bz);
  camera.lookAt(target.x, target.y + 1.6, target.z);
}

// Test/debug surface: current stride phase and limb angles.
export function strideState() {
  const u = player.mesh ? player.mesh.userData : {};
  return {
    phase: player.swing, speedNow: player.speedNow, sprinting: player.sprinting, swimming: player.swimming,
    legL: u.legL ? u.legL.rotation.x : 0, legR: u.legR ? u.legR.rotation.x : 0,
    armL: u.armL ? u.armL.rotation.x : 0, camYaw: G.camYaw, angle: player.angle,
  };
}
