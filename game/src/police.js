// The wanted system: 0–5 stars, a pooled squad of police cars that chase,
// line-of-sight decay, a bust meter, and a spotlight helicopter at high heat.
//
// Rules of the chase: committing a crime sets the level outright (crimes do
// not stack past their own severity, and nothing exceeds five stars). While
// any officer can see you the heat holds; break line of sight for
// TUNING.wantedDecaySeconds and it cools one star at a time. Get cornered —
// an officer within nine units while you are barely moving — and the bust
// meter fills; empty it by running or driving away.
import { G } from './state.js';
import { TUNING } from './config.js';
import { makeCar, collideBuildings, clampWorld, groundHeightAt } from './city.js';
import { sfx } from './audio.js';

export const cops = []; // {mesh, pos, angle, speed, active}
export const heliCfg = { height: 20, radius: 22 };
let heli = null, heliAngle = 0;

export function buildPolice(scene) {
  for (let i = 0; i < 4; i++) {
    const mesh = makeCar(0xffffff, { lightbar: true, cabColor: 0x273c75 });
    mesh.visible = false;
    scene.add(mesh);
    cops.push({ mesh, pos: mesh.position, angle: 0, speed: 0, active: false });
  }
  heli = new THREE.Group();
  const m = (c) => new THREE.MeshLambertMaterial({ color: c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 5), m(0x273c75)); heli.add(body);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 5), m(0x273c75)); tail.position.set(0, 0.3, -4.5); heli.add(tail);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.1, 0.7), m(0x1e272e)); rotor.position.y = 1.1; heli.add(rotor);
  heli.userData.rotor = rotor;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(6, 26, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff9c4, transparent: true, opacity: 0.28, side: THREE.DoubleSide }));
  cone.position.y = -13.5; heli.add(cone);
  const spot = new THREE.Mesh(new THREE.CircleGeometry(5.5, 12), new THREE.MeshBasicMaterial({ color: 0xfff9c4, transparent: true, opacity: 0.35 }));
  spot.rotation.x = -Math.PI / 2; spot.position.y = -19.4; heli.add(spot);
  heli.userData.spot = spot;
  heli.visible = false;
  scene.add(heli);
}

export function commitCrime(stars, label) {
  if (G.mode !== 'playing') return;
  G.wanted = Math.min(5, Math.max(G.wanted, stars));
  G.losTimer = 0;
}
export function addWanted(n) { G.wanted = Math.min(5, G.wanted + n); G.losTimer = 0; }

export function updatePolice(dt, targetPos, targetSpeed, onBusted) {
  const want = G.wanted;
  let nearest = 1e9, anyLOS = false;
  cops.forEach((c, i) => {
    const should = want > 0 && i < Math.min(4, want + 1);
    if (should && !c.active) { // spawn at a distance, never on top of the player
      c.active = true; c.mesh.visible = true;
      const a = (i / 4) * Math.PI * 2 + G.time;
      c.pos.set(targetPos.x + Math.cos(a) * 55, 0, targetPos.z + Math.sin(a) * 55);
      clampWorld(c.pos);
    }
    if (!should) { c.active = false; c.mesh.visible = false; return; }
    const dx = targetPos.x - c.pos.x, dz = targetPos.z - c.pos.z;
    const dist = Math.hypot(dx, dz);
    nearest = Math.min(nearest, dist);
    if (dist < 70) anyLOS = true;
    const speed = dist > 4 ? Math.min(30, 16 + want * 2.6) : 0;
    if (dist > 1) { c.pos.x += (dx / dist) * speed * dt; c.pos.z += (dz / dist) * speed * dt; }
    collideBuildings(c.pos, 1.6); // officers respect buildings and props too
    c.angle = Math.atan2(dx, dz);
    c.mesh.position.copy(c.pos);
    c.mesh.position.y = groundHeightAt(c.pos.x, c.pos.z, null);
    c.mesh.rotation.y = c.angle;
    if (c.mesh.userData.lightbar) {
      c.mesh.userData.lightbar.material.color.setHex(Math.floor(G.time * 6) % 2 ? 0xff0000 : 0x0066ff);
    }
    for (const w of c.mesh.userData.wheels) w.rotation.x += speed * dt * 2;
  });
  if (want > 0) {
    if (anyLOS) G.losTimer = 0;
    else {
      G.losTimer += dt;
      if (G.losTimer > TUNING.wantedDecaySeconds) { G.wanted--; G.losTimer = 0; }
    }
  }
  if (want > 0 && nearest < 9 && Math.abs(targetSpeed) < 2.2) {
    G.bust = Math.min(1, G.bust + TUNING.bustFillRate * dt);
  } else {
    G.bust = Math.max(0, G.bust - TUNING.bustDrainRate * dt);
  }
  if (G.bust >= 1) { G.bust = 0; onBusted && onBusted(); }
  sfx.siren(dt, want > 0);
  if (heli) {
    const show = want >= 4;
    heli.visible = show;
    if (show) {
      heliAngle += dt * 0.55;
      heli.position.set(targetPos.x + Math.cos(heliAngle) * heliCfg.radius, heliCfg.height, targetPos.z + Math.sin(heliAngle) * heliCfg.radius);
      if (heli.userData.spot) heli.userData.spot.position.y = -(heliCfg.height - 0.6);
      heli.lookAt(targetPos.x, 0, targetPos.z);
      heli.userData.rotor.rotation.y += dt * 22;
    }
  }
}

export function policePositions() { return cops.filter((c) => c.active).map((c) => c.pos); }
export function setHeliAngle(a) { heliAngle = a; }
export function heliVisible() { return !!(heli && heli.visible); }
