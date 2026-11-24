// facilities.js — doors, off-map interiors, shops, services and prison.
// Interiors sit far off-map so world systems (swim, traffic, minimap) never
// collide with them; entering is a teleport, not a streamed load.

import { G } from './state.js';
import { FACILITIES, PRISON, HOME_DOOR } from './config.js';
import { makePersonMesh, posePerson } from './city.js';
import { say, setPrompt, showBanner, openShop, setObjective } from './hud.js';
import { ITEMS, giveItem, addAmmo } from './inventory.js';
import { saveGame } from './save.js';
import { commitCrime } from './police.js';
import { sfx, radio } from './audio.js';
import { player, placeAt } from './player.js';

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

// Face tells which side of the building the door sits on; the anchor in
// FACILITIES is the building centre, so the door is pushed out by half the
// building depth plus a small step.
const FACE_DIR = {
  n: { x: 0, z: -1 },
  s: { x: 0, z: 1 },
  e: { x: 1, z: 0 },
  w: { x: -1, z: 0 },
};

const DOOR_OUT = 7.5;

export const DOORS = FACILITIES.map((f) => {
  const d = FACE_DIR[f.face] || FACE_DIR.s;
  return { id: f.id, name: f.name, x: f.x + d.x * DOOR_OUT, z: f.z + d.z * DOOR_OUT };
});

const DOOR_BY_ID = new Map(DOORS.map((d) => [d.id, d]));
const FACILITY_BY_ID = new Map(FACILITIES.map((f) => [f.id, f]));

// ---------------------------------------------------------------------------
// Interior registry
// ---------------------------------------------------------------------------

const ROOM_W = 16;
const ROOM_D = 13;
const WALL_H = 2.6;
const ROOM_BASE_X = 4000;
const ROOM_BASE_Z = 4000;
const ROOM_STRIDE = 90;

// Floor tint per facility kind, so a room reads as its type at a glance.
const FLOOR_COLORS = {
  shop: 0x8a7f6a,
  enter: 0x6f7a72,
  service: 0x707a8a,
};

const rooms = new Map(); // id -> room record

function registerRooms() {
  if (rooms.size) return;
  FACILITIES.forEach((f, index) => {
    const cx = ROOM_BASE_X + index * ROOM_STRIDE;
    const cz = ROOM_BASE_Z;
    // Entry gap is on the west (short) side, centred on z; the spawn sits
    // just inside it and the exit point is the same spot.
    const spawnX = cx - ROOM_W / 2 + 1.3;
    const spawnZ = cz;
    const isHome = f.id === 'home';
    rooms.set(f.id, {
      id: f.id,
      facility: f,
      cx,
      cz,
      w: ROOM_W,
      d: ROOM_D,
      spawnX,
      spawnZ,
      // Only home's bed coordinates are load-bearing; other rooms report
      // their centre so callers always get a sane position back.
      bedX: isHome ? cx - 3.4 : cx,
      bedZ: isHome ? cz - ROOM_D / 2 + 1.7 : cz,
      points: [],
      dancers: [],
      keeper: null,
      keeperPhase: Math.random() * 6,
    });
  });
}
registerRooms();

export function interiorSpot(id) {
  const room = rooms.get(id);
  if (!room) return { x: ROOM_BASE_X, z: ROOM_BASE_Z, bedX: ROOM_BASE_X, bedZ: ROOM_BASE_Z };
  // Every entry path (new-game wake-up, door entry) funnels through here,
  // so publish the room rect for the camera to clamp against while indoors.
  G.interiorRect = {
    minX: room.cx - room.w / 2, maxX: room.cx + room.w / 2,
    minZ: room.cz - room.d / 2, maxZ: room.cz + room.d / 2,
    ceilY: WALL_H,
  };
  return { x: room.spawnX, z: room.spawnZ, bedX: room.bedX, bedZ: room.bedZ };
}

function addPoint(room, kind, dx, dz, extra) {
  const point = { kind, x: room.cx + dx, z: room.cz + dz, radius: 1.9, facilityId: room.id };
  if (extra) Object.assign(point, extra);
  room.points.push(point);
  return point;
}

// ---------------------------------------------------------------------------
// Small geometry helpers — boxes and cylinders only, coloured materials.
// ---------------------------------------------------------------------------

function mat(color, opts) {
  const m = new THREE.MeshLambertMaterial({ color });
  if (opts) {
    if (opts.emissive !== undefined) { m.emissive = new THREE.Color(opts.emissive); }
    if (opts.emissiveIntensity !== undefined && 'emissiveIntensity' in m) m.emissiveIntensity = opts.emissiveIntensity;
    if (opts.transparent) { m.transparent = true; m.opacity = opts.opacity ?? 0.45; }
  }
  return m;
}

function addBox(group, w, h, d, color, x, y, z, opts) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  mesh.position.set(x, y, z);
  if (opts && opts.ry) mesh.rotation.y = opts.ry;
  if (opts && opts.rz) mesh.rotation.z = opts.rz;
  if (opts && opts.rx) mesh.rotation.x = opts.rx;
  group.add(mesh);
  return mesh;
}

