// LANTERNFALL — seeded random number generator.
// A small mulberry32-style generator written from scratch: every run with the
// same seed produces the same stream, so replays and screenshots are exact.
// Nothing in the game ever calls unseeded randomness or the wall clock.

// Keep the internal state as an unsigned 32-bit integer.
export function createRandom(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;

  function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(max) {
    if (max <= 0) return 0;
    return Math.floor(next() * max);
  }

  function range(a, b) {
    return a + next() * (b - a);
  }

  function pick(array) {
    return array[int(array.length)];
  }

  return { next, int, range, pick };
}
