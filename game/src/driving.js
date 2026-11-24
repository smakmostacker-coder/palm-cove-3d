// driving.js - vehicles, player driving, and traffic steering helper.
// Vehicles move every frame, so they never register static colliders;
// collision is resolved per-frame against the world in city.js.

import { G } from './state.js';
import {
  TUNING,
  VEHICLE_TYPES,
  TOWNS,
  FIRE_STATION,
  MARINA,
} from './config.js';
import { makeCarMesh, collideWorld, floorHeight } from './city.js';
import { commitCrime } from './police.js';
import { sfx } from './audio.js';
import { floatBetween, pickOne, chanceOf } from './random.js';

// Every live vehicle in the world, parked, traffic, and player-driven.
export const vehicles = [];

// Paint palette shared by parked and traffic spawns so the city does
// not end up as a row of identical sedans.
const PAINT_COLORS = [
  0xd94f3d,
  0x3d7bd9,
  0xf2c230,
  0x39b56a,
  0xe8e4da,
  0x22242a,
  0x8e44ad,
  0xec7a1e,
  0x17a2a8,
  0xc0c6cc,
  0x7a4a21,
  0xd96aa0,
];

// Service liveries are fixed, not drawn from the civilian palette.
const FIRE_COLOR = 0xc0271b;

function clamp(value, lo, hi) {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

// Move a scalar toward a target by at most step, never overshooting,
// so acceleration and braking feel linear instead of snapping.
function approach(value, target, step) {
  if (value < target) return Math.min(target, value + step);
  if (value > target) return Math.max(target, value - step);
  return target;
}

// Wrap an angle into -PI..PI so steering always takes the short way.
function wrapAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Forward on the ground plane for a yaw angle; the car meshes are
// modelled facing +Z, which is why x uses sin and z uses cos.
function forwardOf(angle) {
  return { x: Math.sin(angle), z: Math.cos(angle) };
}

function spinWheels(vehicle, dt) {
  const wheels = vehicle.mesh.userData.wheels;
  if (!wheels) return;
  const spin = vehicle.speed * dt * 2;
  for (let i = 0; i < wheels.length; i++) {
    wheels[i].rotation.x += spin;
  }
}

// Ground the mesh with a little smoothing so ramps, bridges, and
// floor changes do not pop the car in a single frame.
function groundMesh(vehicle, dt) {
  const pos = vehicle.mesh.position;
  const targetY = floorHeight(pos.x, pos.z, pos.y);
  if (dt > 0) {
    const blend = Math.min(1, dt * 12);
    pos.y += (targetY - pos.y) * blend;
  } else {
    pos.y = targetY;
  }
}

function randomPaint() {
  return pickOne(PAINT_COLORS);
}

// Internal spawn helper: builds the mesh, places it on the ground,
// and registers the vehicle record. Shared by every spawn path.
function makeVehicle(scene, type, x, z, angle, color) {
  const def = VEHICLE_TYPES[type] || VEHICLE_TYPES.car;
  const isPolice = type === 'police';
  const isFire = type === 'firetruck';
  const paint = color !== undefined ? color : randomPaint();
  const mesh = makeCarMesh(paint, {
    kind: type,
    lightbar: isPolice,
    cabColor: isFire ? FIRE_COLOR : undefined,
  });
  mesh.position.set(x, floorHeight(x, z, 0), z);
  mesh.rotation.y = angle;
  scene.add(mesh);
  const vehicle = {
    mesh,
    pos: mesh.position,
    angle,
    speed: 0,
    type,
    def,
    driver: null,
    health: 100,
    wrecked: false,
  };
  vehicles.push(vehicle);
  return vehicle;
}

// Parked stock for the whole map: boulevard, towns, marina, club,
// garage, and the fire station appliance.
export function spawnVehicles(scene) {
  // Boulevard parking lanes: seven a side, nose-in along the kerb so
  // the player can always find a first car within a short walk.
  for (let i = 0; i < 7; i++) {
    const x = -168 + i * 52 + floatBetween(-6, 6);
    makeVehicle(scene, 'car', x, 10.5, Math.PI / 2, randomPaint());
  }
  for (let i = 0; i < 7; i++) {
    const x = -144 + i * 52 + floatBetween(-6, 6);
    makeVehicle(scene, 'car', x, -10.5, -Math.PI / 2, randomPaint());
  }

  // One row per town on the main street edges, angled with the road
  // so the highway towns do not look empty on a drive-through.
  for (let t = 0; t < TOWNS.length; t++) {
    const town = TOWNS[t];
    for (let i = 0; i < 3; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * 10.5;
      const z = town.z - 24 + i * 24 + floatBetween(-3, 3);
      const angle = side < 0 ? Math.PI : 0;
      makeVehicle(scene, 'car', x, z, angle, randomPaint());
    }
  }

  // Marina pair, parked facing the water.
  makeVehicle(scene, 'car', MARINA.x - 14, MARINA.z - 18, Math.PI, randomPaint());
  makeVehicle(scene, 'car', MARINA.x - 8, MARINA.z - 18, Math.PI, randomPaint());

  // Two motorbikes near the club; bikes are the fast, fragile option
  // and belong where a quick getaway is thematically likely.
  makeVehicle(scene, 'moto', 46, -86, floatBetween(-0.4, 0.4), randomPaint());
  makeVehicle(scene, 'moto', 49, -84, floatBetween(-0.4, 0.4), randomPaint());

  // The garage truck: slow and tough, useful as a battering ram.
  makeVehicle(scene, 'truck', 82, 82, Math.PI / 4, randomPaint());

  // The fire appliance lives at its station, ready to be borrowed
  // at the higher wanted price enterVehicle charges for it.
  makeVehicle(scene, 'firetruck', FIRE_STATION.x, FIRE_STATION.z, Math.PI, FIRE_COLOR);
}

// Traffic cars are ordinary vehicles whose driver flag hands their
// steering over to traffic.js instead of the player input path.
export function spawnTrafficCar(scene, x, z, angle) {
  const type = chanceOf(0.18) ? 'moto' : 'car';
  const vehicle = makeVehicle(scene, type, x, z, angle, randomPaint());
  vehicle.driver = 'traffic';
  return vehicle;
}

// Nearest usable vehicle to a point. Player-driven and wrecked cars
// are excluded: one is already taken, the other will never move.
export function nearestVehicle(pos, maxDist) {
  let best = null;
  let bestDist = maxDist;
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    if (v.wrecked) continue;
    if (v.driver === 'player') continue;
    const dx = v.pos.x - pos.x;
    const dz = v.pos.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= bestDist) {
      best = v;
      bestDist = dist;
    }
  }
  return best;
}

