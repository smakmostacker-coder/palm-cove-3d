// World generation — Palm Cove and the peninsula it sits on.
//
// Geography, south to north: a Keys island chain over causeways, the city
// itself near the southern tip (five districts on a five-by-five road grid,
// ocean and beaches on both coasts), the Everglades marsh as a wide interior,
// and then the long peninsula spine — a single highway running thousands of
// units north through roadside towns to a broad panhandle. Crossing the whole
// landmass is a drive measured in minutes; the city is only its first stop.
//
// Everything visual is instanced or pooled and every texture is painted on a
// canvas at boot, so a big world stays a light scene: fog caps the view, and
// collision data is plain arrays of numbers, never per-prop objects in the
// render graph.
import { ROADS, ROAD_W, WORLD, KEYS, CAUSEWAY, MARSH, districtAt, isDowntown, FIRE_STATION, SITES, HOSPITAL } from './config.js';
import { makeRng, pick, pickWeighted } from './random.js';

// Building footprints: {x, z, hw, hd} axis-aligned boxes.
export const colliders = [];
// Buildings placed per district/region, filled in during buildCity — the
// HUD/debug surface reads it and the rework report quotes it.
export const buildingCounts = {};
// Every rendered building's footprint {x, z, hw, hd}, recorded at placement
// time from the SAME numbers that produce its collider — the collision
// audit pairs each record against `colliders` and any mismatch is a
// pass-through ghost. Placement code must go through placeRecord() below
// (or push both entries itself) so a mesh can never exist without its box.
export const buildingRecords = [];
// Street-furniture footprints: {x, z, r} circles for tree trunks, lamp and
// traffic-light poles, sign posts, hydrants, palms and towers. Props are
// solid — the player, pedestrians, traffic and police all resolve against
// this list, and vehicles take damage for hitting it (see driving.js).
export const propColliders = [];

export function addProp(x, z, r) { propColliders.push({ x, z, r }); }

// Push a position out of every prop circle it overlaps. Returns true when a
// push happened, so vehicle code can treat it as an impact.
export function collideProps(pos, radius) {
  let hit = false;
  for (const c of propColliders) {
    const dx = pos.x - c.x, dz = pos.z - c.z;
    const rr = c.r + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      pos.x = c.x + (dx / d) * rr;
      pos.z = c.z + (dz / d) * rr;
      hit = true;
    }
  }
  return hit;
}

// Interior mode: while the player is inside a walk-in room, collision
// resolves against that room's furniture/wall list instead of the world,
// and the world bounds do not apply. facilities.js owns the switching.
let roomColliders = null;
export function setRoomColliders(list) { roomColliders = list; }
export function inRoom() { return !!roomColliders; }

// opts.sea (player swimming only): building/prop collision still applies,
// but the LAND clamp is replaced by clampSea — the swimmer is bounded by
// the offshore line, not the shoreline. Every other caller passes no opts
// and gets the land clamp exactly as before.
export function collideBuildings(pos, radius, opts) {
  if (roomColliders) {
    for (const c of roomColliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const px = c.hw + radius - Math.abs(dx), pz = c.hd + radius - Math.abs(dz);
      if (px > 0 && pz > 0) {
        if (px < pz) pos.x = c.x + (dx >= 0 ? c.hw + radius : -c.hw - radius);
        else pos.z = c.z + (dz >= 0 ? c.hd + radius : -c.hd - radius);
      }
    }
    return { building: false, prop: false };
  }
  let building = false;
  for (const c of colliders) {
    const dx = pos.x - c.x, dz = pos.z - c.z;
    const px = c.hw + radius - Math.abs(dx), pz = c.hd + radius - Math.abs(dz);
    if (px > 0 && pz > 0) {
      building = true;
      if (px < pz) pos.x = c.x + (dx >= 0 ? c.hw + radius : -c.hw - radius);
      else pos.z = c.z + (dz >= 0 ? c.hd + radius : -c.hd - radius);
    }
  }
  const prop = collideProps(pos, radius);
  if (opts && opts.sea) clampSea(pos);
  else clampWorld(pos);
  return { building, prop };
}

// ---- The long peninsula -------------------------------------------------
// The spine runs north from the marsh to the panhandle. NORTH_END is the far
// shore; SPINE_HALF is the land half-width along the way (the panhandle is
// much wider). A drive from the city (z ~ +60) to NORTH_END is ~4,300 units.
export const NORTH_END = -4280;
export const PANHANDLE_Z = -3880; // north of this, the land widens out
export function landHalfWidthAt(z) {
  if (z >= -WORLD - 10) return 232;              // city plateau + beaches
  if (z > PANHANDLE_Z) return 188;               // peninsula spine
  return 690;                                    // panhandle
}
export function worldLength() { return 442 - NORTH_END; } // Keys tip to far shore

// Named places. The HUD prefers a landmark name over the district name, so
// these double as the regions you pass through on the long drive north.
export const LANDMARKS = [
  { name: 'Ocean Drive Deco Strip', x: 192, z: 105, r: 88 },
  { name: 'Marlin Point Lighthouse', x: 216, z: 120, r: 46 },
  { name: 'Port of Palm Cove', x: -130, z: 120, r: 85 },
  { name: 'Southernmost Point — Key Solano', x: 0, z: 434, r: 42 },
  { name: 'Glades Airboat Dock', x: 0, z: -222, r: 40 },
  { name: 'Cape Marlin Spaceport (across the bay)', x: 330, z: -40, r: 135 },
  { name: 'Lake Okeechobee — South Shore', x: 0, z: -760, r: 190 },
  { name: 'Palmetto Flats', x: 0, z: -1420, r: 240 },
  { name: 'Cypress Junction', x: 0, z: -2080, r: 240 },
  { name: 'Kissimmee Prairie', x: 0, z: -2740, r: 240 },
  { name: 'Suwannee Crossing', x: 0, z: -3380, r: 240 },
  { name: 'Panhandle Gate', x: 0, z: -3980, r: 260 },
  { name: 'Tallahassee Palms — Far Shore', x: 0, z: -4240, r: 160 },
];
// Map data shared with hud.js's drawFloridaMap, exported so the maps draw
// the placed world itself rather than a hand-drawn approximation of it.
// Lake Okeechobee: the buildPeninsula disc (radius 95 scaled 1.25 × 0.8)
// expressed as an ellipse. MARSH_ROAD: the ROAD_W-wide plane buildCity lays
// across the marsh at (0, -262). FLYOVER_SEG: the elevated x=75 deck span
// (flyoverH's non-zero range). MARSH_CHANNELS is filled by buildCity from
// the very placements it renders — width, rotation and centre of each
// marsh water channel, in draw order — so map and world always agree,
// whatever the world seed.
export const LAKE_OKEECHOBEE = { x: 85, z: -780, rx: 95 * 1.25, rz: 95 * 0.8 };
export const MARSH_ROAD = { x: 0, z: -262, w: ROAD_W, len: 130 };
export const FLYOVER_SEG = { x: 75, z0: 30, z1: 120 };
export const MARSH_CHANNELS = [];
export function landmarkAt(x, z) {
  for (const l of LANDMARKS) if (Math.hypot(x - l.x, z - l.z) < l.r) return l.name;
  return '';
}

// ---- The reworked southern street plan -----------------------------------
// The old grid left 60-unit grass squares between the ROADS centrelines.
// The rework subdivides every southern block with a mid street (checkerboard
// axis, so junctions stagger), keeps buildings in frontage rows ON those
// streets and on the ROADS, and adds three one-off pieces: the Palm
// Boulevard dressing on the z=0 road, a diagonal pedestrian avenue cutting
// the (-37.5, 37.5) block corner to corner, a curved promenade down the
// east beach, and a plaza two blocks from spawn. SOUTH_STREETS is the data
// form of the mid streets — the minimap draws it and the placement checker
// validates frontage against it.
export const SOUTH_STREETS = [];
for (let i = 0; i < ROADS.length - 1; i++) for (let j = 0; j < ROADS.length - 1; j++) {
  if ((i === 2 && j === 2) || (i === 1 && j === 2)) continue; // plaza block / diagonal block
  const cx = (ROADS[i] + ROADS[i + 1]) / 2, cz = (ROADS[j] + ROADS[j + 1]) / 2;
  if ((i + j) % 2 === 0) SOUTH_STREETS.push({ axis: 'ew', at: cz, from: ROADS[i] + ROAD_W / 2, to: ROADS[i + 1] - ROAD_W / 2, halfW: 4 });
  else SOUTH_STREETS.push({ axis: 'ns', at: cx, from: ROADS[j] + ROAD_W / 2, to: ROADS[j + 1] - ROAD_W / 2, halfW: 4 });
}
// ---- Peninsula grid towns (round 5) --------------------------------------
// Real towns on the spine are DATA, not clusters: each entry in TOWN_GRIDS
// is built by one generic grid builder in buildPeninsula — EW streets at
// ewZ spanning x0..x1, NS streets at nsX spanning z0..z1, buildings fronting
// those streets, lamps/trees/signs as props. To add a town, add one entry
// here (name, centre z, street centrelines, extents, seed, target building
// count) — no new builder code. Every street a grid town lays is registered
// in TOWN_STREETS in the SOUTH_STREETS shape ({axis, at, from, to, halfW})
// so the HUD map and checkers see the same streets the world built.
export const TOWN_STREETS = [];
export const TOWN_GRIDS = [
  { name: 'PALMETTO FLATS', cz: -1420, ewZ: [-1480, -1420, -1360], nsX: [-38, 38], x0: -100, x1: 100, z0: -1510, z1: -1330, seed: 142001, target: 28 },
  { name: 'CYPRESS JUNCTION', cz: -2080, ewZ: [-2140, -2080, -2020], nsX: [-38, 38], x0: -100, x1: 100, z0: -2170, z1: -1990, seed: 208002, target: 26 },
  { name: 'TALLAHASSEE PALMS', cz: -4180, ewZ: [-4245, -4180, -4115], nsX: [-45, 45], x0: -150, x1: 150, z0: -4265, z1: -4095, seed: 418003, target: 34 },
];
export const DIAG_SEG = { x1: -64, z1: 11, x2: -11, z2: 64, halfW: 3.5 };
export const PLAZA_RECT = { x0: 17, x1: 49, z0: 35, z1: 63 };
export const PROM_HALF_W = 3;
export const PROM_POINTS = [];
for (let z = -168; z <= 192; z += 18) PROM_POINTS.push({ x: 203 + 4 * Math.sin(z / 55), z });

// Traffic lights: a 12-second two-group cycle shared with traffic.js.
export const LIGHT = { xGo: true, zGo: false, phase: 0 };
let bulbMatA = null, bulbMatB = null;
export function updateLights(t) {
  const p = t % 12;
  LIGHT.phase = p;
  LIGHT.xGo = p < 5.5;
  LIGHT.zGo = p >= 6.5;
  if (bulbMatA) bulbMatA.color.setHex(p < 4.5 ? 0x2ed573 : p < 5.5 ? 0xffd32a : 0xff3838);
  if (bulbMatB) bulbMatB.color.setHex(p < 6.5 ? 0xff3838 : p < 11 ? 0x2ed573 : 0xffd32a);
}

// Grade-separated road structures inside the city: a flyover carrying the
// x=75 boulevard over the z=75 road, and an underpass dipping x=-75 under
// z=-75. Height is direction-aware so crossing traffic stays at grade.
function smooth(t) { return t * t * (3 - 2 * t); }
export function flyoverH(z) {
  if (z < 30 || z > 120) return 0;
  if (z < 60) return 5 * smooth((z - 30) / 30);
  if (z <= 90) return 5;
  return 5 * smooth((120 - z) / 30);
}
export function underpassD(z) {
  if (z < -120 || z > -30) return 0;
  if (z < -90) return -4 * smooth((z + 120) / 30);
  if (z <= -60) return -4;
  return -4 * smooth((-30 - z) / 30);
}
export function groundHeightAt(x, z, dirHint) {
  if (Math.abs(x - 75) < 9 && z > 26 && z < 124) {
    const along = dirHint ? dirHint === 'z' : Math.abs(x - 75) <= Math.abs(z - 75);
    if (along) return flyoverH(z);
  }
  if (Math.abs(x + 75) < 9 && z < -26 && z > -124) {
    const along = dirHint ? dirHint === 'z' : Math.abs(x + 75) <= Math.abs(z + 75);
    if (along) return underpassD(z);
  }
  return 0;
}
// Stateful surface height for a moving entity. Inside a grade-separated
// band two surfaces legitimately exist at one (x, z) — the flyover deck
// and the street beneath it, the underpass dip and the road above — and
// no positional rule can tell them apart near the crossing: the null-hint
// guess above flips with |x−75| vs |z−75| and dropped deck walkers to
// street level mid-crossing (measured: y=0 at z 73–77 in the deck lane).
// So each entity LOCKS to one surface while inside a band
// (ent.surfMode: 'deck' | 'dip' | 'street') and rides it end to end.
// The lock is taken on the first in-band sample — from the positional
// rule (route hint for traffic, heading hint for the driven car) — with
// one correction: at the ramp mouths the surfaces coincide, so a
// street-locked entity entering where the deck/dip is within half a
// unit is joining the structure, not passing under it. A lock taken
// from surface HEIGHT alone (closest-candidate) was tried first and
// failed at speed: at 34 u/s on a throttled frame the deck rises more
// per frame than any fixed hysteresis, and the entity fell through.
// Outside the bands the surface is unique and the lock clears, so
// teleports/respawns can never go stale.
export function groundHeightFor(ent, x, z, dirHint) {
  const inFly = Math.abs(x - 75) < 9 && z > 26 && z < 124;
  const inUnder = Math.abs(x + 75) < 9 && z < -26 && z > -124;
  if (!inFly && !inUnder) { ent.surfMode = null; ent.surfY = 0; return 0; }
  if (ent.surfMode == null) {
    const h = groundHeightAt(x, z, dirHint);
    if (inFly) ent.surfMode = h > 0 || flyoverH(z) <= 0.5 ? 'deck' : 'street';
    else ent.surfMode = h < 0 || underpassD(z) >= -0.5 ? 'dip' : 'street';
  }
  if (inFly) ent.surfY = ent.surfMode === 'deck' ? flyoverH(z) : 0;
  else ent.surfY = ent.surfMode === 'dip' ? underpassD(z) : 0;
  return ent.surfY;
}
export function isRoad(x, z) {
  for (const r of ROADS) if (Math.abs(x - r) < ROAD_W / 2 + 1 || Math.abs(z - r) < ROAD_W / 2 + 1) return true;
  if (Math.abs(x - CAUSEWAY.x) < CAUSEWAY.halfW && z > WORLD) return true;
  if (Math.abs(x) < ROAD_W / 2 + 1 && z <= -WORLD) return true; // peninsula highway
  return false;
}

