// ============================================================
// NEAT Speciation — compatibility distance, species assignment,
// fitness sharing
// ============================================================

import type { DNA, BrainGenome, ConnectionGene } from './types.js';

// ============================================================
// Types
// ============================================================

export interface SpeciationConfig {
  /** Enable speciation (false = single-species mode). */
  enabled: boolean;
  /** Compatibility distance threshold for same species. */
  distanceThreshold: number;
  /** Coefficient for excess genes. */
  c1: number;
  /** Coefficient for disjoint genes. */
  c2: number;
  /** Coefficient for average weight difference of matching genes. */
  c3: number;
  /** Number of generations a species can stagnate before being culled. */
  stagnationLimit: number;
}

export const DEFAULT_SPECIATION_CONFIG: SpeciationConfig = {
  enabled: true,
  distanceThreshold: 3.0,
  c1: 1.0,
  c2: 1.0,
  c3: 0.4,
  stagnationLimit: 15,
};

export interface Species {
  /** Unique species ID. */
  id: number;
  /** Representative genome (used for distance comparison). */
  representative: DNA;
  /** Creature IDs belonging to this species. */
  members: number[];
  /** Best fitness ever observed in this species. */
  bestFitness: number;
  /** Number of generations without fitness improvement. */
  stagnation: number;
}

export interface CreatureFitness {
  creatureId: number;
  dna: DNA;
  fitness: number;
}

// ============================================================
// Compatibility distance (NEAT)
// ============================================================

/**
 * Compute NEAT compatibility distance between two brain genomes.
 *
 * Uses connection genes' innovation numbers to classify:
 * - Matching genes: same innovation number in both genomes
 * - Disjoint genes: non-matching within the range of the other genome
 * - Excess genes: beyond the range of the other genome
 *
 * Distance = (c1 * E + c2 * D) / N + c3 * W_avg
 *
 * Where N = max(size_of_genome1, size_of_genome2), minimum 1.
 */
export function compatibilityDistance(
  brain1: BrainGenome,
  brain2: BrainGenome,
  c1: number,
  c2: number,
  c3: number,
): number {
  const conns1 = brain1.connectionGenes;
  const conns2 = brain2.connectionGenes;

  if (conns1.length === 0 && conns2.length === 0) return 0;

  // Build maps from innovation number to connection
  const map1 = new Map<number, ConnectionGene>();
  const map2 = new Map<number, ConnectionGene>();

  let max1 = 0;
  let max2 = 0;

  for (const c of conns1) {
    map1.set(c.innovationNumber, c);
    if (c.innovationNumber > max1) max1 = c.innovationNumber;
  }

  for (const c of conns2) {
    map2.set(c.innovationNumber, c);
    if (c.innovationNumber > max2) max2 = c.innovationNumber;
  }

  let excess = 0;
  let disjoint = 0;
  let matchingWeightDiff = 0;
  let matchingCount = 0;

  // All unique innovation numbers
  const allInnovations = new Set<number>();
  for (const inn of map1.keys()) allInnovations.add(inn);
  for (const inn of map2.keys()) allInnovations.add(inn);

  for (const inn of allInnovations) {
    const in1 = map1.has(inn);
    const in2 = map2.has(inn);

    if (in1 && in2) {
      // Matching gene
      matchingCount++;
      matchingWeightDiff += Math.abs(map1.get(inn)!.weight - map2.get(inn)!.weight);
    } else if (in1 && !in2) {
      // In genome1 only
      if (inn > max2) {
        excess++;
      } else {
        disjoint++;
      }
    } else {
      // In genome2 only
      if (inn > max1) {
        excess++;
      } else {
        disjoint++;
      }
    }
  }

  const N = Math.max(conns1.length, conns2.length, 1);
  const avgWeightDiff = matchingCount > 0 ? matchingWeightDiff / matchingCount : 0;

  return (c1 * excess + c2 * disjoint) / N + c3 * avgWeightDiff;
}

/**
 * Convenience: compute compatibility distance between two DNA genomes.
 */
export function dnaCompatibilityDistance(
  dna1: DNA,
  dna2: DNA,
  config: SpeciationConfig,
): number {
  return compatibilityDistance(
    dna1.brain,
    dna2.brain,
    config.c1,
    config.c2,
    config.c3,
  );
}