// Taking a car is always reported; the label and star count depend
// on whether someone was driving it and on what kind of vehicle it
// is, and those reporting rules are applied here at the call site.
export function enterVehicle(v, playerPos) {
  if (!v || v.wrecked) return false;
  if (v.driver === 'traffic') {
    commitCrime(2, 'Carjacking', { pos: playerPos });
  } else if (v.driver === null) {
    if (v.type === 'firetruck' || v.type === 'police') {
      commitCrime(3, 'Vehicle stolen', { pos: playerPos });
    } else {
      commitCrime(2, 'Vehicle stolen', { pos: playerPos });
    }
  }
  v.driver = 'player';
  v.speed = 0;
  G.driving = v;
  G.stats.carsStolen += 1;
  sfx.door();
  return true;
}

// Leave the player standing beside the car's left side, clear of
// the bodywork, so exiting never drops them inside another mesh.
export function exitVehicle() {
  const v = G.driving;
  if (!v) return null;
  const fwd = forwardOf(v.angle);
  // Left of the facing direction, offset enough to clear the door.
  const left = { x: fwd.z, z: -fwd.x };
  const exitPos = {
    x: v.pos.x + left.x * 2.2,
    z: v.pos.z + left.z * 2.2,
  };
  v.driver = null;
  v.speed = 0;
  G.driving = null;
  sfx.door();
  return exitPos;
}

// Shared damage path for impacts and any other harm. Wrecking is a
// one-way transition, reported once by returning true on that call.
export function damageVehicle(v, amount) {
  if (!v || v.wrecked || amount <= 0) return false;
  v.health -= amount;
  if (v.health > 0) return false;
  v.health = 0;
  v.wrecked = true;
  v.speed = 0;
  // Darken the bodywork so a wreck reads as burnt-out at a glance;
  // traverse defensively because mesh internals belong to city.js.
  v.mesh.traverse((child) => {
    if (child.isMesh && child.material && child.material.color) {
      child.material = child.material.clone();
      child.material.color.multiplyScalar(0.3);
    }
  });
  return true;
}