// World bounds follow the land: city plateau, Keys corridor, marsh, spine
// and panhandle. Every edge is a shoreline — you stop where the land stops,
// and the sea is what is past it.
//
// The one exception is the swimming player (player.js): the sea past the
// shoreline is swimmable, bounded only by clampSea below — a generous line
// out in open water, so sand → shallow → deep is one continuous space.

// The Keys isle (expanded by `pad`) whose ellipse contains (x, z), with the
// ellipse's half-width in x at that z — the exact test clampWorld applies.
function keysIsleAt(x, z, pad) {
  for (const k of KEYS) {
    const dz = (z - k.z) / (k.rz + pad);
    if (Math.abs(dz) < 1) {
      const maxX = (k.rx + pad) * Math.sqrt(1 - dz * dz);
      if (Math.abs(x) <= maxX) return { k, maxX };
    }
  }
  return null;
}

// True iff (x, z) is inside the land region clampWorld enforces — i.e.
// clampWorld would leave the point untouched. Anything else is sea. This
// is the single definition of "water" the swimmer derives its state from
// every frame, so a save made mid-swim self-heals on load.
export function isLand(x, z) {
  if (z > WORLD + 10) {
    if (z > 442) return false;
    if (keysIsleAt(x, z, 5)) return true;
    return Math.abs(x) <= CAUSEWAY.halfW + 3;
  }
  return z >= NORTH_END && Math.abs(x) <= landHalfWidthAt(z);
}

// How far past the shoreline the swimmable sea extends, in every direction.
export const OFFSHORE = 240;

// The swimmer's world bound: the SAME land region as clampWorld, expanded
// by `offshore` units in every direction (plateau/spine/panhandle half-
// width + offshore, z range extended at both ends, Keys ellipses grown by
// offshore, causeway corridor widened by offshore). It only ever clamps to
// that outer bound — the position slides along it, nothing is visible
// there and there is no pop.
export function clampSea(pos, offshore = OFFSHORE) {
  if (pos.z > WORLD + 10 + offshore) {
    const hit = keysIsleAt(pos.x, pos.z, 5 + offshore);
    if (hit) {
      pos.x = Math.max(-hit.maxX, Math.min(hit.maxX, pos.x));
    } else if (Math.abs(pos.x) <= CAUSEWAY.halfW + 3 + offshore) {
      pos.x = Math.max(-CAUSEWAY.halfW - 3 - offshore, Math.min(CAUSEWAY.halfW + 3 + offshore, pos.x));
    } else pos.z = WORLD + 10 + offshore;
    pos.z = Math.min(pos.z, 442 + offshore);
    return;
  }
  const half = landHalfWidthAt(pos.z) + offshore;
  pos.x = Math.max(-half, Math.min(half, pos.x));
  pos.z = Math.max(NORTH_END - offshore, Math.min(WORLD + 10 + offshore, pos.z));
}

export function clampWorld(pos) {
  if (pos.z > WORLD + 10) {
    const hit = keysIsleAt(pos.x, pos.z, 5);
    if (hit) {
      pos.x = Math.max(-hit.maxX, Math.min(hit.maxX, pos.x));
    } else if (Math.abs(pos.x) <= CAUSEWAY.halfW + 3) {
      pos.x = Math.max(-CAUSEWAY.halfW - 3, Math.min(CAUSEWAY.halfW + 3, pos.x));
    } else pos.z = WORLD + 10;
    pos.z = Math.min(pos.z, 442);
    return;
  }
  const half = landHalfWidthAt(pos.z);
  pos.x = Math.max(-half, Math.min(half, pos.x));
  pos.z = Math.max(NORTH_END, Math.min(WORLD + 10, pos.z));
}

// ---- Canvas textures: every surface is painted, nothing is fetched -------
const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
const _m = () => new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(), _p = new THREE.Vector3();

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}
function facadeTex(rng, wall, litRatio, cols, rows, storefront) {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = wall; g.fillRect(0, 0, w, h);
    const wh = h / rows, ww = w / cols;
    for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
      const lit = rng() < litRatio;
      // Unlit windows are a readable blue-grey, never near-black: at dusk
      // a #232838 window multiplied by hemisphere-only shade lands on
      // (0,0,0), and on a dark-walled style the whole face goes with it.
      g.fillStyle = lit ? (rng() < 0.25 ? '#ffd9a0' : '#ffe9b8') : '#2f3648';
      if (storefront && r === rows - 1) g.fillStyle = rng() < 0.7 ? '#7ef0d4' : '#2f3648';
      g.fillRect(col * ww + 2, r * wh + 3, ww - 4, wh - 6);
    }
    if (storefront) { g.fillStyle = 'rgba(255,80,150,0.85)'; g.fillRect(0, h - wh - 4, w, 4); }
  });
}
function signTex(text, fg, bg) {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.font = '900 30px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = fg; g.shadowBlur = 14; g.fillStyle = fg;
    g.fillText(text, w / 2, h / 2);
  });
}
// A free-standing sign that reads correctly from BOTH sides: two planes
// back to back sharing one texture. A single DoubleSide plane mirrors
// its text from behind — the PALM FLYOVER sign read backwards to
// southbound deck traffic. Every free-standing sign in the city is
// built through here now; wall-mounted signs in facilities.js keep a
// single plane because their front already faces the street.
export function signMesh(text, fg, bg, w, h) {
  const tex = signTex(text, fg, bg);
  const grp = new THREE.Group();
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.FrontSide }));
    p.position.z = 0.03 * s;
    if (s < 0) p.rotation.y = Math.PI;
    grp.add(p);
  }
  return grp;
}
const BRANDS = ['COVE COLA', 'HOTEL MARLIN', 'NEON PALMS', 'SURF & SAND', 'MARLIN MOTORS', 'CAFE SOLANO', 'PALM RADIO 98', 'GATOR BAIT'];

