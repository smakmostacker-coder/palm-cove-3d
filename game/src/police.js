// Police and the wanted system: crime reporting, pursuit cars, foot
// officers, the bust meter, and the helicopter at high wanted levels.
// Crimes are not heat until somebody can plausibly report them, so
// commitCrime sorts reports by class before anything reaches G.wanted.
import { G } from './state.js';
import { TUNING, CITY_ROADS_X, CITY_ROADS_Z, ROAD_W, PRISON, POLICE_STATION } from './config.js';
import { makeCarMesh, makePersonMesh, posePerson, collideWorld, floorHeight } from './city.js';
import { peds } from './pedestrians.js';
import { sfx } from './audio.js';
import { floatBetween, chanceOf } from './random.js';

export const cops = [];
export const officers = [];
export const jackedCars = [];
const pendingReports = []; // reports waiting out their delay
let heli = null;
let heliAngle = 0;
let spawnSeed = 0;

const LOUD_RADII = { 'Shots fired': 70, 'Sniper fire': 55, 'Vehicle explosion': 85 };
const CAR_TAKING = new Set(['Vehicle stolen', 'Carjacking']);
const ALARM_LABELS = new Set(['Jewelry robbery', 'Debtor taken out', 'Marked car stolen']);

function dist2D(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.z - b.z);
}
function nearestIn(value, list) {
  let best = list[0]; let gap = Infinity;
  for (const item of list) { const g = Math.abs(item - value); if (g < gap) { gap = g; best = item; } }
  return best;
}
function wrapAngle(a) {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}
function turnToward(current, desired, maxStep) {
  const diff = wrapAngle(desired - current);
  return Math.abs(diff) <= maxStep ? desired : current + Math.sign(diff) * maxStep;
}
function insideCity(pos) { return Math.abs(pos.x) < 182 && Math.abs(pos.z) < 182; }
// Axis-separated slide so a blocked axis never cancels the other one.
function slideMove(pos, dx, dz, radius) {
  if (dx !== 0) { pos.x += dx; collideWorld(pos, radius); }
  if (dz !== 0) { pos.z += dz; collideWorld(pos, radius); }
}
function groundY(pos, hint) {
  const y = floorHeight(pos.x, pos.z, hint);
  return typeof y === 'number' && Number.isFinite(y) ? y : 0;
}
function applyStars(stars) {
  G.wanted = Math.min(5, Math.max(G.wanted || 0, stars));
  G.losTimer = 0;
}
export function addWanted(n) {
  const before = G.wanted || 0;
  G.wanted = Math.max(0, Math.min(5, before + n));
  if (G.wanted > before) G.losTimer = 0;
}
function anyEngaged(pos) {
  for (const car of cops) if (car.active && !car.jacked && dist2D(car.pos, pos) <= 65) return true;
  for (const o of officers) if (o.mode === 'chase' && dist2D(o.pos, pos) <= 65) return true;
  return false;
}
function policeUnitNear(pos, radius) {
  for (const car of cops) if (car.active && !car.jacked && dist2D(car.pos, pos) <= radius) return true;
  for (const o of officers) {
    if (o.mode === 'reserve' || o.mode === 'down') continue;
    if (dist2D(o.pos, pos) <= radius) return true;
  }
  return false;
}
function anyWitnessNear(pos, radius, civilians) {
  if (policeUnitNear(pos, radius)) return true;
  if (!civilians) return false;
  for (const ped of peds) if (ped && ped.pos && dist2D(ped.pos, pos) <= radius) return true;
  return false;
}

export function commitCrime(stars, label, opts = {}) {
  if (G.mode !== 'playing' || !stars || stars <= 0) return;
  const pos = opts.pos || null;
  // A chase already on top of the crime skips the reporting step.
  if (opts.instant || label === 'Police chase' || (pos && anyEngaged(pos))) { applyStars(stars); return; }
  if (!pos) return;
  let reported = false; let delay = TUNING.reportDelaySeen;
  if (CAR_TAKING.has(label)) {
    // Quiet theft: only a police unit's eyes count, never a bystander's.
    reported = policeUnitNear(pos, TUNING.witnessRadius);
  } else if (Object.prototype.hasOwnProperty.call(LOUD_RADII, label)) {
    reported = anyWitnessNear(pos, LOUD_RADII[label], true);
    delay = TUNING.reportDelayLoud;
  } else if (ALARM_LABELS.has(label) || opts.victim) {
    reported = true; // alarms and victims phone it in themselves
    delay = TUNING.reportDelayAlarm;
  } else {
    reported = anyWitnessNear(pos, TUNING.witnessRadius, true);
  }
  if (reported) pendingReports.push({ stars, t: delay, label });
}

