// City generation v2 — a Florida-peninsula world at dusk: gradient sunset sky,
// warm low sun, canvas-textured facades that differ per district (downtown glass,
// beachfront pastel, Old Town brick, Docks warehouses, Coral Heights houses),
// street detail (dashes, crosswalks, traffic lights, lit lamps, palms, beach
// props), ocean on three sides, a Keys island chain over causeways to the
// south, and the Everglades marsh inland to the north.
import { ROADS, ROAD_W, WORLD, KEYS, CAUSEWAY, MARSH, districtAt, isDowntown, FIRE_STATION } from './config.js';
import { makeRng, pick } from './random.js';

export const colliders = [];   // {x,z,hw,hd} building footprints for collision
const _m = () => new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(), _p = new THREE.Vector3();
const mat = (c) => new THREE.MeshLambertMaterial({ color: c });

// Landmarks (Part K): original Florida-flavoured set pieces. The HUD names the
// nearest one in range; the buoy and lighthouse carry pickups, the port and
// deco strip carry mission/race geography.
export const LANDMARKS = [
  { name: 'Ocean Drive Deco Strip', x: 192, z: 120, r: 60 },
  { name: 'Marlin Point Lighthouse', x: 216, z: 120, r: 46 },
  { name: 'Port of Palm Cove', x: -130, z: 120, r: 85 },
  { name: 'Southernmost Point — Key Solano', x: 0, z: 434, r: 42 },
  { name: 'Glades Airboat Dock', x: 0, z: -222, r: 40 },
  { name: 'Cape Marlin Spaceport (across the bay)', x: 330, z: -40, r: 135 },
];
export function landmarkAt(x, z) {
  for (const l of LANDMARKS) if (Math.hypot(x - l.x, z - l.z) < l.r) return l.name;
  return '';
}
// Traffic-light cycle shared with traffic AI (Part J). 12s loop, two groups.
export const LIGHT = { xGo: true, zGo: false, phase: 0 };
let bulbMatA = null, bulbMatB = null;
export function updateLights(t) {
  const p = t % 12; LIGHT.phase = p;
  LIGHT.xGo = p < 5.5; LIGHT.zGo = p >= 6.5;
  const aCol = p < 4.5 ? 0x2ed573 : p < 5.5 ? 0xffd32a : 0xff3838;
  const bCol = p < 6.5 ? 0xff3838 : p < 11 ? 0x2ed573 : 0xffd32a;
  if (bulbMatA) bulbMatA.color.setHex(aCol);
  if (bulbMatB) bulbMatB.color.setHex(bCol);
}
// Road structures (Part L): a flyover carrying the x=75 boulevard OVER the
// z=75 road, and an underpass dipping the x=-75 road UNDER the z=-75 road.
// Height is direction-aware: traffic on the crossing road stays at grade.
export function flyoverH(z) {
  if (z < 30 || z > 120) return 0;
  if (z < 60) { const t = (z - 30) / 30; return 5 * t * t * (3 - 2 * t); }
  if (z <= 90) return 5;
  const t = (120 - z) / 30; return 5 * t * t * (3 - 2 * t);
}
export function underpassD(z) {
  if (z < -120 || z > -30) return 0;
  if (z < -90) { const t = (z + 120) / 30; return -4 * t * t * (3 - 2 * t); }
  if (z <= -60) return -4;
  const t = (-30 - z) / 30; return -4 * t * t * (3 - 2 * t);
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
  return false;
}
// World bounds: city plateau, both beaches, the causeway corridor + Keys
// islands to the south, and the marsh flats to the north. Water stops you.
export function clampWorld(pos) {
  if (pos.z > WORLD + 10) {
    let onIsle = null;
    for (const k of KEYS) { const dz = (pos.z - k.z) / (k.rz + 5); if (Math.abs(dz) < 1) { const maxX = (k.rx + 5) * Math.sqrt(1 - dz * dz); if (Math.abs(pos.x) <= maxX) onIsle = k; } }
    if (onIsle) { const dz = (pos.z - onIsle.z) / (onIsle.rz + 5); const maxX = (onIsle.rx + 5) * Math.sqrt(Math.max(0, 1 - dz * dz)); pos.x = Math.max(-maxX, Math.min(maxX, pos.x)); }
    else if (Math.abs(pos.x) <= CAUSEWAY.halfW + 3) pos.x = Math.max(-CAUSEWAY.halfW - 3, Math.min(CAUSEWAY.halfW + 3, pos.x));
    else pos.z = WORLD + 10;
    pos.z = Math.min(pos.z, 442);
  } else if (pos.z < -WORLD - 10) {
    pos.x = Math.max(-212, Math.min(212, pos.x)); pos.z = Math.max(pos.z, MARSH.z0 - 4);
  } else {
    pos.x = Math.max(-232, Math.min(232, pos.x)); pos.z = Math.max(-WORLD - 10, Math.min(WORLD + 10, pos.z));
  }
}
export function collideBuildings(pos, radius) {
  for (const c of colliders) {
    const dx = pos.x - c.x, dz = pos.z - c.z;
    const px = c.hw + radius - Math.abs(dx), pz = c.hd + radius - Math.abs(dz);
    if (px > 0 && pz > 0) {
      if (px < pz) pos.x = c.x + (dx >= 0 ? c.hw + radius : -c.hw - radius);
      else pos.z = c.z + (dz >= 0 ? c.hd + radius : -c.hd - radius);
    }
  }
  clampWorld(pos);
}
// ---- canvas texture helpers (no external images, ever) ----
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t;
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
    g.font = '900 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = fg; g.shadowBlur = 14; g.fillStyle = fg; g.fillText(text, w / 2, h / 2);
  });
}
const BRANDS = ['COVE COLA', 'HOTEL MARLIN', 'NEON PALMS', 'SURF & SAND', 'MARLIN MOTORS', 'CAFE SOLANO', 'PALM RADIO 98', 'GATOR BAIT'];

