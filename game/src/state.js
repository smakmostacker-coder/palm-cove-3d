// Shared mutable game state. Every system module imports this single object
// and reads/writes its fields directly — there is no event bus and no store
// library; G is the contract between player, driving, police, missions, HUD
// and the save system.
//
// v2 additions over the original build: the owned-weapons list with sniper
// ammo and a scoped-aim flag, the chosen lead character, the story-tracking
// record that feeds the six branching endings, and the endings unlocked so
// far. The five-slot found-items inventory itself lives in inventory.js, which
// attaches G.inventory / G.selectedSlot / G.armour on first use.
export const G = {
  mode: 'title', // title | playing | paused | stats | over | ending
  prevMode: 'title',
  time: 0,
  money: 120,
  health: 100,
  wanted: 0,
  weapon: 'Fists',
  character: 'vera', // 'vera' | 'dax' — set on the character-choice screen
  weapons: ['Fists'], // owned weapons; Pistol arrives via story, Sniper by pickup
  sniperAmmo: 0,
  scoped: false,
  district: 'Palm District',
  objective: '',
  prompt: '',
  bust: 0,
  losTimer: 0,
  overKind: '',
  overTimer: 0,
  camYaw: 0,
  camPitch: 0.32,
  driving: null,
  onFoot: true,
  swimming: false, // derived per frame by player.js from the position (never latched in a save)
  stats: { stolen: 0, drivenKm: 0, missions: 0, side: 0, punches: 0, shotsFired: 0, byClass: {} },
  // Story tracking for the branching endings: mercy vs. ruthlessness, money
  // earned honestly, times busted/wasted, and the finale choices in order.
  track: { spared: 0, tookOut: 0, earned: 0, busted: 0, wasted: 0, finaleChoices: [] },
  endingsUnlocked: [],
  lastEnding: '',
  missionIndex: 0,
  missionStage: 0,
  storyDone: false,
  sideMode: null,
  sideTimer: 0,
  raceCp: 0,
  dialogueUntil: 0,
  seed: 1,
  fpsFrames: 0,
  keys: {},
  joyVec: { x: 0, y: 0 }, // continuous analog joystick vector (main.js initJoystick)
  mouseDown: false,
};

// Reset the per-run statistics and story tracking (new game / fresh stats).
export function resetStats() {
  G.stats = { stolen: 0, drivenKm: 0, missions: 0, side: 0, punches: 0, shotsFired: 0, byClass: {} };
  G.track = { spared: 0, tookOut: 0, earned: 0, busted: 0, wasted: 0, finaleChoices: [] };
}
