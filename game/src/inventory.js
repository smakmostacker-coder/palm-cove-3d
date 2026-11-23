// 5-slot item inventory / hotbar (Part H). Weapons ARE inventory items:
// selecting the pistol or sniper slot equips that weapon (one source of truth
// shared with combat.js). Consumables stack and are used with X.
// Item set: Pistol (weapon), Sniper Rifle (weapon), Snack (+40 HP, stacks),
// Armour Vest (use -> 60-point damage shield), Cove Cola (+15 HP, stacks).
import { G } from './state.js';
import { sfx } from './audio.js';
export const ITEM_DEFS = {
  pistol: { name: 'Pistol', icon: '🔫', weapon: 'Pistol', stack: false },
  sniper: { name: 'Sniper Rifle', icon: '🎯', weapon: 'Sniper', stack: false },
  snack: { name: 'Snack', icon: '🍔', stack: true },
  armour: { name: 'Armour Vest', icon: '🛡️', stack: true },
  cola: { name: 'Cove Cola', icon: '🥤', stack: true },
  medkit: { name: 'Medkit', icon: '💊', stack: true },
  ammo: { name: 'Sniper Rounds ×12', icon: '🔹', stack: true },
};
export function emptyInv() { return [null, null, null, null, null]; }
if (!G.inventory) G.inventory = emptyInv();
G.selectedSlot = 0; G.armour = 0;
export function syncWeapon() {
  const it = G.inventory[G.selectedSlot];
  G.weapon = it && ITEM_DEFS[it.id].weapon ? ITEM_DEFS[it.id].weapon : 'Fists';
}
export function hasItem(id) { return G.inventory.some((s) => s && s.id === id); }
export function addItem(id) {
  const def = ITEM_DEFS[id]; if (!def) return false;
  if (def.stack) { const s = G.inventory.find((x) => x && x.id === id); if (s) { s.count++; return true; } }
  if (hasItem(id) && !def.stack) return true; // already owned: counts as taken
  const free = G.inventory.findIndex((s) => !s);
  if (free === -1) return false; // full: caller shows the honest hint
  G.inventory[free] = { id, count: 1 };
  syncWeapon();
  return true;
}
export function selectSlot(n) {
  if (n < 0 || n > 4) return;
  G.selectedSlot = n; syncWeapon(); sfx.pickup();
}
export function useSelected() {
  const s = G.inventory[G.selectedSlot];
  if (!s) return false;
  if (s.id === 'snack') { if (G.health >= 100) return false; G.health = Math.min(100, G.health + 40); }
  else if (s.id === 'cola') { if (G.health >= 100 && G.armour > 0) return false; G.health = Math.min(100, G.health + 15); }
  else if (s.id === 'armour') { if (G.armour >= 60) return false; G.armour = 60; }
  else if (s.id === 'medkit') { if (G.health >= 100) return false; G.health = Math.min(100, G.health + 80); }
  else if (s.id === 'ammo') { G.sniperAmmo += 12; }
  else return false; // weapons are fired, not "used"
  s.count--; if (s.count <= 0) G.inventory[G.selectedSlot] = null;
  syncWeapon(); sfx.cash();
  return true;
}
export function invSummary() { return G.inventory.map((s) => s ? s.id + (s.count > 1 ? 'x' + s.count : '') : '—').join(' · '); }