export function buildCity(scene, seed) {
  const rng = makeRng(seed * 7919 + 13);
  // Dusk register: purple-to-orange gradient sky, warm fog, low orange sun.
  scene.background = canvasTex(4, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#191238'); gr.addColorStop(0.38, '#5b2a86'); gr.addColorStop(0.62, '#c94f7c');
    gr.addColorStop(0.8, '#ff7e47'); gr.addColorStop(1, '#ffc98a');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  scene.fog = new THREE.Fog(0x9a5570, 95, 320);
  scene.add(new THREE.HemisphereLight(0xffc39b, 0x274435, 0.8));
  const sun = new THREE.DirectionalLight(0xff9a3c, 0.95);
  sun.position.set(-90, 42, -70); scene.add(sun);
  const neonGlow = new THREE.PointLight(0xff5da2, 0.55, 130);
  neonGlow.position.set(0, 16, 0); scene.add(neonGlow);

  // Ocean: border strips around the landmass rather than one giant sheet,
  // so the rasteriser never shades water underneath land.
  const ocean = new THREE.Group();
  const seaMat = mat(0x0e6e8c);
  for (const [w, h, x, z] of [[330, 920, 397, 10], [330, 920, -397, 10], [464, 236, 0, 326], [1100, 130, 0, 505], [1100, 130, 0, -501]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, h), seaMat);
    strip.rotation.x = -Math.PI / 2; strip.position.set(x, 0, z); ocean.add(strip);
  }
  // Northern sea: two strips flanking the spine and one across the far shore.
  for (const [w, h, x, z] of [[420, 4200, -398, -2350], [420, 4200, 398, -2350], [1500, 260, 0, NORTH_END - 120]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, h), seaMat);
    strip.rotation.x = -Math.PI / 2; strip.position.set(x, 0, z); ocean.add(strip);
  }
  ocean.position.y = -0.35; scene.add(ocean);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(440, 440), mat(0x3f7d46));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.05, 0); scene.add(ground);
  for (const sx of [-1, 1]) { // beaches on both coasts of the city
    const beach = new THREE.Mesh(new THREE.PlaneGeometry(30, 440), mat(0xf2d492));
    beach.rotation.x = -Math.PI / 2; beach.position.set(sx * (WORLD + 16), 0, 0); scene.add(beach);
  }
  // Everglades marsh: green-brown flats cut by dark water channels.
  const marsh = new THREE.Mesh(new THREE.PlaneGeometry(440, 240), mat(0x5c6b35));
  marsh.rotation.x = -Math.PI / 2; marsh.position.set(0, -0.04, -322); scene.add(marsh);
  const chanMat = mat(0x2e4d3f);
  MARSH_CHANNELS.length = 0;
  for (let i = 0; i < 7; i++) {
    const w = 8 + rng() * 14, rot = (rng() - 0.5) * 0.22, x = -190 + rng() * 380;
    const ch = new THREE.Mesh(new THREE.PlaneGeometry(w, 230), chanMat);
    ch.rotation.x = -Math.PI / 2; ch.rotation.z = rot;
    ch.position.set(x, 0.01, -322); scene.add(ch);
    MARSH_CHANNELS.push({ x, z: -322, w, len: 230, rot });
  }
  buildPeninsula(scene, rng);

  // Keys: sand-rimmed discs with green tops, strung along the causeway.
  for (const k of KEYS) {
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.2, 20), mat(0xf2d492));
    sand.scale.set(k.rx + 7, 1, k.rz + 7); sand.position.set(0, -0.4, k.z); scene.add(sand);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.4, 20), mat(0x4c8a4f));
    top.scale.set(k.rx, 1, k.rz); top.position.set(0, -0.3, k.z); scene.add(top);
  }
  const cw = new THREE.Mesh(new THREE.PlaneGeometry(CAUSEWAY.halfW * 2, CAUSEWAY.z1 - CAUSEWAY.z0 + 30), mat(0x39404d));
  cw.rotation.x = -Math.PI / 2; cw.position.set(CAUSEWAY.x, 0.06, (CAUSEWAY.z0 + CAUSEWAY.z1) / 2); scene.add(cw);
  const railMat = mat(0xdfe6e9);
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, CAUSEWAY.z1 - CAUSEWAY.z0 + 30), railMat);
    rail.position.set(CAUSEWAY.x + sx * (CAUSEWAY.halfW + 0.4), 0.45, (CAUSEWAY.z0 + CAUSEWAY.z1) / 2); scene.add(rail);
  }
  const mr = new THREE.Mesh(new THREE.PlaneGeometry(MARSH_ROAD.w, MARSH_ROAD.len), mat(0x39404d));
  mr.rotation.x = -Math.PI / 2; mr.position.set(MARSH_ROAD.x, 0.03, MARSH_ROAD.z); scene.add(mr);

  // City road grid with lane dashes.
  const roadMat = mat(0x39404d), dashMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const dashes = [];
  for (const r of ROADS) {
    const v = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 420), roadMat);
    v.rotation.x = -Math.PI / 2; v.position.set(r, 0.02, 0); scene.add(v);
    const h = new THREE.Mesh(new THREE.PlaneGeometry(420, ROAD_W), roadMat);
    h.rotation.x = -Math.PI / 2; h.position.set(0, 0.02, r); scene.add(h);
    for (let t = -200; t < 200; t += 16) if (!ROADS.some((o) => Math.abs(t - o) < 11)) dashes.push([r, t, 0], [t, r, 1]);
  }
  const dashFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const dashSpin = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
  const dashInst = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.5, 5), dashMat, dashes.length);
  dashes.forEach((d, k) => {
    _p.set(d[0], 0.05, d[1]); _s.set(1, 1, 1);
    dashInst.setMatrixAt(k, _m().compose(_p, d[2] ? dashSpin.clone().multiply(dashFlat) : dashFlat, _s));
  });
  dashInst.instanceMatrix.needsUpdate = true; scene.add(dashInst);
  // Crosswalks at every intersection.
  const cwTex = canvasTex(64, 16, (g, w, h) => {
    g.fillStyle = '#39404d'; g.fillRect(0, 0, w, h); g.fillStyle = '#f5f6fa';
    for (let i = 0; i < 6; i++) g.fillRect(i * 11 + 2, 2, 6, h - 4);
  });
  const cwInst = new THREE.InstancedMesh(new THREE.PlaneGeometry(13, 3.4), new THREE.MeshBasicMaterial({ map: cwTex }), ROADS.length * ROADS.length * 4);
  let cwk = 0;
  for (const rx of ROADS) for (const rz of ROADS) for (let a = 0; a < 4; a++) {
    const ang = a * Math.PI / 2;
    _p.set(rx + Math.sin(ang) * 9.6, 0.045, rz + Math.cos(ang) * 9.6); _s.set(1, 1, 1);
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ang, 0));
    cwInst.setMatrixAt(cwk++, _m().compose(_p, spin.multiply(flat), _s));
  }
  cwInst.count = cwk; cwInst.instanceMatrix.needsUpdate = true; scene.add(cwInst);
  // Sidewalk slabs, one per block.
  const walkMat = mat(0xb8a89a);
  for (let i = 0; i < ROADS.length - 1; i++) for (let j = 0; j < ROADS.length - 1; j++) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(58, 0.3, 58), walkMat);
    slab.position.set((ROADS[i] + ROADS[i + 1]) / 2, 0.15, (ROADS[j] + ROADS[j + 1]) / 2); scene.add(slab);
  }
  // Traffic lights at the intersections: instanced poles and heads, plus one
  // signal bulb per head in two groups that updateLights() cycles. The poles
  // are solid — each registers a prop collider.
  const tlSpots = [];
  for (const rx of ROADS) for (const rz of ROADS) { tlSpots.push([rx + 9, rz + 9]); tlSpots.push([rx - 9, rz - 9]); }
  const tlPoles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.12, 4.6, 5), mat(0x2f3542), tlSpots.length);
  const tlHeads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 1.9, 0.7), mat(0x14161c), tlSpots.length);
  tlSpots.forEach((s, k) => {
    _p.set(s[0], 2.3, s[1]); _s.set(1, 1, 1); tlPoles.setMatrixAt(k, _m().compose(_p, _q, _s));
    _p.y = 5.2; tlHeads.setMatrixAt(k, _m().compose(_p, _q, _s));
    addProp(s[0], s[1], 0.35);
  });
  tlPoles.instanceMatrix.needsUpdate = true; tlHeads.instanceMatrix.needsUpdate = true;
  scene.add(tlPoles); scene.add(tlHeads);
  const groupA = tlSpots.filter((_, k) => k % 2 === 0), groupB = tlSpots.filter((_, k) => k % 2 === 1);
  bulbMatA = new THREE.MeshBasicMaterial({ color: 0x2ed573 });
  bulbMatB = new THREE.MeshBasicMaterial({ color: 0xff3838 });
  const bulbsA = new THREE.InstancedMesh(new THREE.SphereGeometry(0.21, 6, 5), bulbMatA, groupA.length);
  const bulbsB = new THREE.InstancedMesh(new THREE.SphereGeometry(0.21, 6, 5), bulbMatB, groupB.length);
  groupA.forEach((s, k) => { _p.set(s[0], 5.2, s[1] + 0.42); _s.set(1, 1, 1); bulbsA.setMatrixAt(k, _m().compose(_p, _q, _s)); });
  groupB.forEach((s, k) => { _p.set(s[0] + 0.42, 5.2, s[1]); _s.set(1, 1, 1); bulbsB.setMatrixAt(k, _m().compose(_p, _q, _s)); });
  bulbsA.instanceMatrix.needsUpdate = true; bulbsB.instanceMatrix.needsUpdate = true;
  scene.add(bulbsA); scene.add(bulbsB);
  // Street lamps along every road and up the causeway: instanced poles and
  // lit heads, a fake light-pool decal under each, and a solid pole.
  const lampSpots = [];
  for (const r of ROADS) for (let t = -195; t < 200; t += 30) { lampSpots.push([r + 9.5, t]); lampSpots.push([t, r - 9.5]); }
  for (let z = 215; z < 435; z += 30) lampSpots.push([CAUSEWAY.x - CAUSEWAY.halfW - 1, z]);
  // No lamp may stand inside a grade-separated structure's footprint.
  // The (75, 65.5) lamp was based at street height under the flyover:
  // its pole pierced the deck, its globe sat at ankle height on the
  // driving surface, and its height-blind prop collider blocked the
  // deck centreline. The (-75, -84.5) lamp did the same across the
  // underpass dip. Both are dropped; lamps beside the structures stay.
  for (let i = lampSpots.length - 1; i >= 0; i--) {
    const [lx, lz] = lampSpots[i];
    if (Math.abs(lx - 75) < 7.5 && lz > 26 && lz < 124) lampSpots.splice(i, 1);
    else if (Math.abs(lx + 75) < 7.5 && lz < -26 && lz > -124) lampSpots.splice(i, 1);
  }
  const lampPoles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.1, 5.6, 5), mat(0x2f3542), lampSpots.length);
  const lampHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), lampSpots.length);
  lampSpots.forEach((s, k) => {
    _p.set(s[0], 2.8, s[1]); _s.set(1, 1, 1); lampPoles.setMatrixAt(k, _m().compose(_p, _q, _s));
    _p.y = 5.8; lampHeads.setMatrixAt(k, _m().compose(_p, _q, _s));
    addProp(s[0], s[1], 0.3);
  });
  lampPoles.instanceMatrix.needsUpdate = true; lampHeads.instanceMatrix.needsUpdate = true;
  scene.add(lampPoles); scene.add(lampHeads);
  const poolTex = canvasTex(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(32, 32, 4, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,205,130,0.5)'); gr.addColorStop(1, 'rgba(255,205,130,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(7.5, 7.5), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false }), lampSpots.length);
  const flatQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  lampSpots.forEach((s, k) => { _p.set(s[0], 0.07, s[1]); _s.set(1, 1, 1); pools.setMatrixAt(k, _m().compose(_p, flatQ, _s)); });
  pools.instanceMatrix.needsUpdate = true; scene.add(pools);
  // Fire hydrants on the sidewalks: small red posts, solid like the lamps.
  const hydSpots = [];
  for (const r of ROADS) for (let t = -160; t < 200; t += 75) hydSpots.push([r - 10.5, t + 12]);
  const hydBody = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.38, 1.1, 7), mat(0xd63031), hydSpots.length);
  const hydCap = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 7, 5), mat(0xf5f6fa), hydSpots.length);
  hydSpots.forEach((s, k) => {
    _p.set(s[0], 0.55, s[1]); _s.set(1, 1, 1); hydBody.setMatrixAt(k, _m().compose(_p, _q, _s));
    _p.y = 1.2; hydCap.setMatrixAt(k, _m().compose(_p, _q, _s));
    addProp(s[0], s[1], 0.38);
  });
  hydBody.instanceMatrix.needsUpdate = true; hydCap.instanceMatrix.needsUpdate = true;
  scene.add(hydBody); scene.add(hydCap);
  // Leafy street trees lining every block: instanced trunks and canopies,
  // each trunk solid.
  const treeSpots = [];
  for (let i = 0; i < ROADS.length - 1; i++) for (let j = 0; j < ROADS.length - 1; j++) {
    const cx = (ROADS[i] + ROADS[i + 1]) / 2, cz = (ROADS[j] + ROADS[j + 1]) / 2;
    for (const t of [-19, 0, 19]) {
      treeSpots.push([cx + t, cz - 30.5]); treeSpots.push([cx + t, cz + 30.5]);
      treeSpots.push([cx - 30.5, cz + t]); treeSpots.push([cx + 30.5, cz + t]);
    }
  }
  // Keep trees clear of the flyover/underpass bands: the block-corner
  // trees at x=±68/±82 stood at street height beside the structures and
  // their canopies clipped through the deck edge / cutting walls.
  for (let i = treeSpots.length - 1; i >= 0; i--) {
    const [tx, tz] = treeSpots[i];
    if (Math.abs(tx - 75) < 10.5 && tz > 26 && tz < 124) treeSpots.splice(i, 1);
    else if (Math.abs(tx + 75) < 10.5 && tz < -26 && tz > -124) treeSpots.splice(i, 1);
  }
  const treeTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.3, 3.2, 5), mat(0x6d4c41), treeSpots.length);
  const canopies = new THREE.InstancedMesh(new THREE.SphereGeometry(2.3, 7, 6), mat(0x2f9e44), treeSpots.length);
  treeSpots.forEach((s, k) => {
    _p.set(s[0], 1.6, s[1]); _s.set(1, 1, 1); treeTrunks.setMatrixAt(k, _m().compose(_p, _q, _s));
    _p.set(s[0], 4.6, s[1]); _s.set(1, 0.85, 1); canopies.setMatrixAt(k, _m().compose(_p, _q, _s));
    addProp(s[0], s[1], 0.45);
  });
  treeTrunks.instanceMatrix.needsUpdate = true; canopies.instanceMatrix.needsUpdate = true;
  scene.add(treeTrunks); scene.add(canopies);

  // Flyover and underpass structures (decks, rails, walls, signs).
  {
    const deckMat = mat(0x424a58), railM = mat(0xdfe6e9);
    const fSegs = []; for (let z = 32; z < 120; z += 8) fSegs.push(z + 4);
    const fDeck = new THREE.InstancedMesh(new THREE.BoxGeometry(13, 0.7, 8.6), deckMat, fSegs.length);
    const fRail = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 1, 8.6), railM, fSegs.length * 2);
    fSegs.forEach((zc, k) => {
      const h = flyoverH(zc);
      _p.set(75, h - 0.35, zc); _s.set(1, 1, 1); fDeck.setMatrixAt(k, _m().compose(_p, _q, _s));
      _p.set(75 - 6.4, h + 0.5, zc); fRail.setMatrixAt(k * 2, _m().compose(_p, _q, _s));
      _p.set(75 + 6.4, h + 0.5, zc); fRail.setMatrixAt(k * 2 + 1, _m().compose(_p, _q, _s));
    });
    fDeck.instanceMatrix.needsUpdate = true; fRail.instanceMatrix.needsUpdate = true;
    scene.add(fDeck); scene.add(fRail);
    for (const pz of [58, 92]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(2.2, flyoverH(pz), 2.2), deckMat);
      pil.position.set(75, flyoverH(pz) / 2, pz); scene.add(pil);
      // No prop collider on the pillars: prop collision is height-blind,
      // so a collider under the deck also blocked the deck centreline
      // above it — a driven car wedged dead at z≈55 on the ramp,
      // bouncing off thin air (measured before this fix).
    }
    const fs = signMesh('PALM FLYOVER', '#7ef0d4', '#14101f', 16, 3);
    fs.position.set(75, 8.6, 92); scene.add(fs);
    const uSegs = []; for (let z = -118; z < -32; z += 8) uSegs.push(z + 4);
    const uDeck = new THREE.InstancedMesh(new THREE.BoxGeometry(13, 0.7, 8.6), deckMat, uSegs.length);
    const uWall = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 1, 8.6), mat(0x8a9077), uSegs.length * 2);
    const uStrip = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.3, 8.6), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), uSegs.length * 2);
    uSegs.forEach((zc, k) => {
      const d = underpassD(zc), wallH = Math.max(0.6, -d + 1.2);
      _p.set(-75, d - 0.33, zc); _s.set(1, 1, 1); uDeck.setMatrixAt(k, _m().compose(_p, _q, _s));
      for (const sx of [-1, 1]) {
        _p.set(-75 + sx * 7.4, d + wallH / 2 - 0.3, zc); _s.set(1, wallH, 1); uWall.setMatrixAt(k * 2 + (sx > 0 ? 1 : 0), _m().compose(_p, _q, _s));
        _p.set(-75 + sx * 6.9, d + 2.6, zc); _s.set(1, 1, 1); uStrip.setMatrixAt(k * 2 + (sx > 0 ? 1 : 0), _m().compose(_p, _q, _s));
      }
    });
    uDeck.instanceMatrix.needsUpdate = true; uWall.instanceMatrix.needsUpdate = true; uStrip.instanceMatrix.needsUpdate = true;
    scene.add(uDeck); scene.add(uWall); scene.add(uStrip);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(19, 0.8, 15), deckMat);
    bridge.position.set(-75, 0.28, -75); scene.add(bridge);
    const us = signMesh('OLD TOWN UNDERPASS', '#ffd32a', '#14101f', 15, 3);
    us.position.set(-75, 5.4, -96); scene.add(us);
  }
  // Buildings, styled per district so each quarter reads differently:
  // downtown glass, Marina pastel, Old Town brick, Docks warehouses,
  // Coral Heights houses with pitched roofs.
  const styles = {
    downtown: { tex: facadeTex(rng, '#4a5878', 0.62, 8, 14, true), tint: [0xbfd4ff, 0x9fb6e8, 0xd8c8ff] },
    pastel: { tex: facadeTex(rng, '#e8b4b8', 0.5, 6, 8, true), tint: [0xffc8dd, 0xfec8a0, 0xa0e8dd, 0xfff3b0] },
    brick: { tex: facadeTex(rng, '#9c5a44', 0.42, 6, 7, true), tint: [0xe8a080, 0xd98c68, 0xc9a06a] },
    // Ware wall lightened (#6b705c -> #8a9077, colour only — same rng
    // draw count): with half its texels unlit windows, the old olive wall
    // averaged to a black slab under dusk shade.
    ware: { tex: facadeTex(rng, '#8a9077', 0.22, 5, 3, false), tint: [0xa8b09a, 0x8f9a94, 0xb0a696] },
    house: { tex: facadeTex(rng, '#e6ddcb', 0.55, 4, 2, false), tint: [0xffffff, 0xffe8c8, 0xd8f0d0, 0xffd8d8] },
  };
  // Neutral facade for the signed landmark shells (police / garage / fire
  // station): they were plain coloured boxes with no facade at all. Drawn
  // from its OWN rng so the shared stream — and every placement it feeds —
  // is untouched; the building's colour tints it per landmark.
  const shellTex = facadeTex(makeRng(777), '#cfd4dc', 0.5, 5, 6, true);
  const byStyle = { downtown: [], pastel: [], brick: [], ware: [], house: [] };
  const capList = [];    // parapet caps: a dark trim box on every flat roof
  const awningList = []; // shop canopies {x, z, w, d, dir} on dressed rows
  // World pickups are defined here, not at the bottom of the function,
  // because placement reserves clear ground around each one: a cache must
  // never share its spot with a building (the old code placed the building
  // anyway and then DELETED its collider, leaving a pass-through ghost).
  const PICKUP_SPOTS = [
    { x: 6, z: 402, kind: 'sniper', color: 0x7ef0d4 }, { x: -138, z: -28, kind: 'sniper', color: 0x7ef0d4 },
    { x: 80, z: 104, kind: 'pistol', color: 0xffa502 }, { x: -140, z: 148, kind: 'pistol', color: 0xffa502 }, { x: 24, z: -84, kind: 'pistol', color: 0xffa502 },
    { x: 106, z: 82, kind: 'snack', color: 0xffd32a }, { x: 164, z: 158, kind: 'snack', color: 0xffd32a }, { x: 12, z: 396, kind: 'snack', color: 0xffd32a },
    { x: -88, z: -52, kind: 'armour', color: 0x54a0ff }, { x: -150, z: 120, kind: 'armour', color: 0x54a0ff },
    { x: 208, z: 20, kind: 'cola', color: 0xff5da2 }, { x: -208, z: -30, kind: 'cola', color: 0xff5da2 }, { x: 30, z: -120, kind: 'cola', color: 0xff5da2 },
    { x: 210, z: 112, kind: 'cola', color: 0xff5da2 }, { x: -6, z: -218, kind: 'snack', color: 0xffd32a },
    { x: 14, z: -1408, kind: 'snack', color: 0xffd32a }, { x: -14, z: -2730, kind: 'cola', color: 0xff5da2 },
    { x: 14, z: -3370, kind: 'medkit', color: 0x2ed573 },
  ];
  // ---- Reserved ground: fixed anchors and exteriors the rows must avoid --
  const reserved = [], reservedCircles = [], placedAABBs = [];
  const reserve = (x, z, hw, hd, m = 1.5) => reserved.push({ x0: x - hw - m, x1: x + hw + m, z0: z - hd - m, z1: z + hd + m });
  for (const s of Object.values(SITES)) reserve(s.x, s.z, 11, 9); // boulevard storefronts (facilities.js)
  reserve(118, -48, 9, 8);                    // HOME exterior (facilities.js)
  reserve(133, -128, 9, 7.5);                 // MAPLE HOUSE (facilities.js)
  reserve(-128, -166, 9, 7.5);                // PALMETTO APARTMENTS (facilities.js)
  reserve(HOSPITAL.x, HOSPITAL.z, 12, 10);    // hospital lot (facilities.js)
  reserve(-58, -58, 8, 7);                    // police footprint (landmarkBldg below)
  reserve(93, 93, 8, 7);                      // garage footprint
  reserve(170, -118, 8, 7);                   // fire station footprint
  reserved.push({ x0: PLAZA_RECT.x0 - 1, x1: PLAZA_RECT.x1 + 1, z0: PLAZA_RECT.z0 - 1, z1: PLAZA_RECT.z1 + 1 });
  reservedCircles.push({ x: 8, z: 58, r: 7 });                              // SPAWN
  reservedCircles.push({ x: HOSPITAL.x + 12, z: HOSPITAL.z + 12, r: 7 });   // wasted respawn point
  for (const p of [[-110, -110], [110, -110], [130, 30]]) reservedCircles.push({ x: p[0], z: p[1], r: 7 }); // mission debtors
  for (const p of [[-140, 140], [150, 150], [150, 140], [170, 170]]) reservedCircles.push({ x: p[0], z: p[1], r: 9 }); // docks pkg / deliver / taxi rank / marina
  for (const s of PICKUP_SPOTS) reservedCircles.push({ x: s.x, z: s.z, r: 8 });
  const segPt = (px, pz, ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let t = L2 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
  };
  const aabbSeg = (x0, x1, z0, z1, ax, az, bx, bz) => {
    const cxp = Math.max(x0, Math.min(ax, x1)), czp = Math.max(z0, Math.min(az, z1));
    let d = Math.min(Math.hypot(ax - cxp, az - czp), segPt(x0, z0, ax, az, bx, bz), segPt(x1, z0, ax, az, bx, bz), segPt(x0, z1, ax, az, bx, bz), segPt(x1, z1, ax, az, bx, bz), segPt((x0 + x1) / 2, (z0 + z1) / 2, ax, az, bx, bz));
    for (let t = 0.25; t < 1; t += 0.25) {
      const sx = ax + (bx - ax) * t, sz = az + (bz - az) * t;
      d = Math.min(d, Math.hypot(sx - Math.max(x0, Math.min(sx, x1)), sz - Math.max(z0, Math.min(sz, z1))));
    }
    return d;
  };
  // A candidate footprint is placeable only when it clears every road band
  // (full ROAD_W, whole plateau), every reserved plot, the diagonal avenue,
  // the promenade, and every building already placed. This one test is what
  // guarantees the reworked south has zero road encroachment and zero
  // offside grass plots: rows only ever run along street edges, and a
  // candidate that does not fit is skipped, never nudged onto a road.
  function blocked(x, z, hw, hd) {
    const x0 = x - hw, x1 = x + hw, z0 = z - hd, z1 = z + hd;
    for (const r of ROADS) {
      if (x0 < r + ROAD_W / 2 && x1 > r - ROAD_W / 2) return true;
      if (z0 < r + ROAD_W / 2 && z1 > r - ROAD_W / 2) return true;
    }
    for (const s of SOUTH_STREETS) { // the mid streets are streets too — rows stop at their crossings, making junctions
      if (s.axis === 'ns') { if (z0 < s.to && z1 > s.from && x0 < s.at + s.halfW && x1 > s.at - s.halfW) return true; }
      else if (x0 < s.to && x1 > s.from && z0 < s.at + s.halfW && z1 > s.at - s.halfW) return true;
    }
    for (const b of reserved) if (x0 < b.x1 && x1 > b.x0 && z0 < b.z1 && z1 > b.z0) return true;
    for (const c of reservedCircles) {
      const nx = Math.max(x0, Math.min(c.x, x1)), nz = Math.max(z0, Math.min(c.z, z1));
      if (Math.hypot(c.x - nx, c.z - nz) < c.r) return true;
    }
    if (aabbSeg(x0, x1, z0, z1, DIAG_SEG.x1, DIAG_SEG.z1, DIAG_SEG.x2, DIAG_SEG.z2) < DIAG_SEG.halfW + 1) return true;
    if (x1 > 150) for (let k = 0; k < PROM_POINTS.length - 1; k++) {
      if (aabbSeg(x0, x1, z0, z1, PROM_POINTS[k].x, PROM_POINTS[k].z, PROM_POINTS[k + 1].x, PROM_POINTS[k + 1].z) < PROM_HALF_W + 1) return true;
    }
    for (const b of placedAABBs) if (x0 < b.x1 + 0.7 && x1 > b.x0 - 0.7 && z0 < b.z1 + 0.7 && z1 > b.z0 - 0.7) return true;
    return false;
  }
  // The single placement path for southern buildings: render record,
  // collider and audit record all come from the same numbers, so a solid
  // mesh without a matching collider cannot happen.
  function placeB(x, z, w, d, o = {}) {
    const dn = districtAt(x, z);
    let style = o.style, h = o.h;
    if (!style) {
      style = 'pastel'; h = 10 + rng() * rng() * 16;
      if (isDowntown(x, z)) { style = 'downtown'; h = 26 + rng() * rng() * 34; }
      else if (dn === 'The Docks') { style = 'ware'; h = 6 + rng() * 5; }
      else if (dn === 'Coral Heights') { style = 'house'; h = 4.5 + rng() * 2.5; }
      else if (dn === 'Old Town') { style = 'brick'; h = 8 + rng() * 10; }
      else if (dn === 'Marina Mile') { style = 'pastel'; h = 12 + rng() * rng() * 20; }
    }
    if (o.blvd) h *= 1.3;
    byStyle[style].push({ x, z, w, d, h });
    colliders.push({ x, z, hw: w / 2, hd: d / 2 });
    buildingRecords.push({ x, z, hw: w / 2, hd: d / 2 });
    placedAABBs.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
    buildingCounts[dn] = (buildingCounts[dn] || 0) + 1;
    if (style !== 'house') capList.push({ x, z, w, d, h });
    if (o.awning) awningList.push({ x, z, w, d, dir: o.awning });
  }
  // Fill one street edge with a row of buildings fronting it. `axis` is the
  // direction the row runs, `fixed` the row's centreline on the other axis,
  // depth the buildings' extent back from the street.
  function fillRow(axis, fixed, from, to, depth, o = {}) {
    let cur = from;
    while (cur < to - 7) {
      const dn = districtAt(axis === 'x' ? cur + 5 : fixed, axis === 'x' ? fixed : cur + 5);
      let w = dn === 'The Docks' ? 13 + rng() * 6 : dn === 'Coral Heights' ? 8.5 + rng() * 3.5 : 9.5 + rng() * 5;
      if (cur + w > to) w = to - cur;
      if (w < 6) break;
      const c = cur + w / 2;
      const x = axis === 'x' ? c : fixed, z = axis === 'x' ? fixed : c;
      const bw = axis === 'x' ? w : depth, bd = axis === 'x' ? depth : w;
      if (!blocked(x, z, bw / 2, bd / 2)) { placeB(x, z, bw, bd, o); cur += w + 1.2 + rng() * 1.8; }
      else cur += 3; // shuffle along — a narrower neighbour may still fit before the junction/reserved plot
    }
  }
  // Frontage rows on all four edges of every block, plus rows on both sides
  // of the block's mid street — streets read as street walls, and every
  // building stands within a sidewalk's distance of a street it fronts.
  for (let i = 0; i < ROADS.length - 1; i++) for (let j = 0; j < ROADS.length - 1; j++) {
    const x0 = ROADS[i] + ROAD_W / 2 + 2, x1 = ROADS[i + 1] - ROAD_W / 2 - 2;
    const z0 = ROADS[j] + ROAD_W / 2 + 2, z1 = ROADS[j + 1] - ROAD_W / 2 - 2;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const dnC = districtAt(cx, cz);
    const D = dnC === 'The Docks' ? 13 : dnC === 'Coral Heights' ? 10 : 11;
    fillRow('x', z0 + D / 2, x0, x1, D, j === 2 ? { blvd: true, awning: -1 } : {}); // boulevard north side
    fillRow('x', z1 - D / 2, x0, x1, D, j === 1 ? { blvd: true, awning: 1 } : {});  // boulevard south side
    fillRow('z', x0 + D / 2, z0 + D + 1, z1 - D - 1, D, {});
    fillRow('z', x1 - D / 2, z0 + D + 1, z1 - D - 1, D, {});
    if (i === 2 && j === 2) continue; // plaza block — the plaza fills its middle
    if (i === 1 && j === 2) {         // diagonal block — buildings front the avenue
      for (const t of [0.16, 0.37, 0.58, 0.79]) for (const s of [-1, 1]) {
        const bx = DIAG_SEG.x1 + (DIAG_SEG.x2 - DIAG_SEG.x1) * t + 0.7071 * s * 13.5;
        const bz = DIAG_SEG.z1 + (DIAG_SEG.z2 - DIAG_SEG.z1) * t - 0.7071 * s * 13.5;
        const w = 10 + rng() * 3;
        if (!blocked(bx, bz, w / 2, w / 2)) placeB(bx, bz, w, w, {});
      }
      continue;
    }
    // The block's mid street, by the same checkerboard rule that built
    // SOUTH_STREETS (an earlier version looked the street up by centreline
    // and cross-matched other blocks' streets — rows fronted phantom
    // streets while the real ones stood bare).
    if ((i + j) % 2 === 1) {
      fillRow('z', cx - 4 - D / 2, z0, z1, D, {});
      fillRow('z', cx + 4 + D / 2, z0, z1, D, {});
    } else {
      fillRow('x', cz - 4 - D / 2, x0, x1, D, {});
      fillRow('x', cz + 4 + D / 2, x0, x1, D, {});
    }
  }
  // Plaza kiosks: three small shopfronts standing on the plaza edges.
  placeB(20, 49, 8, 7, { style: 'pastel', h: 5.5 });
  placeB(46, 49, 8, 7, { style: 'pastel', h: 6.5 });
  placeB(33, 38.5, 8, 7, { style: 'pastel', h: 5, awning: 1 });
  for (const name of Object.keys(byStyle)) {
    const list = byStyle[name];
    if (!list.length) continue;
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ map: styles[name].tex }), list.length);
    list.forEach((b, k) => {
      _p.set(b.x, b.h / 2 + 0.3, b.z); _s.set(b.w, b.h, b.d);
      inst.setMatrixAt(k, _m().compose(_p, _q, _s));
      inst.setColorAt(k, new THREE.Color(pick(rng, styles[name].tint)));
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    scene.add(inst);
    if (name === 'house') {
      const roofs = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 4), mat(0xb5524a), list.length);
      list.forEach((b, k) => {
        _p.set(b.x, b.h + 2.1, b.z); _s.set(b.w * 0.78, 3.6, b.d * 0.78);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0));
        roofs.setMatrixAt(k, _m().compose(_p, q, _s));
      });
      roofs.instanceMatrix.needsUpdate = true; scene.add(roofs);
    }
  }
  // Parapet caps and shop awnings: the trim that keeps southern frontage
  // from reading as bare boxes — one instanced mesh each.
  if (capList.length) {
    const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0x3d4454), capList.length);
    capList.forEach((b, k) => {
      _p.set(b.x, b.h + 0.55, b.z); _s.set(b.w + 0.7, 0.5, b.d + 0.7);
      caps.setMatrixAt(k, _m().compose(_p, _q, _s));
    });
    caps.instanceMatrix.needsUpdate = true; scene.add(caps);
  }
  if (awningList.length) {
    const awn = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0xd64570), awningList.length);
    awningList.forEach((a, k) => {
      _p.set(a.x, 3.2, a.z + a.dir * (a.d / 2 + 1)); _s.set(a.w * 0.82, 0.16, 2.3);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(a.dir * 0.32, 0, 0));
      awn.setMatrixAt(k, _m().compose(_p, q, _s));
    });
    awn.instanceMatrix.needsUpdate = true; scene.add(awn);
  }
  // ---- Southern dressing: boulevard, diagonal avenue, promenade, plaza --
  const paveMat = mat(0x39404d);
  const reworkPalms = [], reworkLamps = [], benchList = [];
  for (const s of SOUTH_STREETS) { // mid-street paving over the block slabs
    const len = s.to - s.from;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(s.axis === 'ns' ? s.halfW * 2 : len, s.axis === 'ns' ? len : s.halfW * 2), paveMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(s.axis === 'ns' ? s.at : (s.from + s.to) / 2, 0.34, s.axis === 'ns' ? (s.from + s.to) / 2 : s.at);
    scene.add(p);
  }
  { // Palm Boulevard (the z=0 road): median planters with palm rows between
    // the intersections — traffic lanes run at ±3.2, the 2.2-wide median
    // sits clear between them — plus name signs over the median.
    const gaps = [[-202, -158.5], [-141.5, -83.5], [-66.5, -8.5], [8.5, 66.5], [83.5, 141.5], [158.5, 202]];
    const planters = [];
    for (const [a, b] of gaps) {
      planters.push([(a + b) / 2, b - a - 4]);
      for (let x = a + 12; x < b - 6; x += 23) reworkPalms.push({ x, z: 0 });
    }
    const pl = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0x4a5d3a), planters.length);
    planters.forEach((p2, k) => { _p.set(p2[0], 0.13, 0); _s.set(p2[1], 0.24, 2.2); pl.setMatrixAt(k, _m().compose(_p, _q, _s)); });
    pl.instanceMatrix.needsUpdate = true; scene.add(pl);
    for (const sx of [-100, -30, 34, 104]) {
      const s = signMesh('PALM BOULEVARD', '#ffd32a', '#14101f', 12, 2.6);
      s.position.set(sx, 6.4, 0); scene.add(s);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 6.4, 5), mat(0x2f3542));
      pole.position.set(sx, 3.2, 0); scene.add(pole); addProp(sx, 0, 0.3);
    }
  }
  { // Diagonal pedestrian avenue: a paved strip built from the segment's
    // own corners (no rotation guesswork), benches and lamps along its
    // edges, small shade palms at its ends.
    const dxu = DIAG_SEG.x2 - DIAG_SEG.x1, dzu = DIAG_SEG.z2 - DIAG_SEG.z1, L = Math.hypot(dxu, dzu);
    const ux = -dzu / L * DIAG_SEG.halfW, uz = dxu / L * DIAG_SEG.halfW;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      DIAG_SEG.x1 - ux, 0, DIAG_SEG.z1 - uz, DIAG_SEG.x1 + ux, 0, DIAG_SEG.z1 + uz,
      DIAG_SEG.x2 - ux, 0, DIAG_SEG.z2 - uz, DIAG_SEG.x2 + ux, 0, DIAG_SEG.z2 + uz]), 3));
    geo.setIndex([0, 2, 1, 1, 2, 3]);
    const strip = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x4a4438, side: THREE.DoubleSide }));
    strip.position.y = 0.34; scene.add(strip);
    const ex = -dzu / L, ez = dxu / L; // unit perpendicular
    for (const t of [0.14, 0.32, 0.5, 0.68, 0.86]) for (const s of [-1, 1]) {
      const bx = DIAG_SEG.x1 + dxu * t + ex * s * (DIAG_SEG.halfW + 1.8), bz = DIAG_SEG.z1 + dzu * t + ez * s * (DIAG_SEG.halfW + 1.8);
      if (t % 0.36 < 0.2) benchList.push({ x: bx, z: bz, rotY: Math.PI / 4 });
      else reworkLamps.push({ x: bx, z: bz });
    }
    reworkPalms.push({ x: DIAG_SEG.x1 - 4, z: DIAG_SEG.z1 - 4 }, { x: DIAG_SEG.x2 + 4, z: DIAG_SEG.z2 + 4 });
  }
  { // Coastal promenade: a ribbon following the east beach arc, palms on
    // the land side, benches facing the sea.
    const verts = [], idx = [];
    PROM_POINTS.forEach((p, k) => {
      verts.push(p.x - PROM_HALF_W, 0, p.z, p.x + PROM_HALF_W, 0, p.z);
      if (k > 0) { const a = (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      if (k % 2 === 0) reworkPalms.push({ x: p.x - 7.5, z: p.z });
      if (k % 3 === 1) benchList.push({ x: p.x + 4.6, z: p.z, rotY: -Math.PI / 2 });
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    geo.setIndex(idx);
    const ribbon = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xb8a89a, side: THREE.DoubleSide }));
    ribbon.position.y = 0.06; scene.add(ribbon);
  }
  { // Palm Plaza, ~27 units from SPAWN: fountain with the gold diamond,
    // benches, palms, lamps and a name sign on its south edge.
    const pave = new THREE.Mesh(new THREE.PlaneGeometry(PLAZA_RECT.x1 - PLAZA_RECT.x0, PLAZA_RECT.z1 - PLAZA_RECT.z0), mat(0x9a8f7a));
    pave.rotation.x = -Math.PI / 2; pave.position.set(33, 0.34, 49); scene.add(pave);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.4, 1, 12), mat(0x8e9aaf));
    basin.position.set(33, 0.85, 49); scene.add(basin);
    const water = new THREE.Mesh(new THREE.CircleGeometry(3.4, 12), new THREE.MeshBasicMaterial({ color: 0x2e9ec9 }));
    water.rotation.x = -Math.PI / 2; water.position.set(33, 1.3, 49); scene.add(water);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.4, 1.8), mat(0x57606f));
    plinth.position.set(33, 1.55, 49); scene.add(plinth);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(1.4), new THREE.MeshBasicMaterial({ color: 0xffd32a }));
    gem.position.set(33, 4.4, 49); scene.add(gem);
    addProp(33, 49, 4.5);
    for (let a = 0; a < 8; a++) benchList.push({ x: 33 + Math.cos(a * Math.PI / 4) * 8, z: 49 + Math.sin(a * Math.PI / 4) * 8, rotY: -a * Math.PI / 4 });
    for (const [px2, pz2] of [[21, 38], [45, 38], [21, 60], [45, 60]]) reworkPalms.push({ x: px2, z: pz2 });
    for (const [lx, lz] of [[26, 42], [40, 42], [26, 56], [40, 56]]) reworkLamps.push({ x: lx, z: lz });
    const s = signMesh('PALM PLAZA', '#7ef0d4', '#14101f', 11, 2.6);
    s.position.set(33, 4.6, 64.6); scene.add(s);
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 4.6, 5), mat(0x2f3542));
      pole.position.set(33 + sx * 5, 2.3, 64.6); scene.add(pole); addProp(33 + sx * 5, 64.6, 0.3);
    }
  }
  // Shared instanced renderers for the dressing props — every solid one
  // registers its prop collider as it is placed.
  if (reworkPalms.length) {
    const tr = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 7, 5), mat(0x8d6e63), reworkPalms.length);
    const fr = new THREE.InstancedMesh(new THREE.ConeGeometry(3.4, 2.2, 6), mat(0x2ecc71), reworkPalms.length);
    reworkPalms.forEach((p, k) => {
      _p.set(p.x, 3.5, p.z); _s.set(1, 1, 1); tr.setMatrixAt(k, _m().compose(_p, _q, _s));
      _p.set(p.x, 7.6, p.z); fr.setMatrixAt(k, _m().compose(_p, _q, _s));
      addProp(p.x, p.z, 0.5);
    });
    tr.instanceMatrix.needsUpdate = true; fr.instanceMatrix.needsUpdate = true;
    scene.add(tr); scene.add(fr);
  }
  if (reworkLamps.length) {
    const po = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.1, 5.6, 5), mat(0x2f3542), reworkLamps.length);
    const he = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), reworkLamps.length);
    reworkLamps.forEach((p, k) => {
      _p.set(p.x, 2.8, p.z); _s.set(1, 1, 1); po.setMatrixAt(k, _m().compose(_p, _q, _s));
      _p.y = 5.8; he.setMatrixAt(k, _m().compose(_p, _q, _s));
      addProp(p.x, p.z, 0.3);
    });
    po.instanceMatrix.needsUpdate = true; he.instanceMatrix.needsUpdate = true;
    scene.add(po); scene.add(he);
  }
  if (benchList.length) {
    const seats = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 0.5, 0.65), mat(0x7f5539), benchList.length);
    benchList.forEach((b, k) => {
      _p.set(b.x, 0.62, b.z); _s.set(1, 1, 1);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, b.rotY, 0));
      seats.setMatrixAt(k, _m().compose(_p, q, _s));
      addProp(b.x, b.z, 0.8);
    });
    seats.instanceMatrix.needsUpdate = true; scene.add(seats);
  }
  // Neon billboards on downtown and marina rooftops; their poles are solid.
  const bbSpots = [[-30, -30], [28, -34], [-34, 26], [30, 30], [112, 118], [-118, 40], [108, -112], [0, 152]];
  bbSpots.forEach(([x, z], i) => {
    const bb = signMesh(BRANDS[i % BRANDS.length], i % 2 ? '#7ef0d4' : '#ff5da2', '#14101f', 17, 4.4);
    bb.position.set(x, 17 + (i % 3) * 5, z); bb.rotation.y = (i % 4) * Math.PI / 4 + 0.4; scene.add(bb);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, bb.position.y, 5), mat(0x2f3542));
    pole.position.set(x, bb.position.y / 2, z); scene.add(pole);
    addProp(x, z, 0.4);
  });
  // Docks dressing: container stacks and two port cranes.
  const contColors = [0xe74c3c, 0x3498db, 0xe67e22, 0x27ae60, 0x8e6cc8];
  const conts = [];
  // Containers live in the west margin strip only, clear of the road bands
  // that cross it and of the armour pickup — and every stack is solid: the
  // old scatter had no colliders at all, so players walked through them.
  for (let i = 0; i < 26; i++) {
    let x = 0, z = 0, ok = false;
    for (let tries = 0; tries < 12 && !ok; tries++) {
      x = -164.5 + rng() * 2; z = 55 + rng() * 135; // a dock row fronting the x=-150 road
      ok = !ROADS.some((r) => Math.abs(z - r) < ROAD_W / 2 + 5.5) && Math.hypot(x + 150, z - 120) > 9;
    }
    if (!ok) continue;
    conts.push({ x, z, lvl: Math.floor(rng() * 3) });
    const rot = (conts.length - 1) % 2 === 1; // matches the instancing rotation below ((k % 2) * PI/2)
    colliders.push({ x, z, hw: rot ? 2 : 4.5, hd: rot ? 4.5 : 2 });
    buildingRecords.push({ x, z, hw: rot ? 2 : 4.5, hd: rot ? 4.5 : 2 });
  }
  const contInst = new THREE.InstancedMesh(new THREE.BoxGeometry(9, 3.4, 4), new THREE.MeshLambertMaterial({ color: 0xffffff }), conts.length);
  conts.forEach((c, k) => {
    _p.set(c.x, 1.7 + c.lvl * 3.4, c.z); _s.set(1, 1, 1);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (k % 2) * Math.PI / 2, 0));
    contInst.setMatrixAt(k, _m().compose(_p, q, _s));
    contInst.setColorAt(k, new THREE.Color(pick(rng, contColors)));
  });
  contInst.instanceMatrix.needsUpdate = true;
  if (contInst.instanceColor) contInst.instanceColor.needsUpdate = true;
  scene.add(contInst);
  for (const [x, z] of [[-160, 90], [-95, 165]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 20, 1.2), mat(0xf39c12));
    leg.position.set(x, 10, z); scene.add(leg); addProp(x, z, 0.9);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 22), mat(0xf39c12));
    arm.position.set(x, 19.5, z + 8); scene.add(arm);
  }
  // Marina boats along the east beach.
  {
    const hulls = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 1.2, 7), mat(0xf5f6fa), 10);
    const masts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.09, 8, 4), mat(0xdfe6e9), 10);
    for (let i = 0; i < 10; i++) {
      const bx = WORLD + 22 + rng() * 6, bz = 60 + i * 14 + rng() * 5;
      _p.set(bx, 0.1, bz); _s.set(1, 1, 1); hulls.setMatrixAt(i, _m().compose(_p, _q, _s));
      _p.set(bx, 4.4, bz); masts.setMatrixAt(i, _m().compose(_p, _q, _s));
    }
    hulls.instanceMatrix.needsUpdate = true; masts.instanceMatrix.needsUpdate = true;
    scene.add(hulls); scene.add(masts);
  }
  // Palms: boulevard rows, both beaches, the Keys, and browner scrub palms
  // across the marsh and up the spine. Trunks are solid.
  const palmSpots = [];
  for (const r of ROADS) for (let t = -195; t < 200; t += 26) {
    palmSpots.push({ x: r + ROAD_W / 2 + 3, z: t + rng() * 6, scrub: 0 });
    palmSpots.push({ x: t + rng() * 6, z: r - ROAD_W / 2 - 3, scrub: 0 });
  }
  for (let z = -195; z < 200; z += 16) { palmSpots.push({ x: WORLD + 5 + rng() * 7, z, scrub: 0 }); palmSpots.push({ x: -WORLD - 5 - rng() * 7, z, scrub: 0 }); }
  for (const k of KEYS) for (let i = 0; i < 9; i++) palmSpots.push({ x: (rng() - 0.5) * k.rx * 1.5, z: k.z + (rng() - 0.5) * k.rz * 1.4, scrub: 0 });
  for (let i = 0; i < 46; i++) palmSpots.push({ x: -200 + rng() * 400, z: -215 - rng() * 200, scrub: 1 });
  for (let z = -500; z > NORTH_END + 200; z -= 90) { // sparse scrub palms along the highway
    palmSpots.push({ x: 16 + rng() * 30, z: z + rng() * 20, scrub: 1 });
    palmSpots.push({ x: -16 - rng() * 30, z: z - 40 + rng() * 20, scrub: 1 });
  }
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 7, 5), mat(0x8d6e63), palmSpots.length);
  const fronds = new THREE.InstancedMesh(new THREE.ConeGeometry(3.4, 2.2, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }), palmSpots.length);
  palmSpots.forEach((p, k) => {
    _p.set(p.x, 3.5, p.z); _s.set(1, 1, 1); trunks.setMatrixAt(k, _m().compose(_p, _q, _s));
    _p.set(p.x, 7.6, p.z); fronds.setMatrixAt(k, _m().compose(_p, _q, _s));
    fronds.setColorAt(k, new THREE.Color(p.scrub ? 0x7a8a3a : 0x2ecc71));
    addProp(p.x, p.z, 0.5);
  });
  trunks.instanceMatrix.needsUpdate = true; fronds.instanceMatrix.needsUpdate = true;
  if (fronds.instanceColor) fronds.instanceColor.needsUpdate = true;
  scene.add(trunks); scene.add(fronds);
  // Beach umbrellas on both coasts and the Keys (visual only, no collider —
  // they are canvas and fronds, you brush past them).
  const umbSpots = [];
  for (let z = -180; z < 195; z += 24) { umbSpots.push([WORLD + 12 + rng() * 6, z]); umbSpots.push([-WORLD - 12 - rng() * 6, z + 9]); }
  for (const k of KEYS) for (let i = 0; i < 4; i++) umbSpots.push([(rng() - 0.5) * k.rx, k.z + k.rz - 4]);
  const umb = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 1, 7), new THREE.MeshLambertMaterial({ color: 0xffffff }), umbSpots.length);
  umbSpots.forEach((s, k) => {
    _p.set(s[0], 2.1, s[1]); _s.set(1, 1, 1); umb.setMatrixAt(k, _m().compose(_p, _q, _s));
    umb.setColorAt(k, new THREE.Color(pick(rng, contColors.concat([0xff5da2, 0x7ef0d4]))));
  });
  umb.instanceMatrix.needsUpdate = true;
  if (umb.instanceColor) umb.instanceColor.needsUpdate = true;
  scene.add(umb);

  // ---- Landmark set pieces ------------------------------------------------
  const DECO = ['HOTEL DEL MARLIN', 'THE FLAMINGO PALM', 'DECO SANDS', 'HOTEL AZURE PALM', 'THE CORALINE', 'PALM ROYALE'];
  const decoInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ map: styles.pastel.tex }), DECO.length);
  const stepInst = new THREE.InstancedMesh(new THREE.BoxGeometry(7, 2.4, 10), mat(0xf5f6fa), DECO.length);
  DECO.forEach((name, i) => {
    // Hotels sit BETWEEN the east–west road bands, fronting the promenade —
    // the old 62 + i*21 spacing dropped three of them across the z=75 and
    // z=150 road surfaces.
    const z = [32, 52, 95, 115, 133, 175][i], h = 11 + (i % 3) * 3;
    _p.set(193, h / 2 + 0.3, z); _s.set(10, h, 15); decoInst.setMatrixAt(i, _m().compose(_p, _q, _s));
    // Per-instance colour, like every other building mesh: an instanced
    // facade mesh with NO instanceColor is the one class that came up
    // pure black on the player's phone (see the town fix in
    // buildPeninsula). Deterministic cycle — no rng, stream untouched.
    decoInst.setColorAt(i, new THREE.Color(styles.pastel.tint[i % styles.pastel.tint.length]));
    _p.set(193, h + 1.4, z); _s.set(1, 1, 1); stepInst.setMatrixAt(i, _m().compose(_p, _q, _s));
    colliders.push({ x: 193, z, hw: 5, hd: 7.5 });
    buildingRecords.push({ x: 193, z, hw: 5, hd: 7.5 });
    const s = signMesh(name, i % 2 ? '#7ef0d4' : '#ff5da2', '#14101f', 11, 2.6);
    s.position.set(198.5, h - 1.6, z); s.rotation.y = Math.PI / 2; scene.add(s);
  });
  decoInst.instanceMatrix.needsUpdate = true; stepInst.instanceMatrix.needsUpdate = true;
  if (decoInst.instanceColor) decoInst.instanceColor.needsUpdate = true;
  scene.add(decoInst); scene.add(stepInst);
  { // Marlin Point Lighthouse: banded tower, lit lamp, sweeping beam cone.
    const bands = [0xf5f6fa, 0xd63031, 0xf5f6fa, 0xd63031, 0xf5f6fa];
    bands.forEach((c, i) => {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.6 - i * 0.28, 2.9 - i * 0.28, 3.4, 10), mat(c));
      seg.position.set(218, 1.7 + i * 3.4, 120); scene.add(seg);
    });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    lamp.position.set(218, 19.4, 120); scene.add(lamp);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(4.5, 30, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff9c4, transparent: true, opacity: 0.13, side: THREE.DoubleSide }));
    beam.rotation.z = Math.PI / 2.25; beam.position.set(206, 19.4, 120); scene.add(beam);
    colliders.push({ x: 218, z: 120, hw: 3, hd: 3 });
    buildingRecords.push({ x: 218, z: 120, hw: 3, hd: 3 });
  }
  { // Southernmost Point buoy at the end of the Keys — standing BESIDE the
    // causeway terminus, not on it (the old spot blocked the road's end).
    const cols = [0xd63031, 0xf5f6fa, 0x14161c, 0xf5f6fa, 0xd63031];
    cols.forEach((c, i) => {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.2 - Math.abs(i - 2) * 0.3, 2.4 - Math.abs(i - 2) * 0.3, 1.6, 10), mat(c));
      seg.position.set(12, 0.8 + i * 1.6, 434); scene.add(seg);
    });
    const s = signMesh('SOUTHERNMOST POINT · KEY SOLANO', '#ffe9a8', '#7a1f1f', 13, 3);
    s.position.set(12, 10.6, 434); scene.add(s);
    colliders.push({ x: 12, z: 434, hw: 2.6, hd: 2.6 });
    buildingRecords.push({ x: 12, z: 434, hw: 2.6, hd: 2.6 });
  }
  // Drawbridge span mid-causeway: twin towers and a top beam (deck stays flat).
  for (const sx of [-1, 1]) {
    const tw = new THREE.Mesh(new THREE.BoxGeometry(1.6, 13, 1.6), mat(0x8e9aaf));
    tw.position.set(CAUSEWAY.x + sx * 11, 6.5, 302); scene.add(tw);
    addProp(CAUSEWAY.x + sx * 11, 302, 1.1);
  }
  const beam2 = new THREE.Mesh(new THREE.BoxGeometry(24, 1.4, 1.6), mat(0x8e9aaf));
  beam2.position.set(CAUSEWAY.x, 13.4, 302); scene.add(beam2);
  const dbs = signMesh('MARLIN DRAWBRIDGE', '#7ef0d4', '#14101f', 15, 3);
  dbs.position.set(CAUSEWAY.x, 10.8, 302); scene.add(dbs);
  { // Glades airboat dock at the marsh edge.
    const dock = new THREE.Mesh(new THREE.BoxGeometry(16, 0.5, 5), mat(0x8d6e63));
    dock.position.set(0, 0.35, -222); scene.add(dock);
    const boat = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.8, 6.4), mat(0xe67e22));
    boat.position.set(-3, 0.7, -230); scene.add(boat);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.3, 12), mat(0x2f3542));
    fan.rotation.x = Math.PI / 2; fan.position.set(-3, 2.4, -233); scene.add(fan);
    const s = signMesh('GLADES AIRBOAT TOURS', '#ffe9a8', '#243014', 13, 3);
    s.position.set(6, 4.6, -220); scene.add(s);
  }
  { // Rocket gantry silhouette across the bay.
    const gantry = new THREE.Mesh(new THREE.BoxGeometry(4, 44, 4), mat(0x4a5262));
    gantry.position.set(330, 22, -40); scene.add(gantry);
    const rocket = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 30, 8), mat(0xdfe6e9));
    rocket.position.set(338, 15, -40); scene.add(rocket);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(2.4, 6, 8), mat(0xd63031));
    nose.position.set(338, 33, -40); scene.add(nose);
  }
  // Key Solano settlement: small pastel houses flanking the causeway at
  // the end of the line — none on the road itself (three of the old row
  // stood across the causeway band).
  for (let i = 0; i < 7; i++) {
    const x = [-24, -17, 17, 24, -20, 20, -13.5][i], z = 396 + (i % 2) * 12;
    const hse = new THREE.Mesh(new THREE.BoxGeometry(5.5, 4, 5.5), new THREE.MeshLambertMaterial({ map: styles.pastel.tex, color: [0xffffff, 0xffe8c8, 0xd8f0d0, 0xffd8d8][i % 4] }));
    hse.position.set(x, 2.3, z); scene.add(hse);
    colliders.push({ x, z, hw: 2.8, hd: 2.8 });
    buildingRecords.push({ x, z, hw: 2.8, hd: 2.8 });
  }
  // Signed service buildings: police, garage, fire station. (The hospital
  // is built by facilities.js as a walk-in building on its own lot.)
  // The FOOTPRINT sits inside the block quadrant beside the anchor point —
  // the old code centred a 20x16 box on anchors that stand within a few
  // units of the road centrelines, so the police/hospital boxes straddled
  // the x=±75 / z=-75 junction and the fire station sat across the whole
  // x=150 / z=-150 corner: blank walls eating half of two streets each.
  function landmarkBldg(fx, fz, color, label, fg, signFace) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(16, 12, 14), new THREE.MeshLambertMaterial({ map: shellTex, color }));
    b.position.set(fx, 6, fz); scene.add(b);
    colliders.push({ x: fx, z: fz, hw: 8, hd: 7 });
    buildingRecords.push({ x: fx, z: fz, hw: 8, hd: 7 });
    const s = signMesh(label, fg || '#ffffff', '#14101f', 13, 3.2);
    if (signFace === 'w') { s.position.set(fx - 8.2, 10.6, fz); s.rotation.y = -Math.PI / 2; }
    else if (signFace === 'n') { s.position.set(fx, 10.6, fz - 7.2); s.rotation.y = Math.PI; }
    else s.position.set(fx, 10.6, fz + 7.2);
    scene.add(s);
    return b;
  }
  landmarkBldg(-58, -58, 0x3742fa, 'POLICE', '#7ef0d4', 's');       // anchor POLICE_STATION (-68,-68): footprint in the block NE of the junction
  landmarkBldg(93, 93, 0x57606f, "LUCIA'S GARAGE", '#ffd32a', 'w'); // anchor GARAGE (82,82): footprint in the block NE of the junction
  landmarkBldg(170, -118, 0xc0392b, 'DAMKAR · FIRE STATION', '#ffd32a', 'n'); // anchor FIRE_STATION (150,-150): footprint NE of the junction, clear of MAPLE HOUSE
  const gator = signMesh('THE GLADES — MIND THE GATORS', '#ffe9a8', '#243014', 14, 3.6);
  gator.position.set(8, 4.4, -214); scene.add(gator);

  // World pickups: sniper caches, pistols, food, armour and cola at places
  // that make sense. A glowing pillar marks each one until it is taken.
  const pickups = [];
  // PICKUP_SPOTS is defined up by the placement code, which reserved clear
  // ground around every spot — so nothing here needs to delete colliders.
  for (const spot of PICKUP_SPOTS) {
    const grp = new THREE.Group();
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 1.3), mat(spot.kind === 'armour' ? 0x273c75 : spot.kind === 'sniper' ? 0x2f3542 : 0xe67e22));
    crate.position.y = 0.7; grp.add(crate);
    if (spot.kind === 'sniper') {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.4, 6), mat(0x14161c));
      barrel.rotation.z = Math.PI / 2; barrel.position.y = 1.25; grp.add(barrel);
    }
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 22, 10, 1, true), new THREE.MeshBasicMaterial({ color: spot.color, transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
    glow.position.y = 11; grp.add(glow);
    grp.position.set(spot.x, 0, spot.z); scene.add(grp);
    pickups.push({ x: spot.x, z: spot.z, kind: spot.kind, grp, taken: false });
  }
  // Objective marker: glowing pillar with a floating diamond on top.
  const marker = new THREE.Group();
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 30, 10), new THREE.MeshBasicMaterial({ color: 0xffd32a, transparent: true, opacity: 0.4 }));
  pillar.position.y = 15; marker.add(pillar);
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(1.8), new THREE.MeshBasicMaterial({ color: 0xffd32a }));
  diamond.position.y = 6; marker.add(diamond);
  marker.visible = false; scene.add(marker);
  return { marker, diamond, ocean, pickups };
}

