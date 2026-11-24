// city.js — world geometry for Palm Cove.
// Built in stages: this file owns the land shape, the collider registry,
// the flyover height profile, and every static mesh the player can see.
// Later stages add buildings, dressing, and the car / person factories.
//
// THREE is a global supplied by a vendor script tag, so it is never
// imported here; only our own modules come in through relative paths.

import {
  TUNING,
  CITY_ROADS_X,
  CITY_ROADS_Z,
  ROAD_W,
  HIGHWAY,
  TOWNS,
  KEY_TOWN,
  HOME,
  POLICE_STATION,
  HOSPITAL_POS,
  FIRE_STATION,
  MARINA,
  GARAGE,
  PRISON,
  FACILITIES,
  PLACES,
} from './config.js';

import {
  seedWith,
  nextFloat,
  floatBetween,
  intBetween,
  pickOne,
  chanceOf,
  shuffled,
} from './random.js';

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------
// A single fixed seed drives every placement decision in this module, so
// two loads of the game always produce the same city. buildWorld reseeds
// at its start because other systems may have drawn from the shared
// generator between module load and world construction.
const WORLD_SEED = 20261124;
seedWith(WORLD_SEED);

// ---------------------------------------------------------------------------
// Land shape
// ---------------------------------------------------------------------------
// The peninsula runs along Z: the city sits near z 0, the highway climbs
// north to negative z, and Key Solano hangs off the southern causeway.
// Width is generous around the city and pinches gently toward the far
// north so the drive up-state feels like a real narrowing coastline.

const LAND_SOUTH_Z = 205;
const LAND_NORTH_Z = -4450;
const LAND_WIDE = 190;
const LAND_NARROW = 120;
const TAPER_START_Z = -300;
const TAPER_END_Z = -4400;

export function landHalfWidth(z) {
  if (z >= TAPER_START_Z) return LAND_WIDE;
  if (z <= TAPER_END_Z) return LAND_NARROW;
  // Smoothstep, not linear: a kink in the coastline would show as a
  // visible corner in the sand underlay where the taper begins.
  const t = (TAPER_START_Z - z) / (TAPER_START_Z - TAPER_END_Z);
  const s = t * t * (3 - 2 * t);
  return LAND_WIDE + (LAND_NARROW - LAND_WIDE) * s;
}

const CAUSEWAY_HALF = 15;
const CAUSEWAY_NORTH_Z = 205;
const CAUSEWAY_SOUTH_Z = 430;
const KEY_TOWN_RADIUS = 55;

export function isLand(x, z) {
  // Main peninsula body.
  if (z >= LAND_NORTH_Z && z <= LAND_SOUTH_Z) {
    if (Math.abs(x) <= landHalfWidth(z)) return true;
  }
  // Causeway strip: narrow, but it is the only way south by road.
  if (z >= CAUSEWAY_NORTH_Z && z <= CAUSEWAY_SOUTH_Z) {
    if (Math.abs(x) <= CAUSEWAY_HALF) return true;
  }
  // Key Solano blob at the end of the causeway.
  const kdx = x - KEY_TOWN.x;
  const kdz = z - KEY_TOWN.z;
  if (kdx * kdx + kdz * kdz <= KEY_TOWN_RADIUS * KEY_TOWN_RADIUS) return true;
  return false;
}

// Approximate distance from a point to the nearest land. The swim logic
// only needs a believable bound, not a survey-grade measurement, so this
// takes the cheapest of three estimates: peninsula edge, causeway edge,
// and the Key Solano circle. Points on land report 0.
export function shoreDistance(x, z) {
  if (isLand(x, z)) return 0;
  let best = Infinity;

  // Peninsula: mostly an east-west overshoot once z is in range, plus a
  // north/south overshoot when the point sits past either tip.
  {
    const half = landHalfWidth(
      Math.max(LAND_NORTH_Z, Math.min(LAND_SOUTH_Z, z)),
    );
    const dx = Math.max(0, Math.abs(x) - half);
    let dz = 0;
    if (z > LAND_SOUTH_Z) dz = z - LAND_SOUTH_Z;
    else if (z < LAND_NORTH_Z) dz = LAND_NORTH_Z - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < best) best = d;
  }

  // Causeway: a thin rectangle, so clamp into it and measure the gap.
  {
    const cx = Math.max(-CAUSEWAY_HALF, Math.min(CAUSEWAY_HALF, x));
    const cz = Math.max(
      CAUSEWAY_NORTH_Z,
      Math.min(CAUSEWAY_SOUTH_Z, z),
    );
    const dx = x - cx;
    const dz = z - cz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < best) best = d;
  }

  // Key Solano: radial distance outside the disc.
  {
    const dx = x - KEY_TOWN.x;
    const dz = z - KEY_TOWN.z;
    const d = Math.sqrt(dx * dx + dz * dz) - KEY_TOWN_RADIUS;
    if (d > 0 && d < best) best = d;
  }

  return best === Infinity ? 0 : best;
}

// ---------------------------------------------------------------------------
// Colliders
// ---------------------------------------------------------------------------
// Two flat registries keep collision allocation-light: plain objects in
// plain arrays, no per-frame construction. Buildings, trees, lamps and
// props register themselves here while the world is being built, and
// every mover (player, pedestrian, car) resolves against the same lists.

const boxColliders = [];
const circleColliders = [];

export function registerBox(minX, maxX, minZ, maxZ) {
  boxColliders.push({ minX, maxX, minZ, maxZ });
}

export function registerCircle(x, z, r) {
  circleColliders.push({ x, z, r });
}

export function colliderCounts() {
  return { boxes: boxColliders.length, circles: circleColliders.length };
}

// Push `pos` (anything with numeric x/z) out of every registered solid.
// Returns true when at least one collider had to be resolved, which the
// callers use to stop sliding sounds, cancel a step, and so on.
export function collideWorld(pos, radius) {
  let hit = false;
  const r = radius > 0 ? radius : 0;

  for (let i = 0; i < boxColliders.length; i++) {
    const b = boxColliders[i];
    // Nearest point of the box to the mover.
    const cx = pos.x < b.minX ? b.minX : pos.x > b.maxX ? b.maxX : pos.x;
    const cz = pos.z < b.minZ ? b.minZ : pos.z > b.maxZ ? b.maxZ : pos.z;
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;

    if (d2 > 0) {
      if (d2 >= r * r) continue;
      // Outside but overlapping: slide out along the contact normal.
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      pos.x += dx * push;
      pos.z += dz * push;
      hit = true;
      continue;
    }

    // Centre is inside the box: exit through the nearest face, because
    // the contact normal is undefined when the clamp is the point itself.
    const toMinX = pos.x - b.minX;
    const toMaxX = b.maxX - pos.x;
    const toMinZ = pos.z - b.minZ;
    const toMaxZ = b.maxZ - pos.z;
    let smallest = toMinX;
    let axis = 0; // 0 minX, 1 maxX, 2 minZ, 3 maxZ
    if (toMaxX < smallest) { smallest = toMaxX; axis = 1; }
    if (toMinZ < smallest) { smallest = toMinZ; axis = 2; }
    if (toMaxZ < smallest) { smallest = toMaxZ; axis = 3; }
    if (axis === 0) pos.x = b.minX - r;
    else if (axis === 1) pos.x = b.maxX + r;
    else if (axis === 2) pos.z = b.minZ - r;
    else pos.z = b.maxZ + r;
    hit = true;
  }

  for (let i = 0; i < circleColliders.length; i++) {
    const c = circleColliders[i];
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const rr = r + c.r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) continue;
    if (d2 > 0.000001) {
      const d = Math.sqrt(d2);
      const push = (rr - d) / d;
      pos.x += dx * push;
      pos.z += dz * push;
    } else {
      // Dead centre on the pole: any direction out is equally right.
      pos.x = c.x + rr;
    }
    hit = true;
  }

  return hit;
}

// ---------------------------------------------------------------------------
// Flyover
// ---------------------------------------------------------------------------
// An elevated deck rides above the x=75 north-south road through the
// city. Ramps climb from ground level at |z| 160 to the full deck height
// at |z| 120; the middle span is flat. Traffic below must ignore the
// deck, which is why floorHeight takes a height hint: only a mover that
// is already up near deck level gets the deck as its floor.

const FLYOVER_X = 75;
const FLYOVER_HALF_W = 7;
const FLYOVER_END_Z = 160;
const FLYOVER_RAMP_Z = 120;
const FLYOVER_DECK_H = 6;

function flyoverDeckHeight(z) {
  const az = Math.abs(z);
  if (az >= FLYOVER_END_Z) return 0;
  if (az <= FLYOVER_RAMP_Z) return FLYOVER_DECK_H;
  const t = (FLYOVER_END_Z - az) / (FLYOVER_END_Z - FLYOVER_RAMP_Z);
  return FLYOVER_DECK_H * t;
}

