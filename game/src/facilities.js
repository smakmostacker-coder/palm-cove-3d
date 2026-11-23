// Facilities: the working buildings of Palm Cove, in two kinds.
//
// MENU FACILITIES open a shop panel at the door: COVE MART minimarket
// (food), APOTIK SEHAT pharmacy (healing), MARLIN ARMS gun shop (AMMO ONLY —
// weapons are found in the world, never sold), SOLANO GAS, and the prison,
// PALM COVE CORRECTIONAL, which replaces the plain busted respawn: serve a
// short timed stay in the yard or pay bail.
//
// WALK-IN INTERIORS are real rooms you step into: two houses/apartments, the
// PALM KITCHEN restaurant (buy a meal at the counter), MARLIN & CO. JEWELS
// (browse — or smash a case and take the robbery heat), the COVE BANK lobby
// (a working ATM with a small vault account), and the lead's own HOME in
// Coral Heights: bedroom, bathroom, living room and kitchen, the bed the
// New Game wake-up starts in, and sleep = save afterwards.
//
// Interior trick: each room is a roofless dollhouse set built far off-map;
// entering teleports the player in and swaps the collision set to the
// room's own walls and furniture (city.setRoomColliders), leaving restores
// both. From the gameplay camera the room reads as a furnished interior.
import { G } from './state.js';
import { colliders, setRoomColliders } from './city.js';
import { addItem, ITEM_DEFS } from './inventory.js';
import { commitCrime } from './police.js';
import { sfx } from './audio.js';
import { saveGame } from './save.js';

function signTex(text, fg, bg) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 64);
  g.font = '900 26px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = fg; g.shadowBlur = 12; g.fillStyle = fg;
  g.fillText(text, 128, 32);
  return new THREE.CanvasTexture(c);
}
const mat = (c) => new THREE.MeshLambertMaterial({ color: c });

export const PRISON = { x: -168, z: -262, hw: 30, hd: 24, gate: { x: -168, z: -236 } };
export const FACILITIES = [
  { id: 'mart', name: 'COVE MART 24H', x: 30, z: 88, color: 0x27ae60, sign: '#7ef0d4', shop: [{ item: 'snack', price: 15 }, { item: 'cola', price: 8 }] },
  { id: 'apotik', name: 'APOTIK SEHAT', x: 88, z: -34, color: 0xf5f6fa, sign: '#2ed573', shop: [{ item: 'medkit', price: 60 }, { item: 'snack', price: 20 }] },
  { id: 'arms', name: 'MARLIN ARMS', x: -34, z: -88, color: 0x57606f, sign: '#ffd32a', shop: [{ item: 'ammo', price: 40 }, { item: 'armour', price: 120 }] },
  { id: 'gas', name: 'SOLANO GAS', x: 152, z: 34, color: 0xe67e22, sign: '#ffe9a8', shop: [{ item: 'cola', price: 8 }] },
  { id: 'bank', name: 'COVE BANK · ATM', x: -18, z: 20, color: 0x8e9aaf, sign: '#ffffff', shop: [] },
];
// The lead's home: a Coral Heights house, a short walk from spawn.
export const HOME = { x: 118, z: -48 };

function clearPlot(x, z, r) {
  for (let ci = colliders.length - 1; ci >= 0; ci--) {
    if (Math.hypot(colliders[ci].x - x, colliders[ci].z - z) < r) colliders.splice(ci, 1);
  }
}
function exterior(scene, x, z, w, h, d, color, label, fg) {
  clearPlot(x, z, 16);
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  b.position.set(x, h / 2, z); scene.add(b);
  colliders.push({ x, z, hw: w / 2, hd: d / 2 });
  const s = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.85, 3.2), new THREE.MeshBasicMaterial({ map: signTex(label, fg, '#14101f'), side: THREE.DoubleSide }));
  s.position.set(x, h - 1.2, z + d / 2 + 0.2); scene.add(s);
  return { x, z: z + d / 2 + 2.2 };
}

