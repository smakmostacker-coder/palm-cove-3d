// On-foot combat: fists, pistol and sniper hitscan, plus using heal items
// and the fire can. Everything resolves along the player's facing angle.

import { G } from './state.js';
import { selectedItem, useSelected, useAmmo } from './inventory.js';
import { commitCrime, cops, officers, damageOfficer, damageCop } from './police.js';
import { peds, hurtPed } from './pedestrians.js';
import { vehicles, damageVehicle } from './driving.js';
import { spawnFire, explodeVehicle } from './fire.js';
import { sfx } from './audio.js';
import { player } from './player.js';
import { setScope } from './hud.js';

let sceneRef = null;
let cooldown = 0;
let hudScoped = false;

const tracers = [];
let tracerGeo = null;
let tracerMat = null;

export function initCombat(scene) {
  sceneRef = scene;
  // One shared unit box, stretched per shot, keeps tracers allocation-free.
  tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  tracerMat = new THREE.MeshBasicMaterial({
    color: 0xffe27a, transparent: true, opacity: 0.9, depthWrite: false,
  });
}

function setScoped(value) {
  G.scoped = value;
  // The HUD overlay only needs to hear about actual changes.
  if (hudScoped !== value) {
    hudScoped = value;
    setScope(value);
  }
}

function facingX() { return Math.sin(player.angle); }
function facingZ() { return Math.cos(player.angle); }

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function collectTargets() {
  const targets = [];
  for (const ped of peds) {
    if (ped.mode !== 'down') targets.push({ kind: 'ped', ref: ped, pos: ped.pos });
  }
  for (const officer of officers) {
    if (officer.health === undefined || officer.health > 0) {
      targets.push({ kind: 'officer', ref: officer, pos: officer.pos });
    }
  }
  for (const v of vehicles) {
    if (!v.exploded) targets.push({ kind: 'vehicle', ref: v, pos: v.pos });
  }
  for (const cop of cops) {
    if (!cop.destroyed) targets.push({ kind: 'cop', ref: cop, pos: cop.pos });
  }
  return targets;
}

// Nearest target inside the aim cone; anything point-blank counts even if
// it sits just outside the cone, because at arm's length aim is a formality.
function findHit(range, cone) {
  let best = null;
  let bestBlank = null;
  for (const target of collectTargets()) {
    const dx = target.pos.x - player.pos.x;
    const dz = target.pos.z - player.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > range) continue;
    const entry = { ...target, dist };
    if (dist <= 2.5 && (!bestBlank || dist < bestBlank.dist)) bestBlank = entry;
    const diff = angleDiff(Math.atan2(dx, dz), player.angle);
    if (diff <= cone && (!best || dist < best.dist)) best = entry;
  }
  if (bestBlank && (!best || bestBlank.dist < best.dist)) return bestBlank;
  return best;
}

function fireTracer(toX, toY, toZ) {
  if (!sceneRef || !tracerGeo) return;
  const fromX = player.pos.x + facingX() * 0.7;
  const fromZ = player.pos.z + facingZ() * 0.7;
  const len = Math.hypot(toX - fromX, toZ - fromZ);
  if (len < 0.1) return;
  const mesh = new THREE.Mesh(tracerGeo, tracerMat);
  mesh.scale.set(0.045, 0.045, len);
  mesh.position.set((fromX + toX) / 2, (1.35 + toY) / 2, (fromZ + toZ) / 2);
  mesh.lookAt(toX, toY, toZ);
  sceneRef.add(mesh);
  tracers.push({ mesh, ttl: 0.06 });
}

function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].ttl -= dt;
    if (tracers[i].ttl > 0) {
      // Thin out over its short life so the shot reads as a flash, not a beam.
      const thin = 0.045 * Math.max(0.2, tracers[i].ttl / 0.06);
      tracers[i].mesh.scale.x = tracers[i].mesh.scale.y = thin;
      continue;
    }
    if (tracers[i].mesh.parent) tracers[i].mesh.parent.remove(tracers[i].mesh);
    tracers.splice(i, 1);
  }
}

