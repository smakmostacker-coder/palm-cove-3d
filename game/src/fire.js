// Fires and vehicle explosions. Fires are cheap cone clusters with one
// light each, so the active count is capped and the oldest is recycled.

import { G } from './state.js';
import { vehicles, damageVehicle } from './driving.js';
import { commitCrime } from './police.js';
import { sfx } from './audio.js';
import { floatBetween, intBetween } from './random.js';
import { peds, hurtPed } from './pedestrians.js';

const MAX_FIRES = 10;
const FLAME_COLORS = [0xff6a00, 0xff8c1a, 0xffb300, 0xffd54d, 0xff5722];

const fires = [];
let sceneRef = null;
let lastPlayerPos = null;

export function initFire(scene) {
  sceneRef = scene;
}

function makeFlameGroup(scale) {
  const group = new THREE.Group();
  const cones = [];
  const count = intBetween(5, 7);
  for (let i = 0; i < count; i++) {
    const height = floatBetween(1.1, 2.3) * scale;
    const radius = floatBetween(0.35, 0.6) * scale;
    const geo = new THREE.ConeGeometry(radius, height, 7);
    const mat = new THREE.MeshBasicMaterial({
      color: FLAME_COLORS[i % FLAME_COLORS.length],
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    const cone = new THREE.Mesh(geo, mat);
    cone.position.set(
      floatBetween(-0.45, 0.45) * scale,
      height / 2,
      floatBetween(-0.45, 0.45) * scale,
    );
    cone.userData.baseHeight = height;
    cone.userData.spin = floatBetween(-1.6, 1.6);
    group.add(cone);
    cones.push(cone);
  }
  // One light per fire is the budget that keeps the cap at MAX_FIRES sane.
  const light = new THREE.PointLight(0xff7722, 16, 13 * scale, 1.8);
  light.position.y = 1.3 * scale;
  group.add(light);
  group.userData.cones = cones;
  group.userData.light = light;
  return group;
}

function removeFireAt(index) {
  const fire = fires[index];
  if (!fire) return;
  if (fire.group.parent) fire.group.parent.remove(fire.group);
  fire.group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  });
  fires.splice(index, 1);
}

export function spawnFire(x, z, scale = 1, life = 14) {
  if (fires.length >= MAX_FIRES) removeFireAt(0);
  const group = makeFlameGroup(scale);
  group.position.set(x, 0, z);
  if (sceneRef) sceneRef.add(group);
  const fire = {
    group,
    pos: group.position,
    scale,
    age: 0,
    life,
    seed: floatBetween(0, 100),
  };
  fires.push(fire);
  return fire;
}

function flickerFire(fire, dt) {
  const cones = fire.group.userData.cones;
  for (let i = 0; i < cones.length; i++) {
    const cone = cones[i];
    // Sine wobble plus a little random jitter reads as flame, not noise.
    const wobble = 0.86 + 0.22 * Math.sin(fire.age * 13 + fire.seed + i * 1.7);
    cone.scale.y = wobble * floatBetween(0.94, 1.06);
    cone.scale.x = cone.scale.z = wobble > 1 ? 0.9 : 1;
    cone.rotation.y += cone.userData.spin * dt;
  }
  const light = fire.group.userData.light;
  light.intensity = 15 + 5 * Math.sin(fire.age * 17 + fire.seed) + floatBetween(-1.5, 1.5);
}

function burnPlayer(fire, playerPos, dt) {
  if (!playerPos || G.driving) return;
  const dx = playerPos.x - fire.pos.x;
  const dz = playerPos.z - fire.pos.z;
  const reach = 1.7 * fire.scale;
  if (dx * dx + dz * dz < reach * reach) {
    G.health = Math.max(0, G.health - 14 * dt);
  }
}

function burnVehicles(fire, dt) {
  for (const v of vehicles) {
    if (v.wrecked || v.exploded) continue;
    const dx = v.pos.x - fire.pos.x;
    const dz = v.pos.z - fire.pos.z;
    if (dx * dx + dz * dz >= 2.4 * 2.4) continue;
    const wreckedByFire = damageVehicle(v, 22 * dt);
    if (wreckedByFire) explodeVehicle(v);
  }
}

export function updateFire(dt, playerPos) {
  if (playerPos) lastPlayerPos = playerPos;
  // A fire spawned before initFire still needs to join the scene once known.
  if (sceneRef) {
    for (const fire of fires) {
      if (!fire.group.parent) sceneRef.add(fire.group);
    }
  }
  for (let i = fires.length - 1; i >= 0; i--) {
    const fire = fires[i];
    fire.age += dt;
    if (fire.age >= fire.life) {
      removeFireAt(i);
      continue;
    }
    // Dying fires shrink away instead of vanishing in one frame.
    const remaining = fire.life - fire.age;
    if (remaining < 2) {
      const s = Math.max(0.06, remaining / 2);
      fire.group.scale.setScalar(s);
    }
    flickerFire(fire, dt);
    burnPlayer(fire, playerPos, dt);
    burnVehicles(fire, dt);
  }
}

function explosionAt(v) {
  sfx.explosion();
  commitCrime(3, 'Vehicle explosion', { pos: v.pos });
  spawnFire(v.pos.x, v.pos.z, 2, 6);
  // The blast hurts whoever is standing close, scaled by distance.
  if (lastPlayerPos) {
    const dist = Math.hypot(lastPlayerPos.x - v.pos.x, lastPlayerPos.z - v.pos.z);
    if (dist < 6) G.health = Math.max(0, G.health - 45 * (1 - dist / 6));
  }
  for (const ped of peds) {
    if (ped.mode === 'down') continue;
    const dist = Math.hypot(ped.pos.x - v.pos.x, ped.pos.z - v.pos.z);
    if (dist < 6) hurtPed(ped, 60, v.pos);
  }
}

// Shared detonation path: burning wrecks and gunfire wrecks both land here,
// and the exploded flag makes sure a vehicle only goes up once.
export function explodeVehicle(v) {
  if (!v || v.exploded) return;
  v.exploded = true;
  explosionAt(v);
}
