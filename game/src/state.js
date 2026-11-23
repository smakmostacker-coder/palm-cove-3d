// Shared mutable game state, imported by every system module.
// v2 adds: owned-weapon list + sniper ammo, scoped-aim flag, the story-tracking
// record that feeds the branching endings, and endings unlocked so far.
export const G = {
  mode: 'title',          // title | playing | paused | stats | over | ending
  prevMode: 'title',
  time: 0, money: 120, health: 100, wanted: 0, weapon: 'Fists', character: 'vera',
  weapons: ['Fists'],     // owned weapons; Pistol arrives in Collections, Sniper by pickup
  sniperAmmo: 0, scoped: false,
  district: 'Palm District', objective: '', prompt: '',
  bust: 0, losTimer: 0, overKind: '', overTimer: 0,
  camYaw: 0, camPitch: 0.32, driving: null, onFoot: true,
  stats: { stolen: 0, drivenKm: 0, missions: 0, side: 0, punches: 0, shotsFired: 0, byClass: {} },
  // Story tracking for the six branching endings (Part B).
  track: { spared: 0, tookOut: 0, earned: 0, busted: 0, wasted: 0, finaleChoices: [] },
  endingsUnlocked: [], lastEnding: '',
  missionIndex: 0, missionStage: 0, storyDone: false,
  sideMode: null, sideTimer: 0, raceCp: 0,
  dialogueUntil: 0, seed: 1, fpsFrames: 0,
  keys: {}, mouseDown: false,
};
export function resetStats() {
  G.stats = { stolen: 0, drivenKm: 0, missions: 0, side: 0, punches: 0, shotsFired: 0, byClass: {} };
  G.track = { spared: 0, tookOut: 0, earned: 0, busted: 0, wasted: 0, finaleChoices: [] };
}