export function buildCity(scene, seed) {
  const rng = makeRng(seed * 7919 + 13);
  // Vice-register dusk: purple-to-orange gradient sky, warm fog, low orange sun.
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
  const neonGlow = new THREE.PointLight(0xff5da2, 0.55, 130); neonGlow.position.set(0, 16, 0); scene.add(neonGlow);

  // Ocean on three sides: border strips around the landmass instead of one
  // giant underlay, so the software rasteriser never shades water under land.
  const ocean = new THREE.Group();
  const seaMat = mat(0x0e6e8c);
  for (const [w, h, x, z] of [[330, 920, 397, 10], [330, 920, -397, 10], [464, 236, 0, 326], [1100, 130, 0, 505], [1100, 130, 0, -501]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, h), seaMat);
    strip.rotation.x = -Math.PI / 2; strip.position.set(x, 0, z); ocean.add(strip);
  }
  ocean.position.y = -0.35; scene.add(ocean);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(440, 440), mat(0x3f7d46));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.05, 0); scene.add(ground);
  // Beaches on BOTH coasts of the peninsula.
  for (const sx of [-1, 1]) {
    const beach = new THREE.Mesh(new THREE.PlaneGeometry(30, 440), mat(0xf2d492));
    beach.rotation.x = -Math.PI / 2; beach.position.set(sx * (WORLD + 16), 0.0, 0); scene.add(beach);
  }
  // Everglades marsh: flat green-brown flats with dark water channels.
  const marsh = new THREE.Mesh(new THREE.PlaneGeometry(440, 240), mat(0x5c6b35));
  marsh.rotation.x = -Math.PI / 2; marsh.position.set(0, -0.04, -322); scene.add(marsh);
  const chanMat = mat(0x2e4d3f);
  for (let i = 0; i < 7; i++) {
    const ch = new THREE.Mesh(new THREE.PlaneGeometry(8 + rng() * 14, 230), chanMat);
    ch.rotation.x = -Math.PI / 2; ch.rotation.z = (rng() - 0.5) * 0.22;
    ch.position.set(-190 + rng() * 380, 0.01, -322); scene.add(ch);
  }
  // Keys islands: sand-rim discs with green tops.
  for (const k of KEYS) {
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.2, 20), mat(0xf2d492));
    sand.scale.set(k.rx + 7, 1, k.rz + 7); sand.position.set(0, -0.4, k.z); scene.add(sand);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.4, 20), mat(0x4c8a4f));
    top.scale.set(k.rx, 1, k.rz); top.position.set(0, -0.3, k.z); scene.add(top);
  }
  // Causeway: a long drivable bridge road from the tip to Key Solano.
  const cw = new THREE.Mesh(new THREE.PlaneGeometry(CAUSEWAY.halfW * 2, CAUSEWAY.z1 - CAUSEWAY.z0 + 30), mat(0x39404d));
  cw.rotation.x = -Math.PI / 2; cw.position.set(CAUSEWAY.x, 0.06, (CAUSEWAY.z0 + CAUSEWAY.z1) / 2); scene.add(cw);
  const railMat = mat(0xdfe6e9);
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, CAUSEWAY.z1 - CAUSEWAY.z0 + 30), railMat);
    rail.position.set(CAUSEWAY.x + sx * (CAUSEWAY.halfW + 0.4), 0.45, (CAUSEWAY.z0 + CAUSEWAY.z1) / 2); scene.add(rail);
  }
  // Marsh road: the boulevard continues a little way into the Glades.
  const mr = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 130), mat(0x39404d));
  mr.rotation.x = -Math.PI / 2; mr.position.set(0, 0.03, -262); scene.add(mr);

  // Roads with lane dashes + edge lines.
  const roadMat = mat(0x39404d), dashMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const dashGeoV = new THREE.PlaneGeometry(0.5, 5), dashGeoH = new THREE.PlaneGeometry(5, 0.5);
  const dashes = [];
  for (const r of ROADS) {
    const v = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 420), roadMat);
    v.rotation.x = -Math.PI / 2; v.position.set(r, 0.02, 0); scene.add(v);
    const h = new THREE.Mesh(new THREE.PlaneGeometry(420, ROAD_W), roadMat);
    h.rotation.x = -Math.PI / 2; h.position.set(0, 0.02, r); scene.add(h);
    for (let t = -200; t < 200; t += 16) { if (!ROADS.some((o) => Math.abs(t - o) < 11)) dashes.push([r, t, 0], [t, r, 1]); }
  }
  const dashInst = new THREE.InstancedMesh(dashGeoV, dashMat, dashes.length);
  const dashFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const dashSpin = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
  dashes.forEach((d, k) => { _p.set(d[0], 0.05, d[1]); _s.set(1, 1, 1); const q = d[2] ? dashSpin.clone().multiply(dashFlat) : dashFlat; dashInst.setMatrixAt(k, _m().compose(_p, q, _s)); });
  dashInst.instanceMatrix.needsUpdate = true; scene.add(dashInst);
  // Crosswalks at every intersection (striped canvas texture, instanced).
  const cwTex = canvasTex(64, 16, (g, w, h) => { g.fillStyle = '#39404d'; g.fillRect(0, 0, w, h); g.fillStyle = '#f5f6fa'; for (let i = 0; i < 6; i++) g.fillRect(i * 11 + 2, 2, 6, h - 4); });
  const cwInst = new THREE.InstancedMesh(new THREE.PlaneGeometry(13, 3.4), new THREE.MeshBasicMaterial({ map: cwTex }), ROADS.length * ROADS.length * 4);
  let cwk = 0;
  for (const rx of ROADS) for (const rz of ROADS) for (let a = 0; a < 4; a++) {
    const ang = a * Math.PI / 2, ox = Math.sin(ang) * 9.6, oz = Math.cos(ang) * 9.6;
    _p.set(rx + ox, 0.045, rz + oz); _s.set(1, 1, 1);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, ang));
    // plane rotated flat then spun: compose with euler XYZ order approximation via two quats
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ang, 0));
    cwInst.setMatrixAt(cwk++, _m().compose(_p, spin.multiply(flat), _s));
  }
  cwInst.count = cwk; cwInst.instanceMatrix.needsUpdate = true; scene.add(cwInst);
  // Sidewalk slabs per block.
  const walkMat = mat(0xb8a89a);
  for (let i = 0; i < ROADS.length - 1; i++) for (let j = 0; j < ROADS.length - 1; j++) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(58, 0.3, 58), walkMat);
    slab.position.set((ROADS[i] + ROADS[i + 1]) / 2, 0.15, (ROADS[j] + ROADS[j + 1]) / 2); scene.add(slab);
  }
  // Traffic lights at intersections (Part J): dark heads + one signal bulb per
  // head, in two groups — A serves traffic travelling along X, B along Z — and
  // updateLights() cycles them green -> yellow -> red. Traffic AI reads LIGHT.
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 4.6, 5);
  const headGeo = new THREE.BoxGeometry(0.7, 1.9, 0.7);
  const tlSpots = [];
  for (const rx of ROADS) for (const rz of ROADS) { tlSpots.push([rx + 9, rz + 9]); tlSpots.push([rx - 9, rz - 9]); }
  const tlPoles = new THREE.InstancedMesh(poleGeo, mat(0x2f3542), tlSpots.length);
  const tlHeads = new THREE.InstancedMesh(headGeo, mat(0x14161c), tlSpots.length);
  tlSpots.forEach((s, k) => { _p.set(s[0], 2.3, s[1]); _s.set(1, 1, 1); tlPoles.setMatrixAt(k, _m().compose(_p, _q, _s)); _p.y = 5.2; tlHeads.setMatrixAt(k, _m().compose(_p, _q, _s)); });
  tlPoles.instanceMatrix.needsUpdate = true; tlHeads.instanceMatrix.needsUpdate = true; scene.add(tlPoles); scene.add(tlHeads);
  const bulbGeo = new THREE.SphereGeometry(0.21, 6, 5);
  const groupA = tlSpots.filter((_, k) => k % 2 === 0), groupB = tlSpots.filter((_, k) => k % 2 === 1);
  bulbMatA = new THREE.MeshBasicMaterial({ color: 0x2ed573 });
  bulbMatB = new THREE.MeshBasicMaterial({ color: 0xff3838 });
  const bulbsA = new THREE.InstancedMesh(bulbGeo, bulbMatA, groupA.length);
  const bulbsB = new THREE.InstancedMesh(bulbGeo, bulbMatB, groupB.length);
  groupA.forEach((s, k) => { _p.set(s[0], 5.2, s[1] + 0.42); _s.set(1, 1, 1); bulbsA.setMatrixAt(k, _m().compose(_p, _q, _s)); });
  groupB.forEach((s, k) => { _p.set(s[0] + 0.42, 5.2, s[1]); _s.set(1, 1, 1); bulbsB.setMatrixAt(k, _m().compose(_p, _q, _s)); });
  bulbsA.instanceMatrix.needsUpdate = true; bulbsB.instanceMatrix.needsUpdate = true; scene.add(bulbsA); scene.add(bulbsB);
  const lampSpots = [];
  for (const r of ROADS) for (let t = -195; t < 200; t += 30) { lampSpots.push([r + 9.5, t]); lampSpots.push([t, r - 9.5]); }
  for (let z = 215; z < 435; z += 30) lampSpots.push([CAUSEWAY.x - CAUSEWAY.halfW - 1, z]);
  const lampPoles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.1, 5.6, 5), mat(0x2f3542), lampSpots.length);
  const lampHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), lampSpots.length);
  lampSpots.forEach((s, k) => { _p.set(s[0], 2.8, s[1]); _s.set(1, 1, 1); lampPoles.setMatrixAt(k, _m().compose(_p, _q, _s)); _p.y = 5.8; lampHeads.setMatrixAt(k, _m().compose(_p, _q, _s)); });
  lampPoles.instanceMatrix.needsUpdate = true; lampHeads.instanceMatrix.needsUpdate = true; scene.add(lampPoles); scene.add(lampHeads);
  // Lamp light-pools: cheap additive radial decals under every lamp head.
  const poolTex = canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 4, 32, 32, 30); gr.addColorStop(0, 'rgba(255,205,130,0.5)'); gr.addColorStop(1, 'rgba(255,205,130,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(7.5, 7.5), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false }), lampSpots.length);
  const flatQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  lampSpots.forEach((s, k) => { _p.set(s[0], 0.07, s[1]); _s.set(1, 1, 1); pools.setMatrixAt(k, _m().compose(_p, flatQ, _s)); });
  pools.instanceMatrix.needsUpdate = true; scene.add(pools);
  // Leafy street trees (Part J): trunks + canopy spheres lining the sidewalks
  // of every block, so streets read tree-lined in all districts, not just palms.
  const treeSpots = [];
  for (let i = 0; i < ROADS.length - 1; i++) for (let j = 0; j < ROADS.length - 1; j++) {
    const cx = (ROADS[i] + ROADS[i + 1]) / 2, cz = (ROADS[j] + ROADS[j + 1]) / 2;
    for (const t of [-19, 0, 19]) { treeSpots.push([cx + t, cz - 30.5]); treeSpots.push([cx + t, cz + 30.5]); treeSpots.push([cx - 30.5, cz + t]); treeSpots.push([cx + 30.5, cz + t]); }
  }
  const treeTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.3, 3.2, 5), mat(0x6d4c41), treeSpots.length);
  const canopies = new THREE.InstancedMesh(new THREE.SphereGeometry(2.3, 7, 6), mat(0x2f9e44), treeSpots.length);
  treeSpots.forEach((s, k) => {
    _p.set(s[0], 1.6, s[1]); _s.set(1, 1, 1); treeTrunks.setMatrixAt(k, _m().compose(_p, _q, _s));
    _p.set(s[0], 4.6, s[1]); _s.set(1, 0.85, 1); canopies.setMatrixAt(k, _m().compose(_p, _q, _s));
  });
  treeTrunks.instanceMatrix.needsUpdate = true; canopies.instanceMatrix.needsUpdate = true; scene.add(treeTrunks); scene.add(canopies);

  // ---- Road structures (Part L): flyover deck + underpass trough ----
  {
    const deckMat = mat(0x424a58), railM = mat(0xdfe6e9);
    // Flyover: instanced deck segments following flyoverH, instanced rails,
    // and two pillars that stand clear of the crossing road's lanes.
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
    }
    const fs = new THREE.Mesh(new THREE.PlaneGeometry(16, 3), new THREE.MeshBasicMaterial({ map: signTex('PALM FLYOVER', '#7ef0d4', '#14101f'), side: THREE.DoubleSide }));
    fs.position.set(75, 8.6, 92); scene.add(fs);
    // Underpass: dipping segments, retaining walls with strip lighting, and
    // the at-grade bridge deck of the crossing road above.
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
  // ---- Buildings, styled per district (Part E: districts must READ apart) ----
  const styles = {
    downtown: { tex: facadeTex(rng, '#3a4460', 0.62, 8, 14, true), tint: [0xbfd4ff, 0x9fb6e8, 0xd8c8ff] },
    pastel:   { tex: facadeTex(rng, '#e8b4b8', 0.5, 6, 8, true),  tint: [0xffc8dd, 0xfec8a0, 0xa0e8dd, 0xfff3b0] },
    brick:    { tex: facadeTex(rng, '#9c5a44', 0.42, 6, 7, true),  tint: [0xe8a080, 0xd98c68, 0xc9a06a] },
    ware:     { tex: facadeTex(rng, '#6b705c', 0.22, 5, 3, false), tint: [0xa8b09a, 0x8f9a94, 0xb0a696] },
    house:    { tex: facadeTex(rng, '#e6ddcb', 0.55, 4, 2, false), tint: [0xffffff, 0xffe8c8, 0xd8f0d0, 0xffd8d8] },
  };
  const byStyle = { downtown: [], pastel: [], brick: [], ware: [], house: [] };
  for (let i = 0; i < ROADS.length - 1; i++) for (let j = 0; j < ROADS.length - 1; j++) {
    const cx = (ROADS[i] + ROADS[i + 1]) / 2, cz = (ROADS[j] + ROADS[j + 1]) / 2;
    for (const ox of [-15, 15]) for (const oz of [-15, 15]) {
      if (rng() < 0.1) continue;
      const x = cx + ox, z = cz + oz, dn = districtAt(x, z);
      let style = 'pastel', h = 10 + rng() * rng() * 16, w = 16 + rng() * 8, d = 16 + rng() * 8;
      if (isDowntown(x, z)) { style = 'downtown'; h = 26 + rng() * rng() * 30; }
      else if (dn === 'The Docks') { style = 'ware'; h = 6 + rng() * 5; w = 22 + rng() * 8; d = 20 + rng() * 8; }
      else if (dn === 'Coral Heights') { style = 'house'; h = 4.5 + rng() * 2.5; w = 11 + rng() * 4; d = 11 + rng() * 4; }
      else if (dn === 'Old Town') { style = 'brick'; h = 8 + rng() * 10; }
      else if (dn === 'Marina Mile') { style = 'pastel'; h = 12 + rng() * rng() * 20; }
      byStyle[style].push({ x, z, w, d, h });
      colliders.push({ x, z, hw: w / 2, hd: d / 2 });
    }
  }
  for (const name of Object.keys(byStyle)) {
    const list = byStyle[name]; if (!list.length) continue;
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ map: styles[name].tex }), list.length);
    list.forEach((b, k) => { _p.set(b.x, b.h / 2 + 0.3, b.z); _s.set(b.w, b.h, b.d); inst.setMatrixAt(k, _m().compose(_p, _q, _s)); inst.setColorAt(k, new THREE.Color(pick(rng, styles[name].tint))); });
    inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    scene.add(inst);
    if (name === 'house') { // pitched roofs make Coral Heights read residential
      const roofs = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 4), mat(0xb5524a), list.length);
      list.forEach((b, k) => { _p.set(b.x, b.h + 2.1, b.z); _s.set(b.w * 0.78, 3.6, b.d * 0.78); const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)); roofs.setMatrixAt(k, _m().compose(_p, q, _s)); });
      roofs.instanceMatrix.needsUpdate = true; scene.add(roofs);
    }
  }
  // Billboards with neon fake brands on downtown + marina rooftops.
  const bbSpots = [[-30, -30], [28, -34], [-34, 26], [30, 30], [112, 118], [-118, 40], [108, -112], [0, 152]];
  bbSpots.forEach(([x, z], i) => {
    const tex = signTex(BRANDS[i % BRANDS.length], i % 2 ? '#7ef0d4' : '#ff5da2', '#14101f');
    const bb = new THREE.Mesh(new THREE.PlaneGeometry(17, 4.4), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    bb.position.set(x, 17 + (i % 3) * 5, z); bb.rotation.y = (i % 4) * Math.PI / 4 + 0.4; scene.add(bb);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, bb.position.y, 5), mat(0x2f3542));
    pole.position.set(x, bb.position.y / 2, z); scene.add(pole);
  });
  // Docks dressing: container stacks + two simple cranes.
  const contColors = [0xe74c3c, 0x3498db, 0xe67e22, 0x27ae60, 0x8e6cc8];
  const conts = [];
  for (let i = 0; i < 26; i++) conts.push({ x: -185 + rng() * 130, z: 55 + rng() * 135, lvl: Math.floor(rng() * 3) });
  const contInst = new THREE.InstancedMesh(new THREE.BoxGeometry(9, 3.4, 4), new THREE.MeshLambertMaterial({ color: 0xffffff }), conts.length);
  conts.forEach((c, k) => { _p.set(c.x, 1.7 + c.lvl * 3.4, c.z); _s.set(1, 1, 1); const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (k % 2) * Math.PI / 2, 0)); contInst.setMatrixAt(k, _m().compose(_p, q, _s)); contInst.setColorAt(k, new THREE.Color(pick(rng, contColors))); });
  contInst.instanceMatrix.needsUpdate = true; if (contInst.instanceColor) contInst.instanceColor.needsUpdate = true; scene.add(contInst);
  for (const [x, z] of [[-160, 90], [-95, 165]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 20, 1.2), mat(0xf39c12)); leg.position.set(x, 10, z); scene.add(leg);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 22), mat(0xf39c12)); arm.position.set(x, 19.5, z + 8); scene.add(arm);
  }
  // Marina: instanced boat hulls + masts along the east beach.
  {
    const hulls = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 1.2, 7), mat(0xf5f6fa), 10);
    const masts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.09, 8, 4), mat(0xdfe6e9), 10);
    for (let i = 0; i < 10; i++) {
      const bx = WORLD + 22 + rng() * 6, bz = 60 + i * 14 + rng() * 5;
      _p.set(bx, 0.1, bz); _s.set(1, 1, 1); hulls.setMatrixAt(i, _m().compose(_p, _q, _s));
      _p.set(bx, 4.4, bz); masts.setMatrixAt(i, _m().compose(_p, _q, _s));
    }
    hulls.instanceMatrix.needsUpdate = true; masts.instanceMatrix.needsUpdate = true; scene.add(hulls); scene.add(masts);
  }
  // Palms: boulevard rows, both beaches, Keys and marsh scrub (browner) palms.
  const palmSpots = [];
  for (const r of ROADS) for (let t = -195; t < 200; t += 26) { palmSpots.push({ x: r + ROAD_W / 2 + 3, z: t + rng() * 6, scrub: 0 }); palmSpots.push({ x: t + rng() * 6, z: r - ROAD_W / 2 - 3, scrub: 0 }); }
  for (let z = -195; z < 200; z += 16) { palmSpots.push({ x: WORLD + 5 + rng() * 7, z, scrub: 0 }); palmSpots.push({ x: -WORLD - 5 - rng() * 7, z, scrub: 0 }); }
  for (const k of KEYS) for (let i = 0; i < 9; i++) palmSpots.push({ x: (rng() - 0.5) * k.rx * 1.5, z: k.z + (rng() - 0.5) * k.rz * 1.4, scrub: 0 });
  for (let i = 0; i < 46; i++) palmSpots.push({ x: -200 + rng() * 400, z: -215 - rng() * 200, scrub: 1 });
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 7, 5), mat(0x8d6e63), palmSpots.length);
  const fronds = new THREE.InstancedMesh(new THREE.ConeGeometry(3.4, 2.2, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }), palmSpots.length);
  palmSpots.forEach((p, k) => {
    _p.set(p.x, 3.5, p.z); _s.set(1, 1, 1); trunks.setMatrixAt(k, _m().compose(_p, _q, _s));
    _p.set(p.x, 7.6, p.z); fronds.setMatrixAt(k, _m().compose(_p, _q, _s));
    fronds.setColorAt(k, new THREE.Color(p.scrub ? 0x7a8a3a : 0x2ecc71));
  });
  trunks.instanceMatrix.needsUpdate = true; fronds.instanceMatrix.needsUpdate = true; if (fronds.instanceColor) fronds.instanceColor.needsUpdate = true;
  scene.add(trunks); scene.add(fronds);
  // Beach props: umbrellas on both coasts + the Keys.
  const umbSpots = [];
  for (let z = -180; z < 195; z += 24) { umbSpots.push([WORLD + 12 + rng() * 6, z]); umbSpots.push([-WORLD - 12 - rng() * 6, z + 9]); }
  for (const k of KEYS) for (let i = 0; i < 4; i++) umbSpots.push([(rng() - 0.5) * k.rx, k.z + k.rz - 4]);
  const umb = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 1, 7), new THREE.MeshLambertMaterial({ color: 0xffffff }), umbSpots.length);
  umbSpots.forEach((s, k) => { _p.set(s[0], 2.1, s[1]); _s.set(1, 1, 1); umb.setMatrixAt(k, _m().compose(_p, _q, _s)); umb.setColorAt(k, new THREE.Color(pick(rng, contColors.concat([0xff5da2, 0x7ef0d4])))); });
  umb.instanceMatrix.needsUpdate = true; if (umb.instanceColor) umb.instanceColor.needsUpdate = true; scene.add(umb);
  // ---- Landmarks (Part K), flat Florida terrain, silhouette set pieces ----
  // Art-deco beachfront strip: pastel stepped hotel fronts with neon signs
  // facing the east ocean along Marina Mile's beach.
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
  decoInst.instanceMatrix.needsUpdate = true; stepInst.instanceMatrix.needsUpdate = true; scene.add(decoInst); scene.add(stepInst);
  // Marlin Point Lighthouse on the east beach: banded tower + lit lamp room.
  {
    const bands = [0xf5f6fa, 0xd63031, 0xf5f6fa, 0xd63031, 0xf5f6fa];
    bands.forEach((c, i) => { const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.6 - i * 0.28, 2.9 - i * 0.28, 3.4, 10), mat(c)); seg.position.set(218, 1.7 + i * 3.4, 120); scene.add(seg); });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9a8 })); lamp.position.set(218, 19.4, 120); scene.add(lamp);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(4.5, 30, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff9c4, transparent: true, opacity: 0.13, side: THREE.DoubleSide }));
    beam.rotation.z = Math.PI / 2.25; beam.position.set(206, 19.4, 120); scene.add(beam);
    colliders.push({ x: 218, z: 120, hw: 3, hd: 3 });
  }
  // Southernmost-point marker buoy at the very end of the Keys chain.
  {
    const cols = [0xd63031, 0xf5f6fa, 0x14161c, 0xf5f6fa, 0xd63031];
    cols.forEach((c, i) => { const seg = new THREE.Mesh(new THREE.CylinderGeometry(2.2 - Math.abs(i - 2) * 0.3, 2.4 - Math.abs(i - 2) * 0.3, 1.6, 10), mat(c)); seg.position.set(0, 0.8 + i * 1.6, 434); scene.add(seg); });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(13, 3), new THREE.MeshBasicMaterial({ map: signTex('SOUTHERNMOST POINT · KEY SOLANO', '#ffe9a8', '#7a1f1f'), side: THREE.DoubleSide }));
    s.position.set(0, 10.6, 434); scene.add(s);
    colliders.push({ x: 0, z: 434, hw: 2.6, hd: 2.6 });
  }
  // Drawbridge-style span mid-causeway: twin towers + top beam (deck stays flat).
  for (const sx of [-1, 1]) {
    const tw = new THREE.Mesh(new THREE.BoxGeometry(1.6, 13, 1.6), mat(0x8e9aaf)); tw.position.set(CAUSEWAY.x + sx * 11, 6.5, 302); scene.add(tw);
  }
  const beam2 = new THREE.Mesh(new THREE.BoxGeometry(24, 1.4, 1.6), mat(0x8e9aaf)); beam2.position.set(CAUSEWAY.x, 13.4, 302); scene.add(beam2);
  const dbs = new THREE.Mesh(new THREE.PlaneGeometry(15, 3), new THREE.MeshBasicMaterial({ map: signTex('MARLIN DRAWBRIDGE', '#7ef0d4', '#14101f'), side: THREE.DoubleSide }));
  dbs.position.set(CAUSEWAY.x, 10.8, 302); scene.add(dbs);
  // Everglades airboat dock at the marsh edge: planks + a fan boat.
  {
    const dock = new THREE.Mesh(new THREE.BoxGeometry(16, 0.5, 5), mat(0x8d6e63)); dock.position.set(0, 0.35, -222); scene.add(dock);
    const boat = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.8, 6.4), mat(0xe67e22)); boat.position.set(-3, 0.7, -230); scene.add(boat);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.3, 12), mat(0x2f3542)); fan.rotation.x = Math.PI / 2; fan.position.set(-3, 2.4, -233); scene.add(fan);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(13, 3), new THREE.MeshBasicMaterial({ map: signTex('GLADES AIRBOAT TOURS', '#ffe9a8', '#243014'), side: THREE.DoubleSide }));
    s.position.set(6, 4.6, -220); scene.add(s);
  }
  // Rocket-launch gantry silhouette far across the bay (space-coast nod).
  {
    const gantry = new THREE.Mesh(new THREE.BoxGeometry(4, 44, 4), mat(0x3a3f4a)); gantry.position.set(330, 22, -40); scene.add(gantry);
    const rocket = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 30, 8), mat(0xdfe6e9)); rocket.position.set(338, 15, -40); scene.add(rocket);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(2.4, 6, 8), mat(0xd63031)); nose.position.set(338, 33, -40); scene.add(nose);
  }
  // Key Solano settlement: a handful of small pastel houses at the end of the line.
  for (let i = 0; i < 7; i++) {
    const x = -22 + i * 7.5, z = 396 + (i % 2) * 12;
    const hse = new THREE.Mesh(new THREE.BoxGeometry(5.5, 4, 5.5), new THREE.MeshLambertMaterial({ map: styles.pastel.tex }));
    hse.position.set(x, 2.3, z); scene.add(hse); colliders.push({ x, z, hw: 2.8, hd: 2.8 });
  }
  // Landmarks with readable signs: police, hospital, garage, FIRE STATION (damkar).
  function landmark(x, z, color, label, fg) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(20, 12, 16), mat(color));
    b.position.set(x, 6, z); scene.add(b); colliders.push({ x, z, hw: 10, hd: 8 });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(15, 3.6), new THREE.MeshBasicMaterial({ map: signTex(label, fg || '#ffffff', '#14101f') }));
    s.position.set(x, 10.6, z + 8.2); scene.add(s);
    return b;
  }
  landmark(-68, -68, 0x3742fa, 'POLICE', '#7ef0d4'); landmark(68, -68, 0xf5f6fa, 'HOSPITAL', '#ff5da2');
  landmark(82, 95, 0x57606f, "LUCIA'S GARAGE", '#ffd32a');
  landmark(FIRE_STATION.x, FIRE_STATION.z, 0xc0392b, 'DAMKAR · FIRE STATION', '#ffd32a');
  const gator = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.6), new THREE.MeshBasicMaterial({ map: signTex('THE GLADES — MIND THE GATORS', '#ffe9a8', '#243014'), side: THREE.DoubleSide }));
  gator.position.set(8, 4.4, -214); scene.add(gator);
  // World pickups (Parts C + H): sniper caches (Lucia's stash at Key Solano and
  // an Old Town alley cache) plus consumables at sensible spots — snacks at the
  // garage + marina + Key Solano, armour at the police station and the docks,
  // Cove Cola on both beaches. Each entry: {x, z, kind, grp, taken}.
  const pickups = [];
  const PICKUP_SPOTS = [
    { x: 6, z: 402, kind: 'sniper', color: 0x7ef0d4 }, { x: -104, z: -16, kind: 'sniper', color: 0x7ef0d4 },
    { x: 88, z: 90, kind: 'pistol', color: 0xffa502 }, { x: -140, z: 148, kind: 'pistol', color: 0xffa502 }, { x: 24, z: -84, kind: 'pistol', color: 0xffa502 },
    { x: 90, z: 92, kind: 'snack', color: 0xffd32a }, { x: 164, z: 158, kind: 'snack', color: 0xffd32a }, { x: 12, z: 396, kind: 'snack', color: 0xffd32a },
    { x: -56, z: -58, kind: 'armour', color: 0x54a0ff }, { x: -150, z: 120, kind: 'armour', color: 0x54a0ff },
    { x: 208, z: 20, kind: 'cola', color: 0xff5da2 }, { x: -208, z: -30, kind: 'cola', color: 0xff5da2 }, { x: 30, z: -120, kind: 'cola', color: 0xff5da2 },
    { x: 210, z: 112, kind: 'cola', color: 0xff5da2 }, { x: -6, z: -218, kind: 'snack', color: 0xffd32a },
  ];
  for (const spot of PICKUP_SPOTS) {
    const grp = new THREE.Group();
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 1.3), mat(spot.kind === 'armour' ? 0x273c75 : spot.kind === 'sniper' ? 0x2f3542 : 0xe67e22)); crate.position.y = 0.7; grp.add(crate);
    if (spot.kind === 'sniper') { const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.4, 6), mat(0x14161c)); barrel.rotation.z = Math.PI / 2; barrel.position.y = 1.25; grp.add(barrel); }
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 22, 10, 1, true), new THREE.MeshBasicMaterial({ color: spot.color, transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
    glow.position.y = 11; grp.add(glow);
    grp.position.set(spot.x, 0, spot.z); scene.add(grp);
    pickups.push({ x: spot.x, z: spot.z, kind: spot.kind, grp, taken: false });
    // Keep caches reachable: clear any building footprint that swallowed one.
    for (let ci = colliders.length - 1; ci >= 0; ci--) if (Math.hypot(colliders[ci].x - spot.x, colliders[ci].z - spot.z) < 9) colliders.splice(ci, 1);
  }
  // Objective marker: glowing pillar + floating diamond, moved by missions.
  const marker = new THREE.Group();
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 30, 10), new THREE.MeshBasicMaterial({ color: 0xffd32a, transparent: true, opacity: 0.4 }));
  pillar.position.y = 15; marker.add(pillar);
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(1.8), new THREE.MeshBasicMaterial({ color: 0xffd32a }));
  diamond.position.y = 6; marker.add(diamond);
  marker.visible = false; scene.add(marker);
  return { marker, diamond, ocean, pickups };
}

