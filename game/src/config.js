// Palm Cove — tuning constants and world layout.
//
// Geography note for v2: the playable city (Palm Cove, five districts) sits at
// the south-eastern tip of a Florida-shaped landmass. The full Florida
// silhouette — panhandle, narrowing peninsula, Lake Okeechobee, the Everglades
// and the Keys arc — is built in city.js; this file keeps the shared constants
// every other system reads: road grid inside the city proper, the causeway
// spine running south to the Keys, facility anchor points and balance tuning.
export const WORLD = 200; // half-extent of the Palm Cove city plateau
export const ROADS = [-150, -75, 0, 75, 150]; // city street centre-lines, both axes
export const ROAD_W = 15; // street width in world units

// Island chain south of the tip (z > WORLD), reached over the causeway.
export const KEYS = [
  { z: 268, rx: 40, rz: 27, name: 'Key Largo Verde' },
  { z: 338, rx: 36, rz: 25, name: 'Key Marlin' },
  { z: 408, rx: 44, rz: 30, name: 'Key Solano' }, // end-of-the-line settlement
];
export const CAUSEWAY = { x: 0, z0: 200, z1: 436, halfW: 9 };
export const MARSH = { z0: -436, z1: -200 }; // Everglades wetland, inland north

export const DISTRICTS = [
  { name: 'Marina Mile',   x0: 40,   x1: 205,  z0: 40,   z1: 205,  color: 0x2ec4b6 },
  { name: 'The Docks',     x0: -205, x1: -40,  z0: 40,   z1: 205,  color: 0xf4a261 },
  { name: 'Coral Heights', x0: 40,   x1: 205,  z0: -205, z1: -40,  color: 0xef476f },
  { name: 'Old Town',      x0: -205, x1: -40,  z0: -205, z1: -40,  color: 0xffd166 },
  { name: 'Palm District', x0: -205, x1: 205,  z0: -40,  z1: 40,   color: 0x06d6a0 },
];

// Human-readable place name for any world position: Keys, causeway and the
// Glades resolve before the five city districts are consulted.
export function districtAt(x, z) {
  if (z > WORLD + 4) {
    for (const k of KEYS) if (Math.abs(z - k.z) < k.rz + 8) return k.name;
    return 'The Causeway';
  }
  if (z < -WORLD - 4) return 'The Glades';
  for (const d of DISTRICTS) if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d.name;
  return 'Palm District';
}

// Downtown core: the tallest towers cluster around the central boulevard cross.
export function isDowntown(x, z) { return Math.abs(x) < 58 && Math.abs(z) < 58; }

// Storefront sites on the Palm Boulevard (the z=0 east–west spine): every
// shop, service and club exterior in the south fronts this street. `face`
// is the side the door and sign sit on — 's' faces +z (buildings north of
// the boulevard), 'n' faces −z (buildings south of it). facilities.js reads
// its positions from here and city.js reserves these plots when it lays out
// the street walls, so the two never disagree about where a shop stands.
export const SITES = {
  bank:      { x: -100, z: -17, face: 's' },
  arms:      { x: -52,  z: -17, face: 's' },
  club:      { x: -20,  z: -17, face: 's' },
  jewels:    { x: 24,   z: -17, face: 's' },
  decoFlats: { x: 56,   z: -17, face: 's' },
  blvdFlats: { x: 116,  z: -17, face: 's' },
  surf:      { x: -128, z: 17,  face: 'n' },
  mart:      { x: -96,  z: 17,  face: 'n' },
  apotik:    { x: -32,  z: 17,  face: 'n' },
  kitchen:   { x: 30,   z: 17,  face: 'n' },
  books:     { x: 94,   z: 17,  face: 'n' },
  gas:       { x: 128,  z: 17,  face: 'n' },
};

export const SPAWN = { x: 8, z: 58 };
export const POLICE_STATION = { x: -68, z: -68 };
export const HOSPITAL = { x: 97, z: -56 }; // Coral Heights lot fronting the z=-75 road, door at (97,-66.2) (was {68,-68}: the old box straddled the x=75/z=-75 junction and blocked both roads)
export const FIRE_STATION = { x: 150, z: -150 }; // Coral Heights fire station
export const GARAGE = { x: 82, z: 82 }; // the lead's garage, Marina Mile
export const MARINA = { x: 170, z: 170 };
export const KEY_TOWN = { x: 6, z: 402 }; // Key Solano settlement, end of the causeway

export const TUNING = {
  walkSpeed: 7, sprintSpeed: 12, carAccel: 17, carMax: 22, carReverse: 6,
  wantedDecaySeconds: 14, bustFillRate: 0.45, bustDrainRate: 0.3,
};

// Per-class handling for the five stealable vehicle classes. Round 5
// retune: base speeds/accels scaled down ~35% across the board so a car
// is controllable at full throttle; the old pace is still reachable by
// holding GAS (BOOST_MULT in driving.js scales accel + top speed).
export const HANDLING = {
  car:       { accel: 17, max: 22, reverse: 6, turn: 1.7,  dmg: 1.0 },
  moto:      { accel: 23, max: 28, reverse: 4, turn: 2.7,  dmg: 0.6 },
  truck:     { accel: 9,  max: 16, reverse: 5, turn: 1.05, dmg: 2.2 },
  police:    { accel: 21, max: 26, reverse: 7, turn: 1.9,  dmg: 1.1 },
  firetruck: { accel: 10, max: 17, reverse: 5, turn: 1.1,  dmg: 2.0 },
};

export const SAVE_KEY = 'palm-cove-save-v2';