export function floorHeight(x, z, yHint) {
  if (Math.abs(x - FLYOVER_X) < FLYOVER_HALF_W) {
    if (z > -FLYOVER_END_Z && z < FLYOVER_END_Z) {
      // Below the hint threshold the mover is under the deck, so its
      // floor stays the street; above it, the deck is the floor.
      if (yHint !== undefined && yHint !== null && yHint > 3) {
        return flyoverDeckHeight(z);
      }
      return 0;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Shared mesh helpers
// ---------------------------------------------------------------------------
// Materials are cached by colour because the city builds hundreds of
// boxes; sharing one MeshLambertMaterial per colour keeps the draw setup
// cheap and the palette consistent.

const materialCache = new Map();

function mat(color, opts) {
  const key = opts ? color + ':' + JSON.stringify(opts) : String(color);
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial(Object.assign({ color }, opts || {}));
    materialCache.set(key, m);
  }
  return m;
}

const unitBox = () => new THREE.BoxGeometry(1, 1, 1);

// A scaled unit box is the workhorse of the whole city: one geometry,
// many sizes, positioned by centre.
function addBox(parent, w, h, d, x, y, z, material, ry) {
  const mesh = new THREE.Mesh(unitBox(), material);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  if (ry) mesh.rotation.y = ry;
  parent.add(mesh);
  return mesh;
}

// Flat ground slab: a box so thin it reads as a surface, but with a real
// top face at exactly the requested height.
function addSlab(parent, w, d, x, y, z, material) {
  return addBox(parent, w, 0.04, d, x, y, z, material, 0);
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

const COLOUR_WATER = 0x0d4d73;
const COLOUR_GRASS = 0x4d8f3f;
const COLOUR_SAND = 0xd9c184;
const COLOUR_ASPHALT = 0x2e2e33;
const COLOUR_ASPHALT_TOWN = 0x35353b;
const COLOUR_SIDEWALK = 0xb9b4a6;
const COLOUR_MEDIAN = 0x8f9a6a;
const COLOUR_DASH = 0xf2ead2;

// Sampled peninsula outline in world coordinates. The step is coarse out
// at sea-scale distances and that is fine: the coast only has to read as
// a smooth taper from the air and from the shore.
function peninsulaOutline(expand) {
  const pts = [];
  const step = 125;
  // West coast, south tip to north tip.
  for (let z = LAND_SOUTH_Z + expand; z >= LAND_NORTH_Z - expand; z -= step) {
    pts.push({ x: -(landHalfWidth(z) + expand), z });
  }
  // North cap, west to east.
  pts.push({ x: 0, z: LAND_NORTH_Z - expand - 10 });
  // East coast, north tip back to south tip.
  for (let z = LAND_NORTH_Z - expand; z <= LAND_SOUTH_Z + expand; z += step) {
    pts.push({ x: landHalfWidth(z) + expand, z });
  }
  return pts;
}

// ShapeGeometry lives in XY; rotating -90 degrees about X lays it flat
// with shape Y becoming world -Z, so points are fed in as (x, -z).
function outlineMesh(pts, y, material) {
  const shape = new THREE.Shape();
  for (let i = 0; i < pts.length; i++) {
    const sx = pts[i].x;
    const sy = -pts[i].z;
    if (i === 0) shape.moveTo(sx, sy);
    else shape.lineTo(sx, sy);
  }
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

function flatDisc(radius, y, material, x, z) {
  const geo = new THREE.CircleGeometry(radius, 40);
  const mesh = new THREE.Mesh(geo, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

let waterMesh = null;

function buildTerrain(parent) {
  // Sea first: everything the land does not cover is water, and the
  // plane is oversized so the horizon never shows its edge.
  const waterGeo = new THREE.PlaneGeometry(14000, 14000);
  waterMesh = new THREE.Mesh(
    waterGeo,
    mat(COLOUR_WATER, { transparent: true, opacity: 0.94 }),
  );
  waterMesh.rotation.x = -Math.PI / 2;
  waterMesh.position.y = -0.4;
  parent.add(waterMesh);

  const grassMat = new THREE.MeshLambertMaterial({ color: COLOUR_GRASS });
  const sandMat = new THREE.MeshLambertMaterial({ color: COLOUR_SAND });

  // Sand underlay slightly larger and slightly lower: from any shore
  // angle a pale beach ring shows between grass and water.
  parent.add(outlineMesh(peninsulaOutline(9), -0.06, sandMat));
  parent.add(outlineMesh(peninsulaOutline(0), 0, grassMat));

  // Causeway ground: a grass strip with its own sand skirt underneath.
  addBox(parent, CAUSEWAY_HALF * 2 + 14, 0.04, CAUSEWAY_SOUTH_Z - CAUSEWAY_NORTH_Z,
    0, -0.08, (CAUSEWAY_NORTH_Z + CAUSEWAY_SOUTH_Z) / 2, sandMat, 0);
  addBox(parent, CAUSEWAY_HALF * 2, 0.04, CAUSEWAY_SOUTH_Z - CAUSEWAY_NORTH_Z,
    0, -0.02, (CAUSEWAY_NORTH_Z + CAUSEWAY_SOUTH_Z) / 2, grassMat, 0);

  // Key Solano: a round island blob closing the causeway.
  parent.add(flatDisc(KEY_TOWN_RADIUS + 8, -0.06, sandMat, KEY_TOWN.x, KEY_TOWN.z));
  parent.add(flatDisc(KEY_TOWN_RADIUS, 0, grassMat, KEY_TOWN.x, KEY_TOWN.z));
}

// ---------------------------------------------------------------------------
// Roads
// ---------------------------------------------------------------------------

const ROAD_Y = 0.02;
const CITY_MIN = -190;
const CITY_MAX = 190;
const BOULEVARD_W = 22;

function buildCityRoads(parent) {
  const asphalt = mat(COLOUR_ASPHALT);

  // East-west streets (their z comes from CITY_ROADS_X by contract).
  for (let i = 0; i < CITY_ROADS_X.length; i++) {
    const z = CITY_ROADS_X[i];
    const w = z === 0 ? BOULEVARD_W : ROAD_W;
    addSlab(parent, CITY_MAX - CITY_MIN, w, 0, ROAD_Y, z, asphalt);
  }
  // North-south streets (their x comes from CITY_ROADS_Z by contract).
  for (let i = 0; i < CITY_ROADS_Z.length; i++) {
    const x = CITY_ROADS_Z[i];
    addSlab(parent, ROAD_W, CITY_MAX - CITY_MIN, x, ROAD_Y, 0, asphalt);
  }

  // Palm Boulevard median: planted strip, broken at every crossing so
  // cross traffic and U-turns still read as open asphalt.
  const medianMat = mat(COLOUR_MEDIAN);
  const crossings = CITY_ROADS_Z.slice().sort((a, b) => a - b);
  let cursor = CITY_MIN;
  for (let i = 0; i <= crossings.length; i++) {
    const end = i < crossings.length ? crossings[i] - ROAD_W / 2 - 2 : CITY_MAX;
    if (end - cursor > 4) {
      addBox(parent, end - cursor, 0.1, 2.2,
        (cursor + end) / 2, 0.06, 0, medianMat, 0);
    }
    if (i < crossings.length) cursor = crossings[i] + ROAD_W / 2 + 2;
  }

  // Boulevard sidewalks on both kerbs.
  const walkMat = mat(COLOUR_SIDEWALK);
  const walkOff = BOULEVARD_W / 2 + 1.6;
  addSlab(parent, CITY_MAX - CITY_MIN, 3, 0, ROAD_Y + 0.01, -walkOff, walkMat);
  addSlab(parent, CITY_MAX - CITY_MIN, 3, 0, ROAD_Y + 0.01, walkOff, walkMat);
}

function buildHighway(parent) {
  const asphalt = mat(COLOUR_ASPHALT);
  const from = HIGHWAY.from;
  const to = HIGHWAY.to;

  // Main stem, city edge to the far north.
  addSlab(parent, ROAD_W, from - to, HIGHWAY.x, ROAD_Y, (from + to) / 2, asphalt);
  // Southern continuation: city streets hand over to the causeway road.
  addSlab(parent, ROAD_W, CAUSEWAY_SOUTH_Z - from, HIGHWAY.x, ROAD_Y,
    (from + CAUSEWAY_SOUTH_Z) / 2, asphalt);

  // Dashed centre line the whole way; a shared geometry would be ideal
  // but thin boxes are cheap enough at this spacing.
  const dashMat = mat(COLOUR_DASH);
  for (let z = from - 10; z > to; z -= 14) {
    addBox(parent, 0.5, 0.02, 6, HIGHWAY.x, 0.04, z, dashMat, 0);
  }
  for (let z = from + 12; z < CAUSEWAY_SOUTH_Z - 8; z += 14) {
    addBox(parent, 0.5, 0.02, 6, HIGHWAY.x, 0.04, z, dashMat, 0);
  }
}

function buildTownRoads(parent) {
  const asphalt = mat(COLOUR_ASPHALT_TOWN);
  const walkMat = mat(COLOUR_SIDEWALK);
  const streetW = 10;

  for (let i = 0; i < TOWNS.length; i++) {
    const town = TOWNS[i];
    const tz = town.z;
    // Two east-west streets bracketing the town centre.
    addSlab(parent, 140, streetW, 0, ROAD_Y, tz - 40, asphalt);
    addSlab(parent, 140, streetW, 0, ROAD_Y, tz + 40, asphalt);
    // Two north-south streets crossing both.
    addSlab(parent, streetW, 140, -40, ROAD_Y, tz, asphalt);
    addSlab(parent, streetW, 140, 40, ROAD_Y, tz, asphalt);
    // Sidewalks flank the southern east-west street, the town main
    // street segment where its shops will front in a later stage.
    const off = streetW / 2 + 1.4;
    addSlab(parent, 140, 2.4, 0, ROAD_Y + 0.01, tz + 40 - off, walkMat);
    addSlab(parent, 140, 2.4, 0, ROAD_Y + 0.01, tz + 40 + off, walkMat);
  }
}

// ---------------------------------------------------------------------------
// Public world entry points
// ---------------------------------------------------------------------------

// Minimap / navigation data derived from the same constants that build
// the geometry, so the map can never drift from the world it describes.
function buildMapOutline() {
  const pts = [];
  const step = 300;
  // West edge, southern shore up to the northern tip.
  for (let z = LAND_SOUTH_Z; z >= LAND_NORTH_Z; z -= step) {
    pts.push([-landHalfWidth(z), z]);
  }
  if (pts[pts.length - 1][1] !== LAND_NORTH_Z) {
    pts.push([-landHalfWidth(LAND_NORTH_Z), LAND_NORTH_Z]);
  }
  // Northern tip.
  pts.push([0, LAND_NORTH_Z - 15]);
  // East edge, northern tip back down to the southern shore.
  for (let z = LAND_NORTH_Z; z <= LAND_SOUTH_Z; z += step) {
    pts.push([landHalfWidth(z), z]);
  }
  if (pts[pts.length - 1][1] !== LAND_SOUTH_Z) {
    pts.push([landHalfWidth(LAND_SOUTH_Z), LAND_SOUTH_Z]);
  }
  // Southern shore westward, folding the causeway strip and the Key
  // Solano disc into the outline as an approximate southern bulge.
  pts.push([CAUSEWAY_HALF, LAND_SOUTH_Z]);
  pts.push([CAUSEWAY_HALF, CAUSEWAY_SOUTH_Z]);
  pts.push([KEY_TOWN.x + KEY_TOWN_RADIUS * 0.7, KEY_TOWN.z + KEY_TOWN_RADIUS * 0.7]);
  pts.push([KEY_TOWN.x, KEY_TOWN.z + KEY_TOWN_RADIUS]);
  pts.push([KEY_TOWN.x - KEY_TOWN_RADIUS * 0.7, KEY_TOWN.z + KEY_TOWN_RADIUS * 0.7]);
  pts.push([-CAUSEWAY_HALF, CAUSEWAY_SOUTH_Z]);
  pts.push([-CAUSEWAY_HALF, LAND_SOUTH_Z]);
  return pts;
}

function townZOf(town) {
  if (typeof town.z === 'number') return town.z;
  if (town.center && typeof town.center.z === 'number') return town.center.z;
  if (town.pos && typeof town.pos.z === 'number') return town.pos.z;
  return 0;
}

function buildMapRoads() {
  const roads = [];
  // City east-west streets: full width at each CITY_ROADS_X z.
  for (let i = 0; i < CITY_ROADS_X.length; i++) {
    roads.push([-190, CITY_ROADS_X[i], 190, CITY_ROADS_X[i]]);
  }
  // City north-south streets: full height at each CITY_ROADS_Z x.
  for (let i = 0; i < CITY_ROADS_Z.length; i++) {
    roads.push([CITY_ROADS_Z[i], -190, CITY_ROADS_Z[i], 190]);
  }
  // Highway north in a few long segments (x 0, z 200 to -4400).
  for (let z = 200; z > -4400;) {
    const next = Math.max(-4400, z - 1150);
    roads.push([0, z, 0, next]);
    z = next;
  }
  // Each town's grid: two east-west and two north-south streets.
  for (let i = 0; i < TOWNS.length; i++) {
    const tz = townZOf(TOWNS[i]);
    roads.push([-70, tz - 40, 70, tz - 40]);
    roads.push([-70, tz + 40, 70, tz + 40]);
    roads.push([-40, tz - 70, -40, tz + 70]);
    roads.push([40, tz - 70, 40, tz + 70]);
  }
  // Causeway south to Key Solano.
  roads.push([0, 190, 0, 430]);
  return roads;
}

const FACE_DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

function facilityAnchor(f) {
  if (!f) return null;
  if (typeof f.x === 'number' && typeof f.z === 'number') return { x: f.x, z: f.z };
  const spots = [f.anchor, f.pos, f.position, f.center, f.at];
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    if (Array.isArray(s) && s.length >= 2) return { x: s[0], z: s[1] };
    if (s && typeof s.x === 'number' && typeof s.z === 'number') return { x: s.x, z: s.z };
  }
  return null;
}

function facilityFace(f) {
  const raw = f.face || f.faceDir || f.dir || f.facing || f.doorDir || 's';
  if (raw && typeof raw === 'object') {
    if (raw.x) return raw.x > 0 ? 'e' : 'w';
    if (raw.z) return raw.z > 0 ? 's' : 'n';
    return 's';
  }
  const key = String(raw).toLowerCase();
  if (FACE_DIRS[key]) return key;
  if (key.indexOf('north') >= 0) return 'n';
  if (key.indexOf('east') >= 0) return 'e';
  if (key.indexOf('west') >= 0) return 'w';
  return 's';
}

function buildDoorMarkers() {
  const markers = [];
  const list = Array.isArray(FACILITIES) ? FACILITIES : [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const anchor = facilityAnchor(f);
    if (!anchor) continue;
    const dir = FACE_DIRS[facilityFace(f)];
    markers.push({
      id: f.id || f.name || ('facility-' + i),
      x: anchor.x + dir[0] * 7.5,
      z: anchor.z + dir[1] * 7.5,
    });
  }
  return markers;
}

export const DOOR_MARKERS = buildDoorMarkers();
export const MAP_DATA = {
  outline: buildMapOutline(),
  roads: buildMapRoads(),
  landSouthZ: LAND_SOUTH_Z,
  landNorthZ: LAND_NORTH_Z,
  causeway: { half: CAUSEWAY_HALF, from: CAUSEWAY_NORTH_Z, to: CAUSEWAY_SOUTH_Z },
  keyTown: KEY_TOWN,
  highway: HIGHWAY,
  towns: TOWNS,
  cityRoadsX: CITY_ROADS_X,
  cityRoadsZ: CITY_ROADS_Z,
  flyover: { x: FLYOVER_X, halfW: FLYOVER_HALF_W, endZ: FLYOVER_END_Z, deckH: FLYOVER_DECK_H },
  home: HOME,
  policeStation: POLICE_STATION,
  hospital: HOSPITAL_POS,
  fireStation: FIRE_STATION,
  marina: MARINA,
  garage: GARAGE,
  prison: PRISON,
  facilities: FACILITIES,
  places: PLACES,
};

export function buildWorld(scene) {
  // Reseed so dressing placed by later stages lands identically on
  // every load regardless of what drew from the generator beforehand.
  seedWith(WORLD_SEED);

  const world = new THREE.Group();
  world.name = 'palm-cove-world';
  scene.add(world);

  buildTerrain(world);
  buildCityRoads(world);
  buildHighway(world);
  buildTownRoads(world);
  buildCityBuildings(world);
  buildFacilities(world);
  buildNamedStructures(world);
  buildTownBuildings(world);
  buildDressing(world);

  return world;
}

// Per-frame world animation. Stage 1 has only the sea to move: a slow
// opacity breathe keeps the water from reading as flat paint. Later
// stages register their own animated pieces alongside this.
export function updateCity(dt, t) {
  if (waterMesh) {
    waterMesh.material.opacity = 0.92 + Math.sin(t * 0.4) * 0.03;
  }
  // The lighthouse beam sweeps the harbour entrance on a slow turn.
  if (lighthouseBeam) {
    lighthouseBeam.rotation.y += dt * 0.7;
  }
  // Traffic lights alternate axes every 4 seconds: one axis shows
  // green while the crossing axis shows red, amber stays dark.
  const phase = Math.floor(t / 4) % 2;
  for (let i = 0; i < trafficLights.length; i++) {
    const entry = trafficLights[i];
    const ewGreen = phase === 0;
    const active = entry.axis === 'ew'
      ? (ewGreen ? 'green' : 'red')
      : (ewGreen ? 'red' : 'green');
    entry.mats.red.emissiveIntensity = active === 'red' ? 1.8 : 0.08;
    entry.mats.amber.emissiveIntensity = active === 'amber' ? 1.8 : 0.08;
    entry.mats.green.emissiveIntensity = active === 'green' ? 1.8 : 0.08;
  }
  // Radio beacon blinks at roughly 1 Hz by pulsing its emissive.
  if (radioBeaconMat) {
    radioBeaconMat.emissiveIntensity = Math.floor(t) % 2 === 0 ? 2.4 : 0.1;
  }
}

// ---------------------------------------------------------------------------
// Factories — people and vehicles
// ---------------------------------------------------------------------------
// Both factories build from the shared unit box plus a few primitive
// geometries, pivoted so animation is pure rotation on named groups.

function addMesh(parent, geometry, material, x, y, z) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

export function makePersonMesh(opts) {
  const o = opts || {};
  const shirt = o.shirt !== undefined ? o.shirt : 0x8899aa;
  const pants = o.pants !== undefined ? o.pants : 0x3a4458;
  const skin = o.skin !== undefined ? o.skin : 0xd9a37e;
  const hairColor = o.hairColor !== undefined ? o.hairColor : 0x2b2018;
  const shoeColor = o.shoeColor !== undefined ? o.shoeColor : 0x222222;
  const hairStyle = o.hairStyle || 'flat';
  const shirtStyle = o.shirtStyle || 'tee';
  const face = o.face || 'plain';

  const group = new THREE.Group();
  const skinMat = mat(skin);
  const pantsMat = mat(pants);
  const shoeMat = mat(shoeColor);
  const shirtMat = mat(shirt);
  const hairMat = mat(hairColor);

  // Legs pivot at the hip so a walk cycle is just rotation.x on each.
  function makeLeg(sideX) {
    const leg = new THREE.Group();
    leg.position.set(sideX, 0.85, 0);
    addBox(leg, 0.22, 0.75, 0.24, 0, -0.38, 0, pantsMat, 0);
    // Shoe juts forward (+z is the facing direction).
    addBox(leg, 0.22, 0.12, 0.36, 0, -0.8, 0.05, shoeMat, 0);
    group.add(leg);
    return leg;
  }
  const legL = makeLeg(-0.14);
  const legR = makeLeg(0.14);

  // Upper body pivots at the waist; bobbing moves this group only.
  const upper = new THREE.Group();
  upper.position.set(0, 0.95, 0);
  group.add(upper);
  group.userData.baseUpperY = upper.position.y;

  if (shirtStyle === 'tank') {
    // Narrower torso leaves the shoulders bare.
    addBox(upper, 0.46, 0.55, 0.3, 0, 0.28, 0, shirtMat, 0);
    addBox(upper, 0.14, 0.12, 0.18, -0.3, 0.5, 0, skinMat, 0);
    addBox(upper, 0.14, 0.12, 0.18, 0.3, 0.5, 0, skinMat, 0);
  } else if (shirtStyle === 'hawaiian') {
    // White tee proud of two open coloured panels either side.
    addBox(upper, 0.5, 0.52, 0.34, 0, 0.28, 0, mat(0xf4f1e8), 0);
    addBox(upper, 0.16, 0.54, 0.36, -0.26, 0.28, 0, shirtMat, 0);
    addBox(upper, 0.16, 0.54, 0.36, 0.26, 0.28, 0, shirtMat, 0);
  } else {
    addBox(upper, 0.58, 0.55, 0.32, 0, 0.28, 0, shirtMat, 0);
    if (shirtStyle === 'uniform') {
      // Darker belt band marks the uniform waist.
      addBox(upper, 0.6, 0.1, 0.34, 0, 0.03, 0, mat(0x24242a), 0);
    }
  }

  if (o.necklace) {
    // Gold chain sits on the chest front.
    addMesh(upper, new THREE.TorusGeometry(0.11, 0.02, 6, 14),
      mat(0xd4af37, { emissive: 0x554411 }), 0, 0.42, 0.15);
  }

  // Arms pivot at the shoulders; sleeves take the shirt colour except
  // on a tank, where the whole arm is skin.
  function makeArm(sideX) {
    const arm = new THREE.Group();
    arm.position.set(sideX, 0.48, 0);
    const sleeveMat = shirtStyle === 'tank' ? skinMat : shirtMat;
    addBox(arm, 0.16, 0.3, 0.18, 0, -0.15, 0, sleeveMat, 0);
    addBox(arm, 0.13, 0.32, 0.15, 0, -0.45, 0, skinMat, 0);
    upper.add(arm);
    return arm;
  }
  const armL = makeArm(-0.37);
  const armR = makeArm(0.37);

  // Head: face details sit on the +z front of the head box.
  const head = new THREE.Group();
  head.position.set(0, 0.56, 0);
  upper.add(head);
  addBox(head, 0.34, 0.36, 0.34, 0, 0.18, 0, skinMat, 0);
  const eyeMat = mat(0x1c1c22);
  addBox(head, 0.04, 0.05, 0.02, -0.08, 0.21, 0.18, eyeMat, 0);
  addBox(head, 0.04, 0.05, 0.02, 0.08, 0.21, 0.18, eyeMat, 0);
  if (face === 'stern') {
    // Angled brows do the stern work; soft/plain faces skip them.
    const browL = addBox(head, 0.1, 0.025, 0.02, -0.08, 0.29, 0.18, eyeMat, 0);
    browL.rotation.z = -0.45;
    const browR = addBox(head, 0.1, 0.025, 0.02, 0.08, 0.29, 0.18, eyeMat, 0);
    browR.rotation.z = 0.45;
  }
  addBox(head, 0.1, 0.025, 0.02, 0, 0.06, 0.18, mat(0x7a4636), 0);

  if (hairStyle === 'ponytail') {
    addBox(head, 0.37, 0.13, 0.37, 0, 0.38, 0, hairMat, 0);
    addBox(head, 0.12, 0.4, 0.1, 0, 0.12, -0.22, hairMat, 0);
  } else if (hairStyle === 'spiky') {
    addBox(head, 0.37, 0.07, 0.37, 0, 0.37, 0, hairMat, 0);
    const spikeGeo = new THREE.ConeGeometry(0.06, 0.17, 5);
    const spikeX = [-0.13, -0.045, 0.045, 0.13];
    for (let i = 0; i < spikeX.length; i++) {
      addMesh(head, spikeGeo, hairMat, spikeX[i], 0.47, 0);
    }
  } else if (hairStyle === 'cap') {
    const capTop = addMesh(head, new THREE.CylinderGeometry(0.22, 0.23, 0.09, 12),
      hairMat, 0, 0.39, 0);
    capTop.scale.y = 0.8;
    addBox(head, 0.3, 0.03, 0.2, 0, 0.35, 0.24, hairMat, 0);
  } else if (hairStyle === 'bun') {
    addBox(head, 0.37, 0.13, 0.37, 0, 0.38, 0, hairMat, 0);
    addMesh(head, new THREE.SphereGeometry(0.1, 10, 8), hairMat, 0, 0.36, -0.19);
  } else {
    // 'flat' and any unknown style: a thin cap of hair.
    addBox(head, 0.37, 0.07, 0.37, 0, 0.38, 0, hairMat, 0);
  }

  group.userData.isPerson = true;
  group.userData.opts = o;
  group.userData.legL = legL;
  group.userData.legR = legR;
  group.userData.armL = armL;
  group.userData.armR = armR;
  group.userData.upper = upper;
  group.userData.head = head;
  return group;
}

export function posePerson(mesh, phase, mode) {
  if (!mesh || !mesh.userData) return;
  const u = mesh.userData;
  const legL = u.legL, legR = u.legR, armL = u.armL, armR = u.armR;
  const upper = u.upper, head = u.head;
  if (!legL || !legR || !armL || !armR || !upper) return;
  const p = phase || 0;
  const m = mode || 'idle';
  const baseY = typeof u.baseUpperY === 'number' ? u.baseUpperY : upper.position.y;

  // Reset every animated axis first so no mode leaks into the next.
  legL.rotation.set(0, 0, 0);
  legR.rotation.set(0, 0, 0);
  armL.rotation.set(0, 0, 0);
  armR.rotation.set(0, 0, 0);
  upper.rotation.set(0, 0, 0);
  upper.position.y = baseY;
  if (head) head.rotation.set(0, 0, 0);
  mesh.userData.posePhase = p;
  mesh.userData.poseMode = m;

  const s = Math.sin(p);
  if (m === 'walk') {
    legL.rotation.x = s * 0.55;
    legR.rotation.x = -s * 0.55;
    armL.rotation.x = -s * 0.4;
    armR.rotation.x = s * 0.4;
    upper.rotation.x = 0.07;
    upper.position.y = baseY + Math.abs(s) * 0.035;
  } else if (m === 'run') {
    legL.rotation.x = s * 0.95;
    legR.rotation.x = -s * 0.95;
    // Arms stay bent at the elbow line: a fixed forward base plus swing.
    armL.rotation.x = -0.9 - s * 0.5;
    armR.rotation.x = -0.9 + s * 0.5;
    upper.rotation.x = 0.16;
    upper.position.y = baseY + Math.abs(s) * 0.05;
  } else if (m === 'swim') {
    // Body pitched forward at the surface, arms windmilling alternately.
    upper.rotation.x = 1.15;
    armL.rotation.x = p;
    armR.rotation.x = p + Math.PI;
    legL.rotation.x = Math.sin(p * 2.2) * 0.25;
    legR.rotation.x = -Math.sin(p * 2.2) * 0.25;
    upper.position.y = baseY + Math.sin(p * 2.2) * 0.02;
  } else if (m === 'drive') {
    // Seated: thighs forward, hands forward onto the wheel.
    legL.rotation.x = -1.35;
    legR.rotation.x = -1.35;
    armL.rotation.x = -0.85;
    armR.rotation.x = -0.85;
  } else if (m === 'dance') {
    armL.rotation.z = 2.2 + Math.sin(p) * 0.3;
    armR.rotation.z = -(2.2 + Math.sin(p) * 0.3);
    armL.rotation.x = Math.sin(p) * 0.2;
    armR.rotation.x = -Math.sin(p) * 0.2;
    upper.rotation.z = Math.sin(p) * 0.12;
    upper.position.y = baseY + Math.abs(Math.sin(p * 2)) * 0.05;
  } else if (m === 'aim') {
    armR.rotation.x = -1.5;
    armL.rotation.x = -0.4;
    armL.rotation.z = 0.35;
    legL.rotation.x = 0.2;
    legR.rotation.x = -0.1;
  } else {
    // 'idle' and any unknown mode: a quiet standing sway.
    const sway = Math.sin(p * 0.5) * 0.04;
    armL.rotation.x = sway;
    armR.rotation.x = -sway;
    upper.position.y = baseY + Math.sin(p * 1.2) * 0.012;
  }
}

function makeWheel(parent, wheels, r, width, x, z) {
  const wheel = addMesh(parent, new THREE.CylinderGeometry(r, r, width, 14),
    mat(0x18181c), x, r, z);
  // Cylinder axis is Y by default; rolling around X needs it on its side.
  wheel.rotation.z = Math.PI / 2;
  wheels.push(wheel);
  return wheel;
}

function addLights(group, width, length) {
  const headMat = mat(0xfff3b8, { emissive: 0xccb96a });
  const tailMat = mat(0xd23b2e, { emissive: 0x7a1710 });
  const hz = length / 2 + 0.02;
  addBox(group, 0.32, 0.14, 0.05, -width / 2 + 0.3, 0.52, hz, headMat, 0);
  addBox(group, 0.32, 0.14, 0.05, width / 2 - 0.3, 0.52, hz, headMat, 0);
  addBox(group, 0.32, 0.12, 0.05, -width / 2 + 0.3, 0.55, -hz, tailMat, 0);
  addBox(group, 0.32, 0.12, 0.05, width / 2 - 0.3, 0.55, -hz, tailMat, 0);
}

function addLightbar(group, roofY) {
  const bar = new THREE.Group();
  bar.position.set(0, roofY, -0.2);
  group.add(bar);
  addBox(bar, 1.05, 0.13, 0.32, 0, 0, 0, mat(0x22242a), 0);
  // Distinct lens materials: police.js flashes these two by reference.
  const redLens = new THREE.MeshLambertMaterial({ color: 0xff2a20, emissive: 0x881108 });
  const blueLens = new THREE.MeshLambertMaterial({ color: 0x2255ff, emissive: 0x112288 });
  addBox(bar, 0.46, 0.1, 0.26, -0.27, 0.02, 0, redLens, 0);
  addBox(bar, 0.46, 0.1, 0.26, 0.27, 0.02, 0, blueLens, 0);
  bar.userData.lenses = [redLens, blueLens];
  group.userData.lightbar = bar;
  return bar;
}

export function makeCarMesh(color, opts) {
  const o = opts || {};
  const kind = o.kind || 'car';
  const group = new THREE.Group();
  const wheels = [];
  const paint = mat(color !== undefined ? color : 0xcccccc);
  const glass = mat(o.cabColor !== undefined ? o.cabColor : 0x1a2430);

  if (kind === 'moto') {
    // Slim wedge body: a low box raked by a sloped front fairing box.
    addBox(group, 0.5, 0.32, 2.1, 0, 0.55, 0, paint, 0);
    const fairing = addBox(group, 0.44, 0.3, 0.6, 0, 0.68, 0.75, paint, 0);
    fairing.rotation.x = -0.35;
    addBox(group, 0.42, 0.12, 0.85, 0, 0.76, -0.3, mat(0x1e1e24), 0);
    addBox(group, 0.62, 0.06, 0.08, 0, 0.95, 0.82, mat(0x2a2a30), 0);
    makeWheel(group, wheels, 0.36, 0.12, 0, 0.85);
    makeWheel(group, wheels, 0.36, 0.12, 0, -0.85);
    addLights(group, 0.5, 2.1);
  } else if (kind === 'truck') {
    addBox(group, 2.0, 1.3, 1.6, 0, 1.02, 1.95, paint, 0);
    addBox(group, 1.8, 0.6, 0.08, 0, 1.3, 2.72, glass, 0);
    // Tall cargo box does the truck silhouette.
    addBox(group, 2.2, 2.2, 3.4, 0, 1.5, -0.95, mat(0xe8e6df), 0);
    addBox(group, 2.24, 0.5, 3.44, 0, 0.42, -0.95, mat(0x3a3a40), 0);
    makeWheel(group, wheels, 0.42, 0.26, -1.0, 1.95);
    makeWheel(group, wheels, 0.42, 0.26, 1.0, 1.95);
    makeWheel(group, wheels, 0.42, 0.26, -1.0, -1.9);
    makeWheel(group, wheels, 0.42, 0.26, 1.0, -1.9);
    addLights(group, 2.0, 5.5);
  } else if (kind === 'firetruck') {
    const red = mat(0xc2271b);
    addBox(group, 2.2, 1.6, 5.6, 0, 1.05, 0, red, 0);
    addBox(group, 2.0, 0.9, 1.2, 0, 0.85, 2.95, red, 0);
    addBox(group, 1.8, 0.55, 0.08, 0, 1.05, 3.52, glass, 0);
    addBox(group, 2.24, 0.35, 5.64, 0, 0.35, 0, mat(0xf0ead8), 0);
    // Ladder: two rails and rungs laid flat along the roof.
    addBox(group, 0.09, 0.09, 4.4, -0.32, 2.0, -0.3, mat(0xb9bdc4), 0);
    addBox(group, 0.09, 0.09, 4.4, 0.32, 2.0, -0.3, mat(0xb9bdc4), 0);
    for (let i = 0; i < 6; i++) {
      addBox(group, 0.7, 0.06, 0.12, 0, 2.0, -2.2 + i * 0.78, mat(0xb9bdc4), 0);
    }
    makeWheel(group, wheels, 0.42, 0.26, -1.05, 2.2);
    makeWheel(group, wheels, 0.42, 0.26, 1.05, 2.2);
    makeWheel(group, wheels, 0.42, 0.26, -1.05, -2.0);
    makeWheel(group, wheels, 0.42, 0.26, 1.05, -2.0);
    addLights(group, 2.2, 6.9);
    if (o.lightbar) addLightbar(group, 1.95);
  } else if (kind === 'police') {
    // Car shape in white with a navy cabin and the flashing lightbar.
    const white = mat(0xf2f2f0);
    const navy = mat(o.cabColor !== undefined ? o.cabColor : 0x16264a);
    addBox(group, 1.8, 0.55, 4.2, 0, 0.45, 0, white, 0);
    addBox(group, 1.84, 0.22, 4.24, 0, 0.3, 0, navy, 0);
    addBox(group, 1.6, 0.5, 2.2, 0, 1.0, -0.25, navy, 0);
    makeWheel(group, wheels, 0.34, 0.24, -0.85, 1.35);
    makeWheel(group, wheels, 0.34, 0.24, 0.85, 1.35);
    makeWheel(group, wheels, 0.34, 0.24, -0.85, -1.35);
    makeWheel(group, wheels, 0.34, 0.24, 0.85, -1.35);
    addLights(group, 1.8, 4.2);
    addLightbar(group, 1.32);
  } else {
    // Plain car.
    addBox(group, 1.8, 0.55, 4.2, 0, 0.45, 0, paint, 0);
    addBox(group, 1.6, 0.5, 2.2, 0, 1.0, -0.25, glass, 0);
    makeWheel(group, wheels, 0.34, 0.24, -0.85, 1.35);
    makeWheel(group, wheels, 0.34, 0.24, 0.85, 1.35);
    makeWheel(group, wheels, 0.34, 0.24, -0.85, -1.35);
    makeWheel(group, wheels, 0.34, 0.24, 0.85, -1.35);
    addLights(group, 1.8, 4.2);
    if (o.lightbar) addLightbar(group, 1.32);
  }

  group.userData.isCar = true;
  group.userData.opts = o;
  group.userData.kind = kind;
  group.userData.wheels = wheels;
  return group;
}

// Referenced so parallel-built config values stay part of this module's
// surface even before the stages that fully use them land.
export const WORLD_CONSTANTS = {
  tuning: TUNING,
  randomApi: { nextFloat, floatBetween, intBetween, pickOne, chanceOf, shuffled },
};

// ---------------------------------------------------------------------------
// Part B — buildings and structures
// ---------------------------------------------------------------------------
// Everything below fills the road grid built above: facade-textured city
// blocks, the named facilities, and the landmark structures. Placement
// draws from the same seeded generator buildWorld reseeds, so the city
// is identical on every load.

// Live tallies so tooling (and the minimap debug overlay) can report how
// much of the city was actually placed.
export const BUILD_STATS = {
  cityBuildings: 0,
  houses: 0,
  facilities: 0,
  townBuildings: 0,
  namedStructures: 0,
};

// The lighthouse beam group lives here so updateCity can sweep it.
let lighthouseBeam = null;

// --- B1: facade textures ---------------------------------------------------

const facadeTexCache = new Map();
const facadeMatCache = new Map();
const signTexCache = new Map();

function cssColor(color) {
  return '#' + (color >>> 0).toString(16).padStart(6, '0');
}

// Cheap deterministic hash so a given texture always lights the same
// windows without spending draws from the shared seeded generator.
function texHash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// One building face: colour wash, a window grid with a few warm-lit
// panes, a trim band near the top, and an optional sign strip.
function facadeTexture(color, floors, sign) {
  const key = color + '|' + floors + '|' + (sign || '');
  let tex = facadeTexCache.get(key);
  if (tex) return tex;
  const canvas = makeCanvas(128, 256);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = cssColor(color);
  ctx.fillRect(0, 0, 128, 256);
  // Vertical wash: sun-bleached at the top, grime settling at street level.
  const wash = ctx.createLinearGradient(0, 0, 0, 256);
  wash.addColorStop(0, 'rgba(255,255,255,0.16)');
  wash.addColorStop(0.7, 'rgba(0,0,0,0)');
  wash.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, 128, 256);

  // Trim band near the top caps the facade like a cornice shadow line.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 12, 128, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(0, 19, 128, 3);

  const rows = Math.max(1, floors);
  const cols = 4;
  const seed = texHash(key);
  const top = 30;
  const bottom = sign ? 196 : 238;
  const cellW = 128 / cols;
  const cellH = (bottom - top) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = seed + r * 31 + c * 17 + r * c * 7;
      const lit = ((n * 2654435761) >>> 0) % 5 === 0;
      ctx.fillStyle = lit ? '#ffd98a' : '#1b2634';
      const ww = Math.min(16, cellW - 10);
      const wh = Math.min(20, cellH - 8);
      ctx.fillRect(c * cellW + (cellW - ww) / 2, top + r * cellH + 4, ww, wh);
      // A mullion cross keeps even dark panes reading as windows.
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(c * cellW + cellW / 2 - 0.5, top + r * cellH + 4, 1, wh);
    }
  }

  if (sign) {
    ctx.fillStyle = '#10161f';
    ctx.fillRect(0, 208, 128, 34);
    ctx.fillStyle = '#f5eeda';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(sign).toUpperCase().slice(0, 14), 64, 226, 120);
  }

  tex = new THREE.CanvasTexture(canvas);
  facadeTexCache.set(key, tex);
  return tex;
}

function facadeMaterial(color, floors, sign) {
  const key = color + '|' + floors + '|' + (sign || '');
  let m = facadeMatCache.get(key);
  if (m) return m;
  const tex = facadeTexture(color, floors, sign);
  if (tex) {
    // The texture already carries the base colour, so the material
    // colour stays white to avoid double-tinting the wash.
    m = new THREE.MeshLambertMaterial({ map: tex });
  } else {
    m = mat(color);
  }
  facadeMatCache.set(key, m);
  return m;
}

// Standalone sign board texture: light letters on a dark board.
function signTexture(text) {
  const key = 'sign|' + text;
  let tex = signTexCache.get(key);
  if (tex) return tex;
  const canvas = makeCanvas(256, 56);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#121a26';
  ctx.fillRect(0, 0, 256, 56);
  ctx.strokeStyle = '#d8c98f';
  ctx.lineWidth = 3;
  ctx.strokeRect(3, 3, 250, 50);
  ctx.fillStyle = '#f7efdb';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(text).toUpperCase().slice(0, 20), 128, 30, 236);
  tex = new THREE.CanvasTexture(canvas);
  signTexCache.set(key, tex);
  return tex;
}

