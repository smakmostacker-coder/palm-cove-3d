// Palm Cove tuning constants: Florida-peninsula layout, districts and balance.
// The city sits near the southern tip of a long peninsula: ocean east and west,
// a Keys-style island chain arcs off the south tip over drivable causeways, and
// an Everglades-flavoured marsh spreads inland to the north.
export const WORLD = 200;                 // half-extent of the city plateau
export const ROADS = [-150, -75, 0, 75, 150]; // street centre-lines on both axes
export const ROAD_W = 15;                 // street width in world units
export const KEYS = [                     // island chain south of the tip (z > WORLD)
  { z: 268, rx: 40, rz: 27, name: 'Key Largo Verde' },
  { z: 338, rx: 36, rz: 25, name: 'Key Marlin' },
  { z: 408, rx: 44, rz: 30, name: 'Key Solano' },   // end-of-the-line settlement
];
export const CAUSEWAY = { x: 0, z0: 200, z1: 436, halfW: 9 };
export const MARSH = { z0: -436, z1: -200 };      // Everglades wetland, inland north
export const DISTRICTS = [
  { name: 'Marina Mile',    x0: 40,  x1: 205, z0: 40,  z1: 205, color: 0x2ec4b6 },
  { name: 'The Docks',      x0: -205, x1: -40, z0: 40,  z1: 205, color: 0xf4a261 },
  { name: 'Coral Heights',  x0: 40,  x1: 205, z0: -205, z1: -40, color: 0xef476f },
  { name: 'Old Town',       x0: -205, x1: -40, z0: -205, z1: -40, color: 0xffd166 },
  { name: 'Palm District',  x0: -205, x1: 205, z0: -40,  z1: 40,  color: 0x06d6a0 },
];
export function districtAt(x, z) {
  if (z > WORLD + 4) { for (const k of KEYS) if (Math.abs(z - k.z) < k.rz + 8) return k.name; return 'The Causeway'; }
  if (z < -WORLD - 4) return 'The Glades';
  for (const d of DISTRICTS) if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d.name;
  return 'Palm District';
}
// Downtown core: the tallest towers cluster around the central boulevard cross.
export function isDowntown(x, z) { return Math.abs(x) < 58 && Math.abs(z) < 58; }
export const SPAWN = { x: 8, z: 58 };
export const POLICE_STATION = { x: -68, z: -68 };
export const HOSPITAL = { x: 68, z: -68 };
export const FIRE_STATION = { x: 150, z: -150 };  // Coral Heights damkar station
export const GARAGE = { x: 82, z: 82 };    // Lucia's garage, Marina Mile
export const MARINA = { x: 170, z: 170 };
export const KEY_TOWN = { x: 6, z: 402 };  // Key Solano settlement, end of the causeway
export const TUNING = {
  walkSpeed: 7, sprintSpeed: 12, carAccel: 26, carMax: 34, carReverse: 10,
  wantedDecaySeconds: 14, bustFillRate: 0.45, bustDrainRate: 0.3,
};
// Per-class handling for Part F vehicle variety (all classes stealable).
export const HANDLING = {
  car:       { accel: 26, max: 34, reverse: 10, turn: 1.7, dmg: 1.0 },
  moto:      { accel: 36, max: 44, reverse: 6,  turn: 2.7, dmg: 0.6 },
  truck:     { accel: 14, max: 24, reverse: 7,  turn: 1.05, dmg: 2.2 },
  police:    { accel: 31, max: 39, reverse: 10, turn: 1.9, dmg: 1.1 },
  firetruck: { accel: 15, max: 26, reverse: 7,  turn: 1.1, dmg: 2.0 },
};
export const SAVE_KEY = 'palm-cove-save-v2';