function addChestStripe(mesh) {
  // A pale stripe marks the uniform without new builder geometry.
  if (!mesh.userData.upper) return;
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.07, 0.03),
    new THREE.MeshBasicMaterial({ color: 0xdfe8f5 }));
  stripe.position.set(0, 0.1, 0.17);
  mesh.userData.upper.add(stripe);
}
function makeOfficer(scene, opts) {
  const mesh = makePersonMesh({
    shirtStyle: 'uniform', shirt: 0x273c75, pants: 0x20293d,
    hairStyle: 'cap', hairColor: 0x1b2a4a, face: 'stern', skin: opts.skin,
  });
  addChestStripe(mesh);
  mesh.visible = opts.mode !== 'reserve';
  scene.add(mesh);
  const officer = {
    mesh, pos: mesh.position, angle: opts.angle || 0, phase: floatBetween(0, 6),
    mode: opts.mode, homeMode: opts.mode, beat: opts.beat || null, post: opts.post || null,
    car: null, crew: false, health: 100, downT: 0, dir: opts.dir || 1,
  };
  officer.pos.set(opts.x, 0, opts.z);
  officer.pos.y = groundY(officer.pos, 0);
  mesh.rotation.y = officer.angle;
  officers.push(officer);
  return officer;
}
function buildHelicopter(scene) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x222831 });
  const accentMat = new THREE.MeshLambertMaterial({ color: 0xf2f4f6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.7, 5.6), bodyMat); group.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 1.4), accentMat);
  nose.position.set(0, -0.2, 3.2); group.add(nose);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 5.4), bodyMat);
  tail.position.set(0, 0.25, -5.2); group.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.5, 0.9), accentMat);
  fin.position.set(0, 0.7, -7.7); group.add(fin);
  const rotor = new THREE.Group();
  const bladeMat = new THREE.MeshBasicMaterial({ color: 0x111318 });
  rotor.add(new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.55), bladeMat));
  rotor.add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 11), bladeMat));
  rotor.position.y = 1.15; group.add(rotor);
  group.userData.rotor = rotor;
  // Skids keep the silhouette readable from the ground, where the
  // player almost always sees it from.
  const skidMat = new THREE.MeshLambertMaterial({ color: 0x111318 });
  for (const sideX of [-1.3, 1.3]) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 4.6), skidMat);
    skid.position.set(sideX, -1.45, 0.2);
    group.add(skid);
    for (const strutZ of [-1.4, 1.6]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.8, 0.14), skidMat);
      strut.position.set(sideX, -1.05, strutZ);
      group.add(strut);
    }
  }
  // A small tail rotor sells the spin even when the main rotor blurs.
  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 0.22), bladeMat);
  tailRotor.position.set(0.2, 0.7, -7.7);
  group.add(tailRotor);
  group.userData.tailRotor = tailRotor;
  // Translucent cone plus a ground disc sell the searchlight.
  const cone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 6.2, 19, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  cone.position.y = -10; group.add(cone);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(6.2, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.22, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = -19.6; group.add(disc);
  group.visible = false;
  scene.add(group);
  heli = { group, rotor, cone, disc };
}

