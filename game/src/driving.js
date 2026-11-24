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
import { player, updateCamera, tickDragHold, dragHoldActive, wrapAngle } from './player.js';
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
  commitCrime(2, 'Carjacking'); // reported only if a police unit is within sight range (police.js)
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
  // an ordinary parked car only raises the stars if a police unit sees it.
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
// GAS boost: while Space (or the touch GAS button) is held, accel and
// top speed scale by this — a boosted car (22 × 1.55 ≈ 34) matches the
// old pre-retune pace. No fuel, no cooldown.
export const BOOST_MULT = 1.55;
// Per-axis analog deadzone, rescaled to 0..1 past it — the same 0.18 the
// on-foot joystick uses (player.js). Axes are read independently: stick
// X only steers, stick Y only throttles.
function joyAxis(v) {
  const a = Math.abs(v || 0);
  if (a <= 0.18) return 0;
  return Math.sign(v) * Math.min(1, (a - 0.18) / 0.82);
}
export function updateDriving(dt, camera, onCrash) {
  const car = G.driving;
  if (!car) return;
  const H = HANDLING[car.kind] || HANDLING.car;
  const k = G.keys;
  const boost = !!(k['Space'] || G.boostTouch);
  car.boosting = boost;
  const effAccel = H.accel * (boost ? BOOST_MULT : 1);
  const effMax = H.max * (boost ? BOOST_MULT : 1);
  const effReverse = H.reverse * (boost ? BOOST_MULT : 1);
  // Throttle in [-1, 1]: keyboard is binary (±1); the analog stick is
  // proportional — a small tilt asks for a small target speed and can
  // never pass the (unboosted) cap on its own. GAS is the only way past
  // base. Keyboard wins when both are present.
  let throttle = 0;
  if (k['KeyW'] || k['ArrowUp']) throttle = 1;
  else if (k['KeyS']) throttle = -1;
  else throttle = -joyAxis(G.joyVec ? G.joyVec.y : 0);
  if (car.burning || car.burnt) car.speed *= Math.max(0, 1 - 3 * dt);
  else if (throttle !== 0) {
    // Accelerate toward the throttle's target speed without overshoot:
    // full input reproduces the old accel ramp to the cap, partial stick
    // settles at throttle × cap, and releasing GAS eases a boosted car
    // back down to base instead of snapping.
    const target = throttle > 0 ? throttle * effMax : throttle * effReverse;
    const rate = effAccel * (throttle > 0 ? 1 : 0.9) * dt;
    car.speed += Math.max(-rate, Math.min(rate, target - car.speed));
  }
  else { car.speed *= Math.max(0, 1 - 0.7 * dt); if (Math.abs(car.speed) < 0.05) car.speed = 0; }
  // Steering in [-1, 1]: keyboard binary, stick X proportional (stick
  // right = KeyD = steer −1 in this convention).
  let steer = (k['KeyA'] ? 1 : 0) - (k['KeyD'] ? 1 : 0);
  if (steer === 0) steer = -joyAxis(G.joyVec ? G.joyVec.x : 0);
  if (car.speed !== 0) {
    // Speed-aware yaw: the old min(1, |speed|/10) factor gave the FULL
    // turn rate at any speed ≥ 10, which at the old 34 u/s was twitchy.
    // Now the rate still ramps in gently at crawl (precise parking), but
    // TAPERS above ~6 u/s, so at base top speed a held turn describes a
    // wide, stable arc instead of spinning the car around.
    const sp = Math.abs(car.speed);
    const taper = 1 / (1 + Math.max(0, sp - 6) / 10);
    car.angle += steer * dt * H.turn * Math.sign(car.speed) * Math.min(1, sp / 10) * taper;
  }
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
  // Chase camera: behind the car, using the same yaw convention and the
  // same composition as on foot. The drag hold ticks here too (updatePlayer
  // never runs while driving, so still exactly one decay per frame); while
  // a drag hold is active the yaw belongs to orbitCamera() — the player can
  // orbit manually while driving — and otherwise the yaw EASES behind the
  // car at the foot-follow rate instead of snapping to it every frame.
  tickDragHold(dt);
  if (!dragHoldActive()) {
    const want = Math.PI - car.angle;
    G.camYaw += wrapAngle(want - G.camYaw) * Math.min(1, dt * 3.0);
  }
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