function addCyl(group, rTop, rBot, h, color, x, y, z, opts) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 14), mat(color, opts));
  mesh.position.set(x, y, z);
  if (opts && opts.ry) mesh.rotation.y = opts.ry;
  if (opts && opts.rz) mesh.rotation.z = opts.rz;
  if (opts && opts.rx) mesh.rotation.x = opts.rx;
  group.add(mesh);
  return mesh;
}

// A low box on legs reads as a counter from any angle in this art style.
function addCounter(group, cx, cz, x, z, length, alongZ, color) {
  if (alongZ) {
    addBox(group, 0.9, 1.05, length, color, cx + x, 0.53, cz + z);
    addBox(group, 1.1, 0.08, length + 0.2, 0x3a332a, cx + x, 1.09, cz + z);
  } else {
    addBox(group, length, 1.05, 0.9, color, cx + x, 0.53, cz + z);
    addBox(group, length + 0.2, 0.08, 1.1, 0x3a332a, cx + x, 1.09, cz + z);
  }
}

function addShelf(group, cx, cz, x, z, frontColor) {
  // Upright frame plus a bright front panel so stock colour faces the aisle.
  addBox(group, 2.6, 2.0, 0.7, 0x5d5347, cx + x, 1.0, cz + z);
  addBox(group, 2.4, 1.7, 0.08, frontColor, cx + x, 1.05, cz + z - 0.4);
  addBox(group, 2.4, 0.28, 0.5, frontColor, cx + x, 1.55, cz + z - 0.2);
  addBox(group, 2.4, 0.28, 0.5, 0xe8e2d4, cx + x, 0.95, cz + z - 0.2);
  addBox(group, 2.4, 0.28, 0.5, frontColor, cx + x, 0.4, cz + z - 0.2);
}

function addTableSet(group, cx, cz, x, z, topColor) {
  addBox(group, 1.7, 0.08, 1.2, topColor, cx + x, 0.74, cz + z);
  addBox(group, 0.12, 0.72, 0.12, 0x4a4038, cx + x, 0.37, cz + z);
  addBox(group, 0.5, 0.5, 0.5, 0x6b5a48, cx + x - 1.25, 0.25, cz + z);
  addBox(group, 0.5, 0.5, 0.5, 0x6b5a48, cx + x + 1.25, 0.25, cz + z);
  addBox(group, 0.5, 0.85, 0.12, 0x6b5a48, cx + x - 1.25, 0.62, cz + z);
  addBox(group, 0.5, 0.85, 0.12, 0x6b5a48, cx + x + 1.25, 0.62, cz + z);
}

function addBed(group, cx, cz, x, z, blanketColor) {
  addBox(group, 2.4, 0.35, 1.5, 0xded8cc, cx + x, 0.32, cz + z);
  addBox(group, 2.4, 0.5, 0.14, 0x5d4a38, cx + x, 0.5, cz + z - 0.75);
  addBox(group, 1.6, 0.14, 1.34, blanketColor, cx + x + 0.32, 0.56, cz + z);
  addBox(group, 0.6, 0.12, 1.1, 0xffffff, cx + x - 0.8, 0.56, cz + z);
}

function addKeeper(group, room, dx, dz, shirt) {
  const keeper = makePersonMesh({ shirt, pants: 0x2e3440, skin: 0xd9a077 });
  keeper.position.set(room.cx + dx, 0, room.cz + dz);
  keeper.rotation.y = -Math.PI / 2; // face the counter front, toward the entry
  group.add(keeper);
  room.keeper = keeper;
  return keeper;
}

// ---------------------------------------------------------------------------
// Room shells and dressing
// ---------------------------------------------------------------------------

function buildShell(group, room) {
  const { cx, cz } = room;
  const floorColor = FLOOR_COLORS[room.facility.kind] || 0x777777;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_W, ROOM_D),
    mat(floorColor)
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0.02, cz);
  group.add(floor);
  // A thin ceiling slab keeps interior light flat and hides the sky colour.
  addBox(group, ROOM_W, 0.15, ROOM_D, 0x9a958c, cx, WALL_H + 0.08, cz);

  const wallColor = 0xb8b0a0;
  const hw = ROOM_W / 2;
  const hd = ROOM_D / 2;
  addBox(group, ROOM_W, WALL_H, 0.3, wallColor, cx, WALL_H / 2, cz - hd); // north
  addBox(group, ROOM_W, WALL_H, 0.3, wallColor, cx, WALL_H / 2, cz + hd); // south
  addBox(group, 0.3, WALL_H, ROOM_D, wallColor, cx + hw, WALL_H / 2, cz); // east
  // West wall is split so the middle 2.6 units stay open as the entry gap.
  const seg = (ROOM_D - 2.6) / 2;
  addBox(group, 0.3, WALL_H, seg, wallColor, cx - hw, WALL_H / 2, cz - (1.3 + seg / 2));
  addBox(group, 0.3, WALL_H, seg, wallColor, cx - hw, WALL_H / 2, cz + (1.3 + seg / 2));
  addBox(group, 0.3, 0.5, 2.6, wallColor, cx - hw, WALL_H - 0.25, cz); // lintel
  addPoint(room, 'exit', -hw + 1.3, 0);
}