// Hospital mark: a red cross on white, drawn instead of lettering.
function crossTexture() {
  const key = 'sign|cross';
  let tex = signTexCache.get(key);
  if (tex) return tex;
  const canvas = makeCanvas(128, 128);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#c0271c';
  ctx.fillRect(52, 22, 24, 84);
  ctx.fillRect(22, 52, 84, 24);
  tex = new THREE.CanvasTexture(canvas);
  signTexCache.set(key, tex);
  return tex;
}

function signMaterial(text) {
  const tex = text === null ? crossTexture() : signTexture(text);
  if (!tex) return mat(0x121a26);
  return new THREE.MeshLambertMaterial({ map: tex });
}

// A box whose four sides wear the facade texture; the roof gets its own
// slab in addBuilding, so top/bottom use a plain dark material here.
function addFacadeBox(parent, w, h, d, x, y, z, color, floors, sign, ry) {
  const side = facadeMaterial(color, floors, sign);
  const cap = mat(0x3a3d44);
  const mesh = new THREE.Mesh(unitBox(), [side, side, cap, cap, side, side]);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  if (ry) mesh.rotation.y = ry;
  parent.add(mesh);
  return mesh;
}

// Shared building shell: facade box + darker roof slab, a parapet lip on
// tall blocks, and the shrunken-footprint collider every building gets.
function addBuilding(parent, x, z, w, d, h, color, sign) {
  const floors = Math.max(1, Math.round(h / 3.4));
  addFacadeBox(parent, w, h, d, x, h / 2, z, color, floors, sign, 0);
  addBox(parent, w + 0.35, 0.22, d + 0.35, x, h + 0.11, z, mat(0x33363c), 0);
  if (h >= 24) {
    // Parapet lip: four thin rails hide the roof edge from street level.
    const lip = mat(0x2c2f35);
    addBox(parent, w + 0.35, 0.55, 0.3, x, h + 0.38, z - d / 2 - 0.02, lip, 0);
    addBox(parent, w + 0.35, 0.55, 0.3, x, h + 0.38, z + d / 2 + 0.02, lip, 0);
    addBox(parent, 0.3, 0.55, d + 0.35, x - w / 2 - 0.02, h + 0.38, z, lip, 0);
    addBox(parent, 0.3, 0.55, d + 0.35, x + w / 2 + 0.02, h + 0.38, z, lip, 0);
  }
  registerBox(x - w / 2 + 0.2, x + w / 2 - 0.2, z - d / 2 + 0.2, z + d / 2 - 0.2);
  return h;
}

