// The wanted system: 0–5 stars, a pooled squad of police cars that chase
// along the street grid, uniformed officers on foot (boulevard patrols,
// prison posts, and car crews who get out and chase), line-of-sight decay,
// a bust meter, and a spotlight helicopter at high heat.
//
// REPORTING (Stage 2.7): crimes no longer raise the stars the instant they
// happen — somebody has to report them first. A crime with a witness (any
// pedestrian or officer within 26 units) is phoned in after ~1.2 s; loud
// crimes (gunfire, explosions) are heard from much further and reported
// after ~0.8 s; a victim reports their own carjacking after ~0.8 s; alarms
// and victims report jewelry robberies, debtor hits and marked-car thefts
// after ~0.9 s. A crime nobody sees or hears in an empty area is never
// reported and never raises wanted. While units are already engaged (an
// active car or a chasing officer within 65 units) every further crime is
// seen by them and applies instantly, as does the scripted police chase.
//
// RESPONSE: cars spawn ON the street grid and route along it (nearest
// intersection → the target's cross street → final approach), so a response
// visibly arrives through the streets instead of cutting across blocks.
// A car that makes no progress for 3 s while still far away is repositioned
// to another street — another unit arriving, never a visible pop-in on top
// of the player. When a car stops within five units of a wanted player on
// foot, its officer gets out and chases on foot; the existing bust rule
// (a unit within nine units while the player is barely moving) does the
// rest, now counting foot officers as units too.
import { G } from './state.js';
import { TUNING, ROADS, ROAD_W } from './config.js';
import { makeCar, makePerson, posePerson, collideBuildings, clampWorld, groundHeightFor } from './city.js';
import { peds } from './pedestrians.js';
import { sfx } from './audio.js';

export const cops = []; // {mesh, pos, angle, speed, active, jacked, ...}
export const officers = []; // {mesh, pos, mode, beat, post, car, crew, ...}
export const jackedCars = []; // cop cars the player has taken — now parked stealables
export const heliCfg = { height: 20, radius: 22 };
let heli = null, heliAngle = 0;
let sceneRef = null;
let playerRef = null; // last target position updatePolice saw (≈ crime scene)
const pending = []; // {stars, t} — reports phoned in, not yet dispatched

const PRISON_GATE = { x: -168, z: -234 }; // mirrors PRISON.gate in facilities.js
const POLICE_STATION = { x: -68, z: -68 }; // mirrors config.js

function nearestRoad(v) {
  let best = ROADS[0];
  for (const r of ROADS) if (Math.abs(r - v) < Math.abs(best - v)) best = r;
  return best;
}

// Move an entity toward a point with building collision; on a building hit
// it retries axis-separated, which slides it along the face instead of
// wedging into it. Returns the remaining distance.
function slideMove(ent, tx, tz, speed, dt, radius) {
  const dx = tx - ent.pos.x, dz = tz - ent.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05 || speed <= 0) return d;
  const s = Math.min(d, speed * dt), ux = dx / d, uz = dz / d;
  const ox = ent.pos.x, oz = ent.pos.z;
  ent.pos.x = ox + ux * s; ent.pos.z = oz + uz * s;
  if (collideBuildings(ent.pos, radius).building) {
    ent.pos.x = ox + ux * s; ent.pos.z = oz;
    if (collideBuildings(ent.pos, radius).building) {
      ent.pos.x = ox; ent.pos.z = oz + uz * s;
      if (collideBuildings(ent.pos, radius).building) { ent.pos.x = ox; ent.pos.z = oz; collideBuildings(ent.pos, radius); }
    }
  }
  return Math.hypot(tx - ent.pos.x, tz - ent.pos.z);
}

function makeCopCar() {
  const mesh = makeCar(0xffffff, { lightbar: true, cabColor: 0x273c75 });
  mesh.visible = false;
  return { mesh, pos: mesh.position, angle: 0, speed: 0, active: false, jacked: false, taken: false, kind: 'police', name: 'police car', health: 100, surfMode: null, surfY: 0, stallT: 0, lastDist: 1e9, crewOut: false, crewWait: 0 };
}

