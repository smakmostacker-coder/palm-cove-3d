// Procedural audio only: every sound is synthesized, no files are loaded.
import { G } from './state.js';

let ctx = null;
let master = null;
let sfxBus = null;
let radioBus = null;
let noiseBuf = null;
let clubMode = false;

const RADIO_BASE = 0.42;

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);
    radioBus = ctx.createGain();
    radioBus.gain.value = clubMode ? RADIO_BASE * 1.25 : RADIO_BASE;
    radioBus.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// Gate used everywhere so pre-gesture calls stay silent and cheap.
function ready() {
  return !!ctx && !!G.settings.sound;
}

function noiseBuffer() {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 1);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

// One-shot oscillator with a quick attack/decay envelope.
function tone({ type = 'sine', freq = 440, end = null, t = 0, dur = 0.15,
  vol = 0.3, bus = null, curve = 'exp' }) {
  const start = ctx.currentTime + t;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (end !== null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), start + dur);
  }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + 0.008);
  if (curve === 'exp') {
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  } else {
    gain.gain.linearRampToValueAtTime(0.0001, start + dur);
  }
  osc.connect(gain);
  gain.connect(bus || sfxBus);
  osc.start(start);
  osc.stop(start + dur + 0.05);
  return osc;
}

// One-shot filtered noise burst; the workhorse for cracks, hits and washes.
function noise({ t = 0, dur = 0.2, vol = 0.3, type = 'lowpass', freq = 1200,
  end = null, q = 0.8, bus = null, attack = 0.005 }) {
  const start = ctx.currentTime + t;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, start);
  if (end !== null) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, end), start + dur);
  }
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(bus || sfxBus);
  src.start(start, Math.random() * 0.5);
  src.stop(start + dur + 0.05);
}

// Siren state lives outside sfx so per-frame calls reuse one oscillator.
const sirenState = { osc: null, gain: null, phase: 0 };

function stopSiren() {
  if (!sirenState.osc) return;
  const now = ctx.currentTime;
  try {
    sirenState.gain.gain.cancelScheduledValues(now);
    sirenState.gain.gain.setValueAtTime(sirenState.gain.gain.value, now);
    sirenState.gain.gain.linearRampToValueAtTime(0.0001, now + 0.18);
    sirenState.osc.stop(now + 0.22);
  } catch (e) { /* already stopped */ }
  sirenState.osc = null;
  sirenState.gain = null;
  sirenState.phase = 0;
}