// Gabled house: a low facade box under a squashed 4-segment cone whose
// rotated square base lands exactly on the footprint corners.
function addHouse(parent, x, z, w, d, wallColor, roofColor) {
  const wallH = 3.2;
  addFacadeBox(parent, w, wallH, d, x, wallH / 2, z, wallColor, 1, null, 0);
  const roofH = Math.min(w, d) * 0.42 + 1;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(1, 1, 4),
    mat(roofColor || 0x8a4b32),
  );
  // Cone base vertices sit on the axes; rotating 45 degrees turns the
  // base into a square whose half-side is cos(45deg) of the radius.
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(w * 0.72, roofH, d * 0.72);
  roof.position.set(x, wallH + roofH / 2, z);
  parent.add(roof);
  registerBox(x - w / 2 + 0.2, x + w / 2 - 0.2, z - d / 2 + 0.2, z + d / 2 - 0.2);
  BUILD_STATS.houses++;
}

// A sign board hung on a wall: thin box wearing the sign texture.
function addSignBoard(parent, w, h, x, y, z, text, ry) {
  const board = new THREE.Mesh(unitBox(), signMaterial(text));
  board.scale.set(w, h, 0.18);
  board.position.set(x, y, z);
  if (ry) board.rotation.y = ry;
  parent.add(board);
  return board;
}

// --- B2: city buildings ----------------------------------------------------

const CITY_PALETTE = [
  0xcbb59a, 0xb7c3c9, 0xd8c8a8, 0xa8b6a0, 0xc9a689, 0x9fb0bd,
  0xd3d0c4, 0xb98d7a, 0x8fa3ad, 0xe0d3ae, 0xa4917e, 0xbfc8b8,
];
const HOUSE_PALETTE = [0xf2e3c2, 0xe8d8b0, 0xdfe8d8, 0xf0dcc8, 0xe3e0f0, 0xf5ead2];
const HOUSE_ROOFS = [0x8a4b32, 0x74584a, 0x9c5a3c, 0x5f7161];

