// Persistence: one JSON blob in localStorage, guarded because storage
// can be blocked, full, or cleared without the game's consent.
import { G } from './state.js';
import { SAVE_KEY } from './config.js';
import { invSnapshot, invRestore } from './inventory.js';

export function saveGame(playerPos) {
  try {
    const data = {
      money: G.money,
      health: G.health,
      lead: G.lead,
      partner: G.partner,
      stats: G.stats,
      endingsFound: G.endingsFound,
      settings: G.settings,
      minimapZoom: G.minimapZoom,
      radioStation: G.radioStation,
      inventory: invSnapshot(),
      player: {
        x: playerPos && Number.isFinite(playerPos.x) ? playerPos.x : 0,
        z: playerPos && Number.isFinite(playerPos.z) ? playerPos.z : 0,
      },
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch (err) {
    // A corrupt save is treated as no save, never as a crash.
    return null;
  }
}

function pick(value, fallback) {
  return value === undefined || value === null ? fallback : value;
}

export function applySave(data) {
  if (!data || typeof data !== 'object') return false;
  G.money = Number.isFinite(data.money) ? data.money : G.money;
  G.health = Number.isFinite(data.health) ? data.health : G.health;
  G.lead = pick(data.lead, G.lead);
  G.partner = pick(data.partner, G.partner);
  if (data.stats && typeof data.stats === 'object') {
    // Merge over current stats so newer fields survive older saves.
    G.stats = Object.assign({}, G.stats, data.stats);
    if (!Array.isArray(G.stats.choices)) G.stats.choices = [];
  }
  if (Array.isArray(data.endingsFound)) {
    G.endingsFound = data.endingsFound.slice();
  }
  if (data.settings && typeof data.settings === 'object') {
    G.settings = Object.assign({}, G.settings, data.settings);
  }
  G.minimapZoom = pick(data.minimapZoom, G.minimapZoom);
  G.radioStation = Number.isFinite(data.radioStation)
    ? data.radioStation
    : G.radioStation;
  if (data.inventory) invRestore(data.inventory);
  return true;
}

export function wipeSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
    return true;
  } catch (err) {
    return false;
  }
}
