// localStorage autosave: one slot holding progress, money and lifetime stats.
import { SAVE_KEY } from './config.js';
import { G } from './state.js';
export function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: G.money, missionIndex: G.missionIndex, storyDone: G.storyDone,
      weapon: G.weapon, stats: G.stats, savedAt: Date.now(),
    }));
    return true;
  } catch (e) { return false; }
}
export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
export function applySave(s) {
  if (!s) return;
  G.money = s.money ?? G.money; G.missionIndex = s.missionIndex ?? 0;
  G.storyDone = !!s.storyDone; G.weapon = s.weapon || 'Fists';
  if (s.stats) G.stats = Object.assign(G.stats, s.stats);
}
export function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