// Every anchor a city block must keep clear of, gathered once.
function cityKeepOutPoints() {
  const pts = [];
  const list = Array.isArray(FACILITIES) ? FACILITIES : [];
  for (let i = 0; i < list.length; i++) {
    const a = facilityAnchor(list[i]);
    if (a) pts.push(a);
  }
  const named = [HOME, POLICE_STATION, FIRE_STATION, HOSPITAL_POS, MARINA, GARAGE];
  for (let i = 0; i < named.length; i++) {
    if (named[i]) pts.push({ x: named[i].x, z: named[i].z });
  }
  return pts;
}

// True when the point comes within `pad` of the rectangle (or inside it).
function pointNearRect(px, pz, minX, maxX, minZ, maxZ, pad) {
  return px >= minX - pad && px <= maxX + pad && pz >= minZ - pad && pz <= maxZ + pad;
}

function buildCityBuildings(parent) {
  const keepOut = cityKeepOutPoints();
  const xs = CITY_ROADS_X.slice().sort((a, b) => a - b);
  const zs = CITY_ROADS_Z.slice().sort((a, b) => a - b);
  // Prison rectangle expanded by 4: lots are tested against it per-lot
  // below, so a cell only loses the lots that actually overlap it.
  const prisonMinX = PRISON.x - 36 - 4;
  const prisonMaxX = PRISON.x + 36 + 4;
  const prisonMinZ = PRISON.z - 26 - 4;
  const prisonMaxZ = PRISON.z + 26 + 4;

  for (let ix = 0; ix < xs.length - 1; ix++) {
    for (let iz = 0; iz < zs.length - 1; iz++) {
      // Cell between adjacent roads, inset so lots never touch asphalt.
      const minX = xs[ix] + 4;
      const maxX = xs[ix + 1] - 4;
      const minZ = zs[iz] + 4;
      const maxZ = zs[iz + 1] - 4;
      if (maxX - minX < 20 || maxZ - minZ < 20) continue;

      // No wholesale cell skip: exclusion is per-lot inside the slot
      // loop, so one facility anchor no longer empties a whole block.
      const onBoulevard = zs[iz] === 0 || zs[iz + 1] === 0;
      const coralHeights = zs[iz] === 75 && zs[iz + 1] === 150;
      const oldTown = xs[ix] >= -190 && xs[ix + 1] <= -75;
      const houseBand = coralHeights || oldTown;

      // Jittered sub-grid: up to 6 slots, 2-5 of them filled per cell.
      const count = intBetween(2, 5);
      const slots = shuffled([0, 1, 2, 3, 4, 5]).slice(0, count);
      for (let s = 0; s < slots.length; s++) {
        const slot = slots[s];
        const col = slot % 3;
        const row = Math.floor(slot / 3);
        const cx = minX + ((col + 0.5) / 3) * (maxX - minX) + floatBetween(-3, 3);
        const cz = minZ + ((row + 0.5) / 2) * (maxZ - minZ) + floatBetween(-3, 3);
        const w = floatBetween(10, 18);
        const d = floatBetween(10, 18);
        // Clamp the centre so the whole footprint stays in the cell.
        const bx = Math.max(minX + w / 2, Math.min(maxX - w / 2, cx));
        const bz = Math.max(minZ + d / 2, Math.min(maxZ - d / 2, cz));

        // Per-lot exclusion: skip only this lot when its own centre is
        // within 13 of a keep-out anchor, or its footprint would
        // overlap the expanded prison rectangle.
        let lotBlocked = bx - w / 2 < prisonMaxX && bx + w / 2 > prisonMinX
          && bz - d / 2 < prisonMaxZ && bz + d / 2 > prisonMinZ;
        for (let k = 0; k < keepOut.length && !lotBlocked; k++) {
          const kdx = bx - keepOut[k].x;
          const kdz = bz - keepOut[k].z;
          if (kdx * kdx + kdz * kdz < 13 * 13) lotBlocked = true;
        }
        if (lotBlocked) continue;

        if (houseBand && chanceOf(0.5)) {
          addHouse(parent, bx, bz, w, d, pickOne(HOUSE_PALETTE), pickOne(HOUSE_ROOFS));
          BUILD_STATS.cityBuildings++;
        } else {
          const h = onBoulevard ? floatBetween(18, 38) : floatBetween(8, 20);
          addBuilding(parent, bx, bz, w, d, h, pickOne(CITY_PALETTE), null);
          BUILD_STATS.cityBuildings++;
        }
      }
    }
  }
}

// --- B3: facility buildings ------------------------------------------------

// Rotation that turns a group's local +z onto the faced compass side.
function faceRotation(face) {
  if (face === 'n') return Math.PI;
  if (face === 'e') return Math.PI / 2;
  if (face === 'w') return -Math.PI / 2;
  return 0;
}

// Collider for a rotated 15x13-style footprint: swap extents on e/w.
function registerOrientedBox(x, z, w, d, face) {
  const swap = face === 'e' || face === 'w';
  const hw = (swap ? d : w) / 2 - 0.2;
  const hd = (swap ? w : d) / 2 - 0.2;
  registerBox(x - hw, x + hw, z - hd, z + hd);
}

// Door furniture in local space: recess, panel and step on the +z face.
function addDoorway(group, doorColor) {
  addBox(group, 2.0, 2.8, 0.25, 0, 1.4, 6.45, mat(0x14161c), 0);
  addBox(group, 1.5, 2.5, 0.18, 0, 1.25, 6.58, mat(doorColor || 0x4a3826), 0);
  addBox(group, 3.0, 0.18, 1.2, 0, 0.09, 7.1, mat(0xb9b4a6), 0);
}

function buildFacilities(parent) {
  const list = Array.isArray(FACILITIES) ? FACILITIES : [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const anchor = facilityAnchor(f);
    if (!anchor) continue;
    const face = facilityFace(f);
    const id = f.id || '';
    // The B4 HOME house is the home's exterior at this same anchor, so
    // building the 'home' facility too would stack two houses together.
    if (id === 'home') continue;
    const name = f.name || id || 'SHOP';
    const isHospital = id === 'hospital';
    const isGas = id === 'gas';

    const group = new THREE.Group();
    group.position.set(anchor.x, 0, anchor.z);
    group.rotation.y = faceRotation(face);
    parent.add(group);

    const wallColor = isHospital ? 0xf2f2ee : pickOne(CITY_PALETTE);
    addFacadeBox(group, 15, 7, 13, 0, 3.5, 0, wallColor, 2, null, 0);
    addBox(group, 15.35, 0.22, 13.35, 0, 7.11, 0, mat(isHospital ? 0xd8d8d2 : 0x33363c), 0);
    addDoorway(group, isHospital ? 0x7a8a99 : 0x4a3826);
    if (isHospital) {
      // Red cross instead of a name board, and a helipad on the roof.
      addSignBoard(group, 2.6, 2.6, 0, 5.2, 6.62, null, 0);
      const pad = flatDisc(4, 7.24, mat(0x4a4d52), 0, 0);
      group.add(pad);
      addBox(group, 3.4, 0.06, 0.7, 0, 7.28, 0, mat(0xf2ead2), 0);
      addBox(group, 0.7, 0.06, 3.4, 0, 7.28, 0, mat(0xf2ead2), 0);
    } else {
      addSignBoard(group, 8, 1.5, 0, 5.4, 6.62, name, 0);
    }
    registerOrientedBox(anchor.x, anchor.z, 15, 13, face);
    BUILD_STATS.facilities++;

    if (isGas) {
      buildGasForecourt(parent, anchor, face);
    }
  }
}

// Gas forecourt in world space: canopy on four poles, two pump islands.
function buildGasForecourt(parent, anchor, face) {
  const dir = FACE_DIRS[face];
  const perp = [dir[1], dir[0]];
  const front = 12.5;
  const cx = anchor.x + dir[0] * front;
  const cz = anchor.z + dir[1] * front;
  const ry = faceRotation(face);
  const canopy = new THREE.Group();
  canopy.position.set(cx, 0, cz);
  canopy.rotation.y = ry;
  parent.add(canopy);
  addBox(canopy, 11, 0.35, 8, 0, 4.6, 0, mat(0xd8542e), 0);
  addBox(canopy, 11.4, 0.5, 8.4, 0, 4.32, 0, mat(0xf2ead2), 0);
  const poleMat = mat(0x8b9096);
  const corners = [[-5, -3.4], [5, -3.4], [-5, 3.4], [5, 3.4]];
  for (let i = 0; i < corners.length; i++) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 4.4, 8), poleMat);
    pole.position.set(corners[i][0], 2.2, corners[i][1]);
    canopy.add(pole);
  }
  // Pumps are small islands a car pulls up beside: box + circle collider.
  const pumpOffsets = [-2.2, 2.2];
  for (let i = 0; i < pumpOffsets.length; i++) {
    const off = pumpOffsets[i];
    addBox(canopy, 0.9, 1.3, 0.6, off, 0.65, 0, mat(0xd8d3c3), 0);
    addBox(canopy, 0.94, 0.4, 0.64, off, 1.05, 0, mat(0xb03024), 0);
    const wx = cx + perp[0] * off;
    const wz = cz + perp[1] * off;
    registerCircle(wx, wz, 0.65);
  }
}

// --- B4: named structures --------------------------------------------------

function buildHome(parent) {
  const group = new THREE.Group();
  group.position.set(HOME.x, 0, HOME.z);
  parent.add(group);
  // Cream gabled house; its front door faces south toward HOME_DOOR.
  addFacadeBox(group, 10, 3.6, 8, 0, 1.8, 0, 0xf5e6bd, 1, null, 0);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4), mat(0x9c5a3c));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(10 * 0.72, 2.6, 8 * 0.72);
  roof.position.set(0, 3.6 + 1.3, 0);
  group.add(roof);
  addBox(group, 1.5, 2.5, 0.18, 0, 1.25, 4.05, mat(0x5a4030), 0);
  // Porch: a slab on two posts shading the front door.
  addBox(group, 4.4, 0.16, 1.8, 0, 2.7, 4.7, mat(0xd8c9a3), 0);
  addBox(group, 0.16, 2.7, 0.16, -2.0, 1.35, 5.4, mat(0x8a6f4d), 0);
  addBox(group, 0.16, 2.7, 0.16, 2.0, 1.35, 5.4, mat(0x8a6f4d), 0);
  addBox(group, 4.6, 0.14, 2.0, 0, 0.07, 4.8, mat(0xb9b4a6), 0);
  registerBox(HOME.x - 4.8, HOME.x + 4.8, HOME.z - 3.8, HOME.z + 3.8);
  BUILD_STATS.namedStructures++;
}

function buildPoliceStation(parent) {
  const group = new THREE.Group();
  group.position.set(POLICE_STATION.x, 0, POLICE_STATION.z);
  parent.add(group);
  addFacadeBox(group, 20, 9, 14, 0, 4.5, 0, 0xb9bfc7, 3, null, 0);
  // Navy trim: a band under the roofline and a plinth at street level.
  addBox(group, 20.3, 0.8, 14.3, 0, 8.3, 0, mat(0x16264a), 0);
  addBox(group, 20.3, 0.6, 14.3, 0, 0.3, 0, mat(0x16264a), 0);
  addBox(group, 15.35, 0.22, 13.35, 0, 9.11, 0, mat(0x33363c), 0);
  addBox(group, 2.0, 2.8, 0.25, 0, 1.4, 7.0, mat(0x14161c), 0);
  addBox(group, 1.5, 2.5, 0.18, 0, 1.25, 7.12, mat(0x2a3444), 0);
  addSignBoard(group, 9, 1.7, 0, 6.2, 7.15, 'POLICE', 0);
  // Flag pole on the front corner, colours flying.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 10, 8), mat(0xb9bdc4));
  pole.position.set(8.4, 5, 8.2);
  group.add(pole);
  addBox(group, 1.9, 1.1, 0.06, 9.35, 9.2, 8.2, mat(0x2b4f9e), 0);
  registerBox(
    POLICE_STATION.x - 9.8, POLICE_STATION.x + 9.8,
    POLICE_STATION.z - 6.8, POLICE_STATION.z + 6.8,
  );
  BUILD_STATS.namedStructures++;
}

function buildFireStation(parent) {
  const group = new THREE.Group();
  group.position.set(FIRE_STATION.x, 0, FIRE_STATION.z);
  parent.add(group);
  addFacadeBox(group, 18, 8, 13, 0, 4, 0, 0xd8cfc0, 2, null, 0);
  addBox(group, 18.35, 0.22, 13.35, 0, 8.11, 0, mat(0x33363c), 0);
  // Two big red bay doors dominate the front face.
  const bayMat = mat(0xc2271b);
  addBox(group, 4.6, 4.6, 0.22, -3.4, 2.3, 6.55, bayMat, 0);
  addBox(group, 4.6, 4.6, 0.22, 3.4, 2.3, 6.55, bayMat, 0);
  addBox(group, 4.7, 0.35, 0.26, -3.4, 4.75, 6.55, mat(0xf0ead8), 0);
  addBox(group, 4.7, 0.35, 0.26, 3.4, 4.75, 6.55, mat(0xf0ead8), 0);
  addSignBoard(group, 8, 1.4, 0, 6.6, 6.62, 'FIRE STATION', 0);
  registerBox(
    FIRE_STATION.x - 8.8, FIRE_STATION.x + 8.8,
    FIRE_STATION.z - 6.3, FIRE_STATION.z + 6.3,
  );
  BUILD_STATS.namedStructures++;
}

