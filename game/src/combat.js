// Combat: F punches nearby pedestrians (they drop, witnesses raise the heat),
// and once Lucia arms Vera, mouse click fires the pistol.
import { G } from './state.js';
import { peds } from './pedestrians.js';
import { commitCrime } from './police.js';
import { sfx } from './audio.js';

export function punch(originPos) {
  G.stats.punches++; sfx.punch();
  let hit = false;
  for (const p of peds) {
    if (p.mesh.position.distanceTo(originPos) < 2.6) { p.down = 2.5; p.flee = 0; hit = true; }
  }
  if (hit) commitCrime(Math.max(1, G.wanted), 'Assault');
  return hit;
}
export function intimidate(originPos) {
  // Mission helper: a punch or an aimed pistol near a debtor counts as pressure.
  for (const p of peds) if (p.mesh.position.distanceTo(originPos) < 4) { p.flee = 1.5; return p; }
  return null;
}
export function shoot(originPos, scene) {
  if (G.weapon !== 'Pistol') return false;
  G.stats.shotsFired++; sfx.shot();
  commitCrime(Math.max(2, G.wanted), 'Shots fired');
  for (const p of peds) p.flee = Math.max(p.flee, 1);
  return true;
}
