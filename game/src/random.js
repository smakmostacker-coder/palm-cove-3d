// Deterministic seeded pseudo-random generator (mulberry32 style).
//
// Why seeded instead of Math.random?
//   - Staging is reproducible: the same seed lays out the same city,
//     traffic, and encounters every run, so a scene can be rebuilt
//     exactly when tuning or debugging it.
//   - Tests can assert on exact sequences instead of flaky ranges.
//   - A bug report that includes its seed can be replayed faithfully.
// Math.random offers none of that, so all game randomness flows
// through this module.

// Internal 32-bit state. Any non-zero seed works; this default is
// arbitrary but fixed, so a fresh page load behaves identically.
let state = 0x9e3779b9;

// Reseed the generator. The value is coerced to an unsigned 32-bit
// integer; zero is remapped because a zero state would be degenerate.
export function seedWith(seed) {
  state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
}

// Advance the state and return the next float in [0, 1).
// mulberry32: one multiply-xorshift round per value, fast and with
// good enough distribution for gameplay decisions.
export function nextFloat() {
  state = (state + 0x6d2b79f5) | 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Float in [min, max). Handy for speeds, delays, and jitter.
export function floatBetween(min, max) {
  return min + nextFloat() * (max - min);
}

// Integer in [min, max], including both ends.
export function intBetween(min, max) {
  return min + Math.floor(nextFloat() * (max - min + 1));
}

// One element chosen at random, or null for an empty array so
// callers can handle "nothing to pick" without a crash.
export function pickOne(items) {
  if (items.length === 0) return null;
  return items[Math.floor(nextFloat() * items.length)];
}

// True with the given probability (0 = never, 1 = always).
export function chanceOf(probability) {
  return nextFloat() < probability;
}

// A NEW array shuffled with Fisher-Yates: walk from the last slot
// down, swapping each slot with a random slot at or before it.
// The input array is copied first and left untouched.
export function shuffled(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(nextFloat() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}