// ---- Walk-in rooms ---------------------------------------------------------
const ROOM_BASE = { x: 1500, z: 1500 };
let roomSeq = 0;
function makeRoom(scene, w, d, floorColor, wallColor) {
  const cx = ROOM_BASE.x + roomSeq * 120, cz = ROOM_BASE.z;
  roomSeq++;
  const room = { cx, cz, w, d, colliders: [], doorIn: { x: cx, z: cz + d / 2 - 1.1 }, spawn: { x: cx, z: cz + d / 2 - 4 } };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(floorColor));
  floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0.02, cz); scene.add(floor);
  const wall = (x, z, ww, dd) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(ww, 3.4, dd), mat(wallColor));
    m.position.set(x, 1.7, z); scene.add(m);
    room.colliders.push({ x, z, hw: ww / 2, hd: dd / 2 });
  };
  wall(cx, cz - d / 2, w, 0.4);                       // north
  wall(cx - w / 2, cz, 0.4, d);                       // west
  wall(cx + w / 2, cz, 0.4, d);                       // east
  const segW = (w - 3.4) / 2;                          // south, with a door gap
  wall(cx - (1.7 + segW / 2), cz + d / 2, segW, 0.4);
  wall(cx + (1.7 + segW / 2), cz + d / 2, segW, 0.4);
  room.wall = wall;
  room.furn = (lx, lz, ww, hh, dd, color, solid = true, yBase = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(ww, hh, dd), mat(color));
    m.position.set(cx + lx, yBase + hh / 2, cz + lz);
    scene.add(m);
    if (solid) room.colliders.push({ x: cx + lx, z: cz + lz, hw: ww / 2, hd: dd / 2 });
    return m;
  };
  room.sign = (lx, lz, text, fg, wdt = 9) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(wdt, 2.2), new THREE.MeshBasicMaterial({ map: signTex(text, fg, '#14101f'), side: THREE.DoubleSide }));
    s.position.set(cx + lx, 2.6, cz + lz); scene.add(s);
    return s;
  };
  return room;
}

export const ENTERABLES = []; // {id, name, kind, door:{x,z}, room, ...}
function enterable(scene, def, ext, room) {
  const e = { ...def, door: ext, room, returnPos: null };
  ENTERABLES.push(e);
  return e;
}

let homeEnt = null, homeBed = null, homeStand = null;

export function buildFacilities(scene) {
  for (const f of FACILITIES) {
    f.door = exterior(scene, f.x, f.z, 16, 8, 12, f.color, f.name, f.sign);
  }
  buildInteriors(scene);
  buildPrison(scene);
}

function buildPrison(scene) {
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(PRISON.hw * 2, PRISON.hd * 2), mat(0x9a8f7a));
  yard.rotation.x = -Math.PI / 2; yard.position.set(PRISON.x, 0.02, PRISON.z); scene.add(yard);
  const cells = new THREE.Mesh(new THREE.BoxGeometry(34, 9, 10), mat(0x8e9aaf));
  cells.position.set(PRISON.x, 4.5, PRISON.z - PRISON.hd + 6); scene.add(cells);
  colliders.push({ x: PRISON.x, z: PRISON.z - PRISON.hd + 6, hw: 17, hd: 5 });
  const cs = new THREE.Mesh(new THREE.PlaneGeometry(26, 3.4), new THREE.MeshBasicMaterial({ map: signTex('PALM COVE CORRECTIONAL', '#ffd32a', '#14101f'), side: THREE.DoubleSide }));
  cs.position.set(PRISON.x, 8.4, PRISON.z - PRISON.hd + 11.4); scene.add(cs);
  const fenceMat = mat(0x636e72);
  for (const [w, d, x, z] of [[PRISON.hw * 2, 0.4, PRISON.x, PRISON.z - PRISON.hd], [PRISON.hw * 2, 0.4, PRISON.x, PRISON.z + PRISON.hd], [0.4, PRISON.hd * 2, PRISON.x - PRISON.hw, PRISON.z], [0.4, PRISON.hd * 2, PRISON.x + PRISON.hw, PRISON.z]]) {
    const f2 = new THREE.Mesh(new THREE.BoxGeometry(w, 3.4, d), fenceMat);
    f2.position.set(x, 1.7, z); scene.add(f2);
  }
  const tower = new THREE.Mesh(new THREE.BoxGeometry(3, 11, 3), mat(0x57606f));
  tower.position.set(PRISON.x + PRISON.hw - 3, 5.5, PRISON.z - PRISON.hd + 3); scene.add(tower);
  colliders.push({ x: PRISON.x + PRISON.hw - 3, z: PRISON.z - PRISON.hd + 3, hw: 1.6, hd: 1.6 });
}