function dressShop(group, room, accent) {
  const { cx, cz } = room;
  addShelf(group, cx, cz, -2.6, -3.4, accent);
  addShelf(group, cx, cz, 0.4, -3.4, 0xe8e2d4);
  addShelf(group, cx, cz, -1.1, 0.6, accent);
  addCounter(group, cx, cz, 5.6, 0, 8.5, true, 0x7a6a55);
  addBox(group, 0.55, 0.35, 0.5, 0x2c2c30, cx + 5.5, 1.3, cz - 2.6); // till
  addBox(group, 0.4, 0.18, 0.34, 0x9fe8a8, cx + 5.5, 1.56, cz - 2.6, { emissive: 0x2c7a3a });
  addKeeper(group, room, 6.7, -0.6, accent);
  addPoint(room, 'shop', 4.3, 0);
}

// Extra mart-only rows: two shelf units on the south side dressed with
// small coloured goods boxes along their fronts, so the aisle reads as
// stocked rather than as bare frames.
function dressMartExtras(group, room) {
  const { cx, cz } = room;
  const goods = [0xe23b2e, 0x2e9fe8, 0xf2c12e, 0x3fae6a, 0xe86a2e, 0x7a5fd0];
  const rows = [[-3.6, 3.9], [-0.4, 3.9]];
  rows.forEach(([dx, dz], r) => {
    addShelf(group, cx, cz, dx, dz, r ? 0x2e9fe8 : 0xe86a2e);
    for (let i = 0; i < 5; i++) {
      const c = goods[(r * 3 + i) % goods.length];
      addBox(group, 0.34, 0.34, 0.3, c, cx + dx - 0.9 + i * 0.45, 1.62, cz + dz - 0.2);
      addBox(group, 0.3, 0.3, 0.28, goods[(r * 3 + i + 2) % goods.length],
        cx + dx - 0.9 + i * 0.45, 0.62, cz + dz - 0.2);
    }
  });
}

function dressArms(group, room) {
  const { cx, cz } = room;
  addCounter(group, cx, cz, 5.6, 0, 8.5, true, 0x3f444c);
  // Dark rack panel on the back wall; thin boxes read as gun silhouettes.
  addBox(group, 0.18, 2.0, 9.5, 0x1e2126, cx + 7.7, 1.35, cz);
  for (let i = 0; i < 5; i++) {
    const gz = cz - 3.6 + i * 1.8;
    addBox(group, 0.1, 0.14, 1.15, 0x0c0d0f, cx + 7.55, 1.7, gz);
    addBox(group, 0.1, 0.3, 0.16, 0x0c0d0f, cx + 7.55, 1.45, gz + 0.3);
  }
  addBox(group, 1.4, 0.8, 0.7, 0x555c66, cx + 1.5, 0.4, cz - 4.2); // ammo crate
  addBox(group, 1.4, 0.8, 0.7, 0x626a75, cx + 1.5, 0.4, cz + 4.2);
  addKeeper(group, room, 6.7, 0.8, 0x39424e);
  addPoint(room, 'shop', 4.3, 0);
}

function dressBooks(group, room) {
  const { cx, cz } = room;
  const tones = [0x8a4f3a, 0x3a5f8a, 0x4f7a3a, 0x7a3a6b];
  for (let i = 0; i < 4; i++) {
    addShelf(group, cx, cz, -3.6 + i * 2.6, -3.6, tones[i]);
  }
  addBox(group, 3.2, 0.08, 1.6, 0x6b4f35, cx + 0.4, 0.76, cz + 2.6); // reading table
  addBox(group, 0.14, 0.74, 0.14, 0x4a3826, cx - 0.9, 0.37, cz + 2.6);
  addBox(group, 0.14, 0.74, 0.14, 0x4a3826, cx + 1.7, 0.37, cz + 2.6);
  addBox(group, 0.5, 0.16, 0.7, 0xc23b2e, cx + 0.2, 0.88, cz + 2.6); // open book, red cover
  addBox(group, 0.5, 0.16, 0.7, 0x2e6bc2, cx + 1.0, 0.88, cz + 2.4);
  addKeeper(group, room, 6.4, 3.8, 0x74584a);
  addPoint(room, 'browse', 0.2, -1.6);
}

