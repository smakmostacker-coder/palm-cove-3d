// Settings (Part G): persisted in localStorage, applied immediately and on
// boot — sound volume/mute, FPS cap (30/60), graphics tier (Standard / HD),
// brightness, and the on-screen joystick toggle.
export const SETTINGS_KEY = 'palm-cove-settings-v1';
export const settings = { volume: 0.8, muted: false, fpsCap: 60, quality: 'standard', brightness: 1, joystick: false };
export function loadSettings() {
  try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); if (s) Object.assign(settings, s); } catch (e) {}
  return settings;
}
export function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} }
let graphicsHook = null;
export function onGraphics(fn) { graphicsHook = fn; }
export function applySettings() {
  // Brightness: CSS filter on the WebGL canvas wrapper — cheap and visible.
  const app = document.getElementById('app');
  if (app) app.style.filter = 'brightness(' + settings.brightness.toFixed(2) + ')';
  if (graphicsHook) graphicsHook(settings);
  saveSettings();
}
