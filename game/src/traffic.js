// Pooled traffic: AI cars loop the road grid; parked cars wait to be stolen.
import { ROADS } from './config.js';
import { makeRng, pick } from './random.js';
import { makeCar } from './city.js';

const COLORS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xecf0f1, 0xfd79a8];
export const trafficCars = [];  // {mesh,pos,axis,line,dir,speed,health}
export const parkedCars = [];   // {mesh,pos,angle,health,speed, colorName}

export function buildTraffic(scene, seed) {
  const rng = makeRng(seed * 331 + 7);
  for (let i = 0; i < 14; i++) {
    const mesh = makeCar(pick(rng, COLORS), {});
    scene.add(mesh);
    const horiz = rng() < 0.5;
    trafficCars.push({
      mesh, axis: horiz ? 'x' : 'z', line: pick(rng, ROADS),
      t: -190 + rng() * 380, dir: rng() < 0.5 ? 1 : -1,
      speed: 9 + rng() * 7, health: 100, stopped: 0,
    });
  }
  // Parked cars: the first sits a few steps north of the player spawn (the tutorial car),
  // the second waits in the same lane so a careless first drive ends in a fender-bender.
  const spots = [
    { x: 8, z: 48, angle: Math.PI }, { x: 7, z: 22, angle: 0 },
    { x: -71, z: -30, angle: Math.PI / 2 }, { x: 79, z: 40, angle: -Math.PI / 2 },
    { x: -146, z: 90, angle: 0 }, { x: 40, z: -71, angle: Math.PI / 2 },
    { x: -30, z: 154, angle: Math.PI / 2 }, { x: 154, z: -90, angle: 0 },
    { x: -79, z: -120, angle: Math.PI / 2 }, { x: 120, z: 79, angle: -Math.PI / 2 },
    { x: 71, z: 130, angle: -Math.PI / 2 }, { x: -120, z: -4, angle: 0 },
  ];
  spots.forEach((s, i) => {
    const sports = i === 5;
    const mesh = makeCar(sports ? 0xff3838 : pick(rng, COLORS), sports ? { spoiler: true, len: 4.8 } : {});
    mesh.position.set(s.x, 0, s.z); mesh.rotation.y = s.angle;
    scene.add(mesh);
    parkedCars.push({ mesh, pos: mesh.position, angle: s.angle, health: 100, speed: 0, taken: false, isTarget: false, name: sports ? 'red Comet sports car' : 'car' });
  });
}
const _v = new THREE.Vector3();
export function updateTraffic(dt, playerPos) {
  for (const c of trafficCars) {
    if (c.stopped > 0) c.stopped -= dt;
    const sp = c.stopped > 0 ? 0 : c.speed;
    c.t += sp * c.dir * dt;
    if (c.t > 195) c.t = -195; if (c.t < -195) c.t = 195;
    const lane = c.dir > 0 ? 3.2 : -3.2;
    if (c.axis === 'x') { c.mesh.position.set(c.t, 0, c.line + lane); c.mesh.rotation.y = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
    else { c.mesh.position.set(c.line + lane, 0, c.t); c.mesh.rotation.y = c.dir > 0 ? Math.PI : 0; }
    // Simple avoidance: stop if the player (or their car) is right ahead
    _v.copy(c.mesh.position).sub(playerPos); 
    if (Math.abs(_v.x) < 5 && Math.abs(_v.z) < 5) c.stopped = Math.max(c.stopped, 0.4);
    for (const w of c.mesh.userData.wheels) w.rotation.x += sp * dt * 2;
  }
}
export function allVehicles() { return trafficCars.map((c) => c.mesh).concat(parkedCars.filter((p) => !p.taken).map((p) => p.mesh)); }