function dressBank(group, room) {
  const { cx, cz } = room;
  addCounter(group, cx, cz, 4.6, 0, 10, true, 0x8a8f96);
  // ATM is mounted by the entry so it is the first thing a player reaches.
  addBox(group, 0.8, 1.5, 0.55, 0x2456a8, cx - 6.9, 0.95, cz - 4.6);
  addBox(group, 0.55, 0.45, 0.06, 0x9fe8ff, cx - 6.9, 1.35, cz - 4.28, { emissive: 0x2a6a8a });
  addPoint(room, 'atm', -6.0, -4.6);
  // Round vault door: a fat cylinder turned to face into the room.
  const vault = addCyl(group, 1.7, 1.7, 0.5, 0xb9c0c9, cx + 7.6, 1.5, cz, { rz: Math.PI / 2 });
  vault.material = mat(0xb9c0c9, { emissive: 0x22262c });
  addCyl(group, 0.32, 0.32, 0.35, 0x707880, cx + 7.25, 1.5, cz, { rz: Math.PI / 2 });
  addBox(group, 1.6, 0.9, 1.0, 0xc9a227, cx - 1.5, 0.45, cz + 3.8); // bullion cart, purely decorative
  // A second, darker vault face on the north wall: a big flat circle
  // with a hub, reading as a sealed vault door from across the room.
  addCyl(group, 1.35, 1.35, 0.18, 0x2e3238, cx + 1.8, 1.45, cz - 6.3, { rx: Math.PI / 2 });
  addCyl(group, 0.3, 0.3, 0.3, 0x707880, cx + 1.8, 1.45, cz - 6.22, { rx: Math.PI / 2 });
  // Queue posts in front of the counter, roped together.
  addCyl(group, 0.06, 0.08, 0.95, 0xb9c0c9, cx + 3.4, 0.48, cz - 1.6);
  addCyl(group, 0.06, 0.08, 0.95, 0xb9c0c9, cx + 3.4, 0.48, cz + 1.6);
  addBox(group, 0.16, 0.16, 0.16, 0xb9c0c9, cx + 3.4, 0.99, cz - 1.6);
  addBox(group, 0.16, 0.16, 0.16, 0xb9c0c9, cx + 3.4, 0.99, cz + 1.6);
  addBox(group, 0.07, 0.07, 3.2, 0xa8232e, cx + 3.4, 0.78, cz);
  addKeeper(group, room, 6.2, -2.2, 0x2e4a7a);
  // The bank has no shop stock; the ATM is its only service point.
}

function dressJewels(group, room) {
  const { cx, cz } = room;
  // Glass cases: translucent pale tops on solid stands, so the robbery
  // points are obvious without any extra marker.
  const caseSpots = [[-0.6, -2.4], [-0.6, 2.4]];
  caseSpots.forEach(([dx, dz], i) => {
    addBox(group, 2.4, 0.75, 1.3, 0x4a4238, cx + dx, 0.38, cz + dz);
    addBox(group, 2.3, 0.4, 1.2, 0xdff4ff, cx + dx, 0.95, cz + dz, { transparent: true, opacity: 0.4 });
    addBox(group, 0.5, 0.1, 0.5, 0xffe98a, cx + dx, 0.8, cz + dz, { emissive: 0x8a6d1a });
    addPoint(room, 'case', dx, dz, { index: i });
  });
  addCounter(group, cx, cz, 5.8, 0, 7, true, 0x5d5347);
  addKeeper(group, room, 6.8, 0, 0x6b2e4a);
}

function dressKitchen(group, room) {
  const { cx, cz } = room;
  addTableSet(group, cx, cz, -3.2, -3.2, 0xd8cfc0);
  addTableSet(group, cx, cz, -3.2, 2.8, 0xd8cfc0);
  addTableSet(group, cx, cz, 1.2, 0, 0xd8cfc0);
  addCounter(group, cx, cz, 6.0, 0, 10.5, true, 0xa8542e);
  addBox(group, 0.7, 0.5, 2.2, 0xd8d8dc, cx + 5.9, 1.35, cz - 3); // pass-through warmer
  addKeeper(group, room, 6.9, 2.4, 0xf0ead8);
  addPoint(room, 'meal', 1.2, 1.6);
}