function buildInteriors(scene) {
  // Two rentable houses: sofa, TV, a bed, a table — lived-in, simply.
  const houseDefs = [
    { id: 'house1', name: 'MAPLE HOUSE', x: 152, z: -128, color: 0xffe8c8 },
    { id: 'house2', name: 'PALMETTO APARTMENTS', x: -128, z: -158, color: 0xd98c68 },
  ];
  for (const hd of houseDefs) {
    const door = exterior(scene, hd.x, hd.z, 14, 6, 11, hd.color, hd.name, '#7ef0d4');
    const room = makeRoom(scene, 20, 15, 0xb08968, 0xe6ddcb);
    room.furn(-6, -4, 4.4, 0.9, 2, 0x7f5539);            // sofa
    room.furn(-6, -0.5, 3.4, 1.6, 0.4, 0x14161c);        // TV
    room.furn(6, -4.5, 3, 0.8, 4.6, 0xf5f6fa);          // bed
    room.furn(6, -4.5, 3.2, 0.25, 4.8, 0xff5da2, false, 0.8); // blanket
    room.furn(5.5, 3.5, 3.4, 0.9, 2, 0x8d6e63);         // table
    room.furn(-5, 4.5, 2.6, 2, 0.8, 0x57606f);          // wardrobe
    room.sign(0, -7.2, hd.name, '#ffd32a');
    enterable(scene, { id: hd.id, name: hd.name, kind: 'house' }, door, room);
  }
  { // PALM KITCHEN restaurant: tables and chairs, a counter to order at.
    const door = exterior(scene, -52, 118, 16, 7, 12, 0xe67e22, 'PALM KITCHEN', '#ffe9a8');
    const room = makeRoom(scene, 22, 16, 0x9c6644, 0xf5e6d3);
    for (const [tx, tz] of [[-6, -3], [0, -3.5], [6, -3], [-3, 2.5], [3.5, 2.5]]) {
      room.furn(tx, tz, 2.2, 0.85, 2.2, 0xf5f6fa);      // table
      room.furn(tx - 1.7, tz, 0.6, 1, 0.6, 0xd63031);   // chair
      room.furn(tx + 1.7, tz, 0.6, 1, 0.6, 0xd63031);   // chair
    }
    const counter = room.furn(0, -6.8, 12, 1.15, 1.2, 0x7f5539);
    room.sign(0, -7.6, 'PALM KITCHEN · MEALS $18', '#ffd32a', 12);
    const e = enterable(scene, { id: 'food', name: 'PALM KITCHEN', kind: 'food' }, door, room);
    e.counter = { x: counter.position.x, z: counter.position.z };
  }
  { // MARLIN & CO. JEWELS: three glass cases with something shiny inside.
    const door = exterior(scene, 24, -28, 15, 7, 11, 0x273c75, 'MARLIN & CO. JEWELS', '#7ef0d4');
    const room = makeRoom(scene, 20, 14, 0x2f3542, 0xdfe6e9);
    const cases = [];
    for (const cx of [-5.5, 0, 5.5]) {
      room.furn(cx, -2.5, 3.4, 0.9, 1.4, 0x8e9aaf);
      const gem = room.furn(cx, -2.5, 0.7, 0.5, 0.7, 0xffd32a, false, 1);
      cases.push({ x: room.cx + cx, z: room.cz - 2.5, gem, smashed: false });
    }
    room.furn(0, -6.2, 8, 1.1, 1.1, 0x57606f);          // register counter
    room.sign(0, -6.7, 'MARLIN & CO. · FINE JEWELS', '#7ef0d4', 12);
    const e = enterable(scene, { id: 'jewels', name: 'MARLIN & CO. JEWELS', kind: 'jewels' }, door, room);
    e.cases = cases;
    e.register = { x: room.cx, z: room.cz - 6.2 };
  }
  { // COVE BANK lobby: counter row, a vault door, and the ATM — now inside.
    const bankFac = FACILITIES.find((f) => f.id === 'bank');
    const room = makeRoom(scene, 22, 15, 0xb8a89a, 0x8e9aaf);
    room.furn(0, -5.5, 13, 1.15, 1.2, 0x57606f);        // counter row
    room.furn(-8.5, -6, 2.6, 3.2, 0.6, 0x2f3542);       // vault door
    const atm = room.furn(8.6, -6.4, 1.4, 2, 0.7, 0x273c75);
    room.furn(-5, 2, 3.6, 0.8, 1.6, 0x7f5539);          // waiting bench
    room.furn(5, 2, 3.6, 0.8, 1.6, 0x7f5539);
    room.sign(0, -7.2, 'COVE BANK · LOBBY', '#ffffff', 12);
    const e = enterable(scene, { id: 'bankin', name: 'COVE BANK', kind: 'bank' }, bankFac.door, room);
    e.atm = { x: atm.position.x, z: atm.position.z };
  }
  { // THE HOME: one room plan, four lived spaces, partitions with door gaps.
    const door = exterior(scene, HOME.x, HOME.z, 15, 6.5, 12, 0xffd8d8, 'HOME · SOLANO–VEGA', '#ff5da2');
    const room = makeRoom(scene, 28, 20, 0xc9a06a, 0xf5e6d3);
    // Partitions: a horizontal wall with two gaps, a short bathroom wall.
    room.wall(room.cx - 7.5, room.cz - 1, 11, 0.35);
    room.wall(room.cx + 8.5, room.cz - 1, 9, 0.35);
    room.wall(room.cx + 4.5, room.cz - 5.5, 0.35, 9);
    // Bedroom (north-west): bed, wardrobe, lamp.
    const bed = room.furn(-9.5, -6.5, 3.2, 0.8, 5, 0xf5f6fa);
    room.furn(-9.5, -6.5, 3.4, 0.25, 5.2, 0xff5da2, false, 0.8); // blanket
    room.furn(-12.5, -3.5, 1, 0.5, 1, 0xffd32a);                  // lamp table
    room.furn(-4.5, -8.5, 3.4, 2.2, 0.9, 0x7f5539);               // wardrobe
    // Bathroom (north-east): shower, toilet, sink, mirror.
    room.furn(11, -8, 3, 2.2, 2.6, 0xa0e8dd);                     // shower stall
    room.furn(6.2, -8.6, 1.1, 0.9, 1.1, 0xf5f6fa);                // toilet
    room.furn(9, -9.2, 2.2, 0.95, 0.8, 0xdfe6e9);                 // sink
    const mirror = room.furn(9, -9.75, 1.8, 1.4, 0.1, 0x7ef0d4, false, 1.1);
    mirror.material = new THREE.MeshBasicMaterial({ color: 0xbfefff });
    // Living room (south-west): sofa facing a TV, rug.
    room.furn(-9, 5.5, 5, 0.95, 2.1, 0x2ec4b6);                   // sofa
    room.furn(-9, 1.8, 3.6, 1.7, 0.4, 0x14161c);                  // TV
    room.furn(-9, 3.8, 4.6, 0.06, 3, 0xe84393, false);            // rug
    // Kitchen (south-east): counters, fridge, table and chairs.
    room.furn(8, 8.8, 9, 1, 1.1, 0x57606f);                       // counter run
    room.furn(12.8, 5, 1.6, 2.3, 1.6, 0xdfe6e9);                  // fridge
    room.furn(7.5, 3.5, 3.2, 0.85, 2, 0x8d6e63);                  // table
    room.furn(5.3, 3.5, 0.6, 1, 0.6, 0xd63031);
    room.furn(9.7, 3.5, 0.6, 1, 0.6, 0xd63031);
    room.sign(0, -9.7, 'HOME SWEET HOME', '#ff5da2', 11);
    homeEnt = enterable(scene, { id: 'home', name: 'HOME', kind: 'home' }, door, room);
    homeBed = { x: bed.position.x, z: bed.position.z };
    homeStand = { x: bed.position.x + 2.6, z: bed.position.z + 0.5 };
    homeEnt.bed = homeBed;
  }
}

