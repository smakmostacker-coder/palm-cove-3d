// Driving: E enters or leaves the nearest vehicle of any class; each class
// drives to its own handling line in config.js — motorcycles are fast and
// twitchy with the rider visible, trucks are slow, heavy and hit harder,
// police cars are quick pursuit sedans, the fire truck is a heavyweight.
//
// Impacts are honest now: buildings AND street props (trees, lamps, poles,
// signs, hydrants) stop the car. collideBuildings() reports whether the
// position had to be pushed out of a building; prop hits are detected by
// sampling collideProps() the same way. Either way a fast impact costs
// health, kills the speed (a glance or a bounce, class-dependent) and fires
// the crash callback — a car never ghosts through a tree.
import { G } from './state.js';
import { HANDLING } from './config.js';
import { collideBuildings, collideProps, groundHeightFor } from './city.js';
import { parkedCars, trafficCars, ejectDriver } from './traffic.js';
import { player, updateCamera } from './player.js';
import { sfx } from './audio.js';
import { commitCrime, jackableCop, onCopJacked, jackedCars } from './police.js';

export function nearestStealable() {
  let best = null, bd = 4.6;
  for (const c of parkedCars) {
    if (c.taken || c.burnt) continue;
    const d = c.pos.distanceTo(player.pos);
    if (d < bd) { bd = d; best = c; }
  }
  for (const c of jackedCars) { // a cop car the player took earlier, now parked
    if (c.taken || c.burnt) continue;
    const d = c.pos.distanceTo(player.pos);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// The occupied vehicle the player can carjack right now: an active police
// car (checked in police.js) or a traffic vehicle that is stopped or
// crawling — red light, jam, nudged to a halt — with the player standing
// at the driver's door. Moving traffic cannot be jacked.
const JACK_NAMES = { car: 'car', moto: 'motorcycle', truck: 'truck' };
export function nearestJackable() {
  if (G.driving) return null;
  const cop = jackableCop(player.pos);
  if (cop) return { car: cop, cop: true, name: 'police car' };
  let best = null, bd = 4.6;
  for (const c of trafficCars) {
    if (c.burnt || c.burning || (c.curSpeed || 0) > 2.5) continue;
    const d = c.pos.distanceTo(player.pos);
    if (d >= bd) continue;
    const ry = c.mesh.rotation.y, fx = Math.sin(ry), fz = Math.cos(ry);
    const side = (player.pos.x - c.pos.x) * fz - (player.pos.z - c.pos.z) * fx;
    if (side <= 0) continue; // the driver's door only
    bd = d; best = c;
  }
  return best ? { car: best, cop: false, name: JACK_NAMES[best.kind] || 'car' } : null;
}

// GTA-style jacking: the driver is pulled out onto the street (a police
// driver becomes a foot chaser and the theft is a three-star crime the
// moment it happens), then the player gets in and drives off through the
// ordinary enterCar path. A jacked traffic vehicle joins the parked pool
// once the player leaves it, exactly like a stolen parked car.
export function carjack(j) {
  const c = j.car;
  if (j.cop) {
    onCopJacked(c);
    enterCar(c);
    commitCrime(3, 'Police car jacked', { instant: true });
    return c;
  }
  ejectDriver(c);
  const i = trafficCars.indexOf(c);
  if (i >= 0) trafficCars.splice(i, 1);
  c.angle = c.mesh.rotation.y;
  c.speed = 0;
  parkedCars.push(c);
  enterCar(c);
  commitCrime(2, 'Carjacking', { victim: true });
  return c;
}

export function enterCar(car) {
  car.taken = true;
  G.driving = car;
  G.onFoot = false;
  car.speed = 0;
  // Clear the car's surface lock: the stateful ground sampler re-seeds
  // it from the car's heading on its first frame inside a band.
  car.surfMode = null;
  if (car.kind === 'moto') { // the lead stays visible, seated on the bike
    player.mesh.visible = true;
    if (car.mesh.userData.rider) car.mesh.userData.rider.visible = false;
  } else player.mesh.visible = false;
  G.stats.stolen++;
  G.stats.byClass[car.kind] = (G.stats.byClass[car.kind] || 0) + 1;
  // Stealing an emergency vehicle is reported by the station at once;
  // an ordinary parked car only raises the stars if somebody sees it.
  commitCrime(car.kind === 'police' || car.kind === 'firetruck' ? 2 : 1, 'Vehicle stolen',
    car.kind === 'police' || car.kind === 'firetruck' ? { instant: true } : undefined);
  sfx.enter();
}

export function exitCar() {
  const car = G.driving;
  if (!car) return;
  car.taken = false;
  car.speed = 0;
  if (car.mesh.userData.rider) car.mesh.userData.rider.visible = true;
  player.pos.set(car.pos.x + 2.6, 0.3, car.pos.z);
  // The player steps out onto whatever surface the car is on (deck
  // included) — hand the surface lock over with the position.
  player.surfMode = car.surfMode; player.surfY = car.surfY;
  player.mesh.visible = true;
  G.driving = null;
  G.onFoot = true;
  sfx.enter();
}

let crashCooldown = 0;
export function updateDriving(dt, camera, onCrash) {
  const car = G.driving;
  if (!car) return;
  const H = HANDLING[car.kind] || HANDLING.car;
  const k = G.keys;
  const accel = k['KeyW'] || k['ArrowUp'] ? H.accel : 0;
  const brake = k['KeyS'] ? H.accel * 0.9 : 0;
  if (car.burning || car.burnt) car.speed *= Math.max(0, 1 - 3 * dt);
  else if (accel) car.speed = Math.min(H.max, car.speed + accel * dt);
  else if (brake) car.speed = Math.max(-H.reverse, car.speed - brake * dt);
  else { car.speed *= Math.max(0, 1 - 0.7 * dt); if (Math.abs(car.speed) < 0.05) car.speed = 0; }
  const steer = (k['KeyA'] ? 1 : 0) - (k['KeyD'] ? 1 : 0);
  if (car.speed !== 0) car.angle += steer * dt * H.turn * Math.sign(car.speed) * Math.min(1, Math.abs(car.speed) / 10);
  const fx = Math.sin(car.angle), fz = Math.cos(car.angle);
  G.stats.drivenKm += Math.abs(car.speed) * dt / 1000;
  const radius = car.kind === 'truck' || car.kind === 'firetruck' ? 2.2 : 1.6;
  // Sub-step the move (hops of at most ~0.8 units, collision after each) so a
  // long frame at full speed can never jump a building or prop shell.
  const hops = Math.max(1, Math.ceil((Math.abs(car.speed) * dt) / 0.8));
  const hdt = dt / hops;
  let buildingHit = false, propHit = false;
  for (let h = 0; h < hops; h++) {
    car.pos.x += fx * car.speed * hdt;
    car.pos.z += fz * car.speed * hdt;
    const impact = collideBuildings(car.pos, radius);
    buildingHit = buildingHit || impact.building;
    propHit = propHit || impact.prop;
  }
  crashCooldown -= dt;
  if ((buildingHit || propHit) && Math.abs(car.speed) > 6 && crashCooldown <= 0) {
    crashCooldown = 0.8;
    car.health -= propHit ? 10 * H.dmg : 8 * H.dmg;
    // Heavy classes plough on slowly; light ones glance off backwards.
    car.speed *= car.kind === 'truck' || car.kind === 'firetruck' ? 0.4 : -0.25;
    onCrash && onCrash(propHit ? 'prop' : 'building');
  } else if (propHit && crashCooldown <= 0) {
    crashCooldown = 0.8;
    car.speed = 0; // a slow roll into a tree still stops the car
  }
  // Stateful surface (city.js groundHeightFor): the heading hint only
  // seeds the first sample inside a band; after that the car keeps the
  // surface it is on, so turning at the flyover crossing can no longer
  // snap it between deck and street mid-turn.
  car.pos.y = groundHeightFor(car, car.pos.x, car.pos.z, Math.abs(Math.cos(car.angle)) >= Math.abs(Math.sin(car.angle)) ? 'z' : 'x');
  car.mesh.position.copy(car.pos);
  car.mesh.rotation.y = car.angle;
  for (const w of car.mesh.userData.wheels) w.rotation.x += car.speed * dt * 2.2;
  player.pos.copy(car.pos);
  if (car.kind === 'moto') {
    player.mesh.position.set(car.pos.x, 0.55, car.pos.z);
    player.mesh.rotation.y = car.angle;
  }
  // Chase camera: behind the car, using the same yaw convention as on foot.
  G.camYaw = Math.PI - car.angle;
  updateCamera(dt, camera, car.pos, car.kind === 'moto' ? 8 : 11);
  if (car.health <= 0) { car.health = 0; car.speed = 0; }
}

export function vehicleHitCheck(onCrash) {
  const car = G.driving;
  if (!car || Math.abs(car.speed) < 3) return;
  if (crashCooldown > 0) return;
  const H = HANDLING[car.kind] || HANDLING.car;
  const others = [];
  for (const p of parkedCars) if (!p.taken && p !== car) others.push(p);
  for (const t of trafficCars) others.push({ pos: t.mesh.position, mesh: t.mesh, traffic: t, healthRef: t });
  for (const o of others) {
    const dx = car.pos.x - o.pos.x, dz = car.pos.z - o.pos.z;
    if (dx * dx + dz * dz < 9.5) {
      crashCooldown = 0.7;
      car.health -= 6 / H.dmg;
      car.speed *= car.kind === 'truck' || car.kind === 'firetruck' ? 0.65 : 0.3;
      if (o.traffic) { o.traffic.stopped = 1.5; o.traffic.health -= 10 * H.dmg; }
      else if (o.health !== undefined) o.health -= 8 * H.dmg;
      onCrash && onCrash('vehicle');
      return;
    }
  }
}