function dressClub(group, room) {
  const { cx, cz } = room;
  // Dance floor: a grid of emissive tiles, each a different club colour.
  const tileColors = [0xff2e88, 0x2ec5ff, 0xffe12e, 0x7dff2e, 0xb02eff, 0xff7a2e];
  for (let ix = 0; ix < 4; ix++) {
    for (let iz = 0; iz < 4; iz++) {
      const c = tileColors[(ix * 4 + iz) % tileColors.length];
      addBox(group, 1.35, 0.06, 1.35, c, cx - 2.6 + ix * 1.45, 0.06, cz - 2.6 + iz * 1.45, { emissive: c });
    }
  }
  addCounter(group, cx, cz, 6.2, 0, 10, true, 0x2c2138); // bar
  addBox(group, 0.9, 1.6, 1.1, 0x14161c, cx - 6.6, 0.8, cz - 5.2); // speaker stack
  addBox(group, 0.9, 1.6, 1.1, 0x14161c, cx - 6.6, 0.8, cz + 5.2);
  addCyl(group, 0.34, 0.34, 0.1, 0x30343e, cx - 6.6, 0.85, cz - 5.2);
  addCyl(group, 0.34, 0.34, 0.1, 0x30343e, cx - 6.6, 0.85, cz + 5.2);
  // Neon strips hug the long walls so the room glows even in flat light.
  addBox(group, 12, 0.16, 0.1, 0xff2e88, cx, 2.2, cz - 6.28, { emissive: 0xff2e88 });
  addBox(group, 12, 0.16, 0.1, 0x2ec5ff, cx, 2.2, cz + 6.28, { emissive: 0x2ec5ff });
  addBox(group, 0.1, 0.16, 9, 0xb02eff, cx + 7.78, 2.2, cz, { emissive: 0xb02eff });
  const dancerTones = [0xff5a7a, 0x5ac8ff, 0xffd75a, 0x8aff5a];
  const dancerSpots = [[-2.2, -1.6], [-0.6, 0.8], [0.9, -1.9], [-1.7, 2.1]];
  dancerSpots.forEach(([dx, dz], i) => {
    const dancer = makePersonMesh({ shirt: dancerTones[i], pants: 0x22242c, skin: 0xd9a077 });
    dancer.position.set(cx + dx, 0.1, cz + dz);
    dancer.rotation.y = i * 1.4;
    group.add(dancer);
    room.dancers.push({ mesh: dancer, phase: i * 1.7 });
  });
  // Raised stage on the west wall, opposite the bar: a low slab with a
  // DJ booth on it and two translucent light beams raking down over it.
  addBox(group, 3.4, 0.35, 5.2, 0x241a30, cx - 5.9, 0.18, cz);
  addBox(group, 3.5, 0.08, 5.3, 0xff2e88, cx - 5.9, 0.39, cz, { emissive: 0xff2e88 });
  addBox(group, 1.9, 1.0, 0.8, 0x14161c, cx - 6.6, 0.86, cz); // DJ booth
  addBox(group, 1.7, 0.1, 0.6, 0x2ec5ff, cx - 6.6, 1.4, cz, { emissive: 0x2ec5ff });
  addCyl(group, 0.14, 1.05, 2.3, 0x2ec5ff, cx - 6.9, 1.5, cz - 1.9,
    { transparent: true, opacity: 0.26, emissive: 0x2ec5ff });
  addCyl(group, 0.14, 1.05, 2.3, 0xff2e88, cx - 6.9, 1.5, cz + 1.9,
    { transparent: true, opacity: 0.26, emissive: 0xff2e88 });
  addKeeper(group, room, 7.0, -3.4, 0x1e1e28);
}

function dressHospital(group, room) {
  const { cx, cz } = room;
  addBox(group, 3.4, 1.05, 1.0, 0xe8ecef, cx + 3.8, 0.53, cz - 3.6); // reception desk
  addBox(group, 3.5, 0.08, 1.1, 0xb9c2cc, cx + 3.8, 1.09, cz - 3.6);
  addPoint(room, 'desk', 3.8, -2.2);
  addBed(group, cx, cz, -3.4, -3.8, 0x7ac8e8);
  addBed(group, cx, cz, -3.4, 1.8, 0x7ac8e8);
  // Red cross on the east wall, built from two plain boxes.
  addBox(group, 0.1, 1.5, 0.5, 0xd92b20, cx + 7.8, 1.7, cz - 3.6);
  addBox(group, 0.1, 0.5, 1.5, 0xd92b20, cx + 7.8, 1.7, cz - 3.6);
  addBox(group, 1.2, 1.8, 0.6, 0xd8dde2, cx + 5.6, 0.9, cz + 4.4); // supply cabinet
  addKeeper(group, room, 5.2, -3.6, 0xf2f4f6);
}

function dressMotel(group, room) {
  const { cx, cz } = room;
  addBed(group, cx, cz, -3.2, -3.4, 0xb8524a);
  addPoint(room, 'bed', -3.2, -1.9);
  addBox(group, 0.9, 0.55, 0.9, 0x6b543e, cx - 1.2, 0.28, cz - 4.6); // side table
  addCyl(group, 0.07, 0.1, 0.4, 0x33302c, cx - 1.2, 0.75, cz - 4.6); // lamp stem
  addBox(group, 0.42, 0.3, 0.42, 0xffe2a8, cx - 1.2, 1.05, cz - 4.6, { emissive: 0xa87f2e });
  addBox(group, 2.2, 1.3, 0.6, 0x54483a, cx + 5.8, 0.65, cz + 4.2); // dresser
  addBox(group, 1.5, 0.9, 0.14, 0x14161c, cx + 5.8, 1.7, cz + 4.55); // wall TV, off
}