// ---- Entering, leaving, and using interiors --------------------------------
G.interior = null; // id of the room the player is inside, or null
let exitHook = null;
export function setInteriorExitHook(fn) { exitHook = fn; }
export function currentInterior() { return ENTERABLES.find((e) => e.id === G.interior) || null; }
export function nearestInterior(pos) {
  for (const e of ENTERABLES) if (Math.hypot(pos.x - e.door.x, pos.z - e.door.z) < 4.2) return e;
  return null;
}
export function enterInterior(e, playerPos) {
  e.returnPos = { x: playerPos.x, z: playerPos.z };
  G.interior = e.id;
  setRoomColliders(e.room.colliders);
  playerPos.set(e.room.spawn.x, 0.3, e.room.spawn.z);
  sfx.enter();
  return e;
}
export function exitInterior(playerPos) {
  const e = currentInterior();
  if (!e) return null;
  G.interior = null;
  setRoomColliders(null);
  if (e.returnPos) playerPos.set(e.returnPos.x, 0.3, e.returnPos.z);
  sfx.enter();
  if (exitHook) exitHook(e.id);
  return e;
}
// Walking into the room's door gap from inside leaves the building.
export function updateInteriors(dt, playerPos, sayFn) {
  const e = currentInterior();
  if (!e) return '';
  if (Math.hypot(playerPos.x - e.room.doorIn.x, playerPos.z - e.room.doorIn.z) < 1.5) {
    exitInterior(playerPos);
    return '';
  }
  // Context prompts for the room's usable spots.
  if (e.kind === 'home' && Math.hypot(playerPos.x - e.bed.x, playerPos.z - e.bed.z) < 3) {
    return 'Press F to sleep — saves the game and skips to morning';
  }
  if (e.kind === 'food' && Math.hypot(playerPos.x - e.counter.x, playerPos.z - e.counter.z) < 3.2) {
    return 'Press F to order a meal — $18, restores 50 health';
  }
  if (e.kind === 'jewels') {
    const c = e.cases.find((k) => !k.smashed && Math.hypot(playerPos.x - k.x, playerPos.z - k.z) < 2.6);
    if (c) return 'Press F to SMASH the case and grab the jewels (+$220, +3★) — or just browse';
    if (Math.hypot(playerPos.x - e.register.x, playerPos.z - e.register.z) < 3) return 'The clerk smiles: "Finest marlin pearls in the Cove."';
  }
  if (e.kind === 'bank' && Math.hypot(playerPos.x - e.atm.x, playerPos.z - e.atm.z) < 2.8) {
    return 'Press F to use the ATM — deposit $50, or withdraw from your vault ($' + (G.bankVault || 0) + ')';
  }
  return 'Walk through the front door to leave';
}