export function buildPolice(scene) {
  cops.length = 0; officers.length = 0; jackedCars.length = 0; pendingReports.length = 0;
  for (let i = 0; i < 4; i += 1) {
    const mesh = makeCarMesh(0xf2f4f6, { kind: 'police', lightbar: true, cabColor: 0x16294d });
    mesh.visible = false;
    scene.add(mesh);
    cops.push({
      mesh, pos: mesh.position, angle: 0, speed: 0, active: false, jacked: false,
      crewOut: false, crewWait: 0, stallT: 0, lastDist: Infinity, health: 100,
      disabled: false, disabledT: 0, type: 'police', driver: 'police',
    });
  }
  const skins = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xa9744f];
  const walkway = ROAD_W / 2 + 2;
  // Boulevard beats cross the z=0 road on opposite sidewalks.
  makeOfficer(scene, { mode: 'patrol', skin: skins[0], x: -120, z: walkway, angle: Math.PI / 2, dir: 1, beat: { axis: 'x', fixed: walkway, min: -145, max: 145 } });
  makeOfficer(scene, { mode: 'patrol', skin: skins[1], x: 120, z: -walkway, angle: -Math.PI / 2, dir: -1, beat: { axis: 'x', fixed: -walkway, min: -145, max: 145 } });
  makeOfficer(scene, { mode: 'patrol', skin: skins[2], x: -75 + walkway, z: 60, angle: Math.PI, dir: -1, beat: { axis: 'z', fixed: -75 + walkway, min: -140, max: 140 } });
  makeOfficer(scene, { mode: 'post', skin: skins[3], x: PRISON.gateX - 3, z: PRISON.gateZ + 2, post: { x: PRISON.gateX - 3, z: PRISON.gateZ + 2 } });
  makeOfficer(scene, { mode: 'post', skin: skins[4], x: PRISON.gateX + 3, z: PRISON.gateZ + 2, post: { x: PRISON.gateX + 3, z: PRISON.gateZ + 2 } });
  // The sixth officer never walks a beat; he deploys from a stopped car.
  makeOfficer(scene, { mode: 'reserve', skin: skins[5], x: POLICE_STATION.x, z: POLICE_STATION.z });
  buildHelicopter(scene);
}

function snapSpawnPoint(point) {
  if (!insideCity(point)) return;
  const roadX = nearestIn(point.x, CITY_ROADS_Z);
  const roadZ = nearestIn(point.z, CITY_ROADS_X);
  const gapX = Math.abs(roadX - point.x); const gapZ = Math.abs(roadZ - point.z);
  // Near both lines it is an intersection; otherwise keep the closer road.
  if (gapX <= ROAD_W && gapZ <= ROAD_W) { point.x = roadX; point.z = roadZ; }
  else if (gapX < gapZ) point.x = roadX;
  else point.z = roadZ;
}
function spawnCop(car, targetPos, index) {
  spawnSeed += 1;
  const around = index * 1.7 + spawnSeed * 0.9 + floatBetween(-0.4, 0.4);
  const point = { x: targetPos.x + Math.cos(around) * 55, z: targetPos.z + Math.sin(around) * 55 };
  snapSpawnPoint(point);
  car.pos.set(point.x, 0, point.z);
  car.pos.y = groundY(car.pos, 0);
  car.angle = Math.atan2(targetPos.x - point.x, targetPos.z - point.z);
  car.mesh.rotation.y = car.angle;
  car.speed = 0; car.active = true; car.crewOut = false; car.crewWait = 0;
  car.stallT = 0; car.lastDist = dist2D(car.pos, targetPos);
  car.mesh.visible = true;
}
// Ride the current road to the target's cross street, turn at that
// intersection, and leave the grid only for the final short approach.
function routePoint(car, targetPos) {
  if (dist2D(car.pos, targetPos) <= 22) return { x: targetPos.x, z: targetPos.z };
  if (!insideCity(car.pos) || !insideCity(targetPos)) {
    // Off-grid, the highway spine at x=0 is the way back into town.
    if (insideCity(targetPos) && !insideCity(car.pos)) return { x: 0, z: nearestIn(targetPos.z, CITY_ROADS_X) };
    return { x: targetPos.x, z: targetPos.z };
  }
  const crossX = nearestIn(targetPos.x, CITY_ROADS_Z);
  const crossZ = nearestIn(targetPos.z, CITY_ROADS_X);
  const onX = Math.abs(car.pos.x - nearestIn(car.pos.x, CITY_ROADS_Z)) <= ROAD_W / 2 + 1;
  const onZ = Math.abs(car.pos.z - nearestIn(car.pos.z, CITY_ROADS_X)) <= ROAD_W / 2 + 1;
  if (onZ && !onX) return Math.abs(car.pos.x - crossX) > 4 ? { x: crossX, z: car.pos.z } : { x: crossX, z: crossZ };
  if (onX && !onZ) return Math.abs(car.pos.z - crossZ) > 4 ? { x: car.pos.x, z: crossZ } : { x: crossX, z: crossZ };
  if (onX && onZ) return { x: crossX, z: crossZ };
  return { x: nearestIn(car.pos.x, CITY_ROADS_Z), z: nearestIn(car.pos.z, CITY_ROADS_X) };
}
function flashLightbar(car) {
  const bar = car.mesh.userData.lightbar;
  if (!bar || !bar.userData || !bar.userData.lenses) return;
  const phase = Math.floor((G.time || 0) * 6) % 2;
  bar.userData.lenses.forEach((mat, i) => {
    if (!mat) return;
    const lit = i % 2 === phase;
    if ('emissiveIntensity' in mat) mat.emissiveIntensity = lit ? 2.4 : 0.15;
    if ('opacity' in mat && mat.transparent) mat.opacity = lit ? 1 : 0.45;
  });
}
function deployCrew(car) {
  const officer = officers.find((o) => o.mode === 'reserve');
  if (!officer) { car.crewOut = true; return; }
  const side = chanceOf(0.5) ? 1 : -1;
  officer.pos.set(car.pos.x + Math.cos(car.angle) * 2.2 * side, 0, car.pos.z - Math.sin(car.angle) * 2.2 * side);
  officer.pos.y = groundY(officer.pos, 0);
  officer.mesh.visible = true;
  officer.mode = 'chase'; officer.crew = true; officer.car = car; officer.angle = car.angle;
  car.crewOut = true;
}
function updateCopCar(car, dt, targetPos, index) {
  flashLightbar(car);
  if (car.disabled) {
    car.speed = Math.max(0, car.speed - 22 * dt);
    if (car.speed === 0) car.active = false;
    return;
  }
  const dist = dist2D(car.pos, targetPos);
  const point = routePoint(car, targetPos);
  car.angle = turnToward(car.angle, Math.atan2(point.x - car.pos.x, point.z - car.pos.z), 2.4 * dt);
  const topSpeed = Math.min(30, 16 + (G.wanted || 0) * 2.6);
  const goal = dist > 5 ? topSpeed : 0;
  const accel = goal > car.speed ? 14 : 30;
  car.speed += Math.sign(goal - car.speed) * Math.min(Math.abs(goal - car.speed), accel * dt);
  if (car.speed > 0.1) {
    slideMove(car.pos, Math.sin(car.angle) * car.speed * dt, Math.cos(car.angle) * car.speed * dt, 1.7);
    car.pos.y = groundY(car.pos, car.pos.y);
  }
  car.mesh.rotation.y = car.angle;
  // No progress far away means the approach is walled off; a fresh unit
  // arriving from another street reads better than a visible pop.
  if (dist < car.lastDist - 1) { car.lastDist = dist; car.stallT = 0; }
  else { car.stallT += dt; if (car.stallT > 3 && dist > 42) spawnCop(car, targetPos, index + 2); }
  // A stopped car next to a suspect on foot sends its officer out.
  if (!car.crewOut && !G.driving && (G.wanted || 0) > 0 && dist <= 5.2) {
    car.crewWait += dt;
    if (car.crewWait >= 0.7) deployCrew(car);
  } else car.crewWait = 0;
}

