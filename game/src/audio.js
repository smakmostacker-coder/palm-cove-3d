// Tiny WebAudio synth: every sound is an oscillator/noise burst, no audio files.
let ctx = null;
function ac() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; } }
  if (ctx && ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function tone(freq, dur, type, vol, slideTo) {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'square'; o.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
  g.gain.setValueAtTime(vol || 0.08, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
}
function noise(dur, vol) {
  const c = ac(); if (!c) return;
  const len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = c.createBufferSource(); s.buffer = buf;
  const g = c.createGain(); g.gain.value = vol || 0.15;
  s.connect(g); g.connect(c.destination); s.start();
}
export const sfx = {
  pickup() { tone(880, 0.12, 'square', 0.07, 1320); },
  cash() { tone(660, 0.1, 'square', 0.07); setTimeout(() => tone(990, 0.16, 'square', 0.07), 90); },
  shot() { noise(0.12, 0.22); tone(160, 0.1, 'sawtooth', 0.1, 60); },
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