function buildPrison(parent) {
  const cx = PRISON.x;
  const cz = PRISON.z;
  const hw = 36;
  const hd = 26;
  const wallH = 5;
  const wallMat = mat(0x9a958a);
  const thick = 0.6;

  function wall(w, d, x, z) {
    addBox(parent, w, wallH, d, x, wallH / 2, z, wallMat, 0);
    registerBox(x - w / 2, x + w / 2, z - d / 2, z + d / 2);
  }
  wall(hw * 2, thick, cx, cz - hd); // north
  wall(thick, hd * 2, cx - hw, cz); // west
  wall(thick, hd * 2, cx + hw, cz); // east
  // South wall in two segments, leaving the 6-wide gate gap at gateX.
  const southZ = cz + hd;
  const gateHalf = 3;
  const leftW = (PRISON.gateX - gateHalf) - (cx - hw);
  const rightW = (cx + hw) - (PRISON.gateX + gateHalf);
  wall(leftW, thick, (cx - hw) + leftW / 2, southZ);
  wall(rightW, thick, (cx + hw) - rightW / 2, southZ);
  // Gate posts mark the gap without blocking it.
  addBox(parent, 0.5, 5.4, 0.5, PRISON.gateX - gateHalf, 2.7, southZ, mat(0x6e6a60), 0);
  addBox(parent, 0.5, 5.4, 0.5, PRISON.gateX + gateHalf, 2.7, southZ, mat(0x6e6a60), 0);

  // Corner watchtowers: shaft, cab, cone roof.
  const corners = [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]];
  for (let i = 0; i < corners.length; i++) {
    const tx = cx + corners[i][0];
    const tz = cz + corners[i][1];
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 7.5, 10), mat(0x8b867a));
    shaft.position.set(tx, 3.75, tz);
    parent.add(shaft);
    addBox(parent, 3.4, 2.0, 3.4, tx, 8.4, tz, mat(0x5c6068), 0);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.6, 8), mat(0x3c4048));
    cap.position.set(tx, 10.2, tz);
    parent.add(cap);
    registerCircle(tx, tz, 2.0);
  }

  // Cell block: a long grey slab with a slit-window facade.
  addFacadeBox(parent, 42, 8, 12, cx, 4, cz - 9, 0x8f8c84, 2, null, 0);
  addBox(parent, 42.35, 0.22, 12.35, cx, 8.11, cz - 9, mat(0x33363c), 0);
  registerBox(cx - 20.8, cx + 20.8, cz - 14.8, cz - 3.2);

  // Yard lamps: tall poles with emissive heads over the exercise yard.
  const lampSpots = [[-18, 12], [18, 12]];
  for (let i = 0; i < lampSpots.length; i++) {
    const lx = cx + lampSpots[i][0];
    const lz = cz + lampSpots[i][1];
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6.5, 8), mat(0x4a4d52));
    pole.position.set(lx, 3.25, lz);
    parent.add(pole);
    addBox(parent, 0.7, 0.3, 0.7, lx, 6.6, lz, mat(0xfff3b8, { emissive: 0xccb96a }), 0);
  }
  BUILD_STATS.namedStructures++;
}

function buildBoat(parent, x, z, hullColor, ry) {
  const boat = new THREE.Group();
  boat.position.set(x, 0.1, z);
  boat.rotation.y = ry || 0;
  parent.add(boat);
  addBox(boat, 2.2, 0.9, 6.4, 0, 0.45, 0, mat(hullColor), 0);
  addBox(boat, 1.7, 0.9, 2.2, 0, 1.3, -0.6, mat(0xf0ead8), 0);
  addBox(boat, 1.74, 0.4, 1.0, 0, 1.5, -0.6, mat(0x1a2430), 0);
  addBox(boat, 0.12, 2.2, 0.12, 0, 1.8, 1.4, mat(0x8a6f4d), 0);
}

function buildMarina(parent) {
  const wood = mat(0x8a6f4d);
  const woodDark = mat(0x74584a);
  // Dock planks run east off the shore into open water.
  addBox(parent, 30, 0.25, 3.2, 200, 0.15, MARINA.z, wood, 0);
  for (let x = 187; x <= 213; x += 4) {
    addBox(parent, 0.25, 0.3, 3.4, x, 0.16, MARINA.z, woodDark, 0);
  }
  addBox(parent, 2.4, 0.25, 9, 196, 0.15, MARINA.z + 6, wood, 0);
  addBox(parent, 2.4, 0.25, 9, 210, 0.15, MARINA.z - 6, wood, 0);
  buildBoat(parent, 203, MARINA.z + 7.5, 0xd8542e, 0.2);
  buildBoat(parent, 190, MARINA.z - 7.5, 0x2b6ea8, -0.15);
  buildBoat(parent, 214, MARINA.z + 5.5, 0xf0ead8, 0.1);

  // Crane on the quay: base, mast, angled jib, cable, hook, platform.
  const craneX = MARINA.x + 4;
  const craneZ = MARINA.z - 10;
  addBox(parent, 3.2, 1.0, 3.2, craneX, 0.5, craneZ, mat(0xd8a02e), 0);
  addBox(parent, 0.6, 7, 0.6, craneX, 4.5, craneZ, mat(0xb9862a), 0);
  addBox(parent, 2.2, 0.18, 2.2, craneX, 7.6, craneZ, mat(0x8a6f4d), 0);
  const jib = addBox(parent, 0.35, 0.35, 9, craneX, 9.2, craneZ + 3.4, mat(0xd8a02e), 0);
  jib.rotation.x = 0.5;
  addBox(parent, 0.06, 3.4, 0.06, craneX, 8.6, craneZ + 7.2, mat(0x2c2f35), 0);
  addBox(parent, 0.7, 0.7, 0.7, craneX, 6.8, craneZ + 7.2, mat(0x4a4d52), 0);
  registerCircle(craneX, craneZ, 1.9);
  registerBox(craneX - 0.3, craneX + 0.3, craneZ - 0.3, craneZ + 0.3);
  BUILD_STATS.namedStructures++;
}

function buildKeyTown(parent) {
  // Six huts ring the key's centre, each turned to face the middle.
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + 0.35;
    const hx = KEY_TOWN.x + Math.cos(ang) * 26;
    const hz = KEY_TOWN.z + Math.sin(ang) * 24;
    addHouse(parent, hx, hz, floatBetween(6, 8), floatBetween(5, 7),
      pickOne(HOUSE_PALETTE), pickOne(HOUSE_ROOFS));
  }
  // Tiny dock reaching south off the key.
  addBox(parent, 2.6, 0.25, 12, KEY_TOWN.x + 16, 0.15, KEY_TOWN.z + 46, mat(0x8a6f4d), 0);

  // Lighthouse: stacked red/white bands, a lit lamp room, cone cap.
  const lx = 6;
  const lz = 445;
  const bandH = 2.1;
  const bandColors = [0xd23b2e, 0xf2f0e8, 0xd23b2e, 0xf2f0e8, 0xd23b2e];
  for (let i = 0; i < bandColors.length; i++) {
    const r = 2.3 - i * 0.16;
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(r - 0.14, r, bandH, 14),
      mat(bandColors[i]),
    );
    band.position.set(lx, bandH * (i + 0.5), lz);
    parent.add(band);
  }
  const lampY = bandH * bandColors.length;
  const lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.15, 1.4, 12),
    mat(0xffe9a8, { emissive: 0xddaa33 }),
  );
  lamp.position.set(lx, lampY + 0.7, lz);
  parent.add(lamp);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.4, 12), mat(0x2c2f35));
  cap.position.set(lx, lampY + 2.1, lz);
  parent.add(cap);
  registerCircle(lx, lz, 2.5);

  // Rotating beam: an open translucent cone in a group pivoted at the
  // lamp, so updateCity only has to spin the group.
  lighthouseBeam = new THREE.Group();
  lighthouseBeam.position.set(lx, lampY + 0.7, lz);
  const beamMat = new THREE.MeshLambertMaterial({
    color: 0xffe9a8, transparent: true, opacity: 0.32,
  });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(2.0, 15, 14, 1, true), beamMat);
  // Cone axis is Y with the apex up; laying it on its side points the
  // wide end away from the lamp along +x.
  beam.rotation.z = Math.PI / 2;
  beam.position.x = 7.5;
  lighthouseBeam.add(beam);
  parent.add(lighthouseBeam);
  BUILD_STATS.namedStructures++;
}

function buildGarage(parent) {
  const group = new THREE.Group();
  group.position.set(GARAGE.x, 0, GARAGE.z);
  parent.add(group);
  const wall = mat(0xb0a894);
  const h = 4.2;
  // Open front faces south: back and side walls only, plus a roof slab.
  addBox(group, 14, h, 0.4, 0, h / 2, -6, wall, 0);
  addBox(group, 0.4, h, 12.4, -7, h / 2, 0, wall, 0);
  addBox(group, 0.4, h, 12.4, 7, h / 2, 0, wall, 0);
  addBox(group, 14.6, 0.3, 13, 0, h + 0.15, 0, mat(0x4a4d52), 0);
  addBox(group, 14.2, 0.5, 0.3, 0, h - 0.25, 6.1, mat(0xd8542e), 0);
  // Lift slab inside, ready for a car to sit on.
  addBox(group, 5.4, 0.35, 2.4, 0, 0.18, -1, mat(0x6e7278), 0);
  addSignBoard(group, 7, 1.2, 0, 3.4, 6.28, 'GARAGE', 0);
  registerBox(GARAGE.x - 7.2, GARAGE.x + 7.2, GARAGE.z - 6.2, GARAGE.z - 5.8);
  registerBox(GARAGE.x - 7.2, GARAGE.x - 6.8, GARAGE.z - 6.2, GARAGE.z + 6.2);
  registerBox(GARAGE.x + 6.8, GARAGE.x + 7.2, GARAGE.z - 6.2, GARAGE.z + 6.2);
  BUILD_STATS.namedStructures++;
}

function buildSurfShack(parent) {
  const sx = 182;
  const sz = 44;
  addFacadeBox(parent, 6, 3, 5, sx, 1.5, sz, 0xe8d8a8, 1, null, 0);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4), mat(0xc9a86a));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(6 * 0.72, 1.6, 5 * 0.72);
  roof.position.set(sx, 3 + 0.8, sz);
  parent.add(roof);
  // Striped awning over the west face, toward the beach road.
  const awn = new THREE.Group();
  awn.position.set(sx - 3.4, 2.5, sz);
  awn.rotation.z = 0.35;
  parent.add(awn);
  for (let i = 0; i < 5; i++) {
    addBox(awn, 2.0, 0.08, 0.95, 0, 0, -2 + i, mat(i % 2 ? 0xd8542e : 0xf2ead2), 0);
  }
  registerBox(sx - 2.8, sx + 2.8, sz - 2.3, sz + 2.3);
  BUILD_STATS.namedStructures++;
}

function buildNamedStructures(parent) {
  buildHome(parent);
  buildPoliceStation(parent);
  buildFireStation(parent);
  buildPrison(parent);
  buildMarina(parent);
  buildKeyTown(parent);
  buildGarage(parent);
  buildSurfShack(parent);
}

// --- B5: town buildings ------------------------------------------------------

const TOWN_PALETTE = [
  0xd8c8a8, 0xcbb59a, 0xe3d9c0, 0xb7c3c9, 0xd9b48f, 0xc4cfc0, 0xe8e0cc,
];

function buildTownBuildings(parent) {
  const list = Array.isArray(FACILITIES) ? FACILITIES : [];
  const anchors = [];
  for (let i = 0; i < list.length; i++) {
    const a = facilityAnchor(list[i]);
    if (a) anchors.push(a);
  }

  for (let t = 0; t < TOWNS.length; t++) {
    const town = TOWNS[t];
    const tz = townZOf(town);
    // Reseed per town from its own seed so each town's layout is stable
    // and distinct no matter what the city pass consumed beforehand.
    if (typeof town.seed === 'number') seedWith(town.seed);
    else if (typeof town.seed === 'string') seedWith(texHash(town.seed));
    else seedWith(WORLD_SEED + t * 7919);

    // Anchors belonging to this town (near its centre) clear their lots.
    const local = [];
    for (let i = 0; i < anchors.length; i++) {
      if (Math.abs(anchors[i].z - tz) <= 90 && Math.abs(anchors[i].x) <= 90) {
        local.push(anchors[i]);
      }
    }
    function lotClear(x, z) {
      for (let i = 0; i < local.length; i++) {
        const dx = x - local[i].x;
        const dz = z - local[i].z;
        if (dx * dx + dz * dz < 11 * 11) return false;
      }
      return true;
    }
    function placeTownLot(x, z) {
      const w = floatBetween(9, 13);
      const d = floatBetween(9, 13);
      const bx = Math.max(-64 + w / 2, Math.min(64 - w / 2, x));
      if (!lotClear(bx, z)) return;
      const h = floatBetween(5, 10);
      addBuilding(parent, bx, z, w, d, h, pickOne(TOWN_PALETTE), null);
      BUILD_STATS.townBuildings++;
    }

    // Main street: lots front the highway on both sides.
    const frontX = ROAD_W / 2 + 10;
    for (let z = tz - 60; z <= tz + 60; z += 16) {
      placeTownLot(-frontX + floatBetween(-1.5, 1.5), z + floatBetween(-2, 2));
      placeTownLot(frontX + floatBetween(-1.5, 1.5), z + floatBetween(-2, 2));
    }
    // Side streets: one row along each, on its outer side facing in.
    const streetOff = 5 + 6.5 + 1;
    for (let x = -60; x <= 60; x += 16) {
      if (Math.abs(x) < 12) continue; // keep the highway crossing open
      placeTownLot(x + floatBetween(-2, 2), tz - 40 - streetOff + floatBetween(-1, 1));
      placeTownLot(x + floatBetween(-2, 2), tz + 40 + streetOff + floatBetween(-1, 1));
    }

    // Welcome sign where the highway arrives from the south.
    const sign = new THREE.Group();
    sign.position.set(10, 0, tz + 78);
    parent.add(sign);
    const postMat = mat(0x74584a);
    addBox(sign, 0.22, 3.0, 0.22, -2.2, 1.5, 0, postMat, 0);
    addBox(sign, 0.22, 3.0, 0.22, 2.2, 1.5, 0, postMat, 0);
    addSignBoard(sign, 5.6, 1.5, 0, 2.6, 0, town.name || 'TOWN', 0);
  }

  // Restore the world seed so anything placed after towns stays stable.
  seedWith(WORLD_SEED);
}