function homePoint(officer) {
  if (officer.post) return officer.post;
  if (officer.beat) {
    if (officer.beat.axis === 'x') return { x: Math.max(officer.beat.min, Math.min(officer.beat.max, officer.pos.x)), z: officer.beat.fixed };
    return { x: officer.beat.fixed, z: Math.max(officer.beat.min, Math.min(officer.beat.max, officer.pos.z)) };
  }
  return { x: POLICE_STATION.x, z: POLICE_STATION.z };
}
function moveOfficer(officer, dt, tx, tz, speed, pose) {
  const dx = tx - officer.pos.x; const dz = tz - officer.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 0.05) {
    officer.angle = turnToward(officer.angle, Math.atan2(dx, dz), 8 * dt);
    const step = Math.min(dist, speed * dt);
    slideMove(officer.pos, Math.sin(officer.angle) * step, Math.cos(officer.angle) * step, 0.55);
    officer.pos.y = groundY(officer.pos, officer.pos.y);
  }
  officer.mesh.rotation.y = officer.angle;
  officer.phase += dt * (pose === 'run' ? 11 : 6);
  posePerson(officer.mesh, officer.phase, pose);
  return dist;
}
function updateOfficer(officer, dt, targetPos) {
  if (officer.mode === 'reserve') { officer.mesh.visible = false; return; }
  if (officer.mode === 'down') {
    officer.downT -= dt;
    if (officer.downT <= 0) { // back up at half health, heading home
      officer.health = 50; officer.mode = 'return'; officer.mesh.rotation.x = 0; officer.mesh.visible = true;
    }
    return;
  }
  const dist = dist2D(officer.pos, targetPos);
  const sight = officer.homeMode === 'post' ? 26 : 34;
  if (officer.mode !== 'chase' && (G.wanted || 0) > 0 && dist <= sight) officer.mode = 'chase';
  if (officer.mode === 'chase') {
    const gaveUp = (G.wanted || 0) === 0 || dist > 62 || (G.driving && dist > 13);
    if (!gaveUp) { moveOfficer(officer, dt, targetPos.x, targetPos.z, 6.2, 'run'); return; }
    if (officer.crew) { // crew has no beat; it falls back to the station
      officer.homeMode = 'post'; officer.post = { x: POLICE_STATION.x, z: POLICE_STATION.z }; officer.crew = false;
    }
    officer.mode = 'return';
  }
  if (officer.mode === 'return') {
    const home = homePoint(officer);
    if (moveOfficer(officer, dt, home.x, home.z, 2.6, 'walk') <= 0.6) officer.mode = officer.homeMode;
    return;
  }
  if (officer.mode === 'post') { // hold ground, slowly scan the street
    officer.angle += Math.sin((G.time || 0) * 0.4 + officer.phase) * 0.15 * dt;
    officer.mesh.rotation.y = officer.angle;
    posePerson(officer.mesh, officer.phase, 'idle');
    return;
  }
  const beat = officer.beat; // patrol: flip direction at either end
  if (!beat) { posePerson(officer.mesh, officer.phase, 'idle'); return; }
  const along = beat.axis === 'x' ? officer.pos.x : officer.pos.z;
  if (along >= beat.max) officer.dir = -1;
  if (along <= beat.min) officer.dir = 1;
  const tx = beat.axis === 'x' ? along + officer.dir * 4 : beat.fixed;
  const tz = beat.axis === 'x' ? beat.fixed : along + officer.dir * 4;
  moveOfficer(officer, dt, tx, tz, 1.7, 'walk');
}
function clampOfficerDistance(officer, targetPos) {
  // Hard ring: contact alone never arrests, the bust meter does, so no
  // officer may finish a frame inside the stop distance.
  if (officer.mode === 'reserve' || officer.mode === 'down' || !officer.mesh.visible) return;
  const dx = officer.pos.x - targetPos.x; const dz = officer.pos.z - targetPos.z;
  const dist = Math.hypot(dx, dz);
  if (dist >= TUNING.officerStopDistance) return;
  const ux = dist > 0.001 ? dx / dist : Math.sin(officer.angle);
  const uz = dist > 0.001 ? dz / dist : Math.cos(officer.angle);
  officer.pos.x = targetPos.x + ux * TUNING.officerStopDistance;
  officer.pos.z = targetPos.z + uz * TUNING.officerStopDistance;
  officer.pos.y = groundY(officer.pos, officer.pos.y);
}