// Steer a traffic vehicle toward a target point at a cruise speed.
// Mirrors the player path's speed-tapered steering so ambient cars
// corner with the same feel as the one the player is driving.
export function steerVehicleForTraffic(v, dt, tx, tz, cruise) {
  const dx = tx - v.pos.x;
  const dz = tz - v.pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (v.wrecked || dt <= 0) return dist;

  // Accelerate toward cruise; a cruise of zero is a full stop.
  const accel = v.def.accel * 0.7;
  v.speed = approach(v.speed, cruise, accel * dt);

  // Turn toward the target, capped by the same taper as the player
  // path so fast cars cannot pivot on the spot.
  if (Math.abs(v.speed) > 0.05 && dist > 0.01) {
    const desired = Math.atan2(dx, dz);
    const diff = wrapAngle(desired - v.angle);
    const yawRate = v.def.turnRate / (1 + Math.abs(v.speed) * 0.055);
    const maxTurn = yawRate * dt;
    v.angle += clamp(diff, -maxTurn, maxTurn);
  }

  const fwd = forwardOf(v.angle);
  const intendedX = v.pos.x + fwd.x * v.speed * dt;
  const intendedZ = v.pos.z + fwd.z * v.speed * dt;
  v.pos.x = intendedX;
  v.pos.z = intendedZ;

  // A solid hit kills traffic momentum outright; sliding along a
  // wall would look like the AI is grinding its way through town.
  const hit = collideWorld(v.pos, 1.5);
  const shifted =
    Math.abs(v.pos.x - intendedX) > 0.05 || Math.abs(v.pos.z - intendedZ) > 0.05;
  if ((hit === true || shifted) && Math.abs(v.speed) > 3) {
    v.speed = 0;
  }

  groundMesh(v, dt);
  spinWheels(v, dt);
  v.mesh.rotation.y = v.angle;

  const ndx = tx - v.pos.x;
  const ndz = tz - v.pos.z;
  return Math.sqrt(ndx * ndx + ndz * ndz);
}

// Player driving, one frame. Input is already normalised by the
// caller: throttle and steer in -1..1, boost as a held flag.
export function updateDriving(dt, input) {
  const v = G.driving;
  if (!v || dt <= 0) return;
  if (v.wrecked) {
    v.speed = 0;
    return;
  }
  const def = v.def;
  const throttle = clamp(input.throttle || 0, -1, 1);
  const steer = clamp(input.steer || 0, -1, 1);
  const boosting = Boolean(input.boost) && throttle > 0;

  // Boost stretches both how hard the car pulls and where it tops
  // out; reverse is never boosted, it stays a careful manoeuvre.
  const boostMult = boosting ? TUNING.boostMultiplier : 1;
  let target = 0;
  if (throttle >= 0) {
    target = throttle * def.topSpeed * boostMult;
  } else {
    target = throttle * def.reverseSpeed;
  }
  const accelRate = def.accel * boostMult;
  v.speed = approach(v.speed, target, accelRate * dt);

  // Steering authority fades with speed, and reversing flips the
  // yaw sign so backing up steers the way a real car does.
  if (Math.abs(v.speed) > 0.05) {
    const yawRate = steer * def.turnRate / (1 + Math.abs(v.speed) * 0.055);
    v.angle += yawRate * dt * Math.sign(v.speed);
  }

  const fwd = forwardOf(v.angle);
  const intendedX = v.pos.x + fwd.x * v.speed * dt;
  const intendedZ = v.pos.z + fwd.z * v.speed * dt;
  v.pos.x = intendedX;
  v.pos.z = intendedZ;

  // Impact cost scales with the vehicle's own damage factor, then
  // the car rebounds instead of sticking to whatever it hit.
  const hit = collideWorld(v.pos, 1.5);
  const shifted =
    Math.abs(v.pos.x - intendedX) > 0.05 || Math.abs(v.pos.z - intendedZ) > 0.05;
  if (hit === true || shifted) {
    const impact = Math.abs(v.speed);
    if (impact > 0.5) {
      damageVehicle(v, impact * def.damage * 0.8);
      if (impact > 6) sfx.hit();
      v.speed = -0.25 * v.speed;
    }
  }

  groundMesh(v, dt);
  spinWheels(v, dt);
  v.mesh.rotation.y = v.angle;

  // Odometer for the run stats, in kilometres.
  G.stats.distanceKm += Math.abs(v.speed) * dt / 1000;

  // Keep the record's cached angle honest for other systems.
  v.angle = wrapAngle(v.angle);
}

// A jacked police car is built by police.js, but it must join the
// shared vehicle registry so the driving physics and traffic logic
// can see it. Fill in any defaults its builder left out, then adopt
// the record as-is so its mesh and identity stay the same object.
export function adoptVehicle(obj) {
  if (!obj) return obj;
  obj.def = obj.def || VEHICLE_TYPES[obj.type] || VEHICLE_TYPES.car;
  if (obj.driver === undefined) obj.driver = null;
  if (obj.speed === undefined) obj.speed = 0;
  if (obj.health === undefined) obj.health = 100;
  if (obj.wrecked === undefined) obj.wrecked = false;
  if (obj.exploded === undefined) obj.exploded = false;
  if (!vehicles.includes(obj)) vehicles.push(obj);
  return obj;
}
