// localStorage autosave — a single slot.
//
// What persists: cash and story progress, the weapon loadout (owned list,
// current weapon, sniper ammo), the chosen lead, the found-items inventory
// with its selected slot and armour value, lifetime statistics, the
// story-tracking record that decides endings, and which endings have been
// unlocked. Everything is best-effort: private-mode or quota failures are
// swallowed and the game simply runs unsaved.
import { SAVE_KEY } from './config.js';
import { G } from './state.js';

export function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: G.money,
      missionIndex: G.missionIndex,
      storyDone: G.storyDone,
      weapon: G.weapon,
      weapons: G.weapons,
      sniperAmmo: G.sniperAmmo,
      character: G.character,
      inventory: G.inventory,
      selectedSlot: G.selectedSlot,
      armour: G.armour,
      stats: G.stats,
      track: G.track,
      endingsUnlocked: G.endingsUnlocked,
      lastEnding: G.lastEnding,
      savedAt: Date.now(),
    }));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Merge a parsed save back into G, tolerating saves written by older builds
// that lack the newer fields — every field falls back to the live default.
export function applySave(s) {
  if (!s) return;
  G.money = s.money ?? G.money;
  G.missionIndex = s.missionIndex ?? 0;
  G.storyDone = !!s.storyDone;
  G.weapon = s.weapon || 'Fists';
  if (Array.isArray(s.weapons) && s.weapons.length) G.weapons = s.weapons;
  G.sniperAmmo = s.sniperAmmo ?? G.sniperAmmo;
  if (s.character) G.character = s.character;
  if (Array.isArray(s.inventory)) G.inventory = s.inventory;
  G.selectedSlot = s.selectedSlot ?? 0;
  G.armour = s.armour ?? 0;
  if (s.stats) G.stats = Object.assign(G.stats, s.stats);
  if (s.track) G.track = Object.assign(G.track, s.track);
  if (Array.isArray(s.endingsUnlocked)) G.endingsUnlocked = s.endingsUnlocked;
  G.lastEnding = s.lastEnding || '';
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage unavailable */ }
}
