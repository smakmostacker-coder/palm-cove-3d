// traffic.js - ambient traffic AI.
// Traffic cars are ordinary vehicles from driving.js with the
// 'traffic' driver flag; this module only decides where they go.

import { vehicles, spawnTrafficCar, steerVehicleForTraffic } from './driving.js';
import { CITY_ROADS_X, CITY_ROADS_Z, HIGHWAY, TOWNS } from './config.js';
import { G } from './state.js';
import { floatBetween, pickOne, chanceOf } from './random.js';

// Route target per vehicle, kept here because the vehicle record
// is shared with systems that do not care about routing.
const targets = new Map();
const CITY_CRUISE = 11;
const HIGHWAY_CRUISE = 16;
const CITY_LIMIT = 220;

function distanceTo(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function isInCity(pos) {
  return Math.abs(pos.x) < CITY_LIMIT && Math.abs(pos.z) < CITY_LIMIT;
}

function nearestOf(values, value) {
  let best = values[0];
  let bestGap = Math.abs(values[0] - value);
  for (let i = 1; i < values.length; i++) {
    const gap = Math.abs(values[i] - value);
    if (gap < bestGap) { best = values[i]; bestGap = gap; }
  }
  return best;
}

function setTarget(vehicle, x, z, highway) {
  targets.set(vehicle, { x, z, highway: Boolean(highway) });
}

// A point further along the car's own road, so a fresh spawn starts
// by driving its street instead of cutting across blocks.
function firstCityTarget(vehicle, vertical) {
  if (vertical) setTarget(vehicle, vehicle.pos.x, pickOne(CITY_ROADS_Z), false);
  else setTarget(vehicle, pickOne(CITY_ROADS_X), vehicle.pos.z, false);
}

// At an intersection, turn onto a perpendicular road: snap to the
// crossing, then aim along the crossing road to another junction.
function nextCityTarget(vehicle) {
  const crossX = nearestOf(CITY_ROADS_X, vehicle.pos.x);
  const crossZ = nearestOf(CITY_ROADS_Z, vehicle.pos.z);
  if (chanceOf(0.5)) setTarget(vehicle, pickOne(CITY_ROADS_X), crossZ, false);
  else setTarget(vehicle, crossX, pickOne(CITY_ROADS_Z), false);
}

// Highway cars run the road end to end and back past every town;
// jitter keeps them off a single rail line.
function nextHighwayTarget(vehicle, current) {
  const headingSouth = current && current.z > -2000;
  const endZ = headingSouth ? HIGHWAY.to + 50 : HIGHWAY.from - 40;
  setTarget(vehicle, HIGHWAY.x + floatBetween(-3, 3), endZ, true);
}

function pickNextTarget(vehicle) {
  const current = targets.get(vehicle);
  if (current && current.highway) nextHighwayTarget(vehicle, current);
  else if (isInCity(vehicle.pos)) nextCityTarget(vehicle);
  // Off both networks, route back to the highway to reconnect.
  else setTarget(vehicle, HIGHWAY.x, floatBetween(-400, 100), true);
}

// Teleport a far car back near the player, on a real road and never
// within 60 of them, so it never pops in right in front of anyone.
function respawnVehicle(vehicle, playerPos) {
  let x = playerPos.x;
  let z = playerPos.z - 300;
  let highway = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const ring = floatBetween(250, 400);
    const dir = chanceOf(0.5) ? -1 : 1;
    if (isInCity(playerPos) && chanceOf(0.6)) {
      if (chanceOf(0.5)) {
        x = nearestOf(CITY_ROADS_X, playerPos.x + dir * ring * 0.4);
        z = playerPos.z + dir * ring;
      } else {
        x = playerPos.x + dir * ring;
        z = nearestOf(CITY_ROADS_Z, playerPos.z + dir * ring * 0.4);
      }
      highway = false;
    } else {
      x = HIGHWAY.x + floatBetween(-3, 3);
      z = playerPos.z + dir * ring;
      highway = true;
    }
    if (distanceTo({ x, z }, playerPos) >= 60) break;
  }
  vehicle.pos.x = x;
  vehicle.pos.z = z;
  vehicle.speed = 0;
  vehicle.angle = highway && chanceOf(0.5) ? Math.PI : 0;
  vehicle.mesh.rotation.y = vehicle.angle;
  if (highway) setTarget(vehicle, HIGHWAY.x, vehicle.angle === Math.PI ? HIGHWAY.to + 50 : 150, true);
  else firstCityTarget(vehicle, chanceOf(0.5));
}

export function initTraffic(scene) {
  // Six cars working the city grid, split across both road axes.
  for (let i = 0; i < 6; i++) {
    const vertical = chanceOf(0.5);
    let car;
    if (vertical) {
      car = spawnTrafficCar(scene, pickOne(CITY_ROADS_X), floatBetween(-200, 200), chanceOf(0.5) ? 0 : Math.PI);
    } else {
      car = spawnTrafficCar(scene, floatBetween(-200, 200), pickOne(CITY_ROADS_Z), chanceOf(0.5) ? Math.PI / 2 : -Math.PI / 2);
    }
    firstCityTarget(car, vertical);
  }
  // Four highway cars spaced down the long road past the towns.
  const highwayZ = [-500, -1500, -2600, -3600];
  for (let i = 0; i < highwayZ.length; i++) {
    const southbound = i % 2 === 0;
    const car = spawnTrafficCar(scene, HIGHWAY.x + floatBetween(-3, 3), highwayZ[i], southbound ? Math.PI : 0);
    setTarget(car, HIGHWAY.x, southbound ? HIGHWAY.to + 50 : 150, true);
  }
}

export function updateTraffic(dt, playerPos) {
  if (dt <= 0 || !playerPos) return;
  // Anchor recycling on the driven car when there is one, so traffic
  // stays around the action instead of a parked player position.
  const anchor = G.driving ? G.driving.pos : playerPos;
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    if (v.driver !== 'traffic' || v.wrecked) continue;
    if (distanceTo(v.pos, anchor) > 700) respawnVehicle(v, anchor);
    let target = targets.get(v);
    if (!target) { pickNextTarget(v); target = targets.get(v); }
    let cruise = isInCity(v.pos) ? CITY_CRUISE : HIGHWAY_CRUISE;
    // Courtesy stop: the player inside the forward cone, close
    // ahead, makes the car wait for this frame instead of hitting.
    const toX = playerPos.x - v.pos.x;
    const toZ = playerPos.z - v.pos.z;
    const playerDist = Math.sqrt(toX * toX + toZ * toZ);
    if (playerDist > 0.01 && playerDist < 6.5) {
      const dot = (Math.sin(v.angle) * toX + Math.cos(v.angle) * toZ) / playerDist;
      if (dot > 0.8) cruise = 0;
    }
    const remaining = steerVehicleForTraffic(v, dt, target.x, target.z, cruise);
    if (remaining < 7) pickNextTarget(v);
  }
}

// Referenced so the town list stays part of this module's contract:
// highway routing is defined relative to those stops.
export const TRAFFIC_TOWNS = TOWNS;