// The peninsula spine and panhandle: land, beaches, the highway, Lake
// Okeechobee, and a chain of small roadside towns. All props are instanced;
// all buildings and trunks register colliders as plain data.
function buildPeninsula(scene, rng) {
  const landMat = mat(0x55803f), sandMat = mat(0xf2d492);
  const spineLen = -PANHANDLE_Z - 436; // marsh edge to panhandle start
  const spine = new THREE.Mesh(new THREE.PlaneGeometry(376, spineLen), landMat);
  spine.rotation.x = -Math.PI / 2; spine.position.set(0, -0.04, -436 - spineLen / 2); scene.add(spine);
  const pan = new THREE.Mesh(new THREE.PlaneGeometry(1380, -NORTH_END + PANHANDLE_Z + 40), landMat);
  pan.rotation.x = -Math.PI / 2; pan.position.set(0, -0.04, (PANHANDLE_Z + NORTH_END) / 2); scene.add(pan);
  for (const sx of [-1, 1]) { // shoreline sand along both spine coasts
    const b = new THREE.Mesh(new THREE.PlaneGeometry(26, spineLen), sandMat);
    b.rotation.x = -Math.PI / 2; b.position.set(sx * 188, 0, -436 - spineLen / 2); scene.add(b);
  }
  // Lake Okeechobee: a broad water disc biting into the land east of the road.
  const lake = new THREE.Mesh(new THREE.CylinderGeometry(95, 95, 1, 24), mat(0x2e6e8c));
  lake.scale.set(LAKE_OKEECHOBEE.rx / 95, 1, LAKE_OKEECHOBEE.rz / 95); lake.position.set(LAKE_OKEECHOBEE.x, -0.5, LAKE_OKEECHOBEE.z); scene.add(lake);
  // The highway itself: one long road plane, dashes down its centre.
  const hw = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, -NORTH_END - 180), mat(0x39404d));
  hw.rotation.x = -Math.PI / 2; hw.position.set(0, 0.02, (-180 + NORTH_END) / 2); scene.add(hw);
  const dashCount = Math.floor((-NORTH_END - 240) / 26);
  const hwDash = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.5, 6), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }), dashCount);
  const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  for (let i = 0; i < dashCount; i++) {
    _p.set(0, 0.05, -240 - i * 26); _s.set(1, 1, 1);
    hwDash.setMatrixAt(i, _m().compose(_p, flat, _s));
  }
  hwDash.instanceMatrix.needsUpdate = true; scene.add(hwDash);
  // Highway lamps: instanced, sparse, and solid.
  const hwLamps = [];
  for (let z = -320; z > NORTH_END + 120; z -= 110) hwLamps.push(z);
  const hwPoles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.1, 5.6, 5), mat(0x2f3542), hwLamps.length * 2);
  const hwHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), hwLamps.length * 2);
  hwLamps.forEach((z, i) => {
    for (const sx of [-1, 1]) {
      const k = i * 2 + (sx > 0 ? 1 : 0);
      _p.set(sx * 10.5, 2.8, z); _s.set(1, 1, 1); hwPoles.setMatrixAt(k, _m().compose(_p, _q, _s));
      _p.y = 5.8; hwHeads.setMatrixAt(k, _m().compose(_p, _q, _s));
      addProp(sx * 10.5, z, 0.3);
    }
  });
  hwPoles.instanceMatrix.needsUpdate = true; hwHeads.instanceMatrix.needsUpdate = true;
  scene.add(hwPoles); scene.add(hwHeads);
  // Roadside towns: clusters of low blocks either side of the highway, each
  // with a name sign on a solid post at its entrance.
  // PALMETTO FLATS, CYPRESS JUNCTION and TALLAHASSEE PALMS are no longer
  // token clusters — they are grid towns (TOWN_GRIDS, built below; their
  // entrance signs come from the grid builder too).
  const TOWNS = [
    { z: -760, name: 'LAKEPORT · OKEECHOBEE' },
    { z: -2740, name: 'KISSIMMEE PRAIRIE' },
    { z: -3380, name: 'SUWANNEE CROSSING' }, { z: -3980, name: 'PANHANDLE GATE' },
  ];
  const townTex = facadeTex(rng, '#e6ddcb', 0.5, 4, 3, true);
  const blocks = [];
  // The removed clusters' rng draws are burned in their original positions
  // in the sequence (two after LAKEPORT, one after PANHANDLE GATE), so the
  // four remaining clusters — and every placement downstream of this
  // function — keep the exact stream they had before the grid towns landed.
  const burnClusterDraws = () => {
    const n = 7 + Math.floor(rng() * 5);
    for (let i = 0; i < n * 5; i++) rng();
  };
  for (const t of TOWNS) {
    const n = 7 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (26 + rng() * 46), z = t.z + (rng() - 0.5) * 130;
      const w = 10 + rng() * 9, d = 10 + rng() * 9, h = 5 + rng() * 9;
      blocks.push({ x, z, w, d, h });
      colliders.push({ x, z, hw: w / 2, hd: d / 2 });
      buildingRecords.push({ x, z, hw: w / 2, hd: d / 2 });
    }
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 5.4, 5), mat(0x2f3542));
    post.position.set(11, 2.7, t.z + 60); scene.add(post); addProp(11, t.z + 60, 0.35);
    const sign = signMesh(t.name, '#ffe9a8', '#243014', 15, 3);
    sign.position.set(11, 5.6, t.z + 60); scene.add(sign);
    buildingCounts['Peninsula towns'] = (buildingCounts['Peninsula towns'] || 0) + n;
    if (t.name === 'LAKEPORT · OKEECHOBEE') { burnClusterDraws(); burnClusterDraws(); } // PALMETTO + CYPRESS slots
    if (t.name === 'PANHANDLE GATE') burnClusterDraws(); // TALLAHASSEE slot
  }
  // ---- Grid towns ---------------------------------------------------------
  // One generic builder for every TOWN_GRIDS entry. Streets are asphalt
  // planes registered in TOWN_STREETS; buildings are generated as frontage
  // rows on every street (face 2–4 units off the band edge), tested against
  // the highway band, every street band of the town, a roadside pickup
  // reserve, and each other — a candidate that does not fit is skipped,
  // never nudged. All sizes come from a SEPARATE rng seeded per town, so
  // the shared stream (and every placement downstream) never shifts.
  // Buildings join the same blocks[] list as the clusters, so they render
  // through townInst + parapet caps with per-instance tints.
  TOWN_STREETS.length = 0;
  const townLampSpots = [], townTreeSpots = [];
  const townPaveMat = mat(0x39404d);
  function buildGridTown(def) {
    const trng = makeRng(def.seed);
    const streets = [];
    for (const z of def.ewZ) {
      const s = { axis: 'ew', at: z, from: def.x0, to: def.x1, halfW: 5 };
      streets.push(s); TOWN_STREETS.push(s);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(def.x1 - def.x0, s.halfW * 2), townPaveMat);
      p.rotation.x = -Math.PI / 2; p.position.set((def.x0 + def.x1) / 2, 0.02, z); scene.add(p);
    }
    for (const x of def.nsX) {
      const s = { axis: 'ns', at: x, from: def.z0, to: def.z1, halfW: 5 };
      streets.push(s); TOWN_STREETS.push(s);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(s.halfW * 2, def.z1 - def.z0), townPaveMat);
      p.rotation.x = -Math.PI / 2; p.position.set(x, 0.02, (def.z0 + def.z1) / 2); scene.add(p);
    }
    const bandOf = (s) => s.axis === 'ew'
      ? { x0: s.from, x1: s.to, z0: s.at - s.halfW, z1: s.at + s.halfW }
      : { x0: s.at - s.halfW, x1: s.at + s.halfW, z0: s.from, z1: s.to };
    const bands = streets.map(bandOf);
    const placed = []; // candidate AABBs, incl. ones later cut by the target cap
    function tBlocked(x, z, hw, hd) {
      const x0 = x - hw, x1 = x + hw, z0 = z - hd, z1 = z + hd;
      if (x0 < 10.5 && x1 > -10.5) return true; // highway band 7.5 + margin
      if (z0 < -4270) return true; // world edge: nothing south of the far shore line (only Tallahassee Palms ever reaches it)
      for (const b of bands) if (x0 < b.x1 && x1 > b.x0 && z0 < b.z1 && z1 > b.z0) return true;
      // Roadside pickup layby on the main street's south side, east of the
      // highway (the snack spot at (14, -1408) for Palmetto Flats).
      const px = 14, pz = def.cz + 12;
      const nx = Math.max(x0, Math.min(px, x1)), nz = Math.max(z0, Math.min(pz, z1));
      if (Math.hypot(px - nx, pz - nz) < 8) return true;
      for (const b of placed) if (x0 < b.x1 + 0.7 && x1 > b.x0 - 0.7 && z0 < b.z1 + 0.7 && z1 > b.z0 - 0.7) return true;
      return false;
    }
    const candidates = [];
    function rowEW(at, side) {
      let cur = def.x0;
      while (cur < def.x1 - 7) {
        const w = 10 + trng() * 9, d = 10 + trng() * 9, h = 5 + trng() * 9, gap = 2 + trng() * 2;
        const cx = cur + w / 2, cz = at + side * (5 + gap + d / 2);
        if (!tBlocked(cx, cz, w / 2, d / 2)) {
          candidates.push({ x: cx, z: cz, w, d, h });
          placed.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 });
          cur += w + 1.2 + trng() * 1.8;
        } else cur += 3;
      }
    }
    function rowNS(at, side) {
      let cur = def.z0;
      while (cur < def.z1 - 7) {
        const len = 10 + trng() * 9, dep = 10 + trng() * 9, h = 5 + trng() * 9, gap = 2 + trng() * 2;
        const cz = cur + len / 2, cx = at + side * (5 + gap + dep / 2);
        if (!tBlocked(cx, cz, dep / 2, len / 2)) {
          candidates.push({ x: cx, z: cz, w: dep, d: len, h });
          placed.push({ x0: cx - dep / 2, x1: cx + dep / 2, z0: cz - len / 2, z1: cz + len / 2 });
          cur += len + 1.2 + trng() * 1.8;
        } else cur += 3;
      }
    }
    for (const z of def.ewZ) { rowEW(z, -1); rowEW(z, 1); }
    for (const x of def.nsX) { rowNS(x, -1); rowNS(x, 1); }
    // Cap at the town's target: shuffle the candidate order with the town
    // rng, keep the target count, then restore street order for placement —
    // the kept set stays spread across every street and side.
    let kept = candidates;
    if (def.target && candidates.length > def.target) {
      const order = candidates.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(trng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      const chosen = new Set(order.slice(0, def.target));
      kept = candidates.filter((_, i) => chosen.has(i));
    }
    for (const b of kept) {
      blocks.push(b);
      colliders.push({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2 });
      buildingRecords.push({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2 });
    }
    buildingCounts[def.name] = (buildingCounts[def.name] || 0) + kept.length;
    // Lamps along the main street (the cz EW street): pole + glowing head,
    // on the street edge, clear of the highway crossing and NS junctions.
    for (let x = def.x0 + 5; x <= def.x1 - 5; x += 20) {
      if (Math.abs(x) < 12) continue;
      if (def.nsX.some((nx) => Math.abs(x - nx) < 9)) continue;
      townLampSpots.push({ x, z: def.cz + (x < 0 ? -6 : 6), town: def.name });
    }
    // Trees on block corners: the four corners of every street crossing,
    // plus the town's outer corners — skipped when a kept building stands
    // there, so a trunk never grows through a facade.
    const treeAt = (tx, tz) => {
      if (Math.abs(tx) < 10.5) return;
      for (const b of kept) if (tx > b.x - b.w / 2 - 1.5 && tx < b.x + b.w / 2 + 1.5 && tz > b.z - b.d / 2 - 1.5 && tz < b.z + b.d / 2 + 1.5) return;
      for (const bd of bands) if (tx > bd.x0 - 1 && tx < bd.x1 + 1 && tz > bd.z0 - 1 && tz < bd.z1 + 1) return;
      townTreeSpots.push({ x: tx, z: tz, town: def.name });
    };
    for (const ez of def.ewZ) for (const nx of def.nsX) for (const sx of [-1, 1]) for (const sz of [-1, 1]) treeAt(nx + sx * 9, ez + sz * 9);
    treeAt(def.x0 + 6, def.z0 + 6); treeAt(def.x1 - 6, def.z0 + 6);
    treeAt(def.x0 + 6, def.z1 - 6); treeAt(def.x1 - 6, def.z1 - 6);
    // Entrance name signs on the highway at the town's north and south
    // edges — same signMesh + post + addProp pattern as the cluster towns.
    for (const ez of [def.z0, def.z1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 5.4, 5), mat(0x2f3542));
      post.position.set(11, 2.7, ez); scene.add(post); addProp(11, ez, 0.35);
      const sign = signMesh(def.name, '#ffe9a8', '#243014', 15, 3);
      sign.position.set(11, 5.6, ez); scene.add(sign);
    }
    return kept.length;
  }
  for (const def of TOWN_GRIDS) buildGridTown(def);
  // Town lamps and trees, instanced like their highway / southern kin.
  if (townLampSpots.length) {
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.1, 5.6, 5), mat(0x2f3542), townLampSpots.length);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), townLampSpots.length);
    townLampSpots.forEach((s, k) => {
      _p.set(s.x, 2.8, s.z); _s.set(1, 1, 1); poles.setMatrixAt(k, _m().compose(_p, _q, _s));
      _p.y = 5.8; heads.setMatrixAt(k, _m().compose(_p, _q, _s));
      addProp(s.x, s.z, 0.3);
    });
    poles.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
    scene.add(poles); scene.add(heads);
  }
  if (townTreeSpots.length) {
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.3, 3.2, 5), mat(0x6d4c41), townTreeSpots.length);
    const canopies = new THREE.InstancedMesh(new THREE.SphereGeometry(2.3, 7, 6), mat(0x2f9e44), townTreeSpots.length);
    townTreeSpots.forEach((s, k) => {
      _p.set(s.x, 1.6, s.z); _s.set(1, 1, 1); trunks.setMatrixAt(k, _m().compose(_p, _q, _s));
      _p.set(s.x, 4.6, s.z); _s.set(1, 0.85, 1); canopies.setMatrixAt(k, _m().compose(_p, _q, _s));
      addProp(s.x, s.z, 0.45);
    });
    trunks.instanceMatrix.needsUpdate = true; canopies.instanceMatrix.needsUpdate = true;
    scene.add(trunks); scene.add(canopies);
  }
  const townInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ map: townTex }), blocks.length);
  // ROOT CAUSE of the Palmetto Flats black slabs: this was the ONLY
  // facade-textured InstancedMesh in the world that never called
  // setColorAt. In three r128 instanceColor is a shader-program input
  // (USE_INSTANCING_COLOR / USE_COLOR), so the towns compiled the odd
  // program out — and on the player's phone GPU that program sampled
  // the facade as pure black: the screenshot's town faces measure
  // exactly (0,0,0) while the land, road, palms and every southern
  // building (all setColorAt'd) render normally in the same frame. The
  // canvas itself was never the problem — dumped in Node it is a cream
  // facade, mean luminance 172, 0% near-black. So the towns now get
  // per-instance tints exactly like the southern styles, plus the
  // parapet-cap trim the south already had. Tints come from a SEPARATE
  // rng: the shared stream (and every placement downstream) is untouched.
  const townTintRng = makeRng(20261124);
  const townTints = [0xffffff, 0xffe8c8, 0xd8f0d0, 0xffd8d8, 0xcfe4ff];
  const townCaps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0x3d4454), blocks.length);
  blocks.forEach((b, k) => {
    _p.set(b.x, b.h / 2 + 0.3, b.z); _s.set(b.w, b.h, b.d);
    townInst.setMatrixAt(k, _m().compose(_p, _q, _s));
    townInst.setColorAt(k, new THREE.Color(pick(townTintRng, townTints)));
    _p.set(b.x, b.h + 0.55, b.z); _s.set(b.w + 0.7, 0.5, b.d + 0.7);
    townCaps.setMatrixAt(k, _m().compose(_p, _q, _s));
  });
  townInst.instanceMatrix.needsUpdate = true;
  if (townInst.instanceColor) townInst.instanceColor.needsUpdate = true;
  townCaps.instanceMatrix.needsUpdate = true;
  scene.add(townInst); scene.add(townCaps);

  // ---- Roadside tissue (round 5) ------------------------------------------
  // Farms, a trailer cluster, rest stops and billboards strung along the
  // highway so the long drive north is not dead land. Everything here runs
  // on its OWN seeded rng stream, placed after every town/cluster above,
  // so no existing placement shifts. Solid structures push a collider AND
  // a building record from the same numbers (no ghosts); small props go
  // through addProp. Every placement clears the highway band (|x| <= 7.5)
  // by a margin.
  const rrng = makeRng(555001);
  const capMat = mat(0x3d4454), postMat = mat(0x2f3542);
  function solidBox(x, z, w, d, h, color) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    body.position.set(x, h / 2, z); scene.add(body);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, 0.5, d + 0.7), capMat);
    cap.position.set(x, h + 0.25, z); scene.add(cap);
    colliders.push({ x, z, hw: w / 2, hd: d / 2 });
    buildingRecords.push({ x, z, hw: w / 2, hd: d / 2 });
    buildingCounts['Roadside'] = (buildingCounts['Roadside'] || 0) + 1;
  }
  function roadLamp(x, z) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 5.6, 5), postMat);
    pole.position.set(x, 2.8, z); scene.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
    head.position.set(x, 5.8, z); scene.add(head);
    addProp(x, z, 0.3);
  }
  function roadSign(x, z, text, boardW = 11) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 4.6, 5), postMat);
    post.position.set(x, 2.3, z); scene.add(post); addProp(x, z, 0.3);
    const s = signMesh(text, '#ffe9a8', '#243014', boardW, 2.6);
    s.position.set(x, 5.2, z); scene.add(s);
  }
  function picnicTable(x, z) {
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.14, 1.2), mat(0x8a5a2b));
    top.position.set(x, 0.78, z); scene.add(top);
    for (const s of [-1, 1]) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.4), mat(0x8a5a2b));
      bench.position.set(x, 0.45, z + s * 0.95); scene.add(bench);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.78, 0.9), postMat);
      leg.position.set(x + s * 0.9, 0.39, z); scene.add(leg);
    }
    addProp(x, z, 1.3);
  }
  function farm(cx, cz, side) { // side: -1 west of the highway, +1 east
    solidBox(cx, cz, 12, 10, 7, 0x8a3b2e); // the barn, red-brown with its cap
    const siloX = cx - side * 11;
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 11, 10), mat(0xb8bec8));
    silo.position.set(siloX, 5.5, cz); scene.add(silo);
    const siloTop = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.8, 10), capMat);
    siloTop.position.set(siloX, 11.9, cz); scene.add(siloTop);
    addProp(siloX, cz, 2.4);
    const field = new THREE.Mesh(new THREE.PlaneGeometry(34, 20), mat(0x2e5d33));
    field.rotation.x = -Math.PI / 2; field.position.set(cx, 0.01, cz + 21); scene.add(field);
    // Fence line of posts along the road frontage.
    const fx = side * 13, posts = [];
    for (let z = cz - 26; z <= cz + 26; z += 5.2) posts.push(z + (rrng() - 0.5) * 0.6);
    const postInst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 1.15, 0.22), mat(0x6d4c41), posts.length);
    posts.forEach((z, k) => {
      _p.set(fx, 0.57, z); _s.set(1, 1, 1); postInst.setMatrixAt(k, _m().compose(_p, _q, _s));
      addProp(fx, z, 0.28);
    });
    postInst.instanceMatrix.needsUpdate = true; scene.add(postInst);
  }
  farm(-34, -600, -1);   // west farm, z ~ -600
  farm(34, -2450, 1);    // east farm, z ~ -2450
  // Trailer cluster: three pastel trailers east of the highway at z ~ -1750.
  const trailerTints = [0xfec8a0, 0xa0e8dd, 0xfff3b0];
  [[40, -1760], [56, -1746], [70, -1762]].forEach(([x, z], i) => {
    solidBox(x, z, 9, 3.5, 3.2, pick(rrng, trailerTints));
  });
  roadLamp(48, -1752);
  // Rest stops: asphalt pad just off the highway edge, sign, lamps, table.
  function restStop(cx, cz, side) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(25, 18), mat(0x39404d));
    pad.rotation.x = -Math.PI / 2; pad.position.set(cx, 0.015, cz); scene.add(pad);
    roadSign(side * 10.5, cz + (side < 0 ? 12 : -12), 'REST STOP', 10);
    roadLamp(cx - 7, cz - 8); roadLamp(cx + 7, cz + 8);
    picnicTable(cx + 3, cz);
  }
  restStop(-21, -1050, -1); // west
  restStop(21, -3050, 1);   // east
  // Billboards along the drive, alternating sides, boards riding high on
  // solid posts at |x| ~ 17 (no building collider on the board itself).
  const BOARDS = [
    [-500, 1, 'MIND THE GATORS'], [-1100, -1, 'LAKE OKEECHOBEE'], [-1700, 1, 'EAT — CYPRESS DINER'],
    [-2300, -1, 'PALMETTO FLATS · MOTEL'], [-2900, 1, 'GAS · FOOD · LODGING'], [-3500, -1, 'TALLAHASSEE PALMS'],
  ];
  for (const [z, side, text] of BOARDS) {
    const x = side * 17;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 7.4, 6), postMat);
    post.position.set(x, 3.7, z); scene.add(post); addProp(x, z, 0.4);
    const board = signMesh(text, '#ffd32a', '#14101f', 15, 3.2);
    board.position.set(x, 8.6, z); scene.add(board);
  }
}

