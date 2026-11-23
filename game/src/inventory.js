// The five-slot hotbar inventory.
//
// One list is the single source of truth for what the lead is carrying, and
// weapons live in it like everything else: whichever slot is selected decides
// the equipped weapon (combat.js reads G.weapon, which syncWeapon() keeps in
// step). Consumables stack; weapons do not. Using a slot is X — firing a
// weapon is the mouse, never X.
//
//   pistol  Pistol (weapon)          snack   Snack       (+40 HP, stacks)
//   sniper  Sniper Rifle (weapon)    cola    Cove Cola   (+15 HP, stacks)
//   armour  Armour Vest (60 shield)  medkit  Medkit      (+80 HP, stacks)
//   ammo    Sniper Rounds x12 (adds to the sniper pool, stacks)
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

// First import initialises the fields the save system also reads.
if (!G.inventory) G.inventory = emptyInv();
if (G.selectedSlot === undefined) G.selectedSlot = 0;
if (G.armour === undefined) G.armour = 0;

export function syncWeapon() {
  const slot = G.inventory[G.selectedSlot];
  const def = slot && ITEM_DEFS[slot.id];
  G.weapon = def && def.weapon ? def.weapon : 'Fists';
}

export function hasItem(id) {
  return G.inventory.some((s) => s && s.id === id);
}

// Returns false only when a non-stacking item cannot be placed because every
// slot is full — callers surface that honestly instead of silently dropping it.
export function addItem(id) {
  const def = ITEM_DEFS[id];
  if (!def) return false;
  if (def.stack) {
    const held = G.inventory.find((s) => s && s.id === id);
    if (held) { held.count++; return true; }
  } else if (hasItem(id)) {
    return true; // a second pistol is the same pistol
  }
  const free = G.inventory.findIndex((s) => !s);
  if (free === -1) return false;
  G.inventory[free] = { id, count: 1 };
  syncWeapon();
  return true;
}

export function selectSlot(n) {
  if (n < 0 || n > 4) return;
  G.selectedSlot = n;
  syncWeapon();
  sfx.pickup();
}

// Consume whatever is selected. Weapons refuse: they are fired, not eaten.
export function useSelected() {
  const slot = G.inventory[G.selectedSlot];
  if (!slot) return false;
  switch (slot.id) {
    case 'snack':
      if (G.health >= 100) return false;
      G.health = Math.min(100, G.health + 40); break;
    case 'cola':
      if (G.health >= 100 && G.armour > 0) return false;
      G.health = Math.min(100, G.health + 15); break;
    case 'medkit':
      if (G.health >= 100) return false;
      G.health = Math.min(100, G.health + 80); break;
    case 'armour':
      if (G.armour >= 60) return false;
      G.armour = 60; break;
    case 'ammo':
      G.sniperAmmo += 12; break;
    default:
      return false;
  }
  slot.count--;
  if (slot.count <= 0) G.inventory[G.selectedSlot] = null;
  syncWeapon();
  sfx.cash();
  return true;
}

export function invSummary() {
  return G.inventory.map((s) => (s ? s.id + (s.count > 1 ? 'x' + s.count : '') : '—')).join(' · ');
}
