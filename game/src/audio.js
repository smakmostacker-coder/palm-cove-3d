// Tiny WebAudio synth: every sound is an oscillator/noise burst, no audio files.
// v2: a master gain node carries the Settings volume slider + mute toggle.
import { settings } from './settings.js';
let ctx = null, master = null;
function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; }
    if (ctx) { master = ctx.createGain(); master.connect(ctx.destination); }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
  if (master) master.gain.value = settings.muted ? 0 : settings.volume;
  return ctx;
}
function out() { return master || (ac() && master); }
function tone(freq, dur, type, vol, slideTo) {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'square'; o.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
  g.gain.setValueAtTime(vol || 0.08, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g); g.connect(out()); o.start(); o.stop(c.currentTime + dur);
}
function noise(dur, vol) {
  const c = ac(); if (!c) return;
  const len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = c.createBufferSource(); s.buffer = buf;
  const g = c.createGain(); g.gain.value = vol || 0.15;
  s.connect(g); g.connect(out()); s.start();
}
export const sfx = {
  pickup() { tone(880, 0.12, 'square', 0.07, 1320); },
  cash() { tone(660, 0.1, 'square', 0.07); setTimeout(() => tone(990, 0.16, 'square', 0.07), 90); },
  shot() { noise(0.12, 0.22); tone(160, 0.1, 'sawtooth', 0.1, 60); },
  sniper() { noise(0.3, 0.3); tone(90, 0.35, 'sawtooth', 0.16, 35); setTimeout(() => tone(1400, 0.2, 'sine', 0.05, 300), 60); },
  boom() { noise(0.6, 0.4); tone(60, 0.6, 'triangle', 0.25, 28); },
  splash() { noise(0.18, 0.06); },
  firetruck() { tone(520, 0.22, 'triangle', 0.05, 780); setTimeout(() => tone(780, 0.22, 'triangle', 0.05, 520), 240); },
  punch() { noise(0.07, 0.12); },
  crash() { noise(0.25, 0.25); tone(90, 0.25, 'triangle', 0.14, 40); },
  success() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'square', 0.07), i * 110)); },
  fail() { tone(300, 0.3, 'sawtooth', 0.09, 120); },
  enter() { tone(440, 0.08, 'square', 0.05); },
  sirenPhase: 0,
  siren(dt, active) {
    if (!active) return;
    this.sirenPhase += dt;
    if (this.sirenPhase > 0.55) { this.sirenPhase = 0; tone(700, 0.25, 'triangle', 0.028, 950); }
  },
};