// F inside a room uses whatever the player is standing at. Returns true when
// the action was consumed (so it does not also punch).
export function tryInteriorAction(playerPos, sayFn) {
  const e = currentInterior();
  if (!e) return false;
  const near = (p, r) => Math.hypot(playerPos.x - p.x, playerPos.z - p.z) < r;
  if (e.kind === 'home' && near(e.bed, 3)) {
    saveGame();
    G.time += 480; // the night passes; the world clock moves on
    sfx.success();
    sayFn && sayFn('Home', 'You sleep soundly. Game saved — morning light, a clear head, and Lucia waiting outside.', 5);
    return true;
  }
  if (e.kind === 'food' && near(e.counter, 3.2)) {
    if (G.money < 18) { sfx.fail(); sayFn && sayFn('Palm Kitchen', 'That is $18, friend. The tap water is free.', 3); return true; }
    G.money -= 18;
    G.health = Math.min(100, G.health + 50);
    sfx.cash();
    sayFn && sayFn('Palm Kitchen', 'One Cove special, coming right up. You feel human again. (+50 HP)', 4);
    return true;
  }
  if (e.kind === 'jewels') {
    const c = e.cases.find((k) => !k.smashed && near(k, 2.6));
    if (c) { // smash-and-grab: rides the wanted system and the cash economy
      c.smashed = true;
      c.gem.visible = false;
      G.money += 220;
      sfx.crash();
      commitCrime(Math.max(3, G.wanted), 'Jewelry robbery');
      sayFn && sayFn('Alarm', 'Glass everywhere — jewels grabbed (+$220). The alarm is screaming. RUN!', 4);
      saveGame();
      return true;
    }
    return false;
  }
  if (e.kind === 'bank' && near(e.atm, 2.8)) {
    G.bankVault = G.bankVault || 0;
    if (G.money >= 50) {
      G.money -= 50; G.bankVault += 50;
      sayFn && sayFn('ATM', 'Deposited $50. Vault balance: $' + G.bankVault + '.', 3);
    } else if (G.bankVault > 0) {
      const out = Math.min(50, G.bankVault);
      G.bankVault -= out; G.money += out;
      sayFn && sayFn('ATM', 'Withdrew $' + out + '. Vault balance: $' + G.bankVault + '.', 3);
    } else {
      sfx.fail();
      sayFn && sayFn('ATM', 'Nothing to deposit and an empty vault. Balance: $' + G.money + '.', 3);
      return true;
    }
    sfx.cash();
    saveGame();
    return true;
  }
  return false;
}

