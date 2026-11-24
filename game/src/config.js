// Palm Cove — central game data.
// Pure data plus tiny derivations: no imports, no side effects, so any
// module can read shared numbers without creating import cycles.

// ---------------------------------------------------------------------------
// Player and wanted-system tuning
// Speeds are in world units per second; radii in world units.
// ---------------------------------------------------------------------------

export const TUNING = {
  walkSpeed: 7,
  sprintSpeed: 12,
  swimSpeed: 3.5,
  // Seconds of staying unobserved needed to shed one wanted star.
  wantedDecaySeconds: 14,
  // Seconds an officer must stay close before a bust lands.
  bustSeconds: 2.2,
  witnessRadius: 26,
  loudRadius: 70,
  // Reporting is delayed so a fast exit can still beat the call.
  reportDelaySeen: 1.2,
  reportDelayLoud: 0.8,
  reportDelayAlarm: 0.9,
  boostMultiplier: 1.55,
  // Past this distance from shore the open ocean takes over.
  offshoreBound: 240,
  bustRadius: 9,
  officerStopDistance: 1.4,
};

// ---------------------------------------------------------------------------
// Vehicles
// damage scales how much punishment a hull absorbs before it dies.
// ---------------------------------------------------------------------------

export const VEHICLE_TYPES = {
  car: { accel: 17, topSpeed: 22, reverseSpeed: 6, turnRate: 1.7, damage: 1.0 },
  moto: { accel: 23, topSpeed: 28, reverseSpeed: 4, turnRate: 2.7, damage: 0.6 },
  truck: { accel: 9, topSpeed: 16, reverseSpeed: 5, turnRate: 1.05, damage: 2.2 },
  police: { accel: 21, topSpeed: 26, reverseSpeed: 7, turnRate: 1.9, damage: 1.1 },
  firetruck: { accel: 10, topSpeed: 17, reverseSpeed: 5, turnRate: 1.1, damage: 2.0 },
};

// ---------------------------------------------------------------------------
// City road grid
// The city is a regular grid: east-west roads are lines of constant z,
// north-south roads are lines of constant x. Palm Boulevard is z = 0.
// ---------------------------------------------------------------------------

export const CITY_ROADS_X = [-150, -75, 0, 75, 150];

export const CITY_ROADS_Z = [-150, -75, 0, 75, 150];

export const ROAD_W = 14;

// The highway leaves the north edge of the city and runs far north;
// from/to are z values, with north being negative z.
export const HIGHWAY = {
  x: 0,
  from: 190,
  to: -4400,
};

// ---------------------------------------------------------------------------
// Geography: highway towns, the key, and fixed points of interest
// Each town seed drives its procedural layout, so seeds must stay stable.
// ---------------------------------------------------------------------------

export const TOWNS = [
  { name: 'Palmetto Flats', z: -1420, seed: 14207 },
  { name: 'Cypress Junction', z: -2080, seed: 20813 },
  { name: 'Tallahassee Palms', z: -4180, seed: 41829 },
];

// Reached by the causeway running south out of the city.
export const KEY_TOWN = { x: 6, z: 402 };

// Where a new game drops the player, just off Palm Boulevard.
export const SPAWN = { x: 8, z: 58 };

export const HOME = { x: -40, z: 96 };

// The door sits south of the house footprint so entry triggers outside.
export const HOME_DOOR = { x: -40, z: 105 };

export const POLICE_STATION = { x: -68, z: -68 };

export const HOSPITAL_POS = { x: 97, z: -56 };

export const FIRE_STATION = { x: 150, z: -150 };

export const MARINA = { x: 170, z: 170 };

export const GARAGE = { x: 82, z: 82 };

// The gate is offset from the compound centre toward the city.
export const PRISON = {
  x: -168,
  z: -234,
  gateX: -168,
  gateZ: -222,
};

// ---------------------------------------------------------------------------
// Facilities
// face names the side the door is on: 'n', 's', 'e' or 'w'.
// kind decides the interaction: 'shop' buys, 'enter' loads an interior,
// 'service' offers a civic service such as healing.
// ---------------------------------------------------------------------------

