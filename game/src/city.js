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
import { ROADS, ROAD_W, WORLD, KEYS, CAUSEWAY, MARSH, districtAt, isDowntown, FIRE_STATION } from './config.js';
import { makeRng, pick, pickWeighted } from './random.js';

// Building footprints: {x, z, hw, hd} axis-aligned boxes.
export const colliders = [];
// Buildings placed per district/region, filled in during buildCity — the
// HUD/debug surface reads it and the rework report quotes it.
export const buildingCounts = {};
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

export function collideBuildings(pos, radius) {
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
  clampWorld(pos);
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
  { name: 'Ocean Drive Deco Strip', x: 192, z: 120, r: 60 },
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
export function landmarkAt(x, z) {
  for (const l of LANDMARKS) if (Math.hypot(x - l.x, z - l.z) < l.r) return l.name;
  return '';
}

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
export function isRoad(x, z) {
  for (const r of ROADS) if (Math.abs(x - r) < ROAD_W / 2 + 1 || Math.abs(z - r) < ROAD_W / 2 + 1) return true;
  if (Math.abs(x - CAUSEWAY.x) < CAUSEWAY.halfW && z > WORLD) return true;
  if (Math.abs(x) < ROAD_W / 2 + 1 && z <= -WORLD) return true; // peninsula highway
  return false;
}

// World bounds follow the land: city plateau, Keys corridor, marsh, spine
// and panhandle. Every edge is a shoreline — you stop where the land stops,
// and the sea is what is past it.
export function clampWorld(pos) {
  if (pos.z > WORLD + 10) {
    let isle = null;
    for (const k of KEYS) {
      const dz = (pos.z - k.z) / (k.rz + 5);
      if (Math.abs(dz) < 1) {
        const maxX = (k.rx + 5) * Math.sqrt(1 - dz * dz);
        if (Math.abs(pos.x) <= maxX) isle = k;
      }
    }
    if (isle) {
      const dz = (pos.z - isle.z) / (isle.rz + 5);
      const maxX = (isle.rx + 5) * Math.sqrt(Math.max(0, 1 - dz * dz));
      pos.x = Math.max(-maxX, Math.min(maxX, pos.x));
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
      g.fillStyle = lit ? (rng() < 0.25 ? '#ffd9a0' : '#ffe9b8') : '#232838';
      if (storefront && r === rows - 1) g.fillStyle = rng() < 0.7 ? '#7ef0d4' : '#232838';
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
  for (let i = 0; i < 7; i++) {
    const ch = new THREE.Mesh(new THREE.PlaneGeometry(8 + rng() * 14, 230), chanMat);
    ch.rotation.x = -Math.PI / 2; ch.rotation.z = (rng() - 0.5) * 0.22;
    ch.position.set(-190 + rng() * 380, 0.01, -322); scene.add(ch);
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
  const mr = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 130), mat(0x39404d));
  mr.rotation.x = -Math.PI / 2; mr.position.set(0, 0.03, -262); scene.add(mr);

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
      addProp(75, pz, 1.3);
    }
    const fs = new THREE.Mesh(new THREE.PlaneGeometry(16, 3), new THREE.MeshBasicMaterial({ map: signTex('PALM FLYOVER', '#7ef0d4', '#14101f'), side: THREE.DoubleSide }));
    fs.position.set(75, 8.6, 92); scene.add(fs);
    const uSegs = []; for (let z = -118; z < -32; z += 8) uSegs.push(z + 4);
    const uDeck = new THREE.InstancedMesh(new THREE.BoxGeometry(13, 0.7, 8.6), deckMat, uSegs.length);
    const uWall = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 1, 8.6), mat(0x6b705c), uSegs.length * 2);
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
    const us = new THREE.Mesh(new THREE.PlaneGeometry(15, 3), new THREE.MeshBasicMaterial({ map: signTex('OLD TOWN UNDERPASS', '#ffd32a', '#14101f'), side: THREE.DoubleSide }));
    us.position.set(-75, 5.4, -96); scene.add(us);
  }
  // Buildings, styled per district so each quarter reads differently:
  // downtown glass, Marina pastel, Old Town brick, Docks warehouses,
  // Coral Heights houses with pitched roofs.
  const styles = {
    downtown: { tex: facadeTex(rng, '#3a4460', 0.62, 8, 14, true), tint: [0xbfd4ff, 0x9fb6e8, 0xd8c8ff] },
    pastel: { tex: facadeTex(rng, '#e8b4b8', 0.5, 6, 8, true), tint: [0xffc8dd, 0xfec8a0, 0xa0e8dd, 0xfff3b0] },
    brick: { tex: facadeTex(rng, '#9c5a44', 0.42, 6, 7, true), tint: [0xe8a080, 0xd98c68, 0xc9a06a] },
    ware: { tex: facadeTex(rng, '#6b705c', 0.22, 5, 3, false), tint: [0xa8b09a, 0x8f9a94, 0xb0a696] },
    house: { tex: facadeTex(rng, '#e6ddcb', 0.55, 4, 2, false), tint: [0xffffff, 0xffe8c8, 0xd8f0d0, 0xffd8d8] },
  };
  const byStyle = { downtown: [], pastel: [], brick: [], ware: [], house: [] };
  // Eight plots per block — the four corners plus a mid plot on each edge —
  // roughly double the building count of the old four-plot grid, packed
  // tightest downtown. Footprints are sized so neighbours never overlap.
  const PLOTS = [
    { ox: -15, oz: -15, s: 1 }, { ox: 15, oz: -15, s: 1 }, { ox: -15, oz: 15, s: 1 }, { ox: 15, oz: 15, s: 1 },
    { ox: 0, oz: -24, s: 0.62 }, { ox: 0, oz: 24, s: 0.62 }, { ox: -24, oz: 0, s: 0.62 }, { ox: 24, oz: 0, s: 0.62 },
  ];
  for (let i = 0; i < ROADS.length - 1; i++) for (let j = 0; j < ROADS.length - 1; j++) {
    const cx = (ROADS[i] + ROADS[i + 1]) / 2, cz = (ROADS[j] + ROADS[j + 1]) / 2;
    for (const plot of PLOTS) {
      if (rng() < 0.04) continue;
      const x = cx + plot.ox, z = cz + plot.oz, dn = districtAt(x, z);
      let style = 'pastel', h = 10 + rng() * rng() * 16, w = (13 + rng() * 6) * plot.s, d = (13 + rng() * 6) * plot.s;
      if (isDowntown(x, z)) { style = 'downtown'; h = 26 + rng() * rng() * 34; }
      else if (dn === 'The Docks') { style = 'ware'; h = 6 + rng() * 5; w = (18 + rng() * 7) * plot.s; d = (16 + rng() * 7) * plot.s; }
      else if (dn === 'Coral Heights') { style = 'house'; h = 4.5 + rng() * 2.5; w = (10 + rng() * 4) * plot.s; d = (10 + rng() * 4) * plot.s; }
      else if (dn === 'Old Town') { style = 'brick'; h = 8 + rng() * 10; }
      else if (dn === 'Marina Mile') { style = 'pastel'; h = 12 + rng() * rng() * 20; }
      byStyle[style].push({ x, z, w, d, h });
      colliders.push({ x, z, hw: w / 2, hd: d / 2 });
      buildingCounts[dn] = (buildingCounts[dn] || 0) + 1;
    }
  }
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
  // Neon billboards on downtown and marina rooftops; their poles are solid.
  const bbSpots = [[-30, -30], [28, -34], [-34, 26], [30, 30], [112, 118], [-118, 40], [108, -112], [0, 152]];
  bbSpots.forEach(([x, z], i) => {
    const tex = signTex(BRANDS[i % BRANDS.length], i % 2 ? '#7ef0d4' : '#ff5da2', '#14101f');
    const bb = new THREE.Mesh(new THREE.PlaneGeometry(17, 4.4), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    bb.position.set(x, 17 + (i % 3) * 5, z); bb.rotation.y = (i % 4) * Math.PI / 4 + 0.4; scene.add(bb);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, bb.position.y, 5), mat(0x2f3542));
    pole.position.set(x, bb.position.y / 2, z); scene.add(pole);
    addProp(x, z, 0.4);
  });
  // Docks dressing: container stacks and two port cranes.
  const contColors = [0xe74c3c, 0x3498db, 0xe67e22, 0x27ae60, 0x8e6cc8];
  const conts = [];
  for (let i = 0; i < 26; i++) conts.push({ x: -185 + rng() * 130, z: 55 + rng() * 135, lvl: Math.floor(rng() * 3) });
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
    const z = 62 + i * 21, h = 11 + (i % 3) * 3;
    _p.set(193, h / 2 + 0.3, z); _s.set(10, h, 15); decoInst.setMatrixAt(i, _m().compose(_p, _q, _s));
    _p.set(193, h + 1.4, z); _s.set(1, 1, 1); stepInst.setMatrixAt(i, _m().compose(_p, _q, _s));
    colliders.push({ x: 193, z, hw: 5, hd: 7.5 });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(11, 2.6), new THREE.MeshBasicMaterial({ map: signTex(name, i % 2 ? '#7ef0d4' : '#ff5da2', '#14101f'), side: THREE.DoubleSide }));
    s.position.set(198.5, h - 1.6, z); s.rotation.y = Math.PI / 2; scene.add(s);
  });
  decoInst.instanceMatrix.needsUpdate = true; stepInst.instanceMatrix.needsUpdate = true;
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
  }
  { // Southernmost Point buoy at the end of the Keys.
    const cols = [0xd63031, 0xf5f6fa, 0x14161c, 0xf5f6fa, 0xd63031];
    cols.forEach((c, i) => {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.2 - Math.abs(i - 2) * 0.3, 2.4 - Math.abs(i - 2) * 0.3, 1.6, 10), mat(c));
      seg.position.set(0, 0.8 + i * 1.6, 434); scene.add(seg);
    });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(13, 3), new THREE.MeshBasicMaterial({ map: signTex('SOUTHERNMOST POINT · KEY SOLANO', '#ffe9a8', '#7a1f1f'), side: THREE.DoubleSide }));
    s.position.set(0, 10.6, 434); scene.add(s);
    colliders.push({ x: 0, z: 434, hw: 2.6, hd: 2.6 });
  }
  // Drawbridge span mid-causeway: twin towers and a top beam (deck stays flat).
  for (const sx of [-1, 1]) {
    const tw = new THREE.Mesh(new THREE.BoxGeometry(1.6, 13, 1.6), mat(0x8e9aaf));
    tw.position.set(CAUSEWAY.x + sx * 11, 6.5, 302); scene.add(tw);
    addProp(CAUSEWAY.x + sx * 11, 302, 1.1);
  }
  const beam2 = new THREE.Mesh(new THREE.BoxGeometry(24, 1.4, 1.6), mat(0x8e9aaf));
  beam2.position.set(CAUSEWAY.x, 13.4, 302); scene.add(beam2);
  const dbs = new THREE.Mesh(new THREE.PlaneGeometry(15, 3), new THREE.MeshBasicMaterial({ map: signTex('MARLIN DRAWBRIDGE', '#7ef0d4', '#14101f'), side: THREE.DoubleSide }));
  dbs.position.set(CAUSEWAY.x, 10.8, 302); scene.add(dbs);
  { // Glades airboat dock at the marsh edge.
    const dock = new THREE.Mesh(new THREE.BoxGeometry(16, 0.5, 5), mat(0x8d6e63));
    dock.position.set(0, 0.35, -222); scene.add(dock);
    const boat = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.8, 6.4), mat(0xe67e22));
    boat.position.set(-3, 0.7, -230); scene.add(boat);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.3, 12), mat(0x2f3542));
    fan.rotation.x = Math.PI / 2; fan.position.set(-3, 2.4, -233); scene.add(fan);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(13, 3), new THREE.MeshBasicMaterial({ map: signTex('GLADES AIRBOAT TOURS', '#ffe9a8', '#243014'), side: THREE.DoubleSide }));
    s.position.set(6, 4.6, -220); scene.add(s);
  }
  { // Rocket gantry silhouette across the bay.
    const gantry = new THREE.Mesh(new THREE.BoxGeometry(4, 44, 4), mat(0x3a3f4a));
    gantry.position.set(330, 22, -40); scene.add(gantry);
    const rocket = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 30, 8), mat(0xdfe6e9));
    rocket.position.set(338, 15, -40); scene.add(rocket);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(2.4, 6, 8), mat(0xd63031));
    nose.position.set(338, 33, -40); scene.add(nose);
  }
  // Key Solano settlement: small pastel houses at the end of the line.
  for (let i = 0; i < 7; i++) {
    const x = -22 + i * 7.5, z = 396 + (i % 2) * 12;
    const hse = new THREE.Mesh(new THREE.BoxGeometry(5.5, 4, 5.5), new THREE.MeshLambertMaterial({ map: styles.pastel.tex }));
    hse.position.set(x, 2.3, z); scene.add(hse);
    colliders.push({ x, z, hw: 2.8, hd: 2.8 });
  }
  // Signed service buildings: police, hospital, garage, fire station.
  function landmarkBldg(x, z, color, label, fg) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(20, 12, 16), mat(color));
    b.position.set(x, 6, z); scene.add(b);
    colliders.push({ x, z, hw: 10, hd: 8 });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(15, 3.6), new THREE.MeshBasicMaterial({ map: signTex(label, fg || '#ffffff', '#14101f') }));
    s.position.set(x, 10.6, z + 8.2); scene.add(s);
    return b;
  }
  landmarkBldg(-68, -68, 0x3742fa, 'POLICE', '#7ef0d4');
  landmarkBldg(68, -68, 0xf5f6fa, 'HOSPITAL', '#ff5da2');
  landmarkBldg(82, 95, 0x57606f, "LUCIA'S GARAGE", '#ffd32a');
  landmarkBldg(FIRE_STATION.x, FIRE_STATION.z, 0xc0392b, 'DAMKAR · FIRE STATION', '#ffd32a');
  const gator = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.6), new THREE.MeshBasicMaterial({ map: signTex('THE GLADES — MIND THE GATORS', '#ffe9a8', '#243014'), side: THREE.DoubleSide }));
  gator.position.set(8, 4.4, -214); scene.add(gator);

  // World pickups: sniper caches, pistols, food, armour and cola at places
  // that make sense. A glowing pillar marks each one until it is taken.
  const pickups = [];
  const PICKUP_SPOTS = [
    { x: 6, z: 402, kind: 'sniper', color: 0x7ef0d4 }, { x: -104, z: -16, kind: 'sniper', color: 0x7ef0d4 },
    { x: 88, z: 90, kind: 'pistol', color: 0xffa502 }, { x: -140, z: 148, kind: 'pistol', color: 0xffa502 }, { x: 24, z: -84, kind: 'pistol', color: 0xffa502 },
    { x: 90, z: 92, kind: 'snack', color: 0xffd32a }, { x: 164, z: 158, kind: 'snack', color: 0xffd32a }, { x: 12, z: 396, kind: 'snack', color: 0xffd32a },
    { x: -56, z: -58, kind: 'armour', color: 0x54a0ff }, { x: -150, z: 120, kind: 'armour', color: 0x54a0ff },
    { x: 208, z: 20, kind: 'cola', color: 0xff5da2 }, { x: -208, z: -30, kind: 'cola', color: 0xff5da2 }, { x: 30, z: -120, kind: 'cola', color: 0xff5da2 },
    { x: 210, z: 112, kind: 'cola', color: 0xff5da2 }, { x: -6, z: -218, kind: 'snack', color: 0xffd32a },
    { x: 14, z: -1408, kind: 'snack', color: 0xffd32a }, { x: -14, z: -2730, kind: 'cola', color: 0xff5da2 },
    { x: 14, z: -3370, kind: 'medkit', color: 0x2ed573 },
  ];
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
    // A cache must be reachable: clear any building footprint that ate it.
    for (let ci = colliders.length - 1; ci >= 0; ci--) {
      if (Math.hypot(colliders[ci].x - spot.x, colliders[ci].z - spot.z) < 9) colliders.splice(ci, 1);
    }
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
  lake.scale.set(1.25, 1, 0.8); lake.position.set(85, -0.5, -780); scene.add(lake);
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
  const TOWNS = [
    { z: -760, name: 'LAKEPORT · OKEECHOBEE' }, { z: -1420, name: 'PALMETTO FLATS' },
    { z: -2080, name: 'CYPRESS JUNCTION' }, { z: -2740, name: 'KISSIMMEE PRAIRIE' },
    { z: -3380, name: 'SUWANNEE CROSSING' }, { z: -3980, name: 'PANHANDLE GATE' },
    { z: -4200, name: 'TALLAHASSEE PALMS' },
  ];
  const townTex = facadeTex(rng, '#e6ddcb', 0.5, 4, 3, true);
  const blocks = [];
  for (const t of TOWNS) {
    const n = 7 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (26 + rng() * 46), z = t.z + (rng() - 0.5) * 130;
      const w = 10 + rng() * 9, d = 10 + rng() * 9, h = 5 + rng() * 9;
      blocks.push({ x, z, w, d, h });
      colliders.push({ x, z, hw: w / 2, hd: d / 2 });
    }
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 5.4, 5), mat(0x2f3542));
    post.position.set(11, 2.7, t.z + 60); scene.add(post); addProp(11, t.z + 60, 0.35);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(15, 3), new THREE.MeshBasicMaterial({ map: signTex(t.name, '#ffe9a8', '#243014'), side: THREE.DoubleSide }));
    sign.position.set(11, 5.6, t.z + 60); scene.add(sign);
    buildingCounts['Peninsula towns'] = (buildingCounts['Peninsula towns'] || 0) + n;
  }
  const townInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ map: townTex }), blocks.length);
  blocks.forEach((b, k) => {
    _p.set(b.x, b.h / 2 + 0.3, b.z); _s.set(b.w, b.h, b.d);
    townInst.setMatrixAt(k, _m().compose(_p, _q, _s));
  });
  townInst.instanceMatrix.needsUpdate = true; scene.add(townInst);
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
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.25, 0.6), new THREE.MeshBasicMaterial({ color: 0xff3838 }));
    bar.position.set(0, 2.5, 3.4); g.add(bar);
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
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.25, 0.6), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
      bar.position.set(0, 1.65, -0.2); g.add(bar);
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
