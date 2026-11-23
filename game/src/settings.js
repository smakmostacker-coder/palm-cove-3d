// Player settings, persisted in localStorage and applied immediately.
//
// Covered here: sound volume and mute, the FPS cap (30 or 60), the graphics
// tier ('standard' or 'hd'), screen brightness, and the on-screen joystick
// toggle. Touch devices additionally auto-enable the touch UI in touch.js;
// this stored flag remains the manual override the Settings screen exposes.
export const SETTINGS_KEY = 'palm-cove-settings-v1';

export const settings = {
  volume: 0.8,
  muted: false,
  fpsCap: 60,
  quality: 'standard',
  brightness: 1,
  joystick: false,
};

export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (stored) Object.assign(settings, stored);
  } catch (e) { /* keep defaults when storage is unreadable */ }
  return settings;
}

export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* best effort */ }
}

// The renderer registers a hook so quality-tier changes (pixel ratio, shadow
// and draw tweaks) apply without settings.js importing the whole scene.
let graphicsHook = null;
export function onGraphics(fn) { graphicsHook = fn; }

export function applySettings() {
  // Brightness is a CSS filter over the WebGL canvas wrapper: cheap, and it
  // affects the 3D view and DOM HUD in one move.
  const app = document.getElementById('app');
  if (app) app.style.filter = 'brightness(' + settings.brightness.toFixed(2) + ')';
  if (graphicsHook) graphicsHook(settings);
  saveSettings();
}