function dressHome(group, room) {
  const { cx, cz } = room;
  // Bedroom at the north end; the bed position matches interiorSpot.
  addBed(group, cx, cz, -3.4, -4.55, 0x4a7ab8);
  addPoint(room, 'bed', -3.4, -2.9);
  addBox(group, 2.6, 2.1, 0.7, 0x6e5136, cx + 1.8, 1.05, cz - 5.9); // wardrobe
  addBox(group, 0.9, 0.55, 0.9, 0x6b543e, cx - 1.3, 0.28, cz - 5.2); // nightstand
  // Bathroom corner, south-east: tub with a rim, sink and a pale mirror.
  addBox(group, 2.5, 0.6, 1.3, 0xf4f6f8, cx + 5.6, 0.3, cz + 5.2);
  addBox(group, 2.2, 0.18, 1.0, 0xcfe4ee, cx + 5.6, 0.62, cz + 5.2);
  addBox(group, 0.8, 0.85, 0.6, 0xf4f6f8, cx + 3.4, 0.43, cz + 5.9);
  addBox(group, 0.9, 1.1, 0.06, 0xdff2fa, cx + 3.4, 1.75, cz + 6.28);
  addBox(group, 0.24, 0.5, 0.24, 0xd8dde2, cx + 7.2, 0.25, cz + 5.9); // toilet, abstracted
  // Living area: sofa facing a TV on a stand, rug between them.
  addBox(group, 3.0, 0.55, 1.1, 0x7a4a5e, cx - 1.8, 0.42, cz + 3.4); // sofa seat
  addBox(group, 3.0, 0.95, 0.3, 0x7a4a5e, cx - 1.8, 0.72, cz + 4.05); // sofa back
  addBox(group, 0.3, 0.7, 1.1, 0x6b4052, cx - 3.35, 0.55, cz + 3.4);
  addBox(group, 0.3, 0.7, 1.1, 0x6b4052, cx - 0.25, 0.55, cz + 3.4);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.4), mat(0xa83a4a));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(cx + 0.6, 0.045, cz + 3.4);
  group.add(rug);
  addBox(group, 1.8, 0.5, 0.5, 0x3a332a, cx + 3.2, 0.25, cz + 3.4); // TV stand
  addBox(group, 1.7, 1.0, 0.12, 0x0e1014, cx + 3.2, 1.05, cz + 3.4); // TV
  addBox(group, 1.5, 0.8, 0.08, 0x274b63, cx + 3.2, 1.05, cz + 3.32, { emissive: 0x14384c });
}

function dressGeneric(group, room) {
  const { cx, cz } = room;
  addCounter(group, cx, cz, 5.6, 0, 8, true, 0x7a6a55);
  addBox(group, 1.6, 1.1, 1.0, 0x8a8172, cx - 2, 0.55, cz - 3.5);
  addKeeper(group, room, 6.7, 0, 0x707a8a);
}

const SHOP_ACCENTS = {
  mart: 0xe86a2e,
  apotik: 0x2ea85e,
  gas: 0xe8c22e,
  'palmetto-mart': 0x2e9fe8,
  'cypress-gas': 0xe84a2e,
  'farshore-apotik': 0x2ea85e,
};

export function buildInteriors(scene) {
  registerRooms();
  const root = new THREE.Group();
  for (const room of rooms.values()) {
    const group = new THREE.Group();
    buildShell(group, room);
    const id = room.id;
    if (id === 'arms') dressArms(group, room);
    else if (id === 'books') dressBooks(group, room);
    else if (id === 'bank') dressBank(group, room);
    else if (id === 'jewels') dressJewels(group, room);
    else if (id === 'kitchen' || id === 'cypress-diner') dressKitchen(group, room);
    else if (id === 'club') dressClub(group, room);
    else if (id === 'hospital') dressHospital(group, room);
    else if (id === 'palmetto-motel' || id === 'farshore-motel') dressMotel(group, room);
    else if (id === 'home') dressHome(group, room);
    else if (SHOP_ACCENTS[id] !== undefined) {
      dressShop(group, room, SHOP_ACCENTS[id]);
      if (id === 'mart') dressMartExtras(group, room);
    }
    else dressGeneric(group, room);
    root.add(group);
  }
  scene.add(root);
  return root;
}

// ---------------------------------------------------------------------------
// Shops
// ---------------------------------------------------------------------------

// Stock entries carry either an item id or an ammo kind; the HUD only ever
// sees plain {name, price} rows.
const SHOP_STOCK = {
  mart: [
    { item: 'medkit', price: 30 },
    { item: 'snack', price: 8 },
    { item: 'firecan', price: 25 },
  ],
  apotik: [
    { item: 'medkit', price: 25 },
    { item: 'tonic', price: 60 },
    { item: 'snack', price: 10 },
  ],
  gas: [
    { item: 'firecan', price: 20 },
    { item: 'snack', price: 8 },
  ],
  'cypress-gas': [
    { item: 'firecan', price: 20 },
    { item: 'snack', price: 8 },
  ],
  'palmetto-mart': [
    { item: 'medkit', price: 30 },
    { item: 'snack', price: 8 },
  ],
  'farshore-apotik': [
    { item: 'medkit', price: 25 },
    { item: 'tonic', price: 60 },
  ],
  arms: [
    { item: 'pistol', price: 150 },
    { ammo: 'pistol', name: 'Pistol ammo ×12', price: 20, n: 12 },
    { ammo: 'sniper', name: 'Sniper ammo ×5', price: 50, n: 5 },
    { item: 'medkit', price: 35 },
  ],
};

function entryName(entry) {
  if (entry.name) return entry.name;
  const def = ITEMS[entry.item];
  return def ? def.name : entry.item;
}

