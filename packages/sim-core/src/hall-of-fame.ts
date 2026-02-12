// ============================================================
// Hall of Fame — tracks the best genotypes across all generations
// ============================================================

import type { DNA } from './types.js';

export interface HallOfFameEntry {
  /** Fitness score at time of entry. */
  fitness: number;
  /** DNA genome of the creature. */
  dna: DNA;
  /** Generation when this entry was added. */
  generation: number;
  /** Additional stats. */
  stats: {
    age: number;
    energy: number;
    groupId: number;
  };
}

export interface HallOfFameData {
  maxSize: number;
  entries: HallOfFameEntry[];
}

/**
 * Hall of Fame — maintains a bounded list of the best genotypes
 * ever observed across all generations of evolution.
 */
export class HallOfFame {
  private entries: HallOfFameEntry[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  /** Get all entries, sorted by fitness descending. */
  getEntries(): readonly HallOfFameEntry[] {
    return this.entries;
  }

  /** Get current count. */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Update the hall of fame with new candidates.
   * Merges with existing entries, keeps top-K by fitness.
   */
  update(candidates: HallOfFameEntry[]): void {
    // Merge candidates into entries
    const all = [...this.entries, ...candidates];

    // Sort by fitness descending
    all.sort((a, b) => b.fitness - a.fitness);

    // Keep top maxSize, deduplicate by rough DNA similarity
    // (For simplicity, just keep top by fitness — exact dedup would require
    // compatibility distance checks which is expensive here)
    this.entries = all.slice(0, this.maxSize);
  }

  /** Get the best entry (highest fitness). */
  getBest(): HallOfFameEntry | null {
    return this.entries.length > 0 ? this.entries[0] : null;
  }

  /** Get the top K entries. */
  getTopK(k: number): HallOfFameEntry[] {
    return this.entries.slice(0, k);
  }

  /** Extract just the DNA genotypes (for seeding). */
  getDNAs(count?: number): DNA[] {
    const entries = count ? this.entries.slice(0, count) : this.entries;
    return entries.map(e => e.dna);
  }

  /** Serialize to JSON-friendly object. */
  toJSON(): HallOfFameData {
    return {
      maxSize: this.maxSize,
      entries: this.entries,
    };
  }

  /** Restore from serialized data. */
  static fromJSON(data: HallOfFameData): HallOfFame {
    const hof = new HallOfFame(data.maxSize);
    hof.entries = data.entries
      .sort((a, b) => b.fitness - a.fitness)
      .slice(0, data.maxSize);
    return hof;
  }

  /** Clear all entries. */
  clear(): void {
    this.entries = [];
  }
}