// ---- People ---------------------------------------------------------------
// Figures are ARTICULATED, not statues: each leg hangs from a hip pivot group
// and each arm from a shoulder pivot group, so posePerson() can swing real
// geometry through a stride. The upper body (torso, head, arms) rides in an
// `upper` group pivoted at the hips, which carries the forward lean of a run
// and the breathing bob of an idle stance.
//
// Faces are canvas textures on the head's front face only — eyes, brows and
// a mouth painted over the skin tone — so a face costs one small texture per
// expression, shared by every figure that uses it.
const faceCache = {};
export function faceTexture(skinHex, variant) {
  const key = skinHex + ':' + variant;
  if (faceCache[key]) return faceCache[key];
  const skin = '#' + skinHex.toString(16).padStart(6, '0');
  const tex = canvasTex(64, 64, (g) => {
    g.fillStyle = skin; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#20222b';
    g.fillRect(14, 26, 9, 11); g.fillRect(41, 26, 9, 11);      // eyes
    g.fillStyle = '#ffffff';
    g.fillRect(17, 28, 3, 3); g.fillRect(44, 28, 3, 3);        // catchlights
    g.fillStyle = 'rgba(30,20,16,0.85)';
    g.fillRect(12, 19, 13, 3); g.fillRect(39, 19, 13, 3);      // brows
    if (variant === 'grin') { g.fillRect(24, 46, 16, 3); g.fillRect(24, 46, 3, 6); g.fillRect(37, 46, 3, 6); }
    else if (variant === 'stern') { g.fillRect(25, 50, 14, 3); }
    else { g.fillRect(26, 47, 12, 3); g.fillRect(29, 50, 6, 2); } // neutral mouth
  });
  faceCache[key] = tex;
  return tex;
}
function headedMesh(skin, variant) {
  const side = new THREE.MeshLambertMaterial({ color: skin });
  const front = new THREE.MeshLambertMaterial({ map: faceTexture(skin, variant || 'neutral') });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), [side, side, side, side, front, side]);
  head.position.y = 0.28; // inside a head group pivoted at the neck
  return head;
}
function limb(color, w, len, d) {
  // A pivot group; the limb box hangs below it so rotation.x swings the limb.
  const pivot = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, len, d), new THREE.MeshLambertMaterial({ color }));
  box.position.y = -len / 2;
  pivot.add(box);
  return pivot;
}
function shoe(color) {
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.44), new THREE.MeshLambertMaterial({ color }));
  s.position.set(0, -0.86, 0.07);
  return s;
}
const HAIR_COLORS = [0x1e272e, 0x4a3220, 0x8a5a2b, 0xf7d154, 0xb5524a, 0xdfe6e9, 0x2f3542];
let personCounter = 0;

