// Driving: E enters/exits the nearest car (stealing it), arcade physics,
// chase camera, and damage from impacts.
import { G } from './state.js';
import { TUNING } from './config.js';
import { collideBuildings } from './city.js';
import { parkedCars, trafficCars } from './traffic.js';
import { player, updateCamera } from './player.js';
import { sfx } from './audio.js';
import { commitCrime } from './police.js';

export function nearestStealable() {
  let best = null, bd = 4.2;
  for (const c of parkedCars) {
    if (c.taken) continue;
    const d = c.pos.distanceTo(player.pos);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
export function enterCar(car) {
  car.taken = true; G.driving = car; G.onFoot = false;
  car.speed = 0; player.mesh.visible = false;
  G.stats.stolen++; commitCrime(1, 'Car stolen');
  sfx.enter();
}
export function exitCar() {
  const car = G.driving; if (!car) return;
  car.taken = false; car.speed = 0;
  player.pos.set(car.pos.x + 2.6, 0.3, car.pos.z);
  player.mesh.visible = true; G.driving = null; G.onFoot = true;
  sfx.enter();
}
let crashCooldown = 0;
export function updateDriving(dt, camera, onCrash) {
  const car = G.driving; if (!car) return;
  const k = G.keys;
  const accel = k['KeyW'] || k['ArrowUp'] ? TUNING.carAccel : 0;
  const brake = k['KeyS'] ? TUNING.carAccel * 0.9 : 0;
  if (accel) car.speed = Math.min(TUNING.carMax, car.speed + accel * dt);
  else if (brake) car.speed = Math.max(-TUNING.carReverse, car.speed - brake * dt);
  else { car.speed *= Math.max(0, 1 - 0.7 * dt); if (Math.abs(car.speed) < 0.05) car.speed = 0; }
  const steer = (k['KeyA'] ? 1 : 0) - (k['KeyD'] ? 1 : 0);
  if (car.speed !== 0) car.angle += steer * dt * 1.7 * Math.sign(car.speed) * Math.min(1, Math.abs(car.speed) / 10);
  const fx = Math.sin(car.angle), fz = Math.cos(car.angle);
  car.pos.x += fx * car.speed * dt;
  car.pos.z += fz * car.speed * dt;
  G.stats.drivenKm += Math.abs(car.speed) * dt / 1000;
  const beforeX = car.pos.x, beforeZ = car.pos.z;
  collideBuildings(car.pos, 1.6);
  crashCooldown -= dt;
  if ((beforeX !== car.pos.x || beforeZ !== car.pos.z) && Math.abs(car.speed) > 6 && crashCooldown <= 0) {
    crashCooldown = 0.8; car.health -= 8; car.speed *= -0.25; onCrash && onCrash('building');
  }
  // Collisions with other vehicles and pedestrians are checked in main via these lists.
  car.mesh.position.copy(car.pos); car.mesh.position.y = 0;
  car.mesh.rotation.y = car.angle;
  for (const w of car.mesh.userData.wheels) w.rotation.x += car.speed * dt * 2.2;
  player.pos.copy(car.pos);
  G.camYaw = Math.PI - car.angle; // chase cam: shared W-forward (sin,-cos) must equal car forward (sin,cos)
  updateCamera(dt, camera, car.pos, 11);
  if (car.health <= 0) { car.health = 0; car.speed = 0; }
}
export function vehicleHitCheck(onCrash) {
  const car = G.driving; if (!car || Math.abs(car.speed) < 3) return;
  if (crashCooldown > 0) return;
  const others = [];
  for (const p of parkedCars) if (!p.taken && p !== car) others.push(p);
  for (const t of trafficCars) others.push({ pos: t.mesh.position, mesh: t.mesh, traffic: t });
  for (const o of others) {
    const dx = car.pos.x - o.pos.x, dz = car.pos.z - o.pos.z;
    if (dx * dx + dz * dz < 9.5) {
      crashCooldown = 0.7; car.health -= 6; car.speed *= 0.3;
      if (o.traffic) { o.traffic.stopped = 1.5; o.traffic.health -= 10; }
      onCrash && onCrash('vehicle');
      return;
    }
  }
}
