// Deterministic randomness for city generation.
//
// A mulberry32 generator: the same seed always produces the same stream, so a
// given world seed builds exactly the same city on every load and every
// machine. Gameplay randomness that should vary run to run does not use this.
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Uniform pick from an array using a supplied generator.
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

// Weighted pick: pairs are [value, weight] with weights summing to ~1. Used by
// the dusk city dressing to choose facade styles, neon colours and props
// without long if-chains at every call site.
export function pickWeighted(rng, pairs) {
  let r = rng();
  for (const [value, weight] of pairs) {
    r -= weight;
    if (r <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}
