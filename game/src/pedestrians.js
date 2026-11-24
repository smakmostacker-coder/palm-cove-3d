// Ambient civilians: sidewalk beats in the city and towns, plus a few
// wanderers by the marina. They stroll until something scares or hurts them.

import { makePersonMesh, posePerson, collideWorld } from './city.js';
import { ROAD_W, CITY_ROADS_X, CITY_ROADS_Z, TOWNS } from './config.js';
import { floatBetween, intBetween, pickOne, chanceOf } from './random.js';

export const peds = [];

const SIDEWALK = ROAD_W / 2 + 2.5;

const SHIRTS = [0xff5252, 0xffb142, 0xf7e731, 0x2ed573, 0x1e90ff, 0x5352ed, 0xff6b81, 0xeccc68, 0x7bed9f, 0x70a1ff, 0xffffff, 0xff7f50];
const PANTS = [0x2f3542, 0x1e272e, 0x3b4a6b, 0x57606f, 0x2c3a4a, 0x4a3728, 0x222f3e];
const SKINS = [0xffd9b3, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0x6b4423];
const HAIR_STYLES = ['flat', 'bun', 'cap', 'ponytail', 'spiky'];
const HAIR_COLORS = [0x1a1a1a, 0x3b2a1a, 0x6b4423, 0xb58900, 0xd9d9d9, 0x8b2500];
const SHOE_COLORS = [0x222222, 0xffffff, 0x8b2500, 0x1e3799, 0xb33939];

function makePedMesh() {
  return makePersonMesh({
    shirt: pickOne(SHIRTS),
    pants: pickOne(PANTS),
    skin: pickOne(SKINS),
    hairStyle: pickOne(HAIR_STYLES),
    hairColor: pickOne(HAIR_COLORS),
    face: intBetween(0, 2),
    shoeColor: pickOne(SHOE_COLORS),
    shirtStyle: pickOne(['tee', 'shirt']),
  });
}

// A beat is one straight sidewalk run: the ped walks along `axis` while the
// other coordinate stays pinned to `line`, turning around at the segment ends.
function addPed(scene, opts) {
  const mesh = makePedMesh();
  const t = floatBetween(opts.segMin + 4, opts.segMax - 4);
  const ped = {
    mesh, pos: mesh.position, angle: 0,
    phase: floatBetween(0, Math.PI * 2),
    mode: 'stroll', health: 100, downTimer: 0, fleeTimer: 0,
    dirX: 0, dirZ: 1,
    area: opts.area, axis: opts.axis, line: opts.line, side: opts.side,
    t, dir: pickOne([-1, 1]), segMin: opts.segMin, segMax: opts.segMax,
  };
  if (ped.axis === 'z') ped.pos.set(ped.line, 0, t);
  else ped.pos.set(t, 0, ped.line);
  scene.add(mesh);
  peds.push(ped);
  return ped;
}

export function initPeds(scene) {
  peds.length = 0;
  // Southern city: stroll parallel to a road, offset onto its sidewalk.
  for (let i = 0; i < 28; i++) {
    const side = pickOne([-1, 1]);
    if (chanceOf(0.5) && CITY_ROADS_X.length) {
      const road = pickOne(CITY_ROADS_X);
      addPed(scene, {
        area: 'city', axis: 'z', line: road + side * SIDEWALK, side,
        segMin: -180, segMax: 180,
      });
    } else {
      const road = pickOne(CITY_ROADS_Z);
      addPed(scene, {
        area: 'city', axis: 'x', line: road + side * SIDEWALK, side,
        segMin: -180, segMax: 180,
      });
    }
  }
  // Towns: everyone walks the highway sidewalk that runs through town.
  for (const town of TOWNS) {
    for (let i = 0; i < 4; i++) {
      const side = pickOne([-1, 1]);
      addPed(scene, {
        area: town.name, axis: 'z', line: side * SIDEWALK, side,
        segMin: town.z - 65, segMax: town.z + 65,
      });
    }
  }
  // Marina / beach crowd near (170, 170).
  for (let i = 0; i < 4; i++) {
    addPed(scene, {
      area: 'marina', axis: 'x', line: 162 + i * 5, side: 1,
      segMin: 138, segMax: 202,
    });
  }
}

