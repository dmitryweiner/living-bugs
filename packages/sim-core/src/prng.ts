/**
 * Seeded pseudo-random number generator (xoshiro128**)
 * Deterministic: same seed → same sequence.
 */
export class PRNG {
  private s: Uint32Array;

  constructor(seed: number) {
    // Initialize state from seed using splitmix32
    this.s = new Uint32Array(4);
    let s = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      s += 0x9e3779b9;
      let t = s ^ (s >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t ^= t >>> 15;
      t = Math.imul(t, 0x735a2d97);
      t ^= t >>> 15;
      this.s[i] = t >>> 0;
    }
  }

  /** Returns uint32 */
  private nextU32(): number {
    const s = this.s;
    const result = Math.imul(s[1] * 5, 1 << 7 | 1) >>> 0;
    const t = (s[1] << 9) >>> 0;

    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];

    s[2] ^= t;
    s[3] = ((s[3] << 11) | (s[3] >>> 21)) >>> 0;

    return result;
  }

  /** Returns float in [0, 1) */
  random(): number {
    return this.nextU32() / 4294967296;
  }

  /** Returns float in [min, max) */
  range(min: number, max: number): number {
    return min + this.random() * (max - min);
  }

  /** Returns integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Gaussian random (Box-Muller), mean=0, stddev=1 */
  gaussian(): number {
    let u1: number;
    let u2: number;
    do {
      u1 = this.random();
    } while (u1 === 0);
    u2 = this.random();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }

  /** Returns true with given probability */
  chance(probability: number): boolean {
    return this.random() < probability;
  }

  /** Pick a random element from an array */
  pick<T>(array: T[]): T {
    return array[this.int(0, array.length - 1)];
  }

  /** Serialize PRNG state for save/load */
  getState(): number[] {
    return [this.s[0], this.s[1], this.s[2], this.s[3]];
  }

  /** Restore PRNG state */
  setState(state: number[]): void {
    this.s[0] = state[0] >>> 0;
    this.s[1] = state[1] >>> 0;
    this.s[2] = state[2] >>> 0;
    this.s[3] = state[3] >>> 0;
  }
}