// ---- The wake-up opening -----------------------------------------------------
// A New Game puts the chosen lead in their own bed. updateWake runs the
// short rise: lying flat, then sitting up and standing beside the bed while
// control is held; afterwards the player is simply inside their home.
let wake = null; // {t, player}
export function startWakeUp(player) {
  if (!homeEnt) return;
  enterInterior(homeEnt, player.pos);
  player.pos.set(homeBed.x, 0.95, homeBed.z);
  player.mesh.rotation.x = -Math.PI / 2; // asleep, flat on the bed
  wake = { t: 2.6, player };
  G.objective = 'Home — wake up, get your bearings, then head outside.';
}
export function updateWake(dt) {
  if (!wake) return false;
  wake.t -= dt;
  const p = wake.player;
  if (wake.t > 1.5) return true; // still asleep; the camera settles
  const k = Math.max(0, Math.min(1, (1.5 - wake.t) / 1.5)); // 0 lying -> 1 standing
  p.mesh.rotation.x = -Math.PI / 2 * (1 - k);
  p.pos.x = homeBed.x + (homeStand.x - homeBed.x) * k;
  p.pos.z = homeBed.z + (homeStand.z - homeBed.z) * k;
  p.pos.y = 0.95 - 0.65 * k;
  if (wake.t <= 0) {
    p.mesh.rotation.x = 0;
    p.pos.set(homeStand.x, 0.3, homeStand.z);
    wake = null;
  }
  return true;
}
export function cancelWake(player) { // screenshot staging skips the opening
  if (wake) { wake = null; player.mesh.rotation.x = 0; }
  if (G.interior) { G.interior = null; setRoomColliders(null); }
}
export function isWaking() { return !!wake; }

// ---- Menu facilities and the prison -----------------------------------------
export function nearestFacility(pos) {
  for (const f of FACILITIES) {
    if (f.id === 'bank') continue; // the bank is a walk-in interior now
    if (Math.hypot(pos.x - f.door.x, pos.z - f.door.z) < 5) return f;
  }
  return null;
}
export function buyItem(fac, itemId, sayFn) {
  const row = fac.shop.find((r) => r.item === itemId);
  if (!row) return 'Not sold here.';
  if (G.money < row.price) { sfx.fail(); return 'Not enough cash — $' + row.price + ' needed.'; }
  if (!addItem(itemId)) { sfx.fail(); return 'Inventory full — the clerk shakes their head.'; }
  G.money -= row.price;
  sfx.cash();
  saveGame();
  return 'Bought ' + ITEM_DEFS[itemId].name + ' for $' + row.price + '.';
}

G.inPrison = 0;
export function sendToPrison() {
  G.inPrison = 25;
  return { x: PRISON.x, z: PRISON.z + 6 };
}
export function updatePrison(dt, playerPos, sayFn) {
  if (G.inPrison <= 0) return '';
  G.inPrison -= dt;
  playerPos.x = Math.max(PRISON.x - PRISON.hw + 2, Math.min(PRISON.x + PRISON.hw - 2, playerPos.x));
  playerPos.z = Math.max(PRISON.z - PRISON.hd + 2, Math.min(PRISON.z + PRISON.hd - 2, playerPos.z));
  if (G.inPrison <= 0) {
    releasePrison(playerPos);
    sayFn && sayFn('Guard', 'Time served. Gate is open — stay out of trouble.', 4);
    return '';
  }
  const bail = Math.min(200, G.money);
  return 'PRISON — serving ' + Math.ceil(G.inPrison) + 's · press B to pay $' + bail + ' bail';
}
export function payBail(playerPos, sayFn) {
  if (G.inPrison <= 0) return false;
  const bail = Math.min(200, G.money);
  G.money -= bail;
  G.inPrison = 0;
  releasePrison(playerPos);
  sayFn && sayFn('Guard', 'Bail posted: $' + bail + '. You are free to go.', 4);
  saveGame();
  return true;
}
function releasePrison(playerPos) {
  playerPos.set(PRISON.gate.x, 0.3, PRISON.gate.z + 4);
}
