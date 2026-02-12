import { describe, it, expect, beforeEach } from 'vitest';
import { HallOfFame, type HallOfFameEntry } from './hall-of-fame.js';
import { createDefaultDNA, resetInnovationCounter } from './dna.js';
import { PRNG } from './prng.js';

function makeEntry(fitness: number, generation: number = 1): HallOfFameEntry {
  const rng = new PRNG(fitness); // use fitness as seed for variety
  return {
    fitness,
    dna: createDefaultDNA(0, rng),
    generation,
    stats: { age: 100, energy: 50, groupId: 0 },
  };
}

beforeEach(() => {
  resetInnovationCounter();
});

describe('HallOfFame', () => {
  it('starts empty', () => {
    const hof = new HallOfFame(10);
    expect(hof.size).toBe(0);
    expect(hof.getEntries()).toEqual([]);
    expect(hof.getBest()).toBeNull();
  });

  it('adds entries via update', () => {
    const hof = new HallOfFame(10);
    hof.update([makeEntry(10), makeEntry(20)]);
    expect(hof.size).toBe(2);
    expect(hof.getBest()!.fitness).toBe(20);
  });

  it('maintains sorted order by fitness descending', () => {
    const hof = new HallOfFame(10);
    hof.update([makeEntry(5), makeEntry(15), makeEntry(10)]);
    const entries = hof.getEntries();
    expect(entries[0].fitness).toBe(15);
    expect(entries[1].fitness).toBe(10);
    expect(entries[2].fitness).toBe(5);
  });

  it('caps at maxSize', () => {
    const hof = new HallOfFame(3);
    hof.update([makeEntry(1), makeEntry(2), makeEntry(3), makeEntry(4), makeEntry(5)]);
    expect(hof.size).toBe(3);
    expect(hof.getEntries().map(e => e.fitness)).toEqual([5, 4, 3]);
  });

  it('merges across multiple updates', () => {
    const hof = new HallOfFame(5);
    hof.update([makeEntry(10), makeEntry(20)]);
    hof.update([makeEntry(15), makeEntry(25)]);
    expect(hof.size).toBe(4);
    expect(hof.getBest()!.fitness).toBe(25);
  });

  it('evicts lowest when at capacity after merge', () => {
    const hof = new HallOfFame(3);
    hof.update([makeEntry(10), makeEntry(20), makeEntry(30)]);
    hof.update([makeEntry(25)]); // should evict 10
    expect(hof.size).toBe(3);
    expect(hof.getEntries().map(e => e.fitness)).toEqual([30, 25, 20]);
  });

  it('getTopK returns requested count', () => {
    const hof = new HallOfFame(10);
    hof.update([makeEntry(1), makeEntry(2), makeEntry(3), makeEntry(4), makeEntry(5)]);
    const top3 = hof.getTopK(3);
    expect(top3.length).toBe(3);
    expect(top3.map(e => e.fitness)).toEqual([5, 4, 3]);
  });

  it('getDNAs returns DNA genotypes', () => {
    const hof = new HallOfFame(10);
    hof.update([makeEntry(10), makeEntry(20)]);
    const dnas = hof.getDNAs();
    expect(dnas.length).toBe(2);
    expect(dnas[0]).toHaveProperty('brain');
    expect(dnas[0]).toHaveProperty('sensors');
  });

  it('getDNAs with count limits output', () => {
    const hof = new HallOfFame(10);
    hof.update([makeEntry(10), makeEntry(20), makeEntry(30)]);
    const dnas = hof.getDNAs(2);
    expect(dnas.length).toBe(2);
  });

  it('serializes and deserializes', () => {
    const hof = new HallOfFame(5);
    hof.update([makeEntry(10, 1), makeEntry(20, 2), makeEntry(30, 3)]);

    const json = hof.toJSON();
    expect(json.maxSize).toBe(5);
    expect(json.entries.length).toBe(3);

    const restored = HallOfFame.fromJSON(json);
    expect(restored.size).toBe(3);
    expect(restored.getBest()!.fitness).toBe(30);
    expect(restored.getEntries().map(e => e.fitness)).toEqual([30, 20, 10]);
  });

  it('fromJSON respects maxSize', () => {
    const data = {
      maxSize: 2,
      entries: [makeEntry(10), makeEntry(20), makeEntry(30)],
    };
    const restored = HallOfFame.fromJSON(data);
    expect(restored.size).toBe(2);
    expect(restored.getEntries().map(e => e.fitness)).toEqual([30, 20]);
  });

  it('clear removes all entries', () => {
    const hof = new HallOfFame(10);
    hof.update([makeEntry(10), makeEntry(20)]);
    hof.clear();
    expect(hof.size).toBe(0);
    expect(hof.getBest()).toBeNull();
  });
});
