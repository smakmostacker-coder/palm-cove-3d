// Driving v2: E enters/exits the nearest vehicle of ANY class (car, moto,
// truck, police, firetruck); per-class arcade handling from config HANDLING —
// motos are fast and twitchy with the rider visible, trucks are slow, heavy
// and hit harder, police cars are quick pursuit sedans.
import { G } from './state.js';
import { TUNING, HANDLING } from './config.js';
import { collideBuildings, groundHeightAt } from './city.js';
import { parkedCars, trafficCars } from './traffic.js';
import { player, updateCamera } from './player.js';
import { sfx } from './audio.js';
import { commitCrime } from './police.js';

export function nearestStealable() {
  let best = null, bd = 4.6;
  for (const c of parkedCars) {
    if (c.taken || c.burnt) continue;
    const d = c.pos.distanceTo(player.pos);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
export function enterCar(car) {
  car.taken = true; G.driving = car; G.onFoot = false;
  car.speed = 0;
  // On a motorcycle Vera stays visible, seated over the bike; in enclosed
  // vehicles she disappears into the cabin as before.
  if (car.kind === 'moto') { player.mesh.visible = true; if (car.mesh.userData.rider) car.mesh.userData.rider.visible = false; }
  else player.mesh.visible = false;
  G.stats.stolen++;
  G.stats.byClass[car.kind] = (G.stats.byClass[car.kind] || 0) + 1;
  commitCrime(car.kind === 'police' || car.kind === 'firetruck' ? 2 : 1, 'Vehicle stolen');
  sfx.enter();
}
export function exitCar() {
  const car = G.driving; if (!car) return;
  car.taken = false; car.speed = 0;
  if (car.mesh.userData.rider) car.mesh.userData.rider.visible = true;
  player.pos.set(car.pos.x + 2.6, 0.3, car.pos.z);
  player.mesh.visible = true; G.driving = null; G.onFoot = true;
  sfx.enter();
}
let crashCooldown = 0;
export function updateDriving(dt, camera, onCrash) {
  const car = G.driving; if (!car) return;
  const H = HANDLING[car.kind] || HANDLING.car;
  const k = G.keys;
  const accel = k['KeyW'] || k['ArrowUp'] ? H.accel : 0;
  const brake = k['KeyS'] ? H.accel * 0.9 : 0;
  if (car.burning || car.burnt) { car.speed *= Math.max(0, 1 - 3 * dt); }
  else if (accel) car.speed = Math.min(H.max, car.speed + accel * dt);
  else if (brake) car.speed = Math.max(-H.reverse, car.speed - brake * dt);
  else { car.speed *= Math.max(0, 1 - 0.7 * dt); if (Math.abs(car.speed) < 0.05) car.speed = 0; }
  const steer = (k['KeyA'] ? 1 : 0) - (k['KeyD'] ? 1 : 0);
  if (car.speed !== 0) car.angle += steer * dt * H.turn * Math.sign(car.speed) * Math.min(1, Math.abs(car.speed) / 10);
  const fx = Math.sin(car.angle), fz = Math.cos(car.angle);
  car.pos.x += fx * car.speed * dt;
  car.pos.z += fz * car.speed * dt;
  G.stats.drivenKm += Math.abs(car.speed) * dt / 1000;
  const beforeX = car.pos.x, beforeZ = car.pos.z;
  collideBuildings(car.pos, car.kind === 'truck' || car.kind === 'firetruck' ? 2.2 : 1.6);
  crashCooldown -= dt;
  if ((beforeX !== car.pos.x || beforeZ !== car.pos.z) && Math.abs(car.speed) > 6 && crashCooldown <= 0) {
    crashCooldown = 0.8; car.health -= 8 * H.dmg; car.speed *= car.kind === 'truck' ? 0.4 : -0.25; onCrash && onCrash('building');
  }
  car.pos.y = groundHeightAt(car.pos.x, car.pos.z, Math.abs(Math.cos(car.angle)) >= Math.abs(Math.sin(car.angle)) ? 'z' : 'x');
  car.mesh.position.copy(car.pos);
  car.mesh.rotation.y = car.angle;
  for (const w of car.mesh.userData.wheels) w.rotation.x += car.speed * dt * 2.2;
  player.pos.copy(car.pos);
  if (car.kind === 'moto') { // rider sits on the bike, leaning with it
    player.mesh.position.set(car.pos.x, 0.55, car.pos.z);
    player.mesh.rotation.y = car.angle;
  }
  G.camYaw = Math.PI - car.angle; // chase cam: shared W-forward (sin,-cos) must equal car forward (sin,cos)
  updateCamera(dt, camera, car.pos, car.kind === 'moto' ? 8 : 11);
  if (car.health <= 0) { car.health = 0; car.speed = 0; }
}
export function vehicleHitCheck(onCrash) {
  const car = G.driving; if (!car || Math.abs(car.speed) < 3) return;
  if (crashCooldown > 0) return;
  const H = HANDLING[car.kind] || HANDLING.car;
  const others = [];
  for (const p of parkedCars) if (!p.taken && p !== car) others.push(p);
  for (const t of trafficCars) others.push({ pos: t.mesh.position, mesh: t.mesh, traffic: t, healthRef: t });
  for (const o of others) {
    const dx = car.pos.x - o.pos.x, dz = car.pos.z - o.pos.z;
    if (dx * dx + dz * dz < 9.5) {
      crashCooldown = 0.7; car.health -= 6 / H.dmg; car.speed *= car.kind === 'truck' || car.kind === 'firetruck' ? 0.65 : 0.3;
      if (o.traffic) { o.traffic.stopped = 1.5; o.traffic.health -= 10 * H.dmg; }
      else if (o.health !== undefined) o.health -= 8 * H.dmg;
      onCrash && onCrash('vehicle');
      return;
    }
  }
}
