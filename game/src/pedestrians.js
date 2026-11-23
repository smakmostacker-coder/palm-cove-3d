// Pooled pedestrians: stroll the sidewalks, flee danger, can be taxi fares.
// v2 crowds the dusk streets: more walkers, plus beach strollers on both coasts.
import { ROADS, ROAD_W } from './config.js';
import { makeRng, pick } from './random.js';
import { makePerson } from './city.js';

export const peds = []; // {mesh,pos,axis,line,t,dir,speed,flee,flagged,swing}
const SHIRTS = [0xff6b81, 0x7bed9f, 0x70a1ff, 0xeccc68, 0xff7f50, 0xa4b0be, 0x2ed573, 0x5352ed];

export function buildPeds(scene, seed) {
  const rng = makeRng(seed * 977 + 31);
  for (let i = 0; i < 22; i++) {
    const mesh = makePerson(pick(rng, SHIRTS), pick(rng, SHIRTS), 0xf1c27d);
    scene.add(mesh);
    peds.push({
      mesh, axis: rng() < 0.5 ? 'x' : 'z', line: pick(rng, ROADS),
      side: rng() < 0.5 ? 1 : -1, t: -180 + rng() * 360,
      dir: rng() < 0.5 ? 1 : -1, speed: 1.6 + rng() * 1.2,
      flee: 0, flagged: false, swing: rng() * 6, down: 0,
    });
  }
  // Beach strollers walk the sand lines on both coasts (axis z, line = beach x).
  for (let i = 0; i < 6; i++) {
    const mesh = makePerson(pick(rng, SHIRTS), pick(rng, SHIRTS), 0xf1c27d);
    scene.add(mesh);
    peds.push({ mesh, axis: 'z', line: (i % 2 ? 214 : -214), side: (i % 2 ? 1 : -1), t: -180 + rng() * 360, dir: rng() < 0.5 ? 1 : -1, speed: 1.4 + rng(), flee: 0, flagged: false, swing: rng() * 6, down: 0 });
  }
}
export function updatePeds(dt, dangerPos, dangerRadius) {
  for (const p of peds) {
    if (p.down > 0) { p.down -= dt; p.mesh.rotation.x = Math.PI / 2; if (p.down <= 0) p.mesh.rotation.x = 0; continue; }
    const pos = p.mesh.position;
    let sp = p.speed;
    if (dangerPos) {
      const dx = pos.x - dangerPos.x, dz = pos.z - dangerPos.z;
      if (dx * dx + dz * dz < dangerRadius * dangerRadius) p.flee = 1.2;
    }
    if (p.flee > 0 && dangerPos) { // run away from danger, off the road line
      p.flee -= dt; sp = 6;
      const dx = pos.x - dangerPos.x, dz = pos.z - dangerPos.z;
      const l = Math.hypot(dx, dz) || 1;
      pos.x += (dx / l) * sp * dt; pos.z += (dz / l) * sp * dt;
      p.mesh.rotation.y = Math.atan2(dx, dz);
    } else {
      if (p.flee > 0) p.flee -= dt; // danger gone: calm down, resume the stroll
      p.t += sp * p.dir * dt;
      if (p.t > 195) p.dir = -1; if (p.t < -195) p.dir = 1;
      const off = p.side * (ROAD_W / 2 + 2.5);
      if (p.axis === 'x') { pos.set(p.t, 0.3, p.line + off); p.mesh.rotation.y = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
      else { pos.set(p.line + off, 0.3, p.t); p.mesh.rotation.y = p.dir > 0 ? 0 : Math.PI; }
    }
    pos.x = Math.max(-230, Math.min(230, pos.x)); pos.z = Math.max(-198, Math.min(430, pos.z));
    p.swing += dt * sp * 2.4;
    p.mesh.userData.armL.rotation.x = Math.sin(p.swing) * 0.6;
    p.mesh.userData.armR.rotation.x = -Math.sin(p.swing) * 0.6;
  }
}
