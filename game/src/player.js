// Player avatar, partner NPC, locomotion, swimming and the orbit camera.
// Combat, vehicles and police live elsewhere; they read player.pos,
// player.angle and player.speedNow from here.
import { G } from './state.js';
import { TUNING, SPAWN } from './config.js';
import { isLand, floorHeight, collideWorld, makePersonMesh, posePerson } from './city.js';
import { sfx } from './audio.js';

// --- Numeric helpers -------------------------------------------------------
// Clamp v into [lo, hi]; used for pitch, analog magnitude and world bounds.
function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
// t is expected to already be eased or rate-corrected by the caller.
function lerp(a, b, t) {
  return a + (b - a) * t;
}
// Wrap into (-PI, PI] so turning always takes the short way round.
function wrapAngle(a) {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r <= -Math.PI) r += Math.PI * 2;
  return r;
}
// Frame-rate independent smoothing factor: same feel at 30 and 60 fps.
function dampFactor(rate, dt) {
  return 1 - Math.exp(-rate * Math.max(0, dt));
}
// Smoothstep: soft at both ends so the wake-up rise never jerks.
function easeInOut(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// --- Looks table -----------------------------------------------------------
// One table for both leads so buildLead and buildPartner can never drift:
// whoever is not chosen still has to look like themselves as the partner.
const LOOKS = {
  vera: {
    skin: 0xf1c27d,
    hairStyle: 'ponytail',
    hairColor: 0xf7d774,
    shirtStyle: 'tank',
    shirt: 0xff5f9e,
    pants: 0x2b3a67,
    shoeColor: 0xf5f5f5,
    necklace: false,
    face: true,
  },
  dax: {
    skin: 0xe0ac69,
    hairStyle: 'spiky',
    hairColor: 0x14100c,
    shirtStyle: 'hawaiian',
    shirt: 0x12a5a0,
    pants: 0xff7fa5,
    shoeColor: 0x8a5a2b,
    necklace: true,
    face: true,
  },
};
// Unknown ids fall back to Vera rather than crashing the whole run.
function lookFor(id) {
  return LOOKS[id] || LOOKS.vera;
}

// --- Public state ----------------------------------------------------------
export const player = {
  mesh: null, // THREE group, null until buildLead runs
  pos: null, // alias of mesh.position once built, so callers can mutate it
  angle: 0, // facing radians; forward is (sin(angle), cos(angle)) in xz
  speedNow: 0, // actual speed this frame; the police bust rule reads this
  phase: 0, // limb swing phase, advanced in proportion to speed
  swimming: false, // mirror of G.swimming, kept here for local readers
};
export const partner = {
  mesh: null,
  pos: null,
  angle: 0,
};
// Private partner phase so the sway never syncs with the player's swing,
// which would look like choreography instead of idle life.
const partnerState = { phase: 0, built: false };

// --- Camera state ----------------------------------------------------------
export const cam = {
  yaw: Math.PI, // starts behind a player facing +z at spawn
  pitch: 0.32,
  dist: 8.5,
  lastOrbitAt: -Infinity, // G.time of the last manual orbit drag
  // Dragging right must swing the view right: yaw decreases with +dx so the
  // world appears to follow the pointer instead of mirroring it.
  orbitBy(dx, dy) {
    cam.yaw -= dx * 0.0045;
    cam.pitch = clamp(cam.pitch + dy * 0.003, -0.05, 1.1);
    cam.lastOrbitAt = G.time;
  },
};
// Smoothed camera internals, kept across frames so updateCamera can damp
// toward the desired position instead of snapping to it every frame.
const camState = {
  ready: false,
  distNow: 8.5,
  lookX: 0,
  lookY: 0,
  lookZ: 0,
  lastFocusX: 0,
  lastFocusZ: 0,
  lastMoveAt: -Infinity,
};

// --- Building the avatars --------------------------------------------------
export function buildLead(scene, leadId) {
  const mesh = makePersonMesh(lookFor(leadId));
  mesh.position.set(SPAWN.x, 0, SPAWN.z);
  mesh.position.y = floorHeight(SPAWN.x, SPAWN.z, 0);
  scene.add(mesh);
  player.mesh = mesh;
  player.pos = mesh.position;
  player.angle = 0;
  player.speedNow = 0;
  player.phase = 0;
  player.swimming = false;
  mesh.rotation.y = player.angle;
  posePerson(mesh, 0, 'idle');
  return mesh;
}
export function buildPartner(scene, partnerId) {
  const mesh = makePersonMesh(lookFor(partnerId));
  // A step to the side of spawn so the pair never starts in the same spot.
  const px = SPAWN.x + 1.6;
  const pz = SPAWN.z + 0.6;
  mesh.position.set(px, floorHeight(px, pz, 0), pz);
  scene.add(mesh);
  partner.mesh = mesh;
  partner.pos = mesh.position;
  partner.angle = Math.PI; // roughly facing the lead at spawn
  partnerState.phase = 0;
  partnerState.built = true;
  mesh.rotation.y = partner.angle;
  posePerson(mesh, 0, 'idle');
  return mesh;
}
// Gentle idle life: a slow sway through the idle pose, plus turning to face
// the player when they are close enough to plausibly be talking.
export function updatePartner(dt) {
  if (!partnerState.built || !partner.mesh) return;
  partnerState.phase += dt * 1.4;
  posePerson(partner.mesh, partnerState.phase, 'idle');
  if (!player.pos) return;
  const dx = player.pos.x - partner.pos.x;
  const dz = player.pos.z - partner.pos.z;
  const distSq = dx * dx + dz * dz;
  // Only face the player inside conversational range; far away the partner
  // keeps whatever heading they already had.
  if (distSq < 36 && distSq > 0.0001) {
    const target = Math.atan2(dx, dz);
    const diff = wrapAngle(target - partner.angle);
    partner.angle += diff * dampFactor(4, dt);
    partner.mesh.rotation.y = partner.angle;
  }
}

// --- Teleporting and the wake-up sequence ----------------------------------
export function placeAt(x, z, angle) {
  if (!player.mesh) return;
  player.pos.x = x;
  player.pos.z = z;
  // Ask the world for the floor here so exiting onto the flyover deck (or
  // into an interior) lands on the surface instead of under it.
  player.pos.y = floorHeight(x, z, player.pos.y);
  if (typeof angle === 'number') player.angle = angle;
  player.mesh.rotation.y = player.angle;
  player.speedNow = 0;
}
// The run opens lying in bed, so for a couple of seconds the avatar is
// scripted: input is ignored while the body rises and steps out.
const wake = {
  active: false,
  t: 0,
  duration: 2.6,
  fromX: 0,
  fromZ: 0,
  fromY: 0,
  toX: 0,
  toZ: 0,
  lyingPitch: -Math.PI * 0.46, // upper body pitched back, almost flat
};
export function startWakeUp(spot) {
  if (!player.mesh || !spot) return;
  wake.active = true;
  wake.t = 0;
  wake.fromX = spot.bedX;
  wake.fromZ = spot.bedZ;
  wake.fromY = 0.55; // mattress height: lying on the bed, not in it
  // Stand beside the bed, toward the room centre when the spot gives one,
  // so the avatar never rises up inside the furniture.
  const towardCentre = Math.sign(spot.x - spot.bedX) || 1;
  wake.toX = spot.bedX + towardCentre * 1.15;
  wake.toZ = spot.bedZ;
  player.pos.x = wake.fromX;
  player.pos.y = wake.fromY;
  player.pos.z = wake.fromZ;
  player.speedNow = 0;
  player.swimming = false;
  G.swimming = false;
  // Pitch the torso pivot back into a lying pose; the wake ease returns it.
  if (player.mesh.userData.upper) {
    player.mesh.userData.upper.rotation.x = wake.lyingPitch;
  }
}
export function isWaking() {
  return wake.active;
}
// Advance only the wake-up ease; updatePlayer delegates here while waking
// so no other system has to know the sequence exists.
function advanceWake(dt) {
  wake.t += dt;
  const raw = clamp(wake.t / wake.duration, 0, 1);
  const e = easeInOut(raw);
  player.pos.x = lerp(wake.fromX, wake.toX, e);
  player.pos.z = lerp(wake.fromZ, wake.toZ, e);
  // Settle to the real floor as the body gets upright; staying at mattress
  // height once vertical would read as floating.
  const floorY = floorHeight(player.pos.x, player.pos.z, player.pos.y);
  player.pos.y = lerp(wake.fromY, floorY, e);
  if (player.mesh.userData.upper) {
    player.mesh.userData.upper.rotation.x = lerp(wake.lyingPitch, 0, e);
  }
  // A slow phase reads as stirring in bed, not walking.
  player.phase += dt * 1.2;
  posePerson(player.mesh, player.phase, 'idle');
  player.speedNow = 0;
  if (raw >= 1) {
    wake.active = false;
    if (player.mesh.userData.upper) {
      player.mesh.userData.upper.rotation.x = 0;
    }
    player.pos.y = floorHeight(player.pos.x, player.pos.z, player.pos.y);
  }
}

// --- Locomotion, swimming and world bounds ---------------------------------
// Soft bound: about 240 units of swimmable sea past the shoreline on every
// side. A plain clamp is deliberate; an invisible wall that simply stops
// you reads better than rubber-banding or a teleport back.
const BOUND_X = 430;
const BOUND_Z_MIN = -4690;
const BOUND_Z_MAX = 700;
export function updatePlayer(dt, wish) {
  if (!player.mesh) return;
  // While waking, the sequence owns the avatar completely.
  if (wake.active) {
    advanceWake(dt);
    return;
  }
  const w = wish || { mx: 0, mz: 0, mag: 0, run: false };
  const mag = clamp(typeof w.mag === 'number' ? w.mag : 0, 0, 1);
  const mx = w.mx || 0;
  const mz = w.mz || 0;
  const len = Math.hypot(mx, mz);
  const moving = mag > 0.001 && len > 0.0001;
  const dirX = moving ? mx / len : 0;
  const dirZ = moving ? mz / len : 0;
  // Sprint needs both the run flag and a near-full stick: the stick alone
  // tops out at walk speed, so sprinting is always a deliberate input.
  // Swimming overrides both.
  let speed = 0;
  if (moving) {
    if (player.swimming) speed = TUNING.swimSpeed * mag;
    else if (w.run && mag > 0.9) speed = TUNING.sprintSpeed;
    else speed = TUNING.walkSpeed * mag;
  }
  // Integrate, then let the world push the avatar out of anything solid.
  if (moving && speed > 0) {
    player.pos.x += dirX * speed * dt;
    player.pos.z += dirZ * speed * dt;
  }
  collideWorld(player.pos, 0.55);
  // Bound after collision, so neither system can leave the avatar outside.
  // Interiors live far off-map by design, so the outdoor bound must not
  // apply indoors: facilities clamp the avatar to the room rect instead.
  // (Applying it indoors dragged the avatar to the bound corner every
  // frame and the room clamp then pinned it to the room's min corner,
  // frozen — no interior could ever be walked in.)
  if (!G.interior) {
    player.pos.x = clamp(player.pos.x, -BOUND_X, BOUND_X);
    player.pos.z = clamp(player.pos.z, BOUND_Z_MIN, BOUND_Z_MAX);
  }
  // Swim decision: only outdoors, only off land, and only where the floor
  // query reports open water (0) rather than a deck or the seabed.
  const fh = floorHeight(player.pos.x, player.pos.z, player.pos.y);
  const outdoors = G.interior === null || G.interior === undefined;
  const nowSwimming = outdoors && !isLand(player.pos.x, player.pos.z) && fh === 0;
  // One splash per entry; re-triggering every frame would be noise.
  if (nowSwimming && !player.swimming) sfx.splash();
  player.swimming = nowSwimming;
  G.swimming = nowSwimming;
  // At the surface while swimming (body half-submerged); on the local floor
  // otherwise — floorHeight takes the current y as a hint so the flyover
  // deck wins over the ground beneath it.
  const targetY = nowSwimming ? -0.55 : fh;
  player.pos.y += (targetY - player.pos.y) * dampFactor(10, dt);
  // Facing eases toward the wish direction; snapping would make diagonal
  // movement look robotic and would fight the camera's own easing.
  if (moving) {
    const targetAngle = Math.atan2(mx, mz);
    const diff = wrapAngle(targetAngle - player.angle);
    player.angle += diff * dampFactor(12, dt);
  }
  player.mesh.rotation.y = player.angle;
  // Phase rate scales with speed so feet roughly match ground travel, and
  // the pose mode follows what the body is actually doing.
  player.phase += dt * (3 + speed * 1.7);
  let mode = 'idle';
  if (nowSwimming) mode = 'swim';
  else if (speed > 8) mode = 'run';
  else if (moving) mode = 'walk';
  posePerson(player.mesh, player.phase, mode);
  player.speedNow = moving ? speed : 0;
}

// --- Camera ----------------------------------------------------------------
export function updateCamera(dt, camera, focusPos, focusAngle, driving) {
  if (!camera || !focusPos) return;
  // Track focus movement so auto-follow only engages while the focus is
  // actually travelling, not while the player stands and looks around.
  const fdx = focusPos.x - camState.lastFocusX;
  const fdz = focusPos.z - camState.lastFocusZ;
  if (fdx * fdx + fdz * fdz > 0.000001) camState.lastMoveAt = G.time;
  camState.lastFocusX = focusPos.x;
  camState.lastFocusZ = focusPos.z;
  // Ease back behind the focus once the camera has been left alone for a
  // while; recent manual orbiting always wins over the auto-follow.
  const recentlyMoved = G.time - camState.lastMoveAt < 0.35;
  if (recentlyMoved && G.time - cam.lastOrbitAt > 2.5) {
    const behind = focusAngle + Math.PI;
    const diff = wrapAngle(behind - cam.yaw);
    cam.yaw += diff * dampFactor(2.2, dt);
  }
  // Driving pulls the camera back for speed awareness; damping the distance
  // keeps the transition from popping when entering a vehicle.
  const desiredDist = driving ? 11 : cam.dist;
  camState.distNow += (desiredDist - camState.distNow) * dampFactor(4, dt);
  const dist = camState.distNow;
  const cosP = Math.cos(cam.pitch);
  const desiredX = focusPos.x + Math.sin(cam.yaw) * cosP * dist;
  const desiredY = focusPos.y + 1.6 + Math.sin(cam.pitch) * dist;
  const desiredZ = focusPos.z + Math.cos(cam.yaw) * cosP * dist;
  const lookTX = focusPos.x;
  const lookTY = focusPos.y + 1.6;
  const lookTZ = focusPos.z;
  if (!camState.ready) {
    // First frame snaps, otherwise the camera flies in from the origin.
    camera.position.set(desiredX, desiredY, desiredZ);
    camState.lookX = lookTX;
    camState.lookY = lookTY;
    camState.lookZ = lookTZ;
    camState.ready = true;
  } else {
    const kp = dampFactor(driving ? 7 : 9, dt);
    camera.position.x += (desiredX - camera.position.x) * kp;
    camera.position.y += (desiredY - camera.position.y) * kp;
    camera.position.z += (desiredZ - camera.position.z) * kp;
    const kl = dampFactor(12, dt);
    camState.lookX += (lookTX - camState.lookX) * kl;
    camState.lookY += (lookTY - camState.lookY) * kl;
    camState.lookZ += (lookTZ - camState.lookZ) * kl;
  }
  // Pin up before lookAt: a rolled horizon during orbit easing feels like
  // a bug, and lookAt would otherwise happily inherit any previous roll.
  camera.up.set(0, 1, 0);
  camera.lookAt(camState.lookX, camState.lookY, camState.lookZ);
}
