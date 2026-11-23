// City generation: road grid, named districts, instanced buildings and palms,
// a beach and ocean on the east edge, road markings and the objective marker.
import { ROADS, ROAD_W, WORLD } from './config.js';
import { makeRng, pick } from './random.js';

export const colliders = [];   // {x,z,hw,hd} building footprints for collision
const BUILDING_COLORS = [0xff6b6b, 0xfeca57, 0x48dbfb, 0x1dd1a1, 0xf368e0, 0xff9f43, 0x54a0ff, 0x5f27cd, 0xffd32a, 0x00d2d3];
const _m = () => new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(), _p = new THREE.Vector3();

export function isRoad(x, z) {
  for (const r of ROADS) if (Math.abs(x - r) < ROAD_W / 2 + 1 || Math.abs(z - r) < ROAD_W / 2 + 1) return true;
  return false;
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
  pos.x = Math.max(-WORLD - 4, Math.min(WORLD + 26, pos.x));
  pos.z = Math.max(-WORLD - 4, Math.min(WORLD + 4, pos.z));
}

export function buildCity(scene, seed) {
  const rng = makeRng(seed * 7919 + 13);
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 90, 260);
  scene.add(new THREE.HemisphereLight(0xcfefff, 0x3a7d44, 0.85));
  const sun = new THREE.DirectionalLight(0xfff2cc, 0.85);
  sun.position.set(60, 120, 40); scene.add(sun);

  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  // Ground, beach and ocean
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(440, 440), mat(0x58b368));
  ground.rotation.x = -Math.PI / 2; ground.position.set(10, -0.05, 0); scene.add(ground);
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(34, 440), mat(0xf7e3a1));
  beach.rotation.x = -Math.PI / 2; beach.position.set(WORLD + 14, 0.0, 0); scene.add(beach);
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(180, 440), mat(0x118ab2));
  ocean.rotation.x = -Math.PI / 2; ocean.position.set(WORLD + 110, -0.25, 0); scene.add(ocean);

  // Roads: dark planes plus dashed centre lines (merged into few meshes)
  const roadMat = mat(0x3d4451), lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const r of ROADS) {
    const v = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 420), roadMat);
    v.rotation.x = -Math.PI / 2; v.position.set(r, 0.02, 0); scene.add(v);
    const h = new THREE.Mesh(new THREE.PlaneGeometry(420, ROAD_W), roadMat);
    h.rotation.x = -Math.PI / 2; h.position.set(0, 0.02, r); scene.add(h);
    for (let t = -200; t < 200; t += 25) {
      if (ROADS.some((o) => Math.abs(t - o) < 10)) continue;
      const d1 = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 5), lineMat);
      d1.rotation.x = -Math.PI / 2; d1.position.set(r, 0.05, t); scene.add(d1);
      const d2 = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.5), lineMat);
      d2.rotation.x = -Math.PI / 2; d2.position.set(t, 0.05, r); scene.add(d2);
    }
  }
  // Sidewalk slabs per block
  const walkMat = mat(0xced6e0);
  for (let i = 0; i < ROADS.length - 1; i++) for (let j = 0; j < ROADS.length - 1; j++) {
    const cx = (ROADS[i] + ROADS[i + 1]) / 2, cz = (ROADS[j] + ROADS[j + 1]) / 2;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(58, 0.3, 58), walkMat);
    slab.position.set(cx, 0.15, cz); scene.add(slab);
  }
  // Buildings: one InstancedMesh, varied heights and flat colours
  const spots = [];
  for (let i = 0; i < ROADS.length - 1; i++) for (let j = 0; j < ROADS.length - 1; j++) {
    const cx = (ROADS[i] + ROADS[i + 1]) / 2, cz = (ROADS[j] + ROADS[j + 1]) / 2;
    for (const ox of [-15, 15]) for (const oz of [-15, 15]) {
      if (rng() < 0.12) continue;
      spots.push({ x: cx + ox, z: cz + oz, w: 16 + rng() * 8, d: 16 + rng() * 8, h: 10 + rng() * rng() * 38 });
    }
  }
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), spots.length);
  spots.forEach((b, k) => {
    _p.set(b.x, b.h / 2 + 0.3, b.z); _s.set(b.w, b.h, b.d);
    inst.setMatrixAt(k, _m().compose(_p, _q, _s));
    inst.setColorAt(k, new THREE.Color(pick(rng, BUILDING_COLORS)));
    colliders.push({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2 });
  });
  inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  scene.add(inst);
  // Palm trees: instanced trunks + instanced fronds
  const palmSpots = [];
  for (const r of ROADS) for (let t = -195; t < 200; t += 26) {
    palmSpots.push({ x: r + ROAD_W / 2 + 3, z: t + rng() * 6 });
    palmSpots.push({ x: t + rng() * 6, z: r - ROAD_W / 2 - 3 });
  }
  for (let z = -195; z < 200; z += 18) palmSpots.push({ x: WORLD + 4 + rng() * 8, z });
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 7, 5), mat(0x8d6e63), palmSpots.length);
  const fronds = new THREE.InstancedMesh(new THREE.ConeGeometry(3.4, 2.2, 6), mat(0x2ecc71), palmSpots.length);
  palmSpots.forEach((p, k) => {
    _p.set(p.x, 3.5, p.z); _s.set(1, 1, 1); trunks.setMatrixAt(k, _m().compose(_p, _q, _s));
    _p.set(p.x, 7.6, p.z); fronds.setMatrixAt(k, _m().compose(_p, _q, _s));
  });
  trunks.instanceMatrix.needsUpdate = true; fronds.instanceMatrix.needsUpdate = true;
  scene.add(trunks); scene.add(fronds);

  // Landmark signs: police station + hospital blocks
  function landmark(x, z, color, label) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(20, 12, 16), mat(color));
    b.position.set(x, 6, z); scene.add(b); colliders.push({ x, z, hw: 10, hd: 8 });
    return b;
  }
  landmark(-68, -68, 0x3742fa, 'police'); landmark(68, -68, 0xffffff, 'hospital');
  landmark(82, 95, 0x57606f, 'garage');

  // Objective marker: glowing pillar + floating diamond, moved by missions
  const marker = new THREE.Group();
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 30, 10),
    new THREE.MeshBasicMaterial({ color: 0xffd32a, transparent: true, opacity: 0.4 }));
  pillar.position.y = 15; marker.add(pillar);
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(1.8), new THREE.MeshBasicMaterial({ color: 0xffd32a }));
  diamond.position.y = 6; marker.add(diamond);
  marker.visible = false; scene.add(marker);
  return { marker, diamond, ocean };
}

// Blocky human figure used for the player, Lucia and pedestrians ( recoloured per role )
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
export function makeCar(color, opts) {
  const o = opts || {};
  const g = new THREE.Group();
  const m = (c) => new THREE.MeshLambertMaterial({ color: c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.65, o.len || 4.4), m(color)); body.position.y = 0.65; g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, (o.len || 4.4) * 0.45), m(o.cabColor ?? 0x2f3542)); cab.position.set(0, 1.25, -0.2); g.add(cab);
  const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 8), wm = m(0x1e272e);
  const wheels = [];
  for (const [wx, wz] of [[-1.05, 1.45], [1.05, 1.45], [-1.05, -1.45], [1.05, -1.45]]) {
    const w = new THREE.Mesh(wg, wm); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.42, wz); g.add(w); wheels.push(w);
  }
  if (o.lightbar) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.25, 0.6),
      new THREE.MeshBasicMaterial({ color: 0xff0000 })); bar.position.set(0, 1.65, -0.2); g.add(bar);
    g.userData.lightbar = bar;
  }
  if (o.spoiler) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.15, 0.5), m(0x1e272e)); sp.position.set(0, 1.15, -2.1); g.add(sp);
  }
  g.userData.wheels = wheels;
  return g;
}