// Shared body builder. opts: {skin, shirt, pants, hairColor, hairStyle,
// face, shoeColor}. Hair styles: 'cap' | 'spiky' | 'bun' | 'long' | 'ponytail'
// | 'flat' — geometry, so silhouettes differ, not just colours.
function buildFigure(opts) {
  const g = new THREE.Group();
  const m = (c) => new THREE.MeshLambertMaterial({ color: c });
  const legL = limb(opts.pants, 0.3, 0.92, 0.4); legL.position.set(-0.21, 0.95, 0);
  const legR = limb(opts.pants, 0.3, 0.92, 0.4); legR.position.set(0.21, 0.95, 0);
  legL.add(shoe(opts.shoeColor)); legR.add(shoe(opts.shoeColor));
  g.add(legL); g.add(legR);
  const upper = new THREE.Group(); upper.position.y = 0.95; g.add(upper);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.92, 0.5), m(opts.shirt));
  torso.position.y = 0.45; upper.add(torso);
  const armL = limb(opts.armColor ?? opts.shirt, 0.24, 0.82, 0.24); armL.position.set(-0.6, 0.86, 0);
  const armR = limb(opts.armColor ?? opts.shirt, 0.24, 0.82, 0.24); armR.position.set(0.6, 0.86, 0);
  upper.add(armL); upper.add(armR);
  const headG = new THREE.Group(); headG.position.y = 0.92; upper.add(headG);
  headG.add(headedMesh(opts.skin, opts.face));
  const hair = new THREE.Group(); headG.add(hair);
  const hm = m(opts.hairColor);
  const capTop = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.6), hm); capTop.position.y = 0.62; hair.add(capTop);
  if (opts.hairStyle === 'ponytail') {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.3), m(0xe84393));
    tie.position.set(0, 0.58, -0.3); hair.add(tie);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.78, 0.24), hm);
    tail.position.set(0, 0.22, -0.42); tail.rotation.x = 0.18; hair.add(tail);
    const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.14), hm);
    fringe.position.set(0, 0.52, 0.26); hair.add(fringe);
  } else if (opts.hairStyle === 'spiky') {
    for (let i = 0; i < 3; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.34, 4), hm);
      spike.position.set((i - 1) * 0.19, 0.82, (i % 2) * 0.14 - 0.05); hair.add(spike);
    }
    const fade = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 0.62), hm);
    fade.position.y = 0.44; hair.add(fade);
  } else if (opts.hairStyle === 'bun') {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5), hm);
    bun.position.set(0, 0.68, -0.28); hair.add(bun);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.14), hm);
    back.position.set(0, 0.48, -0.27); hair.add(back);
  } else if (opts.hairStyle === 'long') {
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.72, 0.14), hm);
    back.position.set(0, 0.24, -0.29); hair.add(back);
    for (const sx of [-1, 1]) {
      const sideLock = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.4), hm);
      sideLock.position.set(sx * 0.3, 0.32, 0); hair.add(sideLock);
    }
  } else if (opts.hairStyle === 'cap') {
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.3), hm);
    brim.position.set(0, 0.52, 0.38); hair.add(brim);
  } // 'flat' is the capTop alone
  g.userData = { armL, armR, legL, legR, upper, headG, torso, who: opts.who || '' };
  return g;
}