export const sfx = {
  shot() {
    if (!ready()) return;
    noise({ dur: 0.14, vol: 0.65, type: 'highpass', freq: 900, end: 300 });
    tone({ type: 'square', freq: 220, end: 60, dur: 0.08, vol: 0.25 });
  },
  sniper() {
    if (!ready()) return;
    noise({ dur: 0.32, vol: 0.7, type: 'bandpass', freq: 1600, end: 250, q: 0.6 });
    tone({ type: 'sine', freq: 110, end: 38, dur: 0.3, vol: 0.55 });
    noise({ t: 0.02, dur: 0.5, vol: 0.12, type: 'lowpass', freq: 500, end: 120 });
  },
  explosion() {
    if (!ready()) return;
    noise({ dur: 0.85, vol: 0.8, type: 'lowpass', freq: 900, end: 60, attack: 0.03 });
    tone({ type: 'sine', freq: 70, end: 26, dur: 0.8, vol: 0.6 });
  },
  hit() {
    if (!ready()) return;
    tone({ type: 'sine', freq: 130, end: 55, dur: 0.12, vol: 0.5 });
    noise({ dur: 0.06, vol: 0.15, type: 'lowpass', freq: 700 });
  },
  punch() {
    if (!ready()) return;
    noise({ dur: 0.07, vol: 0.4, type: 'bandpass', freq: 900, q: 1.2 });
    tone({ type: 'sine', freq: 180, end: 90, dur: 0.06, vol: 0.2 });
  },
  pickup() {
    if (!ready()) return;
    tone({ type: 'sine', freq: 660, dur: 0.09, vol: 0.28 });
    tone({ type: 'sine', freq: 990, t: 0.08, dur: 0.14, vol: 0.28 });
  },
  buy() {
    if (!ready()) return;
    tone({ type: 'triangle', freq: 880, dur: 0.1, vol: 0.3 });
    tone({ type: 'triangle', freq: 1320, t: 0.09, dur: 0.18, vol: 0.3 });
    noise({ t: 0.02, dur: 0.04, vol: 0.08, type: 'highpass', freq: 3000 });
  },
  denied() {
    if (!ready()) return;
    tone({ type: 'square', freq: 140, dur: 0.15, vol: 0.22, curve: 'lin' });
    tone({ type: 'square', freq: 130, t: 0.02, dur: 0.13, vol: 0.12, curve: 'lin' });
  },
  door() {
    if (!ready()) return;
    noise({ dur: 0.03, vol: 0.2, type: 'bandpass', freq: 2200, q: 2 });
    tone({ type: 'sine', freq: 95, end: 50, t: 0.04, dur: 0.12, vol: 0.35 });
  },
  splash() {
    if (!ready()) return;
    noise({ dur: 0.42, vol: 0.35, type: 'bandpass', freq: 800, end: 1800, q: 0.7, attack: 0.06 });
    noise({ t: 0.08, dur: 0.3, vol: 0.15, type: 'lowpass', freq: 900, end: 300 });
  },
  step() {
    if (!ready()) return;
    noise({ dur: 0.035, vol: 0.05, type: 'lowpass', freq: 600 });
  },
  siren(dt, active) {
    if (!ctx) return;
    if (!active || !G.settings.sound) {
      if (ctx && sirenState.osc) stopSiren();
      return;
    }
    if (!sirenState.osc) {
      sirenState.osc = ctx.createOscillator();
      sirenState.gain = ctx.createGain();
      sirenState.osc.type = 'triangle';
      sirenState.osc.frequency.value = 700;
      sirenState.gain.gain.value = 0.0001;
      sirenState.gain.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 0.15);
      sirenState.osc.connect(sirenState.gain);
      sirenState.gain.connect(sfxBus);
      sirenState.osc.start();
      sirenState.phase = 0;
    }
    // Half a 0.7 s cycle per tone keeps the classic two-tone alternation.
    sirenState.phase += Math.max(0, dt || 0);
    const high = (sirenState.phase % 0.7) >= 0.35;
    sirenState.osc.frequency.setTargetAtTime(high ? 950 : 700, ctx.currentTime, 0.02);
  },
};

// --- Radio: data-driven stations -------------------------------------------
// Notes are semitone offsets from each station root; null means rest.
const STATIONS = {
  1: {
    name: 'Neon FM', bpm: 100, root: 45, wave: 'sawtooth', leadWave: 'sawtooth',
    filter: 900, bassVol: 0.16, leadVol: 0.07, padVol: 0.045, stepsPerBar: 16,
    prog: [[0, 3, 7], [-4, 0, 3], [5, 8, 12], [-2, 2, 5]],
    bass: [0, null, null, 0, null, null, 12, null, 0, null, null, 0, null, 10, null, 12],
    lead: [12, null, 15, null, null, 12, null, null, 19, null, 17, null, 15, null, null, null],
  },
  2: {
    name: 'Cove Funk', bpm: 92, root: 41, wave: 'square', leadWave: 'square',
    filter: 1400, bassVol: 0.13, leadVol: 0.06, padVol: 0.05, stepsPerBar: 16,
    prog: [[0, 4, 7], [0, 4, 7], [-3, 0, 4], [5, 9, 12]],
    bass: [0, null, 0, null, 12, null, 0, null, null, 0, null, 10, 12, null, 0, null],
    lead: [null, null, 12, null, null, null, 12, null, null, null, 15, null, null, 12, null, null],
  },
  3: {
    name: 'Sunset Chill', bpm: 76, root: 48, wave: 'triangle', leadWave: 'sine',
    filter: 1800, bassVol: 0.1, leadVol: 0.09, padVol: 0.07, stepsPerBar: 8,
    prog: [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]],
    bass: [0, null, null, null, 7, null, null, null],
    lead: [16, null, 19, null, 21, null, 19, null],
  },
};

function midiFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Radio notes route through a station filter so each station has its own tone.
function radioTone(def, midi, start, dur, vol, wave) {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = wave;
  osc.frequency.value = midiFreq(midi);
  filter.type = 'lowpass';
  filter.frequency.value = def.filter;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(vol, start + Math.min(0.03, dur * 0.3));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(radioBus);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

const seq = { timer: null, step: 0, nextTime: 0 };

function scheduleStep(def, step, start) {
  const perBar = def.stepsPerBar;
  const bar = Math.floor(step / perBar) % def.prog.length;
  const inBar = step % perBar;
  const chord = def.prog[bar];
  const stepDur = 60 / def.bpm / (perBar / 4);
  if (inBar === 0) {
    // Pad holds the whole bar underneath the bass and lead patterns.
    for (const off of chord) {
      radioTone(def, def.root + 12 + off, start, stepDur * perBar * 0.95, def.padVol, 'triangle');
    }
  }
  const bassOff = def.bass[inBar % def.bass.length];
  if (bassOff !== null && bassOff !== undefined) {
    const funky = def.bpm === 92;
    radioTone(def, def.root - 12 + chord[0] + bassOff, start,
      stepDur * (funky ? 0.7 : 1.6), def.bassVol, def.wave);
  }
  const leadOff = def.lead[inBar % def.lead.length];
  // Funk chords stab off the beat; other stations use their lead line as-is.
  const isStab = def.bpm === 92 && inBar % 4 === 2;
  if (isStab) {
    for (const off of chord) {
      radioTone(def, def.root + 24 + off, start, stepDur * 0.8, def.padVol, def.leadWave);
    }
  } else if (leadOff !== null && leadOff !== undefined) {
    radioTone(def, def.root + 12 + leadOff, start, stepDur * 1.8, def.leadVol, def.leadWave);
  }
}

function schedulerTick() {
  if (!ready() || radio.station <= 0) { stopScheduler(); return; }
  const def = STATIONS[radio.station];
  if (!def) { stopScheduler(); return; }
  const stepDur = 60 / def.bpm / (def.stepsPerBar / 4);
  if (seq.nextTime < ctx.currentTime) {
    seq.nextTime = ctx.currentTime + 0.06;
    seq.step = 0;
  }
  // Lookahead window: keep roughly a quarter second of music queued.
  while (seq.nextTime < ctx.currentTime + 0.25) {
    scheduleStep(def, seq.step, seq.nextTime);
    seq.nextTime += stepDur;
    seq.step++;
  }
}

function startScheduler() {
  if (seq.timer !== null || !ctx) return;
  seq.step = 0;
  seq.nextTime = ctx.currentTime + 0.06;
  seq.timer = setInterval(schedulerTick, 100);
}

function stopScheduler() {
  if (seq.timer !== null) clearInterval(seq.timer);
  seq.timer = null;
  seq.step = 0;
}

export const radio = {
  station: G.radioStation || 0,

  stationName(n) {
    const def = STATIONS[n];
    return def ? def.name : 'Radio Off';
  },

  toggle() {
    this.setStation((this.station + 1) % 4);
  },

  setStation(n) {
    const next = Math.max(0, Math.min(3, n | 0));
    const changed = next !== this.station;
    this.station = next;
    G.radioStation = next;
    if (changed) stopScheduler();
    this.update();
  },

  update() {
    // Per-frame guard: music runs exactly when a station is on and sound is on.
    this.station = G.radioStation || 0;
    if (this.station > 0 && ready()) startScheduler();
    else stopScheduler();
  },

  setClubMode(on) {
    clubMode = !!on;
    if (radioBus && ctx) {
      const target = RADIO_BASE * (clubMode ? 1.25 : 1);
      radioBus.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
    }
  },
};
