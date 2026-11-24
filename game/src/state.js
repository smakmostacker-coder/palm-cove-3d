// Central mutable game state. One shared object, G, holds everything
// the game reads or changes at runtime; modules import it and mutate
// its fields directly — no store, event bus, or framework here.
export const G = {
  // Flow and clock.
  mode: 'title',
  time: 0,
  // Cast: filled in at character selection, null until then.
  lead: null,
  partner: null,
  // Player vitals and wallet.
  money: 120,
  health: 100,
  // Police pressure: stars, bust progress, time out of sight.
  wanted: 0,
  bust: 0,
  losTimer: 0,
  // Situation: what the player is currently inside of, if anything.
  driving: null, // current vehicle object while driving
  interior: null, // current interior id while indoors
  interiorRect: null, // {minX,maxX,minZ,maxZ,ceilY} of the current room; the camera clamps inside it
  swimming: false,
  inPrison: 0,
  scoped: false, // aiming through a scope
  // Preferences: kept across runs (see resetRunState).
  settings: {
    sound: true,
    fps: 60,
    quality: 'high',
    brightness: 1,
    joystick: 1,
  },
  minimapZoom: 'MID',
  radioStation: 0, // 0 = off, 1-3 = stations
  // This run's tallies, plus the story choices made along the way.
  stats: {
    earned: 0,
    busted: 0,
    wasted: 0,
    spared: 0,
    tookOut: 0,
    carsStolen: 0,
    jobsDone: 0,
    distanceKm: 0,
    choices: [],
  },
  endingsFound: [], // meta progress across all runs; preserved
  flags: {}, // free-form story flags set by missions
};

// Restore the per-run fields to their defaults for a new game.
// settings, minimapZoom, radioStation and endingsFound survive,
// as does the lead/partner cast selection.
export function resetRunState() {
  G.time = 0;
  G.money = 120;
  G.health = 100;
  G.wanted = 0;
  G.bust = 0;
  G.losTimer = 0;
  G.driving = null;
  G.interior = null;
  G.swimming = false;
  G.inPrison = 0;
  G.scoped = false;
  // Fresh objects so no stale references leak into the new run.
  G.stats = {
    earned: 0, busted: 0, wasted: 0, spared: 0, tookOut: 0,
    carsStolen: 0, jobsDone: 0, distanceKm: 0, choices: [],
  };
  G.flags = {};
}