// Pose a figure built by buildFigure. phase is the stride cycle in radians;
// legAmp/armAmp are swing amplitudes (bigger = longer stride, harder pump);
// lean pitches the upper body forward; breath drives the idle motion —
// breathing chest, a slight head bob and a weight shift — and doubles as the
// arm-sway phase when standing still.
export function posePerson(mesh, phase, legAmp, armAmp, lean, breath) {
  const u = mesh.userData;
  if (!u.legL) return;
  const s = Math.sin(phase);
  u.legL.rotation.x = s * legAmp;
  u.legR.rotation.x = -s * legAmp;
  u.armL.rotation.x = -s * armAmp;
  u.armR.rotation.x = s * armAmp;
  u.upper.rotation.x = lean;
  // Body bob lands twice per stride; at idle it collapses to breathing.
  u.upper.position.y = 0.95 + Math.abs(Math.sin(phase)) * legAmp * 0.055 + Math.sin(breath) * 0.014;
  u.upper.rotation.z = Math.sin(breath * 0.5) * 0.02;
  u.headG.rotation.y = Math.sin(breath * 0.33) * 0.06;
  u.torso.scale.y = 1 + Math.sin(breath) * 0.018;
}

// Generic citizen. Hair style and colour rotate through the variants so a
// crowd is a crowd, not a clone army; callers may pin them via opts.
export function makePerson(shirt, pants, skin, opts) {
  const o = opts || {};
  const n = personCounter++;
  const styles = ['cap', 'spiky', 'bun', 'long', 'flat'];
  return buildFigure({
    shirt, pants, skin,
    armColor: o.armColor,
    hairColor: o.hairColor ?? HAIR_COLORS[n % HAIR_COLORS.length],
    hairStyle: o.hairStyle || styles[n % styles.length],
    face: o.face || (n % 5 === 3 ? 'grin' : 'neutral'),
    shoeColor: o.shoeColor ?? 0xf5f6fa,
  });
}