function openShopFor(facilityId) {
  const stock = SHOP_STOCK[facilityId];
  const facility = FACILITY_BY_ID.get(facilityId);
  if (!stock || !facility) { sfx.denied(); return; }
  const items = stock.map((e) => ({ name: entryName(e), price: e.price }));
  openShop(facility.name, items, (index) => {
    const entry = stock[index];
    if (!entry) return;
    if (G.money < entry.price) { sfx.denied(); return; }
    G.money -= entry.price;
    if (entry.item) {
      // A full bag or an already-owned weapon refunds instead of charging.
      if (!giveItem(entry.item)) {
        G.money += entry.price;
        sfx.denied();
        return;
      }
    } else if (entry.ammo) {
      addAmmo(entry.ammo, entry.n);
    }
    sfx.buy();
  });
}

// ---------------------------------------------------------------------------
// Prompt ownership — facilities only clear a prompt they set themselves, so
// other systems (police, missions) are never wiped by a stray null.
// ---------------------------------------------------------------------------

let myPrompt = null;
function showPrompt(text) {
  if (myPrompt === text) return;
  myPrompt = text;
  setPrompt(text);
}
function clearPrompt() {
  if (myPrompt === null) return;
  myPrompt = null;
  setPrompt(null);
}

const BOOK_QUOTES = [
  'Try the tide charts — every smuggler in Palm Cove owns a copy.',
  'The local history shelf is mostly redacted. Nobody knows why.',
  'A book of knots. Useful on boats, and for other things.',
  'Someone keeps dog-earing the pages about the old lighthouse.',
  'The travel guides still list places that burned down years ago.',
];
let bookQuoteIndex = 0;