export const FACILITIES = [
  { id: 'mart', name: 'COVE MART 24H', x: 30, z: 17, face: 'n', kind: 'shop' },
  { id: 'apotik', name: 'APOTIK SEHAT', x: -32, z: 17, face: 'n', kind: 'shop' },
  { id: 'books', name: 'COVE BOOKS', x: 94, z: 17, face: 'n', kind: 'enter' },
  { id: 'gas', name: 'SOLANO GAS', x: 128, z: 17, face: 'n', kind: 'shop' },
  { id: 'arms', name: 'MARLIN ARMS', x: -96, z: 17, face: 'n', kind: 'shop' },
  { id: 'bank', name: 'COVE BANK', x: -128, z: -17, face: 's', kind: 'enter' },
  { id: 'jewels', name: 'MARLIN & CO. JEWELS', x: -64, z: -17, face: 's', kind: 'enter' },
  { id: 'kitchen', name: 'PALM KITCHEN', x: 64, z: -17, face: 's', kind: 'enter' },
  { id: 'club', name: 'CLUB NEON PALMS', x: 0, z: -17, face: 's', kind: 'enter' },
  { id: 'hospital', name: 'PALM COVE HOSPITAL', x: 97, z: -56, face: 's', kind: 'service' },
  { id: 'home', name: 'HOME', x: -40, z: 96, face: 's', kind: 'enter' },
  { id: 'palmetto-mart', name: 'PALMETTO MART', x: -24, z: -1408, face: 'e', kind: 'shop' },
  { id: 'palmetto-motel', name: 'PALMETTO MOTEL', x: 24, z: -1432, face: 'w', kind: 'enter' },
  { id: 'cypress-gas', name: 'CYPRESS GAS', x: -24, z: -2068, face: 'e', kind: 'shop' },
  { id: 'cypress-diner', name: 'CYPRESS DINER', x: 24, z: -2092, face: 'w', kind: 'enter' },
  { id: 'farshore-apotik', name: 'FAR SHORE APOTIK', x: -24, z: -4168, face: 'e', kind: 'shop' },
  { id: 'farshore-motel', name: 'FAR SHORE MOTEL', x: 24, z: -4192, face: 'w', kind: 'enter' },
];

// ---------------------------------------------------------------------------
// Places
// The full-map list for navigation and the quest log. Facility entries
// inherit their town as area; city facilities belong to the Palm District.
// ---------------------------------------------------------------------------

// Town membership is encoded in the facility id prefix.
const TOWN_AREA_BY_PREFIX = {
  'palmetto-': 'Palmetto Flats',
  'cypress-': 'Cypress Junction',
  'farshore-': 'Tallahassee Palms',
};

function facilityArea(id) {
  for (const prefix in TOWN_AREA_BY_PREFIX) {
    if (id.startsWith(prefix)) return TOWN_AREA_BY_PREFIX[prefix];
  }
  return 'Palm District';
}

export const PLACES = [
  ...FACILITIES.map((f) => ({
    name: f.name,
    x: f.x,
    z: f.z,
    area: facilityArea(f.id),
  })),
  { name: 'Palm Cove Correctional', x: PRISON.x, z: PRISON.z, area: 'The Glades' },
  { name: 'Police Station', x: POLICE_STATION.x, z: POLICE_STATION.z, area: 'Coral Heights' },
  { name: 'Fire Station', x: FIRE_STATION.x, z: FIRE_STATION.z, area: 'Coral Heights' },
  { name: 'Marina', x: MARINA.x, z: MARINA.z, area: 'Marina Mile' },
  { name: 'Key Solano', x: KEY_TOWN.x, z: KEY_TOWN.z, area: 'The Keys' },
  { name: 'Home', x: HOME.x, z: HOME.z, area: 'Coral Heights' },
  { name: 'Garage', x: GARAGE.x, z: GARAGE.z, area: 'Marina Mile' },
];

// ---------------------------------------------------------------------------
// Persistence
// Bump the version suffix whenever the saved shape changes.
// ---------------------------------------------------------------------------

export const SAVE_KEY = 'palm-cove-save-v3';