// ---------------------------------------------------------------------------
// Part C — dressing and life
// ---------------------------------------------------------------------------
// Static set dressing over the built city: the flyover deck, signals,
// lamps, vegetation, highway stops and landmarks. Animated pieces keep
// their materials in module-level slots so updateCity can drive them.

// Per-light unique materials, so one head's lamps never share state
// with another head that happens to use the same colour.
const trafficLights = [];
let radioBeaconMat = null;
let radioBeacon = null;

function addCylinder(parent, rTop, rBot, h, x, y, z, material, seg) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBot, h, seg || 10), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function addSphere(parent, r, x, y, z, material) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// Wide board texture for billboards and the arch: one line, big letters.
const boardTexCache = new Map();
function boardMaterial(text, bg, fg) {
  const key = 'board|' + text + '|' + bg;
  let m = boardTexCache.get(key);
  if (m) return m;
  const canvas = makeCanvas(512, 160);
  if (!canvas) { m = mat(bg); boardTexCache.set(key, m); return m; }
  const ctx = canvas.getContext('2d');
  if (!ctx) { m = mat(bg); boardTexCache.set(key, m); return m; }
  ctx.fillStyle = cssColor(bg);
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = cssColor(fg);
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 496, 144);
  ctx.fillStyle = cssColor(fg);
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(text).toUpperCase(), 256, 84, 480);
  m = new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(canvas) });
  boardTexCache.set(key, m);
  return m;
}

function addBoard(parent, w, h, x, y, z, text, bg, fg, ry) {
  const mesh = new THREE.Mesh(unitBox(), boardMaterial(text, bg, fg));
  mesh.scale.set(w, h, 0.25);
  mesh.position.set(x, y, z);
  if (ry) mesh.rotation.y = ry;
  parent.add(mesh);
  return mesh;
}

// --- C1: flyover deck -------------------------------------------------------

function buildFlyoverDeck(parent) {
  const deckMat = mat(0x3a3d44);
  const railMat = mat(0xb9bdc4);
  // Segmented slabs follow the same profile floorHeight reports, so
  // what a mover stands on is exactly what it sees.
  for (let z = -155; z <= 155; z += 10) {
    const h = flyoverDeckHeight(z);
    if (h <= 0.05) continue;
    addBox(parent, 13, 0.5, 10.6, FLYOVER_X, h - 0.25, z, deckMat, 0);
    // Guard rails run along both edges of every segment.
    addBox(parent, 0.25, 0.7, 10.6, FLYOVER_X - 6.3, h + 0.35, z, railMat, 0);
    addBox(parent, 0.25, 0.7, 10.6, FLYOVER_X + 6.3, h + 0.35, z, railMat, 0);
  }
  // Pillars down the centre line leave the ground road passable between
  // them; each one is a real obstacle, hence the circle collider.
  const pillarMat = mat(0x8b9096);
  for (let z = -144; z <= 144; z += 24) {
    const h = flyoverDeckHeight(z);
    if (h <= 0.6) continue;
    addCylinder(parent, 0.9, 1.05, h, FLYOVER_X, h / 2, z, pillarMat, 12);
    registerCircle(FLYOVER_X, z, 1.1);
  }
  // Name board on the east side of the flat middle span.
  addSignBoard(parent, 12, 1.8, FLYOVER_X + 6.75, 4.2, 0, 'PALM FLYOVER', Math.PI / 2);
}

// --- C2: traffic lights -----------------------------------------------------

function makeLampHead(parent, x, y, z, axis) {
  addBox(parent, 0.55, 1.5, 0.55, x, y, z, mat(0x17181c), 0);
  // Unique emissive materials per lamp: updateCity drives these.
  const mats = {
    red: new THREE.MeshLambertMaterial({ color: 0xff2a20, emissive: 0xff2a20, emissiveIntensity: 0.08 }),
    amber: new THREE.MeshLambertMaterial({ color: 0xffa018, emissive: 0xffa018, emissiveIntensity: 0.08 }),
    green: new THREE.MeshLambertMaterial({ color: 0x2aff5a, emissive: 0x2aff5a, emissiveIntensity: 0.08 }),
  };
  addBox(parent, 0.3, 0.3, 0.3, x, y + 0.48, z, mats.red, 0);
  addBox(parent, 0.3, 0.3, 0.3, x, y, z, mats.amber, 0);
  addBox(parent, 0.3, 0.3, 0.3, x, y - 0.48, z, mats.green, 0);
  trafficLights.push({ axis, mats });
}

function buildTrafficLights(parent) {
  const poleMat = mat(0x3c4048);
  const xs = [-150, -75, 75, 150];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    // East-west head: pole on the south-east corner, arm reaching north
    // over the boulevard, head hanging at its end.
    addCylinder(parent, 0.12, 0.14, 5.4, x + 8.5, 2.7, 12.5, poleMat, 8);
    registerCircle(x + 8.5, 12.5, 0.3);
    addBox(parent, 0.16, 0.16, 7, x + 8.5, 5.35, 9.2, poleMat, 0);
    makeLampHead(parent, x + 8.5, 4.4, 6.2, 'ew');
    // North-south head: opposite corner, arm reaching east over the
    // cross street so the two axes read independently.
    addCylinder(parent, 0.12, 0.14, 5.4, x - 8.5, 2.7, -12.5, poleMat, 8);
    registerCircle(x - 8.5, -12.5, 0.3);
    addBox(parent, 7, 0.16, 0.16, x - 5.2, 5.35, -12.5, poleMat, 0);
    makeLampHead(parent, x - 2.2, 4.4, -12.5, 'ns');
  }
}

// --- C3: street lamps -------------------------------------------------------

function buildStreetLamp(parent, x, z, armDirX, armDirZ) {
  const poleMat = mat(0x4a4d52);
  addCylinder(parent, 0.09, 0.11, 4.6, x, 2.3, z, poleMat, 8);
  addBox(parent, Math.abs(armDirX) > 0 ? 1.8 : 0.14, 0.14,
    Math.abs(armDirZ) > 0 ? 1.8 : 0.14,
    x + armDirX * 0.85, 4.55, z + armDirZ * 0.85, poleMat, 0);
  // Warm head over the kerb edge the arm points toward.
  addBox(parent, 0.55, 0.22, 0.55, x + armDirX * 1.7, 4.5, z + armDirZ * 1.7,
    mat(0xffdf9e, { emissive: 0xccaa55 }), 0);
  registerCircle(x, z, 0.3);
}

function buildStreetLamps(parent) {
  // Boulevard: both kerbs, staggered every 30 units.
  for (let x = -180; x <= 180; x += 30) {
    buildStreetLamp(parent, x, -12.8, 0, 1);
    buildStreetLamp(parent, x + 15, 12.8, 0, -1);
  }
  // Each town's main street (its southern east-west street).
  for (let t = 0; t < TOWNS.length; t++) {
    const tz = townZOf(TOWNS[t]) + 40;
    for (let x = -60; x <= 60; x += 30) {
      buildStreetLamp(parent, x, tz - 6.6, 0, 1);
      buildStreetLamp(parent, x + 15, tz + 6.6, 0, -1);
    }
  }
}

// --- C4: vegetation ---------------------------------------------------------

function buildPalm(parent, x, z) {
  const trunkMat = mat(0x8a6f4d);
  const frondMat = mat(0x3f7d33);
  const segH = floatBetween(1.5, 1.9);
  // Lean direction is seeded, so the same palm leans the same way on
  // every load; segments lean progressively like a real curved trunk.
  const ang = nextFloat() * Math.PI * 2;
  const dx = Math.cos(ang);
  const dz = Math.sin(ang);
  const stepLean = 0.3;
  for (let i = 0; i < 3; i++) {
    const off = stepLean * (i + 0.5);
    const seg = addCylinder(parent, 0.17 - i * 0.03, 0.22 - i * 0.03, segH,
      x + dx * off, segH * (i + 0.5), z + dz * off, trunkMat, 7);
    seg.rotation.z = -dx * 0.18;
    seg.rotation.x = dz * 0.18;
  }
  const topX = x + dx * stepLean * 3;
  const topZ = z + dz * stepLean * 3;
  const topY = segH * 3;
  // Six fronds fan out from the crown, each a flattened tilted box.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const frond = addMesh(parent, new THREE.BoxGeometry(0.28, 0.06, 2.4),
      frondMat, topX + Math.cos(a) * 1.05, topY + 0.25, topZ + Math.sin(a) * 1.05);
    frond.rotation.y = -a + Math.PI / 2;
    frond.rotation.x = Math.sin(a) * 0.5;
    frond.rotation.z = -Math.cos(a) * 0.5;
  }
  addSphere(parent, 0.32, topX, topY + 0.05, topZ, mat(0x6e5638));
  registerCircle(x, z, 0.45);
}

function buildLeafyTree(parent, x, z) {
  addCylinder(parent, 0.22, 0.3, 2.3, x, 1.15, z, mat(0x74584a), 8);
  const leafMat = mat(pickOne([0x4d8f3f, 0x5da24a, 0x3f7d33]));
  addSphere(parent, floatBetween(1.6, 2.0), x, 3.4, z, leafMat);
  addSphere(parent, 1.3, x + 1.0, 2.8, z + 0.5, leafMat);
  addSphere(parent, 1.15, x - 0.9, 2.9, z - 0.6, leafMat);
  registerCircle(x, z, 0.45);
}

function buildVegetation(parent) {
  // Boulevard median palms, skipping the crossings where the median
  // strip itself is broken for cross traffic.
  for (let x = -182; x <= 182; x += 26) {
    let nearCrossing = false;
    for (let i = 0; i < CITY_ROADS_Z.length; i++) {
      if (Math.abs(x - CITY_ROADS_Z[i]) < 11) nearCrossing = true;
    }
    if (!nearCrossing) buildPalm(parent, x, 0);
  }
  // Beach palms scattered along the east shore.
  for (let i = 0; i < 14; i++) {
    buildPalm(parent, floatBetween(174, 186), floatBetween(-40, 120));
  }
  // A loose ring of palms around Key Solano's huts.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    buildPalm(parent, KEY_TOWN.x + Math.cos(a) * floatBetween(36, 46),
      KEY_TOWN.z + Math.sin(a) * floatBetween(34, 44));
  }
  // Leafy trees shade the towns' block interiors.
  for (let t = 0; t < TOWNS.length; t++) {
    const tz = townZOf(TOWNS[t]);
    for (let i = 0; i < 10; i++) {
      let x = floatBetween(-64, 64);
      if (Math.abs(x) < 11) x += x < 0 ? -14 : 14;
      const z = tz + pickOne([-58, -22, 22, 58]) + floatBetween(-4, 4);
      buildLeafyTree(parent, x, z);
    }
  }
  // Coral Heights gardens: the leafy band between z 75 and z 150.
  for (let i = 0; i < 12; i++) {
    let x = floatBetween(-170, 170);
    for (let r = 0; r < CITY_ROADS_X.length; r++) {
      if (Math.abs(x - CITY_ROADS_X[r]) < 10) x += 16;
    }
    buildLeafyTree(parent, x, floatBetween(86, 140));
  }
}

// --- C5: farms, trailers, rest stops, billboards ----------------------------

function buildFarm(parent, fx, fz) {
  // Red barn with a pyramid roof, solid enough to need its own AABB.
  addBox(parent, 10, 5, 8, fx, 2.5, fz, mat(0xa83226), 0);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4), mat(0x6e3a2a));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(10 * 0.72, 2.6, 8 * 0.72);
  roof.position.set(fx, 5 + 1.3, fz);
  parent.add(roof);
  addBox(parent, 3, 3.4, 0.2, fx, 1.7, fz + 4.05, mat(0xf0ead8), 0);
  registerBox(fx - 4.8, fx + 4.8, fz - 3.8, fz + 3.8);
  // Silo: tall cylinder with a hemispherical cap beside the barn.
  const sx = fx + 9;
  addCylinder(parent, 2, 2, 11, sx, 5.5, fz, mat(0xb9bdc4), 14);
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    mat(0x8b9096));
  cap.position.set(sx, 11, fz);
  parent.add(cap);
  registerCircle(sx, fz, 2.2);
  // Crop rows run parallel east of the barn.
  const cropMat = mat(0x5da24a);
  for (let i = 0; i < 9; i++) {
    addBox(parent, 1.2, 0.5, 28, fx + 18 + i * 2.4, 0.25, fz, cropMat, 0);
  }
  // Fence posts line the front of the plot.
  for (let x = fx - 12; x <= fx + 30; x += 3) {
    addBox(parent, 0.18, 1.1, 0.18, x, 0.55, fz + 12, mat(0x74584a), 0);
  }
  addBox(parent, 42, 0.14, 0.14, fx + 9, 0.95, fz + 12, mat(0x8a6f4d), 0);
}