export function damageOfficer(officer, amount) {
  if (!officer || officer.mode === 'down') return;
  officer.health -= amount;
  if (officer.health > 0) return;
  officer.health = 0; officer.mode = 'down'; officer.downT = 8;
  officer.mesh.rotation.x = Math.PI / 2; // tipped flat until recovery
  addWanted(1);
}
export function damageCop(car, amount) {
  if (!car || car.disabled) return;
  car.health -= amount;
  if (car.health > 0) return;
  car.health = 0; car.disabled = true; car.disabledT = 0;
}
export function tryJackCop(pos) {
  for (const car of cops) {
    if (!car.active || car.jacked || dist2D(car.pos, pos) > 3.2) continue;
    car.jacked = true; car.active = false; car.type = 'police'; car.driver = null; car.speed = 0;
    jackedCars.push(car);
    if (!car.crewOut) deployCrew(car); // the reserve officer bails out and pursues
    else { const crew = officers.find((o) => o.car === car); if (crew) crew.mode = 'chase'; }
    applyStars(3);
    return car;
  }
  return null;
}
function updateHelicopter(dt, targetPos) {
  if (!heli) return;
  const show = (G.wanted || 0) >= 4;
  heli.group.visible = show;
  if (!show) return;
  heliAngle += dt * 0.45;
  heli.group.position.set(targetPos.x + Math.cos(heliAngle) * 22, 20, targetPos.z + Math.sin(heliAngle) * 22);
  heli.group.rotation.y = -heliAngle;
  heli.rotor.rotation.y += dt * 28; // the disc rides as a child at ground offset
  if (heli.group.userData.tailRotor) heli.group.userData.tailRotor.rotation.x += dt * 34;
  // The cone leans toward the suspect instead of hanging straight
  // down, so the light reads as aimed rather than decorative.
  const leanX = Math.max(-0.35, Math.min(0.35, (targetPos.x - heli.group.position.x) / 60));
  const leanZ = Math.max(-0.35, Math.min(0.35, (targetPos.z - heli.group.position.z) / 60));
  heli.cone.rotation.x = leanZ;
  heli.cone.rotation.z = -leanX;
  // The ground disc drifts with the lean so it stays under the beam.
  heli.disc.position.x = leanX * 18;
  heli.disc.position.z = leanZ * 18;
}
export function heliVisible() { return Boolean(heli && heli.group.visible && (G.wanted || 0) >= 4); }
export function policePositions() {
  const out = [];
  for (const car of cops) if (car.active && !car.jacked) out.push(car.pos);
  for (const o of officers) if (o.mode === 'chase') out.push(o.pos);
  return out;
}

