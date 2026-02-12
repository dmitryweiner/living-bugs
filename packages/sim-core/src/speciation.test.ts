import { describe, it, expect, beforeEach } from 'vitest';
import {
  compatibilityDistance,
  dnaCompatibilityDistance,
  assignSpecies,
  adjustedFitness,
  computeAdjustedFitness,
  updateSpeciesStagnation,
  resetSpeciesCounter,
  DEFAULT_SPECIATION_CONFIG,
  type Species,
  type CreatureFitness,
  type SpeciationConfig,
} from './speciation.js';
import { createDefaultDNA, mutateDNA, resetInnovationCounter } from './dna.js';
import { PRNG } from './prng.js';
import type { BrainGenome, ConnectionGene, NodeGene, DNA } from './types.js';

// ============================================================
// Helpers
// ============================================================

function makeBrain(connections: Partial<ConnectionGene>[]): BrainGenome {
  return {
    plasticityRate: 0.01,
    nodeGenes: [
      { id: 0, type: 'input', activation: 'linear' } as NodeGene,
      { id: 1, type: 'output', activation: 'tanh' } as NodeGene,
    ],
    connectionGenes: connections.map((c, i) => ({
      innovationNumber: c.innovationNumber ?? i + 1,
      fromNode: c.fromNode ?? 0,
      toNode: c.toNode ?? 1,
      weight: c.weight ?? 0,
      enabled: c.enabled ?? true,
    })),
  };
}

function makeDnaWithBrain(brain: BrainGenome): DNA {
  return {
    groupId: 0,
    hasIFF: false,
    body: { radius: 5 },
    sensors: [
      { type: 'rayVision', rayCount: 3, fov: 1.5, maxDistance: 50, offsetAngle: 0 },
      { type: 'touch' },
      { type: 'energySense' },
    ],
    actuators: [
      { type: 'move' },
      { type: 'eat' },
    ],
    brain,
  };
}

beforeEach(() => {
  resetInnovationCounter();
  resetSpeciesCounter();
});

// ============================================================
// compatibilityDistance
// ============================================================