function buildTrailers(parent) {
  const cx = -52;
  const cz = -1750;
  const spots = [[-11, -7], [10, -8], [-9, 8], [12, 6]];
  const colours = [0xd8d3c3, 0xb7c3c9, 0xe3d9c0, 0xc9a689];
  for (let i = 0; i < spots.length; i++) {
    const tx = cx + spots[i][0];
    const tz = cz + spots[i][1];
    // Stilts lift the body clear of the ground like a parked trailer.
    const stiltMat = mat(0x6e6a60);
    addBox(parent, 0.35, 0.6, 0.35, tx - 3, 0.3, tz - 1, stiltMat, 0);
    addBox(parent, 0.35, 0.6, 0.35, tx + 3, 0.3, tz - 1, stiltMat, 0);
    addBox(parent, 0.35, 0.6, 0.35, tx - 3, 0.3, tz + 1, stiltMat, 0);
    addBox(parent, 0.35, 0.6, 0.35, tx + 3, 0.3, tz + 1, stiltMat, 0);
    addBox(parent, 7.4, 2.7, 2.8, tx, 0.6 + 1.35, tz, mat(colours[i]), 0);
    addBox(parent, 7.5, 0.18, 2.9, tx, 3.4, tz, mat(0x8b9096), 0);
    // Awning shades the long south side of each unit.
    const awn = addBox(parent, 5.5, 0.08, 1.6, tx, 2.7, tz + 2.1, mat(0xd8542e), 0);
    awn.rotation.x = 0.25;
    registerBox(tx - 3.5, tx + 3.5, tz - 1.2, tz + 1.2);
  }
  // Shared fire pit at the middle of the cluster.
  addCylinder(parent, 1.0, 1.1, 0.35, cx, 0.18, cz, mat(0x2c2a26), 12);
  addBox(parent, 0.5, 0.3, 0.5, cx, 0.45, cz, mat(0xff7a2a, { emissive: 0xcc4400 }), 0);
}

function buildRestStop(parent, rx, rz) {
  const poleMat = mat(0x74584a);
  const corners = [[-3.6, -2.6], [3.6, -2.6], [-3.6, 2.6], [3.6, 2.6]];
  for (let i = 0; i < corners.length; i++) {
    const px = rx + corners[i][0];
    const pz = rz + corners[i][1];
    addCylinder(parent, 0.13, 0.13, 3, px, 1.5, pz, poleMat, 8);
    registerCircle(px, pz, 0.25);
  }
  // Flat canopy roof shades the tables below.
  addBox(parent, 8.6, 0.25, 6.2, rx, 3.1, rz, mat(0x9c5a3c), 0);
  for (let i = 0; i < 2; i++) {
    const tx = rx - 2 + i * 4;
    // Picnic table: top slab on two legs, benches either side.
    addBox(parent, 1.9, 0.1, 0.95, tx, 0.78, rz, mat(0x8a6f4d), 0);
    addBox(parent, 0.14, 0.75, 0.85, tx - 0.7, 0.38, rz, poleMat, 0);
    addBox(parent, 0.14, 0.75, 0.85, tx + 0.7, 0.38, rz, poleMat, 0);
    addBox(parent, 1.9, 0.08, 0.35, tx, 0.45, rz - 0.85, mat(0x8a6f4d), 0);
    addBox(parent, 1.9, 0.08, 0.35, tx, 0.45, rz + 0.85, mat(0x8a6f4d), 0);
  }
  addSignBoard(parent, 3.6, 1.0, rx, 2.2, rz + 3.3, 'REST STOP', 0);
}

function buildBillboards(parent) {
  const slogans = [
    'VISIT PALM COVE',
    'COVE BANK — SUNNIER MONEY',
    'MARLIN ARMS',
    'CLUB NEON PALMS — ALL NIGHT',
    'FAR SHORE MOTEL',
    'PALM KITCHEN — EAT',
  ];
  const zs = [-600, -1200, -1900, -2500, -3300, -3900];
  const poleMat = mat(0x6e7278);
  for (let i = 0; i < zs.length; i++) {
    // Boards alternate sides of the highway so both directions read.
    const bx = i % 2 === 0 ? 17 : -17;
    const bz = zs[i];
    addCylinder(parent, 0.22, 0.22, 7, bx, 3.5, bz - 3.4, poleMat, 8);
    addCylinder(parent, 0.22, 0.22, 7, bx, 3.5, bz + 3.4, poleMat, 8);
    registerCircle(bx, bz - 3.4, 0.35);
    registerCircle(bx, bz + 3.4, 0.35);
    // Panel runs along z and faces the highway traffic.
    const panel = new THREE.Mesh(unitBox(),
      boardMaterial(slogans[i], 0x14324a, 0xf7efdb));
    panel.scale.set(10, 4, 0.3);
    panel.position.set(bx, 8.6, bz);
    panel.rotation.y = Math.PI / 2;
    parent.add(panel);
    addBox(parent, 0.35, 4.2, 10.3, bx + (bx > 0 ? 0.25 : -0.25), 8.6, bz, mat(0x2c2f35), 0);
  }
}

// --- C6: landmarks and beach props ------------------------------------------

function buildArch(parent) {
  const stone = mat(0xd8c9a3);
  // Pillars stand on the road edges so the boulevard stays passable.
  addBox(parent, 1.4, 7.5, 1.4, 120, 3.75, -13, stone, 0);
  addBox(parent, 1.4, 7.5, 1.4, 120, 3.75, 13, stone, 0);
  registerBox(120 - 0.7, 120 + 0.7, -13 - 0.7, -13 + 0.7);
  registerBox(120 - 0.7, 120 + 0.7, 13 - 0.7, 13 + 0.7);
  addBox(parent, 1.6, 1.7, 28.5, 120, 8.2, 0, stone, 0);
  // Big letters face both directions of boulevard traffic.
  addBoard(parent, 17, 2.4, 119.1, 8.2, 0, 'PALM COVE', 0x14324a, 0xf7efdb, -Math.PI / 2);
  addBoard(parent, 17, 2.4, 120.9, 8.2, 0, 'PALM COVE', 0x14324a, 0xf7efdb, Math.PI / 2);
  BUILD_STATS.namedStructures++;
}

function buildWaterTower(parent) {
  const wx = -160;
  const wz = -182;
  const legMat = mat(0x8b9096);
  const legs = [[-3, -3], [3, -3], [-3, 3], [3, 3]];
  for (let i = 0; i < legs.length; i++) {
    addBox(parent, 0.45, 12, 0.45, wx + legs[i][0], 6, wz + legs[i][1], legMat, 0);
  }
  // Cross braces keep the spindly legs reading as one structure.
  addBox(parent, 6.4, 0.25, 0.25, wx, 4, wz - 3, legMat, 0);
  addBox(parent, 6.4, 0.25, 0.25, wx, 8, wz + 3, legMat, 0);
  addBox(parent, 0.25, 0.25, 6.4, wx - 3, 8, wz, legMat, 0);
  addBox(parent, 0.25, 0.25, 6.4, wx + 3, 4, wz, legMat, 0);
  const tank = addCylinder(parent, 4.5, 4.5, 6, wx, 15, wz, mat(0xb7c3c9), 18);
  tank.scale.z = 1;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(4.9, 2, 18), mat(0x9c5a3c));
  cap.position.set(wx, 19, wz);
  parent.add(cap);
  // Painted name rides on a board bolted to the tank's south face.
  addSignBoard(parent, 8, 1.8, wx, 15.4, wz + 4.6, 'PALM COVE', 0);
  // One AABB covers the whole leg footprint.
  registerBox(wx - 3.5, wx + 3.5, wz - 3.5, wz + 3.5);
  BUILD_STATS.namedStructures++;
}

function buildRadioTower(parent) {
  const tx = -120;
  const tz = -500;
  const mastMat = mat(0x9aa0a8);
  const height = 46;
  // Four legs slant inward as they climb, giving the mast its taper.
  const legBase = [[-3, -3], [3, -3], [-3, 3], [3, 3]];
  for (let i = 0; i < legBase.length; i++) {
    const lx = legBase[i][0];
    const lz = legBase[i][1];
    const leg = addBox(parent, 0.32, height, 0.32,
      tx + lx * 0.55, height / 2, tz + lz * 0.55, mastMat, 0);
    leg.rotation.z = lx > 0 ? 0.058 : -0.058;
    leg.rotation.x = lz > 0 ? -0.058 : 0.058;
  }
  // Cross-braced square rings shrink with height up the mast.
  for (let lvl = 0; lvl < 5; lvl++) {
    const y = 8 + lvl * 8;
    const half = 3 - (y / height) * 2.2;
    addBox(parent, half * 2, 0.2, 0.2, tx, y, tz - half, mastMat, 0);
    addBox(parent, half * 2, 0.2, 0.2, tx, y, tz + half, mastMat, 0);
    addBox(parent, 0.2, 0.2, half * 2, tx - half, y, tz, mastMat, 0);
    addBox(parent, 0.2, 0.2, half * 2, tx + half, y, tz, mastMat, 0);
  }
  addBox(parent, 1.6, 1.2, 1.6, tx, height + 0.4, tz, mat(0x4a4d52), 0);
  // Blinking beacon: its material is kept aside for updateCity.
  radioBeaconMat = new THREE.MeshLambertMaterial({
    color: 0xff2a20, emissive: 0xff2a20, emissiveIntensity: 2.4,
  });
  radioBeacon = addSphere(parent, 0.55, tx, height + 1.6, tz, radioBeaconMat);
  registerCircle(tx, tz, 3.6);
  BUILD_STATS.namedStructures++;
}

function buildFlamingo(parent) {
  const fx = 184;
  const fz = 12;
  const pink = mat(0xe86a9a);
  const darkPink = mat(0xd14f83);
  // Two thin legs hold the body about seven units tall overall.
  addCylinder(parent, 0.09, 0.09, 3.2, fx - 0.5, 1.6, fz, darkPink, 6);
  addCylinder(parent, 0.09, 0.09, 3.2, fx + 0.5, 1.6, fz + 0.3, darkPink, 6);
  const body = addSphere(parent, 1.7, fx, 4.1, fz, pink);
  body.scale.set(1.05, 0.85, 1.35);
  addSphere(parent, 1.0, fx, 4.3, fz - 1.6, darkPink);
  // S-neck: segments climb, then tip forward into the head.
  const neckPts = [[0, 4.9, -1.9], [0, 5.8, -2.2], [0, 6.5, -2.0], [0, 6.9, -1.5]];
  for (let i = 0; i < neckPts.length; i++) {
    addCylinder(parent, 0.26, 0.3, 1.0,
      fx + neckPts[i][0], neckPts[i][1], fz + neckPts[i][2], pink, 8);
  }
  addSphere(parent, 0.55, fx, 7.1, fz - 1.2, pink);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.1, 8), mat(0xf2a03c));
  beak.rotation.x = Math.PI / 2 + 0.5;
  beak.position.set(fx, 6.95, fz - 0.5);
  parent.add(beak);
  registerCircle(fx, fz, 1.8);
  BUILD_STATS.namedStructures++;
}

function buildBeachProps(parent) {
  const canopyColours = [0xd8542e, 0x2b6ea8, 0xf2c12e, 0x3fae6a, 0xe86a9a, 0x7a5fd0];
  for (let i = 0; i < 6; i++) {
    const ux = floatBetween(178, 186);
    const uz = -30 + i * 28 + floatBetween(-6, 6);
    addCylinder(parent, 0.06, 0.06, 2.3, ux, 1.15, uz, mat(0xf0ead8), 6);
    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(1.9, 0.75, 10), mat(canopyColours[i]));
    canopy.position.set(ux, 2.5, uz);
    parent.add(canopy);
    // Towel flat on the sand beside each umbrella.
    const towel = addBox(parent, 1.1, 0.04, 2.1, ux + 1.8, 0.05, uz + 0.6,
      mat(canopyColours[(i + 2) % canopyColours.length]), 0);
    towel.rotation.y = floatBetween(-0.5, 0.5);
  }
}

function buildDressing(parent) {
  buildFlyoverDeck(parent);
  buildTrafficLights(parent);
  buildStreetLamps(parent);
  buildVegetation(parent);
  buildFarm(parent, 60, -900);
  buildFarm(parent, -70, -2600);
  buildTrailers(parent);
  buildRestStop(parent, 12, -900);
  buildRestStop(parent, -12, -3050);
  buildBillboards(parent);
  buildArch(parent);
  buildWaterTower(parent);
  buildRadioTower(parent);
  buildFlamingo(parent);
  buildBeachProps(parent);
}
