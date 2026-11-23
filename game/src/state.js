// Shared mutable game state, imported by every system module.
export const G = {
  mode: 'title',          // title | playing | paused | stats | over
  prevMode: 'title',
  time: 0, money: 120, health: 100, wanted: 0, weapon: 'Fists',
  district: 'Palm District', objective: '', prompt: '',
  bust: 0, losTimer: 0, overKind: '', overTimer: 0,
  camYaw: 0, camPitch: 0.32, driving: null, onFoot: true,
  stats: { stolen: 0, drivenKm: 0, missions: 0, side: 0, punches: 0, shotsFired: 0 },
  missionIndex: 0, missionStage: 0, storyDone: false,
  sideMode: null, sideTimer: 0, raceCp: 0,
  dialogueUntil: 0, seed: 1, fpsFrames: 0,
  keys: {}, mouseDown: false,
};
export function resetStats() {
  G.stats = { stolen: 0, drivenKm: 0, missions: 0, side: 0, punches: 0, shotsFired: 0 };
}