export function updatePolice(dt, targetPos, targetSpeed, onBusted) {
  for (let i = pendingReports.length - 1; i >= 0; i -= 1) { // delayed reports land here
    pendingReports[i].t -= dt;
    if (pendingReports[i].t <= 0) { applyStars(pendingReports[i].stars); pendingReports.splice(i, 1); }
  }
  const wanted = G.wanted || 0;
  const desired = wanted > 0 ? Math.min(4, wanted + 1) : 0;
  let activeCount = 0;
  for (const car of cops) if (car.active && !car.jacked) activeCount += 1;
  for (let i = 0; i < cops.length && activeCount < desired; i += 1) {
    if (cops[i].active || cops[i].jacked || cops[i].disabled) continue;
    spawnCop(cops[i], targetPos, i); activeCount += 1;
  }
  if (activeCount > desired) { // extra units peel off, farthest first
    const active = cops.filter((c) => c.active && !c.jacked)
      .sort((a, b) => dist2D(b.pos, targetPos) - dist2D(a.pos, targetPos));
    for (let i = 0; i < active.length - desired; i += 1) {
      active[i].active = false; active[i].mesh.visible = false; active[i].speed = 0;
    }
  }
  for (const car of cops) { // disabled wrecks get towed once heat dies
    if (!car.disabled) continue;
    car.disabledT += dt;
    if (car.disabledT > 20 && wanted === 0) { car.disabled = false; car.health = 100; }
  }
  for (let i = 0; i < cops.length; i += 1) if (cops[i].active && !cops[i].jacked) updateCopCar(cops[i], dt, targetPos, i);
  for (const o of officers) updateOfficer(o, dt, targetPos);
  for (const o of officers) clampOfficerDistance(o, targetPos);
  updateHelicopter(dt, targetPos);
  // Line of sight is generous for cars, tighter for foot pursuit.
  let contact = false; let nearest = Infinity;
  for (const car of cops) {
    if (!car.active || car.jacked) continue;
    const d = dist2D(car.pos, targetPos);
    if (d < nearest) nearest = d;
    if (d <= 70) contact = true;
  }
  for (const o of officers) {
    if (o.mode !== 'chase') continue;
    const d = dist2D(o.pos, targetPos);
    if (d < nearest) nearest = d;
    if (d <= 40) contact = true;
  }
  if (wanted > 0) {
    if (contact) G.losTimer = 0;
    else {
      G.losTimer = (G.losTimer || 0) + dt;
      if (G.losTimer > TUNING.wantedDecaySeconds) { G.wanted = Math.max(0, wanted - 1); G.losTimer = 0; }
    }
    if (nearest <= TUNING.bustRadius && Math.abs(targetSpeed || 0) < 2.2) G.bust = (G.bust || 0) + dt / TUNING.bustSeconds;
    else G.bust = Math.max(0, (G.bust || 0) - 0.3 * dt);
    if (G.bust >= 1) { G.bust = 0; if (typeof onBusted === 'function') onBusted(); }
  } else G.bust = Math.max(0, (G.bust || 0) - 0.3 * dt);
  sfx.siren(dt, wanted > 0);
}
