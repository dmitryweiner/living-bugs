import { describe, it, expect } from 'vitest';
import { PRNG } from './prng.js';

describe('PRNG', () => {
  describe('determinism', () => {
    it('produces identical sequences from the same seed', () => {
      const a = new PRNG(42);
      const b = new PRNG(42);
      for (let i = 0; i < 100; i++) {
        expect(a.random()).toBe(b.random());
      }
    });

    it('produces different sequences from different seeds', () => {
      const a = new PRNG(1);
      const b = new PRNG(2);
      const aValues = Array.from({ length: 20 }, () => a.random());
      const bValues = Array.from({ length: 20 }, () => b.random());
      // At least some values should differ
      const diffCount = aValues.filter((v, i) => v !== bValues[i]).length;
      expect(diffCount).toBeGreaterThan(10);
    });
  });

  describe('random()', () => {
    it('returns values in [0, 1)', () => {
      const rng = new PRNG(123);
      for (let i = 0; i < 1000; i++) {
        const v = rng.random();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });

    it('has reasonable distribution (not all clustered)', () => {
      const rng = new PRNG(99);
      const buckets = new Array(10).fill(0);
      const N = 10000;
      for (let i = 0; i < N; i++) {
        const v = rng.random();
        buckets[Math.floor(v * 10)]++;
      }
      // Each bucket should have roughly N/10 = 1000, allow wide tolerance
      for (const count of buckets) {
        expect(count).toBeGreaterThan(700);
        expect(count).toBeLessThan(1300);
      }
    });
  });

  describe('range()', () => {
    it('returns values in [min, max)', () => {
      const rng = new PRNG(77);
      for (let i = 0; i < 500; i++) {
        const v = rng.range(5, 10);
        expect(v).toBeGreaterThanOrEqual(5);
        expect(v).toBeLessThan(10);
      }
    });

    it('works with negative ranges', () => {
      const rng = new PRNG(77);
      for (let i = 0; i < 200; i++) {
        const v = rng.range(-10, -5);
        expect(v).toBeGreaterThanOrEqual(-10);
        expect(v).toBeLessThan(-5);
      }
    });
  });

  describe('int()', () => {
    it('returns integers in [min, max] inclusive', () => {
      const rng = new PRNG(55);
      const seen = new Set<number>();
      for (let i = 0; i < 500; i++) {
        const v = rng.int(1, 6);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(6);
        expect(Number.isInteger(v)).toBe(true);
        seen.add(v);
      }
      // Should have seen all values 1..6
      expect(seen.size).toBe(6);
    });
  });

  describe('gaussian()', () => {
    it('produces values centered around 0', () => {
      const rng = new PRNG(33);
      const N = 5000;
      let sum = 0;
      for (let i = 0; i < N; i++) {
        sum += rng.gaussian();
      }
      const mean = sum / N;
      // Mean should be close to 0
      expect(Math.abs(mean)).toBeLessThan(0.1);
    });

    it('has approximately unit standard deviation', () => {
      const rng = new PRNG(44);
      const N = 5000;
      const values: number[] = [];
      for (let i = 0; i < N; i++) {
        values.push(rng.gaussian());
      }
      const mean = values.reduce((s, v) => s + v, 0) / N;
      const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / N;
      const stddev = Math.sqrt(variance);
      // stddev should be close to 1
      expect(stddev).toBeGreaterThan(0.8);
      expect(stddev).toBeLessThan(1.2);
    });
  });

  describe('chance()', () => {
    it('returns true roughly at the given probability', () => {
      const rng = new PRNG(11);
      const N = 5000;
      let trueCount = 0;
      for (let i = 0; i < N; i++) {
        if (rng.chance(0.3)) trueCount++;
      }
      const ratio = trueCount / N;
      expect(ratio).toBeGreaterThan(0.25);
      expect(ratio).toBeLessThan(0.35);
    });

    it('chance(0) always returns false', () => {
      const rng = new PRNG(7);
      for (let i = 0; i < 100; i++) {
        expect(rng.chance(0)).toBe(false);
      }
    });

    it('chance(1) always returns true', () => {
      const rng = new PRNG(7);
      for (let i = 0; i < 100; i++) {
        expect(rng.chance(1)).toBe(true);
      }
    });
  });

  describe('pick()', () => {
    it('picks elements from array', () => {
      const rng = new PRNG(88);
      const arr = ['a', 'b', 'c', 'd'];
      const seen = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const v = rng.pick(arr);
        expect(arr).toContain(v);
        seen.add(v);
      }
      // Should have seen all elements
      expect(seen.size).toBe(4);
    });
  });

  describe('state save/restore', () => {
    it('can save and restore state for identical continuation', () => {
      const rng = new PRNG(42);
      // Advance a bit
      for (let i = 0; i < 50; i++) rng.random();

      // Save state
      const state = rng.getState();

      // Generate sequence
      const seq1: number[] = [];
      for (let i = 0; i < 20; i++) seq1.push(rng.random());

      // Restore state
      rng.setState(state);

      // Generate again — should be identical
      const seq2: number[] = [];
      for (let i = 0; i < 20; i++) seq2.push(rng.random());

      expect(seq1).toEqual(seq2);
    });

    it('state is transferable between instances', () => {
      const rng1 = new PRNG(42);
      for (let i = 0; i < 30; i++) rng1.random();
      const state = rng1.getState();

      const rng2 = new PRNG(0); // Different seed
      rng2.setState(state);

      // Both should produce the same sequence now
      for (let i = 0; i < 20; i++) {
        expect(rng1.random()).toBe(rng2.random());
      }
    });
  });
});