// The two leads, distinguishable by silhouette alone:
// VERA SOLANO — blonde ponytail tied with a pink band, pink tank top (bare
// arms), dark ripped jeans. DAX VEGA — dark spiky hair, open floral shirt
// over a white tee, gold chain, pink trousers.
export function makeProtagonist(who) {
  if (who === 'dax') {
    const g = buildFigure({
      shirt: 0xf5f6fa, pants: 0xf368e0, skin: 0xe0ac69, armColor: 0x2ecc71,
      hairColor: 0x1e272e, hairStyle: 'spiky', face: 'grin', shoeColor: 0xf5f6fa, who: 'dax',
    });
    const m = (c) => new THREE.MeshLambertMaterial({ color: c });
    const upper = g.userData.upper;
    for (const sx of [-1, 1]) { // open floral shirt panels over the tee
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.92, 0.56), m(sx < 0 ? 0x2ecc71 : 0xe84393));
      panel.position.set(sx * 0.34, 0.45, 0); upper.add(panel);
    }
    const chain = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.06), m(0xffd32a));
    chain.position.set(0, 0.82, 0.28); upper.add(chain); // gold chain
    g.userData.armR.children[0].material = m(0xe84393); // right sleeve, other floral side
    return g;
  }
  const g = buildFigure({
    shirt: 0xff5da2, pants: 0x2f3542, skin: 0xf1c27d, armColor: 0xf1c27d,
    hairColor: 0xf7d154, hairStyle: 'ponytail', face: 'neutral', shoeColor: 0xf5f6fa, who: 'vera',
  });
  const rip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.42), new THREE.MeshLambertMaterial({ color: 0xf1c27d }));
  rip.position.set(0, -0.42, 0); g.userData.legR.add(rip); // the ripped knee
  return g;
}

// A proper lightbar, not a slab: a low dark base bar carrying two thin
// lenses (left / right). The group is g.userData.lightbar; the lenses live
// in bar.userData.lenses so police.js / fire.js can flash the two halves
// in alternation (a single unlit box read as a flat red slab on the roof).
function makeLightbar(leftColor, rightColor) {
  const bar = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.58),
    new THREE.MeshLambertMaterial({ color: 0x14181f }));
  base.position.y = -0.04; bar.add(base);
  const lens = (c, x) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.15, 0.5),
      new THREE.MeshBasicMaterial({ color: c }));
    l.position.set(x, 0.06, 0); bar.add(l); return l;
  };
  bar.userData.lenses = [lens(leftColor, -0.4), lens(rightColor, 0.4)];
  return bar;
}

// ---- Vehicles ---------------------------------------------------------------
// One factory for every stealable class: sedan cars, motorcycles (with a
// visible rider figure), box trucks, police sedans (livery + light bar) and
// the damkar fire truck (ladder, stripe, light bar).
export function makeVehicle(kind, color, opts) {
  const o = opts || {};
  const g = new THREE.Group();
  const m = (c) => new THREE.MeshLambertMaterial({ color: c });
  const wheels = [];
  const wheelAt = (x, y, z, r) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 8), m(0x1e272e));
    w.rotation.z = Math.PI / 2; w.position.set(x, y, z); g.add(w); wheels.push(w);
  };
  const axleAt = (y, z, r, wdt) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, wdt, 8), m(0x1e272e));
    w.rotation.z = Math.PI / 2; w.position.set(0, y, z); g.add(w); wheels.push(w);
  };
  if (kind === 'moto') {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 2.5), m(color));
    frame.position.y = 0.72; g.add(frame);
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.9), m(0x1e272e));
    tank.position.set(0, 1.05, 0.2); g.add(tank);
    wheelAt(0, 0.42, 1.15, 0.42); wheelAt(0, 0.42, -1.15, 0.42);
    const rider = makePerson(color, 0x2f3542, 0xf1c27d, { hairStyle: 'cap', hairColor: 0x1e272e });
    rider.scale.setScalar(0.92);
    rider.position.y = 0.55; g.add(rider);
    g.userData.rider = rider;
  } else if (kind === 'truck') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.7, 1.9), m(color));
    cab.position.set(0, 1.25, 3.1); g.add(cab);
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 5.6), m(o.boxColor ?? 0xf5f6fa));
    box.position.set(0, 1.75, -0.7); g.add(box);
    axleAt(0.5, 3.1, 0.5, 2.3); axleAt(0.5, -1.8, 0.5, 2.3); axleAt(0.5, -3, 0.5, 2.3);
  } else if (kind === 'firetruck') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.9, 7.6), m(0xd63031));
    body.position.y = 1.35; g.add(body);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.4, 7.6), m(0xf5f6fa));
    stripe.position.y = 1.5; g.add(stripe);
    const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 6.4), m(0xdfe6e9));
    ladder.position.y = 2.5; g.add(ladder);
    const bar = makeLightbar(0xff3838, 0xfff2cc); // fire: red / warm-white halves
    bar.position.set(0, 2.42, 3.4); g.add(bar);
    g.userData.lightbar = bar;
    axleAt(0.5, 2.7, 0.5, 2.4); axleAt(0.5, -2.7, 0.5, 2.4);
  } else { // sedan body for cars; police adds livery and a light bar
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.65, o.len || 4.4), m(color));
    body.position.y = 0.65; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, (o.len || 4.4) * 0.45), m(o.cabColor ?? 0x2f3542));
    cab.position.set(0, 1.25, -0.2); g.add(cab);
    axleAt(0.42, 1.45, 0.42, 2.1); axleAt(0.42, -1.45, 0.42, 2.1);
    if (kind === 'police' || o.lightbar) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.4, 1.6), m(0x273c75));
      door.position.set(0, 0.7, -0.2); g.add(door);
      const bar = makeLightbar(0xff2222, 0x2f7bff); // police: red / blue halves
      bar.position.set(0, 1.63, -0.2); g.add(bar);
      g.userData.lightbar = bar;
    }
    if (o.spoiler) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.15, 0.5), m(0x1e272e));
      sp.position.set(0, 1.15, -2.1); g.add(sp);
    }
  }
  g.userData.wheels = wheels;
  g.userData.kind = kind;
  return g;
}
export function makeCar(color, opts) {
  const o = opts || {};
  return makeVehicle(o.lightbar ? 'police' : 'car', color, o);
}