// ============================================================
// Species assignment
// ============================================================

let nextSpeciesId = 1;

export function resetSpeciesCounter(value = 1): void {
  nextSpeciesId = value;
}

/**
 * Assign creatures to species based on compatibility distance to each
 * species' representative. If no species is close enough, a new one is
 * created.
 *
 * Returns updated species list. Members arrays are replaced (not appended).
 */
export function assignSpecies(
  creatures: CreatureFitness[],
  existingSpecies: Species[],
  config: SpeciationConfig,
): Species[] {
  // Clear member lists
  for (const sp of existingSpecies) {
    sp.members = [];
  }

  const newSpecies: Species[] = [...existingSpecies];

  for (const creature of creatures) {
    let assigned = false;

    for (const sp of newSpecies) {
      const dist = dnaCompatibilityDistance(creature.dna, sp.representative, config);
      if (dist < config.distanceThreshold) {
        sp.members.push(creature.creatureId);
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      // Create new species with this creature as representative
      newSpecies.push({
        id: nextSpeciesId++,
        representative: creature.dna,
        members: [creature.creatureId],
        bestFitness: creature.fitness,
        stagnation: 0,
      });
    }
  }

  // Remove empty species (all members died / were reassigned)
  return newSpecies.filter(sp => sp.members.length > 0);
}

// ============================================================
// Fitness sharing (adjusted fitness)
// ============================================================

/**
 * Adjusted fitness = raw fitness / species size.
 * This prevents large species from dominating selection.
 */
export function adjustedFitness(rawFitness: number, speciesSize: number): number {
  if (speciesSize <= 0) return rawFitness;
  return rawFitness / speciesSize;
}

/**
 * Compute adjusted fitness for all creatures given their species assignments.
 * Returns a map from creatureId to adjusted fitness.
 */
export function computeAdjustedFitness(
  creatures: CreatureFitness[],
  species: Species[],
): Map<number, number> {
  // Build species membership lookup
  const creatureSpeciesSize = new Map<number, number>();
  for (const sp of species) {
    for (const memberId of sp.members) {
      creatureSpeciesSize.set(memberId, sp.members.length);
    }
  }

  const result = new Map<number, number>();
  for (const c of creatures) {
    const speciesSize = creatureSpeciesSize.get(c.creatureId) ?? 1;
    result.set(c.creatureId, adjustedFitness(c.fitness, speciesSize));
  }

  return result;
}

// ============================================================
// Species stagnation tracking
// ============================================================

/**
 * Update species stagnation counters based on current generation fitness.
 * Returns species that are still alive (not culled due to stagnation).
 *
 * For each species:
 * - If current best fitness > species' all-time best, reset stagnation
 * - Otherwise increment stagnation
 * - If stagnation >= limit, species is culled (unless it's the only one)
 *
 * Also updates the representative to a random member's DNA.
 */
export function updateSpeciesStagnation(
  species: Species[],
  creatures: CreatureFitness[],
  config: SpeciationConfig,
): Species[] {
  // Build fitness lookup
  const fitnessMap = new Map<number, number>();
  const dnaMap = new Map<number, DNA>();
  for (const c of creatures) {
    fitnessMap.set(c.creatureId, c.fitness);
    dnaMap.set(c.creatureId, c.dna);
  }

  for (const sp of species) {
    // Find best fitness among current members
    let currentBest = -Infinity;
    for (const memberId of sp.members) {
      const f = fitnessMap.get(memberId) ?? 0;
      if (f > currentBest) currentBest = f;
    }

    if (currentBest > sp.bestFitness) {
      sp.bestFitness = currentBest;
      sp.stagnation = 0;
    } else {
      sp.stagnation++;
    }

    // Update representative to first member (could be random, but deterministic is simpler)
    if (sp.members.length > 0) {
      const repDna = dnaMap.get(sp.members[0]);
      if (repDna) sp.representative = repDna;
    }
  }

  // Cull stagnant species (but always keep at least one)
  const alive = species.filter(sp => sp.stagnation < config.stagnationLimit);
  if (alive.length === 0 && species.length > 0) {
    // Keep the best species
    const best = species.reduce((a, b) => a.bestFitness > b.bestFitness ? a : b);
    best.stagnation = 0;
    return [best];
  }
  return alive;
}
