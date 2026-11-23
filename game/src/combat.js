// Combat v2: F punches; mouse click fires the equipped weapon — the pistol
// Lucia lends Vera, or the scoped sniper rifle (Part C). The equipped weapon
// comes from the inventory hotbar selection (inventory.js owns that truth).
// Sniper: hold right-mouse (or V) to scope — FOV narrows in main.js — shots
// are long-range, high-damage, loud (3 stars), and cost 1 of 24 rounds.
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
  for (const p of peds) if (p.mesh.position.distanceTo(originPos) < 4) { p.flee = 1.5; return p; }
  return null;
}
export function shoot(originPos, scene) {
  if (G.weapon === 'Pistol') {
    G.stats.shotsFired++; sfx.shot();
    commitCrime(Math.max(2, G.wanted), 'Shots fired');
    for (const p of peds) p.flee = Math.max(p.flee, 1);
    return true;
  }
  if (G.weapon === 'Sniper') {
    if (G.sniperAmmo <= 0) { sfx.fail(); return false; }
    G.sniperAmmo--; G.stats.shotsFired++; sfx.sniper();
    commitCrime(Math.max(3, G.wanted), 'Sniper fire');
    // Long-range effect: the nearest pedestrian within 70 units in front goes
    // down; scoped shots never miss the closest target in that cone.
    let best = null, bd = 70;
    for (const p of peds) { const d = p.mesh.position.distanceTo(originPos); if (d < bd) { bd = d; best = p; } }
    if (best && (G.scoped || bd < 25)) { best.down = 6; }
    for (const p of peds) p.flee = Math.max(p.flee, 1.5);
    return true;
  }
  return false;
}
export function grantWeapon(id) {
  // Back-compat helper: weapons enter through the inventory now.
  import('./inventory.js').then((m) => { m.addItem(id); });
}
