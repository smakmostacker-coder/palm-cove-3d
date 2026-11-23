// Hand-to-hand and firearms.
//
// F is a punch: anyone within arm's reach goes down briefly and, if it
// lands, the assault is a crime. A mouse click fires the equipped weapon —
// and the equipped weapon is whatever the selected hotbar slot holds
// (inventory.js owns that truth), so this module never grants anything.
//
// The pistol is short, loud work: two stars, every pedestrian nearby runs.
// The sniper is the opposite trade: three stars and one of a finite pool of
// rounds per shot, but it reaches seventy units and, while scoped, the
// nearest person in that reach always goes down.
import { G } from './state.js';
import { peds } from './pedestrians.js';
import { commitCrime } from './police.js';
import { sfx } from './audio.js';

export function punch(originPos) {
  G.stats.punches++;
  sfx.punch();
  let landed = false;
  for (const p of peds) {
    if (p.mesh.position.distanceTo(originPos) < 2.6) {
      p.down = 2.5; p.flee = 0; landed = true;
    }
  }
  if (landed) commitCrime(Math.max(1, G.wanted), 'Assault');
  return landed;
}

// One nearby pedestrian, scared off rather than hurt — kept for callers
// that need a debtor-style reaction without a punch landing.
export function intimidate(originPos) {
  for (const p of peds) {
    if (p.mesh.position.distanceTo(originPos) < 4) { p.flee = 1.5; return p; }
  }
  return null;
}

export function shoot(originPos, scene) {
  if (G.weapon === 'Pistol') {
    G.stats.shotsFired++;
    sfx.shot();
    commitCrime(Math.max(2, G.wanted), 'Shots fired');
    for (const p of peds) p.flee = Math.max(p.flee, 1);
    return true;
  }
  if (G.weapon === 'Sniper') {
    if (G.sniperAmmo <= 0) { sfx.fail(); return false; }
    G.sniperAmmo--;
    G.stats.shotsFired++;
    sfx.sniper();
    commitCrime(Math.max(3, G.wanted), 'Sniper fire');
    let nearest = null, nearestD = 70;
    for (const p of peds) {
      const d = p.mesh.position.distanceTo(originPos);
      if (d < nearestD) { nearestD = d; nearest = p; }
    }
    // Unscoped shots only connect up close; the scope buys the range.
    if (nearest && (G.scoped || nearestD < 25)) nearest.down = 6;
    for (const p of peds) p.flee = Math.max(p.flee, 1.5);
    return true;
  }
  return false;
}

// Kept for older call sites: granting a weapon means putting it in the
// hotbar, so delegate to the inventory (loaded lazily to avoid a cycle).
export function grantWeapon(id) {
  import('./inventory.js').then((m) => { m.addItem(id); });
}
