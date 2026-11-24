// Visual settings: applied defensively because the DOM and renderer
// may not both exist yet when a settings change lands.
import { G } from './state.js';

function settings() {
  return G.settings && typeof G.settings === 'object' ? G.settings : {};
}

export function applyVisualSettings(container, renderer) {
  const s = settings();

  if (container && container.style) {
    const b = Number.isFinite(s.brightness) ? s.brightness : 1;
    // CSS filter is the cheapest whole-frame brightness control available.
    container.style.filter = `brightness(${b})`;
  }

  if (renderer) {
    try {
      if (s.quality === 'high') {
        const dpr = globalThis.devicePixelRatio || 1;
        if (typeof renderer.setPixelRatio === 'function') {
          renderer.setPixelRatio(Math.min(dpr, 2));
        }
        if (renderer.shadowMap) renderer.shadowMap.enabled = true;
      } else if (s.quality === 'low') {
        // Pixel ratio 1 is the single biggest mobile frame-rate win.
        if (typeof renderer.setPixelRatio === 'function') {
          renderer.setPixelRatio(1);
        }
        if (renderer.shadowMap) renderer.shadowMap.enabled = false;
      }
    } catch (err) {
      // A renderer mid-teardown must not take the settings menu down too.
    }
  }

  try {
    let joy = null;
    if (container && typeof container.querySelector === 'function') {
      joy = container.querySelector('#joy');
    }
    if (!joy && globalThis.document) {
      joy = globalThis.document.getElementById('joy');
    }
    if (joy && joy.style) {
      const scale = Number.isFinite(s.joystick) ? s.joystick : 1;
      joy.style.transform = `scale(${scale})`;
    }
  } catch (err) {
    // Missing touch UI on desktop is normal, not an error.
  }
}

export function frameInterval() {
  const s = settings();
  // 0 means uncapped; 30fps returns the exact budget the loop sleeps on.
  return s.fps === 30 ? 1000 / 30 : 0;
}