describe('compatibilityDistance', () => {
  it('returns 0 for identical genomes', () => {
    const brain = makeBrain([
      { innovationNumber: 1, weight: 0.5 },
      { innovationNumber: 2, weight: -0.3 },
    ]);
    expect(compatibilityDistance(brain, brain, 1, 1, 1)).toBe(0);
  });

  it('returns 0 for two empty genomes', () => {
    const brain1 = makeBrain([]);
    const brain2 = makeBrain([]);
    expect(compatibilityDistance(brain1, brain2, 1, 1, 1)).toBe(0);
  });

  it('is symmetric', () => {
    const brain1 = makeBrain([
      { innovationNumber: 1, weight: 0.5 },
      { innovationNumber: 2, weight: 0.3 },
      { innovationNumber: 3, weight: 0.1 },
    ]);
    const brain2 = makeBrain([
      { innovationNumber: 1, weight: -0.5 },
      { innovationNumber: 4, weight: 0.8 },
    ]);
    const d1 = compatibilityDistance(brain1, brain2, 1, 1, 0.4);
    const d2 = compatibilityDistance(brain2, brain1, 1, 1, 0.4);
    expect(d1).toBeCloseTo(d2, 10);
  });

  it('is non-negative', () => {
    const brain1 = makeBrain([
      { innovationNumber: 1, weight: 5 },
    ]);
    const brain2 = makeBrain([
      { innovationNumber: 2, weight: -5 },
    ]);
    expect(compatibilityDistance(brain1, brain2, 1, 1, 1)).toBeGreaterThanOrEqual(0);
  });

  it('counts excess genes correctly', () => {
    // brain1 has innovations 1,2; brain2 has 1,2,3,4
    // innovation 3,4 are excess (beyond brain1's max of 2)
    const brain1 = makeBrain([
      { innovationNumber: 1, weight: 0 },
      { innovationNumber: 2, weight: 0 },
    ]);
    const brain2 = makeBrain([
      { innovationNumber: 1, weight: 0 },
      { innovationNumber: 2, weight: 0 },
      { innovationNumber: 3, weight: 0 },
      { innovationNumber: 4, weight: 0 },
    ]);
    // 2 excess genes, 0 disjoint, 0 weight diff
    // N = max(2, 4) = 4
    // distance = (1*2 + 1*0) / 4 + 0 = 0.5
    expect(compatibilityDistance(brain1, brain2, 1, 1, 1)).toBeCloseTo(0.5);
  });

  it('counts disjoint genes correctly', () => {
    // brain1: innovations 1,3; brain2: innovations 2,3
    // brain1's max=3, brain2's max=3
    // Innovation 1: in brain1 only, <= max2(3) → disjoint
    // Innovation 2: in brain2 only, <= max1(3) → disjoint
    // Innovation 3: matching
    const brain1 = makeBrain([
      { innovationNumber: 1, weight: 0 },
      { innovationNumber: 3, weight: 0 },
    ]);
    const brain2 = makeBrain([
      { innovationNumber: 2, weight: 0 },
      { innovationNumber: 3, weight: 0 },
    ]);
    // 2 disjoint, 0 excess, 0 weight diff, N=2
    // distance = (1*0 + 1*2) / 2 = 1.0
    expect(compatibilityDistance(brain1, brain2, 1, 1, 1)).toBeCloseTo(1.0);
  });

  it('accounts for weight differences in matching genes', () => {
    const brain1 = makeBrain([
      { innovationNumber: 1, weight: 0.5 },
      { innovationNumber: 2, weight: 1.0 },
    ]);
    const brain2 = makeBrain([
      { innovationNumber: 1, weight: -0.5 },
      { innovationNumber: 2, weight: 0.0 },
    ]);
    // 2 matching genes, weight diffs: 1.0, 1.0, avg = 1.0
    // 0 excess, 0 disjoint, N=2
    // distance = 0 + c3 * 1.0
    expect(compatibilityDistance(brain1, brain2, 1, 1, 0.4)).toBeCloseTo(0.4);
  });

  it('combines excess, disjoint, and weight differences', () => {
    const brain1 = makeBrain([
      { innovationNumber: 1, weight: 1.0 },
      { innovationNumber: 2, weight: 0.5 },
      { innovationNumber: 5, weight: 0.1 }, // disjoint (< max2=6)
    ]);
    const brain2 = makeBrain([
      { innovationNumber: 1, weight: 0.0 },
      { innovationNumber: 3, weight: 0.8 }, // disjoint (< max1=5)
      { innovationNumber: 6, weight: 0.2 }, // excess (> max1=5)
    ]);
    // Matching: inn 1 (|1.0-0.0|=1.0)
    // Disjoint: inn 2,3,5 (3 disjoint)
    // Excess: inn 6 (1 excess)
    // N = max(3, 3) = 3
    // distance = (1*1 + 1*3) / 3 + 0.4 * 1.0 = 1.333 + 0.4 = 1.733
    const d = compatibilityDistance(brain1, brain2, 1, 1, 0.4);
    expect(d).toBeCloseTo(1.733, 2);
  });
});

// ============================================================
// dnaCompatibilityDistance
// ============================================================

describe('dnaCompatibilityDistance', () => {
  it('computes distance for DNA objects', () => {
    const rng = new PRNG(42);
    const dna1 = createDefaultDNA(0, rng);
    const dna2 = createDefaultDNA(1, rng);

    // Same brain structure since created with same flow, just different weights
    const dist = dnaCompatibilityDistance(dna1, dna2, DEFAULT_SPECIATION_CONFIG);
    expect(dist).toBeGreaterThanOrEqual(0);
  });

  it('identical DNA has zero distance', () => {
    const rng = new PRNG(42);
    const dna = createDefaultDNA(0, rng);
    expect(dnaCompatibilityDistance(dna, dna, DEFAULT_SPECIATION_CONFIG)).toBe(0);
  });

  it('mutated DNA has non-zero distance', () => {
    const rng = new PRNG(42);
    const dna = createDefaultDNA(0, rng);
    const mutated = mutateDNA(dna, 1.0, 1.0, rng); // aggressive mutation
    const dist = dnaCompatibilityDistance(dna, mutated, DEFAULT_SPECIATION_CONFIG);
    expect(dist).toBeGreaterThan(0);
  });
});

