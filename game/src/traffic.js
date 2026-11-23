// Pooled traffic v2: denser mixed-class flow (cars, motorcycles, trucks) looping
// the road grid, plus a parked pool covering EVERY stealable class — cars, a
// motorcycle, a docks truck, a police car at the station and the damkar fire
// truck at the fire station.
import { ROADS, FIRE_STATION, POLICE_STATION } from './config.js';
import { makeRng, pick } from './random.js';
import { makeVehicle, LIGHT, groundHeightAt } from './city.js';

const COLORS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xecf0f1, 0xfd79a8];
export const trafficCars = [];  // {mesh,pos,axis,line,dir,speed,health,kind,burning,burnt,...}
export const parkedCars = [];   // {mesh,pos,angle,health,speed,kind,name,...}

function veh(mesh, kind, name) {
  return { mesh, pos: mesh.position, kind, name, health: 100, speed: 0, burning: 0, burnt: false, burnT: 0, sprayed: 0 };
}
export function buildTraffic(scene, seed) {
  const rng = makeRng(seed * 331 + 7);
  const kinds = [];
  for (let i = 0; i < 15; i++) kinds.push("car");
  for (let i = 0; i < 4; i++) kinds.push("moto");
  for (let i = 0; i < 3; i++) kinds.push('truck');
  kinds.forEach((kind, i) => {
    const mesh = makeVehicle(kind, pick(rng, COLORS), {});
    scene.add(mesh);
    const horiz = rng() < 0.5;
    const v = veh(mesh, kind, kind);
    Object.assign(v, {
      axis: horiz ? 'x' : 'z', line: pick(rng, ROADS),
      t: -190 + rng() * 380, dir: rng() < 0.5 ? 1 : -1,
      speed: kind === 'moto' ? 13 + rng() * 6 : kind === 'truck' ? 6 + rng() * 3 : 9 + rng() * 7, stopped: 0,
    });
    trafficCars.push(v);
  });
  // Parked pool: tutorial car first (a few steps north of spawn), then a spread
  // across districts, then the special classes at their stations.
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
  ];
  const NAMES = { car: 'car', moto: 'motorcycle', truck: 'truck', police: 'police car', firetruck: 'fire truck' };
  spots.forEach((s, i) => {
    const sports = i === 5;
    const color = s.kind === 'police' ? 0xffffff : s.kind === 'firetruck' ? 0xd63031 : sports ? 0xff3838 : pick(rng, COLORS);
    const mesh = makeVehicle(s.kind, color, sports ? { spoiler: true, len: 4.8 } : {});
    mesh.position.set(s.x, 0, s.z); mesh.rotation.y = s.angle;
    scene.add(mesh);
    const v = veh(mesh, s.kind, sports ? 'red Comet sports car' : NAMES[s.kind]);
    v.angle = s.angle; v.taken = false; v.isTarget = false;
    parkedCars.push(v);
  });
}
const _v = new THREE.Vector3();
export function updateTraffic(dt, playerPos) {
  for (const c of trafficCars) {
    if (c.burnt) continue; // charred wrecks stay where they died
    if (c.stopped > 0) c.stopped -= dt;
    // Traffic lights (Part J): stop at the next junction on red for your axis.
    let atRed = false;
    const go = c.axis === 'x' ? LIGHT.xGo : LIGHT.zGo;
    if (!go) for (const r of ROADS) { const ahead = (r - c.t) * c.dir; if (ahead > 1 && ahead < 10) { atRed = true; break; } }
    const sp = c.stopped > 0 || c.burning || atRed ? 0 : c.speed;
    c.t += sp * c.dir * dt;
    if (c.t > 195) c.t = -195; if (c.t < -195) c.t = 195;
    const lane = c.dir > 0 ? 3.2 : -3.2;
    if (c.axis === 'x') { c.mesh.position.set(c.t, groundHeightAt(c.t, c.line + lane, 'x'), c.line + lane); c.mesh.rotation.y = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
    else { c.mesh.position.set(c.line + lane, groundHeightAt(c.line + lane, c.t, 'z'), c.t); c.mesh.rotation.y = c.dir > 0 ? Math.PI : 0; }
    _v.copy(c.mesh.position).sub(playerPos);
    if (Math.abs(_v.x) < 5 && Math.abs(_v.z) < 5) c.stopped = Math.max(c.stopped, 0.4);
    for (const w of c.mesh.userData.wheels) w.rotation.x += sp * dt * 2;
  }
}
export function allVehicles() {
  return trafficCars.concat(parkedCars.filter((p) => !p.taken));
}