function dist(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Forward vector convention shared with the player: (sin a, cos a).
function angleFacing(dx, dz) {
  return Math.atan2(dx, dz);
}

function pointPrompt(point) {
  switch (point.kind) {
    case 'exit': return 'Leave';
    case 'shop': return 'Shop';
    case 'bed': return point.facilityId === 'home' ? 'Sleep & save' : 'Rest — $25';
    case 'atm': return 'Use ATM';
    case 'case': return G.flags['case_' + point.index] ? 'Case emptied' : 'Smash the case';
    case 'desk': return 'Reception — heal $20';
    case 'meal': return 'Eat a meal — $15';
    case 'browse': return 'Browse the shelves';
    default: return null;
  }
}

function enterFacility(door) {
  const spot = interiorSpot(door.id);
  G.interior = door.id;
  clearPrompt();
  // Spawn is inside the west gap, so into the room means facing east.
  placeAt(spot.x, spot.z, angleFacing(1, 0));
  sfx.door();
  if (door.id === 'club') radio.setClubMode(true);
}

function leaveFacility(room) {
  const door = DOOR_BY_ID.get(room.id);
  G.interior = null;
  clearPrompt();
  if (room.id === 'club') radio.setClubMode(false);
  if (door) {
    const facility = FACILITY_BY_ID.get(room.id);
    const dir = FACE_DIR[facility ? facility.face : 's'] || FACE_DIR.s;
    // HOME_DOOR is the authored doorstep for home; it agrees with the
    // computed door, and stepping out lands just beyond it either way.
    const baseX = room.id === 'home' ? HOME_DOOR.x : door.x;
    const baseZ = room.id === 'home' ? HOME_DOOR.z : door.z;
    placeAt(baseX + dir.x * 1.6, baseZ + dir.z * 1.6, angleFacing(dir.x, dir.z));
  }
  sfx.door();
}

function usePoint(point) {
  const room = rooms.get(point.facilityId);
  switch (point.kind) {
    case 'exit':
      if (room) leaveFacility(room);
      break;
    case 'shop':
      openShopFor(point.facilityId);
      break;
    case 'bed':
      if (point.facilityId === 'home') {
        G.health = 100;
        saveGame(player.pos);
        showBanner('Game saved — you sleep soundly');
        sfx.pickup();
      } else if (G.money >= 25) {
        G.money -= 25;
        G.health = 100;
        saveGame(player.pos);
        showBanner('Rested and saved');
        sfx.pickup();
      } else {
        sfx.denied();
      }
      break;
    case 'atm': {
      // One withdrawal per five in-game minutes keeps the bank from being
      // an infinite money tap.
      const last = G.flags.atmAt || -9999;
      if (G.time - last > 300) {
        G.money += 40;
        G.flags.atmAt = G.time;
        sfx.buy();
        say('', 'ATM: $40 withdrawn', 2);
      } else {
        say('', 'ATM limit reached — try later', 2);
        sfx.denied();
      }
      break;
    }
    case 'case': {
      const key = 'case_' + point.index;
      if (G.flags[key]) { sfx.denied(); break; }
      G.flags[key] = true;
      G.money += 300;
      showBanner('Smash and grab! +$300');
      sfx.hit();
      commitCrime(3, 'Jewelry robbery', { pos: player.pos });
      break;
    }
    case 'desk': {
      const cost = Math.min(20, G.money);
      G.money -= cost;
      G.health = 100;
      sfx.buy();
      say('', 'Patched up — good as new', 2);
      break;
    }
    case 'meal':
      if (G.money >= 15) {
        G.money -= 15;
        G.health = Math.min(100, G.health + 30);
        sfx.buy();
      } else {
        sfx.denied();
      }
      break;
    case 'browse': {
      const quote = BOOK_QUOTES[bookQuoteIndex % BOOK_QUOTES.length];
      bookQuoteIndex += 1;
      say('Clerk', quote, 3);
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Per-frame facility logic
// ---------------------------------------------------------------------------

export function updateFacilities(dt, ctx) {
  const interactPressed = !!(ctx && ctx.interactPressed);

  if (!G.interior) {
    if (G.inPrison > 0) { clearPrompt(); return; }
    let nearDoor = null;
    for (const door of DOORS) {
      if (dist(player.pos.x, player.pos.z, door.x, door.z) < 2.6) { nearDoor = door; break; }
    }
    if (!nearDoor) { clearPrompt(); return; }
    showPrompt('Enter ' + nearDoor.name);
    if (interactPressed) enterFacility(nearDoor);
    return;
  }

  const room = rooms.get(G.interior);
  if (!room) { G.interior = null; clearPrompt(); return; }

  // Rooms are solid rectangles; the entry gap never lets the player walk
  // out because leaving is an interact, not a doorway crossing.
  const inset = 0.8;
  player.pos.x = Math.max(room.cx - room.w / 2 + inset, Math.min(room.cx + room.w / 2 - inset, player.pos.x));
  player.pos.z = Math.max(room.cz - room.d / 2 + inset, Math.min(room.cz + room.d / 2 - inset, player.pos.z));

  // Ambient life: dancers only move while watched, keepers sway in place.
  if (room.id === 'club') {
    for (const dancer of room.dancers) {
      dancer.phase += dt * 5.2;
      posePerson(dancer.mesh, dancer.phase, 'dance');
    }
  }
  if (room.keeper) {
    room.keeperPhase += dt * 1.3;
    posePerson(room.keeper, room.keeperPhase, 'idle');
  }

  let nearest = null;
  let nearestDist = Infinity;
  for (const point of room.points) {
    const d = dist(player.pos.x, player.pos.z, point.x, point.z);
    if (d < (point.radius || 1.9) && d < nearestDist) { nearest = point; nearestDist = d; }
  }
  if (!nearest) { clearPrompt(); return; }
  const label = pointPrompt(nearest);
  if (label) showPrompt(label); else clearPrompt();
  if (interactPressed) {
    // An emptied case has a prompt but no action left behind it.
    if (nearest.kind === 'case' && G.flags['case_' + nearest.index]) return;
    usePoint(nearest);
  }
}

// ---------------------------------------------------------------------------
// Prison
// ---------------------------------------------------------------------------

export function prisonSpot() {
  return { x: PRISON.x, z: PRISON.z + 6 };
}

export function sendToPrison() {
  const spot = prisonSpot();
  G.interior = null;
  G.inPrison = 24;
  clearPrompt();
  radio.setClubMode(false);
  placeAt(spot.x, spot.z, angleFacing(PRISON.gateX - spot.x, PRISON.gateZ - spot.z));
}

let prisonPrompt = null;
function showPrisonPrompt(text) {
  if (prisonPrompt === text) return;
  prisonPrompt = text;
  setPrompt(text);
}
function clearPrisonPrompt() {
  if (prisonPrompt === null) return;
  prisonPrompt = null;
  setPrompt(null);
}

function releasePrison(kind) {
  G.inPrison = 0;
  clearPrisonPrompt();
  // Out of the gate and a few steps south of it, back on the street side.
  placeAt(PRISON.gateX, PRISON.gateZ + 6, angleFacing(0, 1));
  showBanner(kind === 'bailed' ? 'Bail paid — you are free' : 'Sentence served — you are free');
  return kind;
}

export function updatePrison(dt, ctx) {
  if (!(G.inPrison > 0)) return null;
  const interactPressed = !!(ctx && ctx.interactPressed);

  G.inPrison -= dt;
  if (G.inPrison <= 0) return releasePrison('served');

  // The yard is a hard rectangle; the only soft edge is the gate gap strip,
  // where a prisoner walks up to the gate to talk bail.
  const inGateStrip = Math.abs(player.pos.x - PRISON.gateX) < 3 && player.pos.z > PRISON.z + 20;
  if (!inGateStrip) {
    player.pos.x = Math.max(PRISON.x - 32, Math.min(PRISON.x + 32, player.pos.x));
    player.pos.z = Math.max(PRISON.z - 22, Math.min(PRISON.z + 24, player.pos.z));
  }

  const atGate = dist(player.pos.x, player.pos.z, PRISON.gateX, PRISON.gateZ) < 3;
  if (!atGate) { clearPrisonPrompt(); return null; }
  showPrisonPrompt(G.money >= 150 ? 'Pay bail — $150' : 'Bail — $150 (not enough cash)');
  if (!interactPressed) return null;
  if (G.money >= 150) {
    G.money -= 150;
    return releasePrison('bailed');
  }
  sfx.denied();
  return null;
}
