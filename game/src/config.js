// Palm Cove tuning constants: world layout, districts and gameplay balance.
export const WORLD = 200;                 // half-extent of the playable land
export const ROADS = [-150, -75, 0, 75, 150]; // street centre-lines on both axes
export const ROAD_W = 15;                 // street width in world units
export const DISTRICTS = [
  { name: 'Marina Mile',    x0: 40,  x1: 205, z0: 40,  z1: 205, color: 0x2ec4b6 },
  { name: 'The Docks',      x0: -205, x1: -40, z0: 40,  z1: 205, color: 0xf4a261 },
  { name: 'Coral Heights',  x0: 40,  x1: 205, z0: -205, z1: -40, color: 0xef476f },
  { name: 'Old Town',       x0: -205, x1: -40, z0: -205, z1: -40, color: 0xffd166 },
  { name: 'Palm District',  x0: -205, x1: 205, z0: -40,  z1: 40,  color: 0x06d6a0 },
];
export function districtAt(x, z) {
  for (const d of DISTRICTS) if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d.name;
  return 'Palm District';
}
export const SPAWN = { x: 8, z: 58 };
export const POLICE_STATION = { x: -68, z: -68 };
export const HOSPITAL = { x: 68, z: -68 };
export const GARAGE = { x: 82, z: 82 };    // Lucia's garage, Marina Mile
export const MARINA = { x: 170, z: 170 };
export const TUNING = {
  walkSpeed: 7, sprintSpeed: 12, carAccel: 26, carMax: 34, carReverse: 10,
  wantedDecaySeconds: 14, bustFillRate: 0.45, bustDrainRate: 0.3,
};
export const SAVE_KEY = 'palm-cove-save-v1';