// ============================================================
// assignSpecies
// ============================================================

describe('assignSpecies', () => {
  it('assigns all creatures to one species if they are similar', () => {
    const rng = new PRNG(42);
    const dna = createDefaultDNA(0, rng);
    const creatures: CreatureFitness[] = [
      { creatureId: 1, dna, fitness: 10 },
      { creatureId: 2, dna, fitness: 20 },
      { creatureId: 3, dna, fitness: 15 },
    ];

    const species = assignSpecies(creatures, [], DEFAULT_SPECIATION_CONFIG);
    expect(species.length).toBe(1);
    expect(species[0].members).toEqual([1, 2, 3]);
  });

  it('creates new species for distant creatures', () => {
    const rng = new PRNG(42);
    const dna1 = createDefaultDNA(0, rng);

    // Create very different DNA through heavy mutation
    let dna2 = createDefaultDNA(1, rng);
    for (let i = 0; i < 20; i++) {
      dna2 = mutateDNA(dna2, 1.0, 2.0, rng);
    }

    // Use very low threshold to force separation
    const config: SpeciationConfig = { ...DEFAULT_SPECIATION_CONFIG, distanceThreshold: 0.001 };

    const creatures: CreatureFitness[] = [
      { creatureId: 1, dna: dna1, fitness: 10 },
      { creatureId: 2, dna: dna2, fitness: 20 },
    ];

    const species = assignSpecies(creatures, [], config);
    expect(species.length).toBe(2);
  });

  it('preserves existing species when reassigning', () => {
    const rng = new PRNG(42);
    const dna = createDefaultDNA(0, rng);

    const existingSpecies: Species[] = [{
      id: 99,
      representative: dna,
      members: [],
      bestFitness: 5,
      stagnation: 0,
    }];

    const creatures: CreatureFitness[] = [
      { creatureId: 1, dna, fitness: 10 },
    ];

    const result = assignSpecies(creatures, existingSpecies, DEFAULT_SPECIATION_CONFIG);
    // Should reuse existing species
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(99);
    expect(result[0].members).toEqual([1]);
  });

  it('removes empty species', () => {
    const rng = new PRNG(42);
    const dna = createDefaultDNA(0, rng);

    // Create very different DNA for the species rep
    let farDna = createDefaultDNA(1, rng);
    for (let i = 0; i < 20; i++) {
      farDna = mutateDNA(farDna, 1.0, 2.0, rng);
    }

    const existingSpecies: Species[] = [
      { id: 1, representative: dna, members: [], bestFitness: 5, stagnation: 0 },
      { id: 2, representative: farDna, members: [], bestFitness: 5, stagnation: 0 },
    ];

    const creatures: CreatureFitness[] = [
      { creatureId: 1, dna, fitness: 10 },
    ];

    const result = assignSpecies(creatures, existingSpecies, DEFAULT_SPECIATION_CONFIG);
    // Empty species should be removed
    for (const sp of result) {
      expect(sp.members.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// adjustedFitness
// ============================================================

describe('adjustedFitness', () => {
  it('divides fitness by species size', () => {
    expect(adjustedFitness(10, 5)).toBe(2);
  });

  it('returns raw fitness for size 1', () => {
    expect(adjustedFitness(10, 1)).toBe(10);
  });

  it('handles zero species size', () => {
    expect(adjustedFitness(10, 0)).toBe(10);
  });
});

// ============================================================
// computeAdjustedFitness
// ============================================================

describe('computeAdjustedFitness', () => {
  it('computes adjusted fitness for all creatures', () => {
    const creatures: CreatureFitness[] = [
      { creatureId: 1, dna: {} as DNA, fitness: 20 },
      { creatureId: 2, dna: {} as DNA, fitness: 10 },
      { creatureId: 3, dna: {} as DNA, fitness: 30 },
    ];
    const species: Species[] = [
      { id: 1, representative: {} as DNA, members: [1, 2], bestFitness: 20, stagnation: 0 },
      { id: 2, representative: {} as DNA, members: [3], bestFitness: 30, stagnation: 0 },
    ];

    const result = computeAdjustedFitness(creatures, species);
    expect(result.get(1)).toBe(10); // 20 / 2
    expect(result.get(2)).toBe(5);  // 10 / 2
    expect(result.get(3)).toBe(30); // 30 / 1
  });
});

// ============================================================
// updateSpeciesStagnation
// ============================================================

describe('updateSpeciesStagnation', () => {
  it('resets stagnation when fitness improves', () => {
    const rng = new PRNG(42);
    const dna = createDefaultDNA(0, rng);

    const species: Species[] = [
      { id: 1, representative: dna, members: [1], bestFitness: 10, stagnation: 5 },
    ];
    const creatures: CreatureFitness[] = [
      { creatureId: 1, dna, fitness: 20 },
    ];

    const config: SpeciationConfig = { ...DEFAULT_SPECIATION_CONFIG, stagnationLimit: 15 };
    const result = updateSpeciesStagnation(species, creatures, config);

    expect(result.length).toBe(1);
    expect(result[0].stagnation).toBe(0);
    expect(result[0].bestFitness).toBe(20);
  });

  it('increments stagnation when fitness does not improve', () => {
    const rng = new PRNG(42);
    const dna = createDefaultDNA(0, rng);

    const species: Species[] = [
      { id: 1, representative: dna, members: [1], bestFitness: 30, stagnation: 5 },
    ];
    const creatures: CreatureFitness[] = [
      { creatureId: 1, dna, fitness: 20 },
    ];

    const config: SpeciationConfig = { ...DEFAULT_SPECIATION_CONFIG, stagnationLimit: 15 };
    const result = updateSpeciesStagnation(species, creatures, config);

    expect(result.length).toBe(1);
    expect(result[0].stagnation).toBe(6);
    expect(result[0].bestFitness).toBe(30); // unchanged
  });

  it('culls stagnant species', () => {
    const rng = new PRNG(42);
    const dna1 = createDefaultDNA(0, rng);
    const dna2 = createDefaultDNA(1, rng);

    const species: Species[] = [
      { id: 1, representative: dna1, members: [1], bestFitness: 10, stagnation: 14 },
      { id: 2, representative: dna2, members: [2], bestFitness: 20, stagnation: 0 },
    ];
    const creatures: CreatureFitness[] = [
      { creatureId: 1, dna: dna1, fitness: 5 },
      { creatureId: 2, dna: dna2, fitness: 25 },
    ];

    const config: SpeciationConfig = { ...DEFAULT_SPECIATION_CONFIG, stagnationLimit: 15 };
    const result = updateSpeciesStagnation(species, creatures, config);

    // Species 1 stagnation = 15, should be culled
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(2);
  });

  it('keeps at least one species even if all stagnant', () => {
    const rng = new PRNG(42);
    const dna = createDefaultDNA(0, rng);

    const species: Species[] = [
      { id: 1, representative: dna, members: [1], bestFitness: 100, stagnation: 14 },
    ];
    const creatures: CreatureFitness[] = [
      { creatureId: 1, dna, fitness: 5 },
    ];

    const config: SpeciationConfig = { ...DEFAULT_SPECIATION_CONFIG, stagnationLimit: 15 };
    const result = updateSpeciesStagnation(species, creatures, config);

    // Even though stagnation hits limit, keep the last species
    expect(result.length).toBe(1);
    expect(result[0].stagnation).toBe(0); // reset
  });
});