function applyHit(hit, pedDamage, vehicleDamage) {
  if (hit.kind === 'ped') hurtPed(hit.ref, pedDamage, player.pos);
  else if (hit.kind === 'officer') damageOfficer(hit.ref, pedDamage);
  else if (hit.kind === 'vehicle') {
    const wrecked = damageVehicle(hit.ref, vehicleDamage);
    if (wrecked) explodeVehicle(hit.ref);
  } else if (hit.kind === 'cop') damageCop(hit.ref, vehicleDamage);
}

function shoot(range, cone, pedDamage, vehicleDamage) {
  const hit = findHit(range, cone);
  if (hit) {
    fireTracer(hit.pos.x, 1.1, hit.pos.z);
    applyHit(hit, pedDamage, vehicleDamage);
  } else {
    // A miss still draws a tracer out to a readable distance.
    const reach = Math.min(range, 26);
    fireTracer(
      player.pos.x + facingX() * reach, 1.35, player.pos.z + facingZ() * reach,
    );
  }
}

function fistAttack() {
  let best = null;
  const consider = (kind, ref, pos) => {
    const dx = pos.x - player.pos.x;
    const dz = pos.z - player.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1.7) return;
    if (dist > 0.4 && angleDiff(Math.atan2(dx, dz), player.angle) > 1.1) return;
    if (!best || dist < best.dist) best = { kind, ref, pos, dist };
  };
  for (const ped of peds) {
    if (ped.mode !== 'down') consider('ped', ped, ped.pos);
  }
  for (const officer of officers) {
    if (officer.health === undefined || officer.health > 0) {
      consider('officer', officer, officer.pos);
    }
  }
  if (!best) return;
  if (best.kind === 'ped') hurtPed(best.ref, 18, player.pos);
  else damageOfficer(best.ref, 18);
  commitCrime(1, 'Assault', { pos: best.pos });
  sfx.punch();
}

function firePistol() {
  if (!useAmmo('pistol')) return;
  cooldown = 0.24;
  sfx.shot();
  commitCrime(2, 'Shots fired', { pos: player.pos });
  shoot(60, 0.12, 34, 12);
}

function fireSniper() {
  if (!useAmmo('sniper')) return;
  cooldown = 0.9;
  sfx.sniper();
  commitCrime(3, 'Sniper fire', { pos: player.pos });
  shoot(240, 0.03, 100, 25);
}

function useHealItem() {
  if (useSelected() === 'healed') sfx.pickup();
}

function useFireCan() {
  if (useSelected() !== 'fire') return;
  spawnFire(player.pos.x + facingX() * 2.2, player.pos.z + facingZ() * 2.2);
  sfx.hit();
}

export function updateCombat(dt, input, camera) {
  cooldown = Math.max(0, cooldown - dt);
  updateTracers(dt);
  const item = selectedItem();

  // The scope belongs to the sniper only; anything else clears it.
  if (item !== 'sniper' && G.scoped) setScoped(false);
  // Combat is on foot only: no shooting from a car or while swimming.
  if (G.driving || player.swimming) {
    if (G.scoped) setScoped(false);
    return;
  }

  if (item === 'pistol') {
    if (input.attackPressed && cooldown <= 0) firePistol();
  } else if (item === 'sniper') {
    // Holding aim raises the scope; releasing it drops the scope again.
    if (input.attackHeld && !G.scoped) setScoped(true);
    if (!input.attackHeld && G.scoped) setScoped(false);
    if (input.attackPressed && G.scoped && cooldown <= 0) fireSniper();
  } else if (item === 'medkit' || item === 'snack' || item === 'tonic') {
    if (input.attackPressed) useHealItem();
  } else if (item === 'firecan') {
    if (input.attackPressed) useFireCan();
  } else if (!item) {
    if (input.attackPressed && cooldown <= 0) {
      cooldown = 0.35;
      fistAttack();
    }
  }
}
