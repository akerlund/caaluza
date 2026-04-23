// ---------------------------------------------------------------------------
// SeededRandom — drop-in for System.Random(seed)
// Uses Mulberry32 internally. .next(bound) returns [0, bound).
// ---------------------------------------------------------------------------
class SeededRandom {
  constructor(seed) {
    this._state = seed | 0;
  }

  // Raw 32-bit unsigned integer via Mulberry32.
  _raw() {
    let z = (this._state += 0x6d2b79f5);
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0);
  }

  // Returns integer in [0, bound).
  next(bound) {
    return this._raw() % bound;
  }
}
