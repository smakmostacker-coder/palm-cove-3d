// Tiny WebAudio synth — every sound effect is an oscillator or noise burst,
// so the game ships zero audio files. A single master gain node carries the
// Settings volume slider and mute toggle; each effect routes through it.
import { settings, saveSettings } from './settings.js';

let ctx = null;
let master = null;

function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; }
    if (ctx) {
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
  if (master) master.gain.value = settings.muted ? 0 : settings.volume;
  return ctx;
}

function out() { return master || (ac() && master); }

function tone(freq, dur, type, vol, slideTo) {
  const c = ac(); if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type || 'square';
  osc.frequency.setValueAtTime(freq, c.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
  gain.gain.setValueAtTime(vol || 0.08, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  osc.connect(gain);
  gain.connect(out());
  osc.start();
  osc.stop(c.currentTime + dur);
}

function noise(dur, vol) {
  const c = ac(); if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const gain = c.createGain();
  gain.gain.value = vol || 0.15;
  src.connect(gain);
  gain.connect(out());
  src.start();
}

// ---- Radio: a built-in WebAudio station engine ------------------------------
// Three procedural stations, zero audio files. A lookahead scheduler
// (100 ms interval, ~220 ms horizon) walks 16th-note steps and each station
// renders its pattern with the shared voice helpers below — oscillators and
// one shared noise buffer only, at most a handful of voices at once, so it
// stays cheap on a phone. The radio runs through its OWN gain node under
// the same master gain as SFX, so the Settings volume slider and mute
// govern music exactly as they govern effects. The AudioContext is only
// ever created from radio.start(), which main.js calls on the player's
// first pointer/key gesture — never at boot.
const mf = (m) => 440 * Math.pow(2, (m - 69) / 12); // midi -> Hz

let radioGain = null;
let noiseBuf = null;

function radioVoice(freq, t, dur, type, vol, o) {
  o = o || {};
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  const atk = o.attack || 0.01;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(vol, t + atk);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  let head = osc;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = o.filter;
    f.frequency.setValueAtTime(o.filterFreq || 800, t);
    if (o.filterSweep) f.frequency.exponentialRampToValueAtTime(o.filterSweep, t + dur);
    f.Q.value = o.q || 0.8;
    osc.connect(f);
    head = f;
  }
  head.connect(gain);
  gain.connect(radioGain);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function radioNoise(t, dur, vol, freq, type) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type || 'highpass';
  f.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(gain); gain.connect(radioGain);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

// Station data: tempo + chord progression + step patterns. `play(step, t,
// stepDur)` renders ONE 16th-note step using the shared voices above.
const STATIONS = [
  {
    name: 'Neon FM', bpm: 100, loopSteps: 64, // synthwave in A minor
    chords: [
      { bass: 45, tones: [57, 60, 64] }, // Am
      { bass: 41, tones: [53, 57, 60] }, // F
      { bass: 48, tones: [55, 60, 64] }, // C
      { bass: 43, tones: [55, 59, 62] }, // G
    ],
    play(st, step, t, sd) {
      const bar = (step >> 4) % 4, s = step & 15, ch = st.chords[bar];
      if (s === 0) for (const m of ch.tones) radioVoice(mf(m), t, sd * 15, 'triangle', 0.045, { attack: 0.35 });
      if (s % 2 === 0) radioVoice(mf(ch.bass), t, sd * 1.7, 'sawtooth', 0.075, { filter: 'lowpass', filterFreq: 520 });
      const arp = ch.tones[[0, 1, 2, 1][s % 4]] + 12;
      radioVoice(mf(arp), t, sd * 0.9, 'square', 0.026);
    },
  },
  {
    name: 'Cove Funk', bpm: 92, loopSteps: 32, // funk groove in A minor
    bassLine: [
      45, null, null, 45, null, null, 48, null, null, 45, null, null, 43, null, 47, null,
      45, null, null, 45, null, null, 50, null, null, 48, null, null, 43, null, 40, null,
    ],
    stabTones: [57, 60, 64],
    play(st, step, t, sd) {
      const s = step & 15;
      const b = st.bassLine[step % 32];
      if (b) radioVoice(mf(b), t, sd * 1.5, 'sawtooth', 0.11, { filter: 'lowpass', filterFreq: 700 });
      if (s % 4 === 2) radioNoise(t, 0.035, 0.05, 6500);
      if (s === 14) radioNoise(t, 0.03, 0.022, 6500);
      if (s === 7 || s === 15) for (const m of st.stabTones) {
        radioVoice(mf(m), t, 0.2, 'sawtooth', 0.042, { filter: 'bandpass', filterFreq: 420, filterSweep: 2600, q: 2.5 });
      }
    },
  },
  {
    name: 'Sunset Chill', bpm: 76, loopSteps: 64, // warm major-7 sunset loop
    chords: [
      { bass: 36, tones: [60, 64, 67, 71] }, // Cmaj7
      { bass: 33, tones: [57, 60, 64, 67] }, // Am7
      { bass: 29, tones: [53, 57, 60, 65] }, // Fmaj7
      { bass: 31, tones: [55, 59, 62, 65] }, // G(add)
    ],
    lead: { 4: 76, 12: 74, 20: 72, 36: 79, 44: 76, 52: 74 },
    play(st, step, t, sd) {
      const bar = (step >> 4) % 4, s = step & 15, ch = st.chords[bar];
      if (s === 0) {
        for (const m of ch.tones) radioVoice(mf(m), t, sd * 17, 'sine', 0.038, { attack: 0.9 });
        radioVoice(mf(ch.bass + 12), t, sd * 15, 'sine', 0.055, { attack: 0.4 });
      }
      const lead = st.lead[step];
      if (lead) radioVoice(mf(lead), t, sd * 6, 'sine', 0.05, { attack: 0.06 });
    },
  },
];
export const RADIO_STATION_NAMES = STATIONS.map((s) => s.name);

const radioState = {
  started: false,      // start() has run (post-gesture); ctx may exist
  playing: false,      // scheduler interval is live
  clubMode: false,
  step: 0,
  nextTime: 0,
  timer: null,
  scheduledNotes: 0,   // total steps scheduled — proves notes are flowing
  lastStepAt: 0,       // ctx time of the most recently scheduled step
};

function applyRadioGain() {
  if (!radioGain || !ctx) return;
  const target = radioState.clubMode ? 0.95 : 0.76; // club: radio ×1.25
  radioGain.gain.setTargetAtTime(target, ctx.currentTime, 0.15);
}

function scheduleStep(step, t) {
  const st = STATIONS[settings.radioStation] || STATIONS[0];
  const sd = 60 / st.bpm / 4;
  st.play(st, step % st.loopSteps, t, sd);
  radioState.scheduledNotes++;
  radioState.lastStepAt = t;
}

function radioTick() {
  if (!ctx) return;
  const st = STATIONS[settings.radioStation] || STATIONS[0];
  const sd = 60 / st.bpm / 4;
  while (radioState.nextTime < ctx.currentTime + 0.22) {
    scheduleStep(radioState.step, radioState.nextTime);
    radioState.nextTime += sd;
    radioState.step++;
  }
}

function startScheduler() {
  if (!ctx || radioState.timer) return;
  radioState.step = 0;
  radioState.nextTime = ctx.currentTime + 0.06;
  radioState.timer = setInterval(radioTick, 100);
  radioState.playing = true;
}
function stopScheduler() {
  if (radioState.timer) clearInterval(radioState.timer);
  radioState.timer = null;
  radioState.playing = false;
}

export const radio = {
  stations: RADIO_STATION_NAMES,
  get station() { return settings.radioStation; },
  get stationName() { return settings.radioOn ? (RADIO_STATION_NAMES[settings.radioStation] || RADIO_STATION_NAMES[0]) : 'Off'; },
  get playing() { return radioState.playing; },
  // Called once from main.js on the first pointer/key gesture. Creates the
  // shared AudioContext (via ac()) and the radio gain under master, then
  // starts the scheduler if the saved setting says the radio is on.
  start() {
    if (radioState.started) return;
    const c = ac();
    if (!c) return;
    radioState.started = true;
    if (!radioGain) {
      radioGain = c.createGain();
      radioGain.connect(master);
      applyRadioGain();
    }
    if (settings.radioOn) startScheduler();
  },
  setStation(i) {
    settings.radioStation = Math.max(0, Math.min(STATIONS.length - 1, i | 0));
    settings.radioOn = true;
    saveSettings();
    if (radioState.started) { stopScheduler(); startScheduler(); }
    return this.stationName;
  },
  setOn(on) {
    settings.radioOn = !!on;
    saveSettings();
    if (!radioState.started) return this.stationName;
    if (settings.radioOn) startScheduler(); else stopScheduler();
    return this.stationName;
  },
  // Cycle Neon FM -> Cove Funk -> Sunset Chill -> Off -> Neon FM ...
  cycle() {
    if (!settings.radioOn) return this.setStation(settings.radioStation);
    if (settings.radioStation < STATIONS.length - 1) return this.setStation(settings.radioStation + 1);
    return this.setOn(false), 'Off';
  },
  // Inside CLUB NEON PALMS the radio is the club's music: lift its gain a
  // touch (×1.25) so it clearly carries the room.
  setClubMode(on) {
    if (radioState.clubMode === !!on) return;
    radioState.clubMode = !!on;
    applyRadioGain();
  },
  debugState() {
    return {
      ctxState: ctx ? ctx.state : 'none',
      playing: radioState.playing,
      started: radioState.started,
      station: settings.radioStation,
      stationName: this.stationName,
      radioOn: settings.radioOn,
      clubMode: radioState.clubMode,
      scheduledNotes: radioState.scheduledNotes,
      lastStepAt: radioState.lastStepAt,
      ctxTime: ctx ? ctx.currentTime : 0,
      notesFlowing: radioState.playing && ctx ? (ctx.currentTime - radioState.lastStepAt) < 1 : false,
      hasRadioGain: !!radioGain,
      radioGainValue: radioGain ? radioGain.gain.value : null,
      masterGainValue: master ? master.gain.value : null,
    };
  },
};

export const sfx = {
  pickup() { tone(880, 0.12, 'square', 0.07, 1320); },
  cash() {
    tone(660, 0.1, 'square', 0.07);
    setTimeout(() => tone(990, 0.16, 'square', 0.07), 90);
  },
  shot() { noise(0.12, 0.22); tone(160, 0.1, 'sawtooth', 0.1, 60); },
  sniper() {
    noise(0.3, 0.3);
    tone(90, 0.35, 'sawtooth', 0.16, 35);
    setTimeout(() => tone(1400, 0.2, 'sine', 0.05, 300), 60);
  },
  boom() { noise(0.6, 0.4); tone(60, 0.6, 'triangle', 0.25, 28); },
  splash() { noise(0.18, 0.06); },
  firetruck() {
    tone(520, 0.22, 'triangle', 0.05, 780);
    setTimeout(() => tone(780, 0.22, 'triangle', 0.05, 520), 240);
  },
  punch() { noise(0.07, 0.12); },
  crash() { noise(0.25, 0.25); tone(90, 0.25, 'triangle', 0.14, 40); },
  success() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'square', 0.07), i * 110)); },
  fail() { tone(300, 0.3, 'sawtooth', 0.09, 120); },
  enter() { tone(440, 0.08, 'square', 0.05); },
  sirenPhase: 0,
  siren(dt, active) {
    if (!active) return;
    this.sirenPhase += dt;
    if (this.sirenPhase > 0.55) {
      this.sirenPhase = 0;
      tone(700, 0.25, 'triangle', 0.028, 950);
    }
  },
};