// Blocky human figure used for the player, Lucia and pedestrians (recoloured per role).
export function makePerson(shirt, pants, skin) {
  const g = new THREE.Group();
  const m = (c) => new THREE.MeshLambertMaterial({ color: c });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.45), m(pants)); legs.position.y = 0.45; g.add(legs);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.5), m(shirt)); torso.position.y = 1.38; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), m(skin)); head.position.y = 2.12; g.add(head);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.85, 0.25), m(shirt)); armL.position.set(-0.62, 1.35, 0); g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.62; g.add(armR);
  g.userData = { armL, armR, legs };
  return g;
}
// The two protagonists (Part M), original in-world versions of the poster pair.
// VERA SOLANO: blonde ponytail, pink tank top, dark ripped jeans, sneakers.
// DAX VEGA: dark spiky hair, open floral shirt over a white tee, gold chain,
// pink trousers — Vera's partner and getaway driver.
export function makeProtagonist(who) {
  const g = new THREE.Group();
  const m = (c) => new THREE.MeshLambertMaterial({ color: c });
  if (who === 'dax') {
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.45), m(0xf368e0)); legs.position.y = 0.45; g.add(legs); // pink trousers
    const tee = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.5), m(0xf5f6fa)); tee.position.y = 1.38; g.add(tee); // white tee
    for (const sx of [-1, 1]) { const panel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.95, 0.56), m(sx < 0 ? 0x2ecc71 : 0xe84393)); panel.position.set(sx * 0.34, 1.38, 0); g.add(panel); } // open floral shirt panels
    const chain = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.06), m(0xffd32a)); chain.position.set(0, 1.78, 0.27); g.add(chain); // gold chain
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), m(0xe0ac69)); head.position.y = 2.12; g.add(head);
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.28, 0.6), m(0x1e272e)); hair.position.y = 2.5; g.add(hair); // dark spiky hair
    const spike = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.3), m(0x1e272e)); spike.position.set(0, 2.72, -0.05); g.add(spike);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.85, 0.25), m(0x2ecc71)); armL.position.set(-0.62, 1.35, 0); g.add(armL);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.85, 0.25), m(0xe84393)); armR.position.x = 0.62; armR.position.y = 1.35; g.add(armR);
    g.userData = { armL, armR, legs };
  } else {
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.45), m(0x2f3542)); legs.position.y = 0.45; g.add(legs); // dark ripped jeans
    const rip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.47), m(0xf1c27d)); rip.position.set(0.1, 0.62, 0); g.add(rip); // ripped knee
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.5), m(0xff5da2)); torso.position.y = 1.38; g.add(torso); // pink tank top
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), m(0xf1c27d)); head.position.y = 2.12; g.add(head);
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.24, 0.6), m(0xf7d154)); hair.position.y = 2.48; g.add(hair); // blonde hair
    const pony = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.22), m(0xf7d154)); pony.position.set(0, 2.15, -0.36); g.add(pony); // ponytail
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.85, 0.25), m(0xf1c27d)); armL.position.set(-0.62, 1.35, 0); g.add(armL);
    const armR = armL.clone(); armR.position.x = 0.62; g.add(armR);
    g.userData = { armL, armR, legs };
  }
  g.userData.who = who;
  return g;
}
// Vehicle factory (Part F): car / moto / truck / police / firetruck classes.
export function makeVehicle(kind, color, opts) {
  const o = opts || {};
  const g = new THREE.Group();
  const m = (c) => new THREE.MeshLambertMaterial({ color: c });
  const wheels = [];
  const wheelAt = (x, y, z, r) => { const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 8), m(0x1e272e)); w.rotation.z = Math.PI / 2; w.position.set(x, y, z); g.add(w); wheels.push(w); };
  const axleAt = (y, z, r, wdt) => { const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, wdt, 8), m(0x1e272e)); w.rotation.z = Math.PI / 2; w.position.set(0, y, z); g.add(w); wheels.push(w); };
  if (kind === 'moto') {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 2.5), m(color)); frame.position.y = 0.72; g.add(frame);
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.9), m(0x1e272e)); tank.position.set(0, 1.05, 0.2); g.add(tank);
    wheelAt(0, 0.42, 1.15, 0.42); wheelAt(0, 0.42, -1.15, 0.42);
    const rider = new THREE.Group();
    const rTorso = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.95, 0.5), m(color)); rTorso.position.y = 1.55; rider.add(rTorso);
    const rHead = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), m(0xf1c27d)); rHead.position.y = 2.3; rider.add(rHead);
    rider.position.y = 0.35; g.add(rider);
    g.userData.rider = rider;
  } else if (kind === 'truck') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.7, 1.9), m(color)); cab.position.set(0, 1.25, 3.1); g.add(cab);
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 5.6), m(o.boxColor ?? 0xf5f6fa)); box.position.set(0, 1.75, -0.7); g.add(box);
    axleAt(0.5, 3.1, 0.5, 2.3); axleAt(0.5, -1.8, 0.5, 2.3); axleAt(0.5, -3, 0.5, 2.3);
  } else if (kind === 'firetruck') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.9, 7.6), m(0xd63031)); body.position.y = 1.35; g.add(body);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.4, 7.6), m(0xf5f6fa)); stripe.position.y = 1.5; g.add(stripe);
    const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 6.4), m(0xdfe6e9)); ladder.position.y = 2.5; g.add(ladder);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.25, 0.6), new THREE.MeshBasicMaterial({ color: 0xff3838 })); bar.position.set(0, 2.5, 3.4); g.add(bar);
    g.userData.lightbar = bar;
    axleAt(0.5, 2.7, 0.5, 2.4); axleAt(0.5, -2.7, 0.5, 2.4);
  } else { // car + police share the sedan body; police gets livery + light bar
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.65, o.len || 4.4), m(color)); body.position.y = 0.65; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, (o.len || 4.4) * 0.45), m(o.cabColor ?? 0x2f3542)); cab.position.set(0, 1.25, -0.2); g.add(cab);
    axleAt(0.42, 1.45, 0.42, 2.1); axleAt(0.42, -1.45, 0.42, 2.1);
    if (kind === 'police' || o.lightbar) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.4, 1.6), m(0x273c75)); door.position.set(0, 0.7, -0.2); g.add(door);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.25, 0.6), new THREE.MeshBasicMaterial({ color: 0xff0000 })); bar.position.set(0, 1.65, -0.2); g.add(bar);
      g.userData.lightbar = bar;
    }
    if (o.spoiler) { const sp = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.15, 0.5), m(0x1e272e)); sp.position.set(0, 1.15, -2.1); g.add(sp); }
  }
  g.userData.wheels = wheels;
  g.userData.kind = kind;
  return g;
}
export function makeCar(color, opts) { const o = opts || {}; return makeVehicle(o.lightbar ? 'police' : 'car', color, o); }
