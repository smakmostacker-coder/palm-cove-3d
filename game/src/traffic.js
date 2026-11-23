// Pooled traffic: mixed-class AI vehicles looping the city grid, a handful
// of highway cars running the long peninsula road, and the parked pool of
// stealable vehicles — cars everywhere, a motorcycle, trucks, a police car
// at the station, the damkar fire truck at the fire station, and a couple of
// vehicles waiting at the far ends of the map (Keys, Panhandle Gate).
//
// City traffic obeys the traffic lights and stops for the player. Highway
// cars just run their long straight line and wrap at the ends. Everything
// resolves against building and prop colliders, so a traffic car nudges
// around a tree instead of ghosting through it.
import { ROADS, FIRE_STATION, POLICE_STATION } from './config.js';
import { makeRng, pick } from './random.js';
import { makeVehicle, LIGHT, groundHeightAt, collideBuildings, NORTH_END } from './city.js';

const COLORS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xecf0f1, 0xfd79a8];
export const trafficCars = [];  // {mesh,pos,axis,line,t,dir,speed,health,kind,burning,burnt,...}
export const parkedCars = [];   // {mesh,pos,angle,health,speed,kind,name,...}

function veh(mesh, kind, name) {
  return { mesh, pos: mesh.position, kind, name, health: 100, speed: 0, burning: 0, burnt: false, burnT: 0, sprayed: 0 };
}

export function buildTraffic(scene, seed) {
  const rng = makeRng(seed * 331 + 7);
  const kinds = [];
  for (let i = 0; i < 15; i++) kinds.push('car');
  for (let i = 0; i < 4; i++) kinds.push('moto');
  for (let i = 0; i < 3; i++) kinds.push('truck');
  kinds.forEach((kind) => {
    const mesh = makeVehicle(kind, pick(rng, COLORS), {});
    scene.add(mesh);
    const horiz = rng() < 0.5;
    const v = veh(mesh, kind, kind);
    Object.assign(v, {
      axis: horiz ? 'x' : 'z', line: pick(rng, ROADS),
      t: -190 + rng() * 380, dir: rng() < 0.5 ? 1 : -1,
      speed: kind === 'moto' ? 13 + rng() * 6 : kind === 'truck' ? 6 + rng() * 3 : 9 + rng() * 7,
      stopped: 0, highway: false,
    });
    trafficCars.push(v);
  });
  // Highway runners: sparse traffic for the long drive north.
  for (let i = 0; i < 5; i++) {
    const kind = i === 4 ? 'truck' : 'car';
    const mesh = makeVehicle(kind, pick(rng, COLORS), {});
    scene.add(mesh);
    const v = veh(mesh, kind, kind);
    Object.assign(v, {
      axis: 'z', line: 0, t: -400 - rng() * 3400, dir: rng() < 0.5 ? 1 : -1,
      speed: 15 + rng() * 7, stopped: 0, highway: true,
    });
    trafficCars.push(v);
  }
  // Parked pool. The tutorial car sits a few steps north of spawn; the rest
  // spread across the districts, the stations, the Keys and the far north.
  const spots = [
    { x: 8, z: 48, angle: Math.PI, kind: 'car' }, { x: 7, z: 22, angle: 0, kind: 'car' },
    { x: -71, z: -30, angle: Math.PI / 2, kind: 'car' }, { x: 79, z: 40, angle: -Math.PI / 2, kind: 'car' },
    { x: -146, z: 90, angle: 0, kind: 'car' }, { x: 40, z: -71, angle: Math.PI / 2, kind: 'car' },
    { x: -30, z: 154, angle: Math.PI / 2, kind: 'car' }, { x: 154, z: -90, angle: 0, kind: 'car' },
    { x: -79, z: -120, angle: Math.PI / 2, kind: 'car' }, { x: 120, z: 79, angle: -Math.PI / 2, kind: 'car' },
    { x: 71, z: 130, angle: -Math.PI / 2, kind: 'car' }, { x: -120, z: -4, angle: 0, kind: 'car' },
    { x: 14, z: 66, angle: Math.PI, kind: 'moto' }, { x: -60, z: 84, angle: 0, kind: 'moto' },
    { x: -120, z: 130, angle: Math.PI / 2, kind: 'truck' }, { x: 96, z: -140, angle: 0, kind: 'truck' },
    { x: POLICE_STATION.x + 14, z: POLICE_STATION.z + 4, angle: Math.PI / 2, kind: 'police' },
    { x: FIRE_STATION.x - 14, z: FIRE_STATION.z + 4, angle: -Math.PI / 2, kind: 'firetruck' },
    { x: 2, z: 392, angle: 0, kind: 'car' }, { x: -10, z: 262, angle: Math.PI, kind: 'moto' },
    { x: 6, z: -1400, angle: 0, kind: 'car' }, { x: -6, z: -3960, angle: Math.PI, kind: 'car' },
    { x: 8, z: -4190, angle: 0, kind: 'truck' },
  ];
  const NAMES = { car: 'car', moto: 'motorcycle', truck: 'truck', police: 'police car', firetruck: 'fire truck' };
  spots.forEach((s, i) => {
    const sports = i === 5;
    const color = s.kind === 'police' ? 0xffffff : s.kind === 'firetruck' ? 0xd63031 : sports ? 0xff3838 : pick(rng, COLORS);
    const mesh = makeVehicle(s.kind, color, sports ? { spoiler: true, len: 4.8 } : {});
    mesh.position.set(s.x, 0, s.z);
    mesh.rotation.y = s.angle;
    scene.add(mesh);
    const v = veh(mesh, s.kind, sports ? 'red Comet sports car' : NAMES[s.kind]);
    v.angle = s.angle; v.taken = false; v.isTarget = false;
    parkedCars.push(v);
  });
}

const _v = new THREE.Vector3();
export function updateTraffic(dt, playerPos) {
  for (const c of trafficCars) {
    if (c.burnt) continue;
    if (c.stopped > 0) c.stopped -= dt;
    let atRed = false;
    if (!c.highway) { // lights only exist inside the city grid
      const go = c.axis === 'x' ? LIGHT.xGo : LIGHT.zGo;
      if (!go) for (const r of ROADS) {
        const ahead = (r - c.t) * c.dir;
        if (ahead > 1 && ahead < 10) { atRed = true; break; }
      }
    }
    const sp = c.stopped > 0 || c.burning || atRed ? 0 : c.speed;
    c.t += sp * c.dir * dt;
    const lo = c.highway ? NORTH_END + 60 : -195, hi = c.highway ? -230 : 195;
    if (c.t > hi) c.t = lo;
    if (c.t < lo) c.t = hi;
    const lane = c.dir > 0 ? 3.2 : -3.2;
    if (c.axis === 'x') {
      c.mesh.position.set(c.t, groundHeightAt(c.t, c.line + lane, 'x'), c.line + lane);
      c.mesh.rotation.y = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      c.mesh.position.set(c.line + lane, groundHeightAt(c.line + lane, c.t, 'z'), c.t);
      c.mesh.rotation.y = c.dir > 0 ? Math.PI : 0;
    }
    collideBuildings(c.mesh.position, 1.4); // buildings and props are solid
    _v.copy(c.mesh.position).sub(playerPos);
    if (Math.abs(_v.x) < 5 && Math.abs(_v.z) < 5) c.stopped = Math.max(c.stopped, 0.4);
    for (const w of c.mesh.userData.wheels) w.rotation.x += sp * dt * 2;
  }
}

export function allVehicles() {
  return trafficCars.concat(parkedCars.filter((p) => !p.taken));
}