function startFlee(ped, fromPos, seconds) {
  ped.mode = 'flee';
  ped.fleeTimer = seconds;
  if (fromPos) {
    let dx = ped.pos.x - fromPos.x;
    let dz = ped.pos.z - fromPos.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    ped.dirX = dx;
    ped.dirZ = dz;
  }
}

export function hurtPed(ped, amount, fromPos) {
  ped.health -= amount;
  if (ped.health <= 0) {
    ped.mode = 'down';
    ped.downTimer = 6;
    return;
  }
  // Still standing: run from whatever just hurt them.
  startFlee(ped, fromPos, 2);
}

function strollPed(ped, dt) {
  ped.t += ped.dir * 2.2 * dt;
  if (ped.t >= ped.segMax) {
    ped.t = ped.segMax;
    ped.dir = -1;
    maybeCrossStreet(ped);
  } else if (ped.t <= ped.segMin) {
    ped.t = ped.segMin;
    ped.dir = 1;
    maybeCrossStreet(ped);
  }
  if (ped.axis === 'z') {
    ped.pos.x = ped.line;
    ped.pos.z = ped.t;
    ped.dirX = 0;
    ped.dirZ = ped.dir;
  } else {
    ped.pos.x = ped.t;
    ped.pos.z = ped.line;
    ped.dirX = ped.dir;
    ped.dirZ = 0;
  }
  ped.angle = Math.atan2(ped.dirX, ped.dirZ);
  ped.mesh.rotation.y = ped.angle;
  ped.phase += dt * 5;
  posePerson(ped.mesh, ped.phase, 'walk');
}

// At a city corner a ped sometimes swaps beats and crosses to the other axis.
function maybeCrossStreet(ped) {
  if (ped.area !== 'city' || !chanceOf(0.2)) return;
  const crossPos = ped.axis === 'z' ? ped.pos.x : ped.pos.z;
  ped.axis = ped.axis === 'z' ? 'x' : 'z';
  ped.line = crossPos;
  ped.t = ped.axis === 'z' ? ped.pos.z : ped.pos.x;
  ped.segMin = -180;
  ped.segMax = 180;
}

function fleePed(ped, dt) {
  ped.fleeTimer -= dt;
  ped.pos.x += ped.dirX * 8.5 * dt;
  ped.pos.z += ped.dirZ * 8.5 * dt;
  collideWorld(ped.pos, 0.4);
  ped.angle = Math.atan2(ped.dirX, ped.dirZ);
  ped.mesh.rotation.y = ped.angle;
  ped.phase += dt * 10;
  posePerson(ped.mesh, ped.phase, 'run');
  if (ped.fleeTimer <= 0) {
    // Back on the beat: re-derive the segment position from where they stopped.
    ped.mode = 'stroll';
    ped.t = ped.axis === 'z' ? ped.pos.z : ped.pos.x;
    ped.t = Math.max(ped.segMin + 1, Math.min(ped.segMax - 1, ped.t));
  }
}

function downPed(ped, dt) {
  ped.downTimer -= dt;
  ped.mesh.rotation.x = -1.5;
  ped.mesh.position.y = 0.25;
  if (ped.downTimer > 0) return;
  // Hurt but alive: get up at reduced health and run for it.
  ped.mesh.rotation.x = 0;
  ped.mesh.position.y = 0;
  ped.health = 40;
  ped.dirX = floatBetween(-1, 1);
  ped.dirZ = floatBetween(-1, 1);
  const len = Math.hypot(ped.dirX, ped.dirZ) || 1;
  ped.dirX /= len;
  ped.dirZ /= len;
  ped.mode = 'flee';
  ped.fleeTimer = 1.5;
}

export function updatePeds(dt, dangerPos) {
  for (const ped of peds) {
    if (ped.mode === 'down') {
      downPed(ped, dt);
      continue;
    }
    if (dangerPos && ped.mode !== 'flee') {
      const dx = ped.pos.x - dangerPos.x;
      const dz = ped.pos.z - dangerPos.z;
      if (dx * dx + dz * dz < 12 * 12) startFlee(ped, dangerPos, 3);
    }
    if (ped.mode === 'flee') fleePed(ped, dt);
    else strollPed(ped, dt);
  }
}