const OFFICER_SKINS = [0xf1c27d, 0xe0ac69, 0x8d5524, 0xffdbac];
function makeOfficer(i) {
  // Navy uniform + navy cap + stern face: readable as police at a glance,
  // distinct from every civilian shirt in the ped pool.
  const mesh = makePerson(0x273c75, 0x20293d, OFFICER_SKINS[i % OFFICER_SKINS.length],
    { hairStyle: 'cap', hairColor: 0x1b2a4a, face: 'stern', shoeColor: 0x14181f });
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.16, 0.52),
    new THREE.MeshLambertMaterial({ color: 0x9fd8ff }));
  stripe.position.y = 0.62;
  mesh.userData.upper.add(stripe); // pale chest stripe across the uniform
  return { mesh, pos: mesh.position, surfMode: null, surfY: 0, swing: Math.random() * 6, mode: 'patrol', beat: null, post: null, postDir: 1, car: null, crew: false, homePos: null };
}

export function buildPolice(scene) {
  sceneRef = scene;
  for (let i = 0; i < 4; i++) {
    const c = makeCopCar();
    scene.add(c.mesh);
    cops.push(c);
  }
  // Six foot officers: two walking the Palm Boulevard beats (both sidewalks
  // of the z=0 spine the facilities front), one on the station road, two
  // posted at the prison gate, and one crew reserve who rides in a car
  // until it stops near a wanted player (a second crew seat reuses the
  // reserve only — the pool never exceeds six foot officers).
  const defs = [
    { mode: 'patrol', beat: { axis: 'x', line: 0, side: 1, t: -60, dir: 1 } },
    { mode: 'patrol', beat: { axis: 'x', line: 0, side: -1, t: 90, dir: -1 } },
    { mode: 'patrol', beat: { axis: 'z', line: -75, side: 1, t: -40, dir: 1 } },
    { mode: 'post', post: { x: PRISON_GATE.x - 6, z: PRISON_GATE.z } },
    { mode: 'post', post: { x: PRISON_GATE.x + 6, z: PRISON_GATE.z } },
    { mode: 'reserve' },
  ];
  defs.forEach((d, i) => {
    const o = makeOfficer(i);
    o.mode = d.mode;
    o.beat = d.beat || null;
    o.post = d.post || null;
    if (o.mode === 'reserve') o.mesh.visible = false;
    else if (o.beat) {
      const off = o.beat.side * (ROAD_W / 2 + 2.5);
      if (o.beat.axis === 'x') o.pos.set(o.beat.t, 0.3, o.beat.line + off);
      else o.pos.set(o.beat.line + off, 0.3, o.beat.t);
    } else if (o.post) o.pos.set(o.post.x, 0.3, o.post.z);
    scene.add(o.mesh);
    officers.push(o);
  });
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

// ---- Reporting -------------------------------------------------------------
const LOUD = { 'Shots fired': 70, 'Sniper fire': 55, 'Vehicle explosion': 85 };
const ALARM = new Set(['Jewelry robbery', 'Debtor taken out', 'Marked car stolen']);
const INSTANT = new Set(['Police chase']); // the police are already right there

function witnessed(pos, r) {
  const r2 = r * r;
  for (const p of peds) {
    const dx = p.mesh.position.x - pos.x, dz = p.mesh.position.z - pos.z;
    if (dx * dx + dz * dz < r2) return true;
  }
  for (const o of officers) {
    if (o.mode === 'reserve') continue;
    const dx = o.pos.x - pos.x, dz = o.pos.z - pos.z;
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}
function engaged(pos) {
  if (!pos || G.wanted <= 0) return false;
  for (const c of cops) if (c.active && !c.jacked && c.pos.distanceTo(pos) < 65) return true;
  for (const o of officers) if (o.mode === 'chase' && o.pos.distanceTo(pos) < 65) return true;
  return false;
}
function applyStars(stars) {
  G.wanted = Math.min(5, Math.max(G.wanted, stars));
  G.losTimer = 0;
}

export function commitCrime(stars, label, opts = {}) {
  if (G.mode !== 'playing') return;
  const pos = opts.pos || playerRef;
  if (opts.instant || INSTANT.has(label) || engaged(pos)) { applyStars(stars); return; }
  let delay = -1;
  if (opts.victim || ALARM.has(label)) delay = 0.9; // the victim / the alarm phones it in
  else if (LOUD[label]) { if (pos && witnessed(pos, LOUD[label])) delay = 0.8; }
  else if (pos && witnessed(pos, 26)) delay = 1.2;
  if (delay < 0) return; // nobody saw or heard it — it never reaches dispatch
  if (pending.length < 8) pending.push({ stars, t: delay });
}
export function addWanted(n) { G.wanted = Math.min(5, G.wanted + n); G.losTimer = 0; }

// ---- Cop cars ----------------------------------------------------------------
function spawnCop(c, targetPos, i) {
  c.active = true; c.mesh.visible = true;
  c.surfMode = null; c.stallT = 0; c.lastDist = 1e9; c.crewWait = 0;
  const a = (i / 4) * Math.PI * 2 + G.time;
  let x = targetPos.x + Math.cos(a) * 55, z = targetPos.z + Math.sin(a) * 55;
  if (Math.abs(targetPos.x) < 190 && Math.abs(targetPos.z) < 190) {
    // Inside the city, units arrive along streets: snap the spawn to the
    // grid (nearest intersection when it is close, else the nearest road).
    const rx = nearestRoad(x), rz = nearestRoad(z);
    if (Math.hypot(rx - x, rz - z) < 40) { x = rx; z = rz; }
    else if (Math.abs(rx - x) < Math.abs(rz - z)) x = rx; else z = rz;
  }
  c.pos.set(x, 0, z);
  clampWorld(c.pos);
  collideBuildings(c.pos, 1.6);
}

// Next street waypoint for a car converging on the target: ride the road
// the car is on to the target's cross street, then the intersection
// nearest the target, then (inside 22 units) straight at the target.
function routePoint(c, targetPos) {
  const dx = targetPos.x - c.pos.x, dz = targetPos.z - c.pos.z;
  const inCity = Math.abs(targetPos.x) < 185 && Math.abs(targetPos.z) < 185 && Math.abs(c.pos.x) < 195 && Math.abs(c.pos.z) < 195;
  if (Math.hypot(dx, dz) < 22 || !inCity) return targetPos;
  const rx = nearestRoad(c.pos.x), rz = nearestRoad(c.pos.z);
  const tx = nearestRoad(targetPos.x), tz = nearestRoad(targetPos.z);
  const onV = Math.abs(c.pos.x - rx) < 8.5, onH = Math.abs(c.pos.z - rz) < 8.5;
  if (onV && onH) return Math.abs(tx - rx) > Math.abs(tz - rz) ? { x: tx, z: rz } : { x: rx, z: tz };
  if (!onV && !onH) return { x: rx, z: rz };
  if (onV && Math.abs(c.pos.z - tz) > 6) return { x: rx, z: tz };
  if (onH && Math.abs(c.pos.x - tx) > 6) return { x: tx, z: rz };
  return { x: tx, z: tz };
}

// ---- Foot officers -----------------------------------------------------------
function walkBeat(o, dt) {
  const b = o.beat;
  b.t += 1.9 * b.dir * dt;
  if (b.t > 185) b.dir = -1;
  if (b.t < -185) b.dir = 1;
  const off = b.side * (ROAD_W / 2 + 2.5);
  if (b.axis === 'x') { o.pos.x = b.t; o.pos.z = b.line + off; o.mesh.rotation.y = b.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
  else { o.pos.x = b.line + off; o.pos.z = b.t; o.mesh.rotation.y = b.dir > 0 ? 0 : Math.PI; }
  collideBuildings(o.pos, 0.45);
  o.pos.y = groundHeightFor(o, o.pos.x, o.pos.z, null) + 0.3;
  o.swing += dt * 4.4;
  posePerson(o.mesh, o.swing, 0.55, 0.5, 0.05, G.time * 2);
}
function pacePost(o, dt) {
  const tx = o.post.x + o.postDir * 5, tz = o.post.z;
  if (slideMove(o, tx, tz, 1.7, dt, 0.45) < 0.4) o.postDir *= -1;
  o.mesh.rotation.y = Math.atan2(tx - o.pos.x, tz - o.pos.z);
  o.pos.y = groundHeightFor(o, o.pos.x, o.pos.z, null) + 0.3;
  o.swing += dt * 4;
  posePerson(o.mesh, o.swing, 0.5, 0.45, 0.03, G.time * 2);
}
function homeFor(o) {
  if (o.car && !o.car.jacked) return o.car.pos;
  if (o.homePos) return o.homePos;
  if (o.post) return o.post;
  if (o.beat) {
    const off = o.beat.side * (ROAD_W / 2 + 2.5);
    return o.beat.axis === 'x' ? { x: o.pos.x, z: o.beat.line + off } : { x: o.beat.line + off, z: o.pos.z };
  }
  return POLICE_STATION;
}
function placeOfficerAt(o, x, z) {
  o.pos.set(x, 0, z);
  o.surfMode = null;
  o.pos.y = groundHeightFor(o, o.pos.x, o.pos.z, null) + 0.3;
  o.mesh.visible = true;
}

// The nearest active cop car whose driver's door the player is standing at
// (within 4.6 units, on the driver's side) — the carjackable police car.
export function jackableCop(pos) {
  for (const c of cops) {
    if (!c.active || c.jacked) continue;
    if (c.pos.distanceTo(pos) >= 4.6) continue;
    const fx = Math.sin(c.angle), fz = Math.cos(c.angle);
    const side = (pos.x - c.pos.x) * fz - (pos.z - c.pos.z) * fx;
    if (side > 0) return c;
  }
  return null;
}

// The player rips a cop out of his car: the officer becomes a foot chaser,
// the car leaves the squad (it is the player's now, a parked stealable
// once abandoned), and a replacement unit joins the pool.
export function onCopJacked(cop) {
  cop.jacked = true; cop.active = false; cop.crewOut = false; cop.crewWait = 0;
  cop.mesh.visible = true;
  const fx = Math.sin(cop.angle), fz = Math.cos(cop.angle);
  const o = officers.find((x) => x.mode === 'reserve') || officers.find((x) => x.mode === 'patrol');
  if (o) {
    const wasReserve = o.mode === 'reserve';
    o.crew = wasReserve;
    o.car = null;
    o.homePos = wasReserve ? { x: cop.pos.x, z: cop.pos.z } : null;
    o.mode = 'chase';
    placeOfficerAt(o, cop.pos.x + fz * 2.2 + fx * 0.5, cop.pos.z - fx * 2.2 + fz * 0.5);
  }
  jackedCars.push(cop);
  if (sceneRef) {
    const c = makeCopCar();
    sceneRef.add(c.mesh);
    cops.push(c);
  }
}

function updateOfficers(dt, targetPos) {
  let nearest = 1e9, anyLOS = false;
  for (const o of officers) {
    if (o.mode === 'reserve') continue;
    const d = Math.hypot(targetPos.x - o.pos.x, targetPos.z - o.pos.z);
    if (o.mode === 'patrol' || o.mode === 'post') {
      if (G.wanted > 0 && d < (o.mode === 'post' ? 26 : 34)) o.mode = 'chase';
      else if (o.mode === 'patrol') walkBeat(o, dt);
      else pacePost(o, dt);
    }
    if (o.mode === 'chase') {
      // Give up when the heat is gone, the player is long gone, or the
      // player drives off — an officer on foot does not chase a car.
      if (G.wanted === 0 || d > 62 || (G.driving && d > 13)) { o.mode = 'return'; }
      else {
        slideMove(o, targetPos.x, targetPos.z, 10.6, dt, 0.45);
        o.mesh.rotation.y = Math.atan2(targetPos.x - o.pos.x, targetPos.z - o.pos.z);
        o.pos.y = groundHeightFor(o, o.pos.x, o.pos.z, null) + 0.3;
        o.swing += dt * 21;
        posePerson(o.mesh, o.swing, 0.95, 0.95, 0.2, G.time * 2);
        nearest = Math.min(nearest, d);
        if (d < 45) anyLOS = true;
      }
    } else if (o.mode === 'return') {
      const home = homeFor(o);
      const hd = slideMove(o, home.x, home.z, 8, dt, 0.45);
      o.mesh.rotation.y = Math.atan2(home.x - o.pos.x, home.z - o.pos.z);
      o.pos.y = groundHeightFor(o, o.pos.x, o.pos.z, null) + 0.3;
      o.swing += dt * 17;
      posePerson(o.mesh, o.swing, 0.9, 0.9, 0.18, G.time * 2);
      if (hd < 1.6) {
        if (o.crew) {
          o.mode = 'reserve'; o.crew = false; o.mesh.visible = false;
          if (o.car) o.car.crewOut = false;
          o.car = null; o.homePos = null;
        } else {
          if (o.beat) o.beat.t = o.beat.axis === 'x' ? o.pos.x : o.pos.z;
          o.mode = o.post ? 'post' : 'patrol';
        }
      }
    }
  }
  return { nearest, anyLOS };
}

export function updatePolice(dt, targetPos, targetSpeed, onBusted) {
  playerRef = targetPos;
  for (let i = pending.length - 1; i >= 0; i--) {
    pending[i].t -= dt;
    if (pending[i].t <= 0) { applyStars(pending[i].stars); pending.splice(i, 1); }
  }
  const want = G.wanted;
  let nearest = 1e9, anyLOS = false;
  let rank = 0;
  for (const c of cops) {
    if (c.jacked) continue; // the player's car now — the squad ignores it
    const should = want > 0 && rank < Math.min(4, want + 1);
    rank++;
    if (should && !c.active) spawnCop(c, targetPos, rank);
    if (!should) { c.active = false; c.mesh.visible = false; continue; }
    const dx = targetPos.x - c.pos.x, dz = targetPos.z - c.pos.z;
    const dist = Math.hypot(dx, dz);
    nearest = Math.min(nearest, dist);
    if (dist < 70) anyLOS = true;
    if (dist < c.lastDist - 1) { c.lastDist = dist; c.stallT = 0; } else c.stallT += dt;
    if (c.stallT > 3 && dist > 42) spawnCop(c, targetPos, rank); // another unit arrives by another street
    const wp = routePoint(c, targetPos);
    const speed = dist > 5 ? Math.min(30, 16 + want * 2.6) : 0;
    if (speed > 0) {
      slideMove(c, wp.x, wp.z, speed, dt, 1.6);
      c.angle = Math.atan2(wp.x - c.pos.x, wp.z - c.pos.z);
    }
    c.mesh.position.y = groundHeightFor(c, c.pos.x, c.pos.z, null);
    c.mesh.rotation.y = c.angle;
    if (c.mesh.userData.lightbar) {
      c.mesh.userData.lightbar.material.color.setHex(Math.floor(G.time * 6) % 2 ? 0xff0000 : 0x0066ff);
    }
    for (const w of c.mesh.userData.wheels) w.rotation.x += speed * dt * 2;
    // Stopped at the player's feet with the player on foot: the officer
    // gets out and finishes the arrest on foot.
    if (!G.driving && want > 0 && dist <= 5.2 && !c.crewOut) {
      c.crewWait += dt;
      if (c.crewWait > 0.7) {
        const o = officers.find((x) => x.mode === 'reserve');
        if (o) {
          c.crewOut = true;
          o.crew = true; o.car = c; o.homePos = null; o.mode = 'chase';
          placeOfficerAt(o, c.pos.x + 2.2, c.pos.z + 1);
        }
      }
    } else c.crewWait = 0;
  }
  const off = updateOfficers(dt, targetPos);
  nearest = Math.min(nearest, off.nearest);
  anyLOS = anyLOS || off.anyLOS;
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

export function policePositions() {
  const out = cops.filter((c) => c.active).map((c) => c.pos);
  for (const o of officers) if (o.mode === 'chase') out.push(o.pos);
  return out;
}
export function setHeliAngle(a) { heliAngle = a; }
export function heliVisible() { return !!(heli && heli.visible); }
