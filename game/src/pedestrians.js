// Pooled pedestrians: they stroll the sidewalks and both beaches, flee
// danger at a run, and can be flagged as taxi fares. They use the same
// articulated figures as the leads (city.js), posed with a gentler version
// of the walk cycle — and a visibly faster, longer one when fleeing.
// Sidewalk routes run past lamps and trees, so every step resolves against
// the prop colliders: nobody ghosts through a pole any more.
import { ROADS, ROAD_W } from './config.js';
import { makeRng, pick } from './random.js';
import { makePerson, posePerson, collideProps } from './city.js';

export const peds = []; // {mesh, axis, line, side, t, dir, speed, flee, flagged, swing, down}
const SHIRTS = [0xff6b81, 0x7bed9f, 0x70a1ff, 0xeccc68, 0xff7f50, 0xa4b0be, 0x2ed573, 0x5352ed];
const SKIN = [0xf1c27d, 0xe0ac69, 0x8d5524, 0xffdbac];

export function buildPeds(scene, seed) {
  const rng = makeRng(seed * 977 + 31);
  for (let i = 0; i < 22; i++) {
    const mesh = makePerson(pick(rng, SHIRTS), pick(rng, SHIRTS), pick(rng, SKIN));
    scene.add(mesh);
    peds.push({
      mesh, axis: rng() < 0.5 ? 'x' : 'z', line: pick(rng, ROADS),
      side: rng() < 0.5 ? 1 : -1, t: -180 + rng() * 360,
      dir: rng() < 0.5 ? 1 : -1, speed: 1.6 + rng() * 1.2,
      flee: 0, flagged: false, swing: rng() * 6, down: 0, idle: rng() * 6,
    });
  }
  // Beach strollers walk the sand lines on both coasts.
  for (let i = 0; i < 6; i++) {
    const mesh = makePerson(pick(rng, SHIRTS), pick(rng, SHIRTS), pick(rng, SKIN));
    scene.add(mesh);
    peds.push({
      mesh, axis: 'z', line: (i % 2 ? 214 : -214), side: (i % 2 ? 1 : -1),
      t: -180 + rng() * 360, dir: rng() < 0.5 ? 1 : -1, speed: 1.4 + rng(),
      flee: 0, flagged: false, swing: rng() * 6, down: 0, idle: rng() * 6,
    });
  }
}

export function updatePeds(dt, dangerPos, dangerRadius) {
  for (const p of peds) {
    if (p.down > 0) {
      p.down -= dt;
      p.mesh.rotation.x = Math.PI / 2;
      if (p.down <= 0) p.mesh.rotation.x = 0;
      continue;
    }
    const pos = p.mesh.position;
    let sp = p.speed;
    let running = false;
    // A ped with its own scare (an ejected driver fleeing his thief) runs
    // from that point even when there is no global danger position.
    const dp = dangerPos || (p.flee > 0 ? p.fleeFrom : null);
    if (dangerPos) {
      const dx = pos.x - dangerPos.x, dz = pos.z - dangerPos.z;
      if (dx * dx + dz * dz < dangerRadius * dangerRadius) p.flee = 1.2;
    }
    if (p.flee > 0 && dp) {
      p.flee -= dt; sp = 6; running = true;
      const dx = pos.x - dp.x, dz = pos.z - dp.z;
      const l = Math.hypot(dx, dz) || 1;
      pos.x += (dx / l) * sp * dt;
      pos.z += (dz / l) * sp * dt;
      p.mesh.rotation.y = Math.atan2(dx, dz);
      // Keep the stroll route under the ped's feet, so when the scare
      // ends it resumes walking from here instead of snapping back.
      if (p.axis === 'x') p.t = Math.max(-195, Math.min(195, pos.x));
      else p.t = Math.max(-195, Math.min(195, pos.z));
      if (p.flee <= 0) p.fleeFrom = null;
    } else {
      if (p.flee > 0) p.flee -= dt;
      p.t += sp * p.dir * dt;
      if (p.t > 195) p.dir = -1;
      if (p.t < -195) p.dir = 1;
      const off = p.side * (ROAD_W / 2 + 2.5);
      if (p.axis === 'x') { pos.set(p.t, 0.3, p.line + off); p.mesh.rotation.y = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
      else { pos.set(p.line + off, 0.3, p.t); p.mesh.rotation.y = p.dir > 0 ? 0 : Math.PI; }
    }
    pos.x = Math.max(-230, Math.min(230, pos.x));
    pos.z = Math.max(-198, Math.min(430, pos.z));
    collideProps(pos, 0.35); // step around lamps, trees and hydrants
    p.swing += dt * sp * (running ? 2.6 : 2.2);
    p.idle += dt;
    if (running) posePerson(p.mesh, p.swing, 0.95, 0.95, 0.2, p.idle * 2);
    else posePerson(p.mesh, p.swing, 0.55, 0.5, 0.05, p.idle * 2);
  }
}
