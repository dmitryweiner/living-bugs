import {
  World,
  mutateDNA,
  PRNG,
  assignSpecies,
  computeAdjustedFitness,
  updateSpeciesStagnation,
  resetSpeciesCounter,
  DEFAULT_SPECIATION_CONFIG,
  HallOfFame,
} from '@living-bugs/sim-core';
import type {
  WorldConfig,
  TickMetrics,
  WorldSnapshot,
  DNA,
  Species,
  CreatureFitness,
  SpeciationConfig,
  HallOfFameEntry,
} from '@living-bugs/sim-core';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ============================================================
// CLI arguments
// ============================================================

export type TrainingMode = 'continuous' | 'generational';

export interface RunOptions {
  ticks: number;
  logInterval: number;
  exportPath: string | null;
  exportTopK: number;
  maxCreatures: number | null;
  checkpointPath: string | null;
  checkpointInterval: number;
  seedGenotypesPath: string | null;
  /** Training mode: continuous (default) or generational. */
  mode: TrainingMode;
  /** Ticks per generation (generational mode only). */
  genTicks: number;
  /** Number of generations to run (generational mode only). */
  generations: number;
}

export function parseArgs(args: string[]): RunOptions {
  const opts: RunOptions = {
    ticks: 3000,
    logInterval: 100,
    exportPath: null,
    exportTopK: 20,
    maxCreatures: null,
    checkpointPath: null,
    checkpointInterval: 10000,
    seedGenotypesPath: null,
    mode: 'continuous',
    genTicks: 1000,
    generations: 50,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--ticks':
        opts.ticks = parseInt(args[++i], 10);
        break;
      case '--log-interval':
        opts.logInterval = parseInt(args[++i], 10);
        break;
      case '--export':
        opts.exportPath = args[++i];
        break;
      case '--top-k':
        opts.exportTopK = parseInt(args[++i], 10);
        break;
      case '--max-creatures':
        opts.maxCreatures = parseInt(args[++i], 10);
        break;
      case '--checkpoint':
        opts.checkpointPath = args[++i];
        break;
      case '--checkpoint-interval':
        opts.checkpointInterval = parseInt(args[++i], 10);
        break;
      case '--seed':
        opts.seedGenotypesPath = args[++i];
        break;
      case '--mode':
        opts.mode = args[++i] as TrainingMode;
        break;
      case '--gen-ticks':
        opts.genTicks = parseInt(args[++i], 10);
        break;
      case '--generations':
        opts.generations = parseInt(args[++i], 10);
        break;
    }
  }

  return opts;
}

// ============================================================
// Checkpoint helpers
// ============================================================

export function saveCheckpoint(world: World, path: string): void {
  const snapshot = world.getSnapshot();
  const outPath = resolve(path);
  writeFileSync(outPath, JSON.stringify(snapshot));
}

export function loadCheckpoint(path: string): WorldSnapshot | null {
  const absPath = resolve(path);
  if (!existsSync(absPath)) return null;
  try {
    const raw = readFileSync(absPath, 'utf-8');
    return JSON.parse(raw) as WorldSnapshot;
  } catch {
    return null;
  }
}

// ============================================================
// Seed genotypes loader
// ============================================================

export function loadSeedGenotypes(path: string): DNA[] {
  const absPath = resolve(path);
  if (!existsSync(absPath)) return [];
  try {
    const raw = readFileSync(absPath, 'utf-8');
    const data = JSON.parse(raw) as { genotypes?: { dna: DNA }[] };
    if (data.genotypes && Array.isArray(data.genotypes)) {
      return data.genotypes.map(g => g.dna);
    }
    return [];
  } catch {
    return [];
  }
}

// ============================================================
// Simulation runner
// ============================================================

export interface RunResult {
  finalMetrics: TickMetrics | null;
  totalTimeMs: number;
  stoppedEarly: boolean;
}

/** Accumulated metrics over a log interval. */
export interface IntervalMetrics extends TickMetrics {
  /** Total births during the interval. */
  intervalBirths: number;
  /** Total deaths during the interval. */
  intervalDeaths: number;
}

export interface RunCallbacks {
  onLog?: (metrics: IntervalMetrics, elapsed: number) => void;
  onCheckpoint?: (world: World, ticksRun: number) => void;
}

export function runSimulation(
  world: World,
  opts: RunOptions,
  callbacks?: RunCallbacks,
): RunResult {
  const startTime = performance.now();
  let lastMetrics: TickMetrics | null = null;
  let stoppedEarly = false;
  let accBirths = 0;
  let accDeaths = 0;

  for (let t = 0; t < opts.ticks; t++) {
    lastMetrics = world.step();
    accBirths += lastMetrics.births;
    accDeaths += lastMetrics.deaths;

    const ticksDone = t + 1;

    if (callbacks?.onLog && ticksDone % opts.logInterval === 0) {
      const elapsed = (performance.now() - startTime) / 1000;
      callbacks.onLog({ ...lastMetrics, intervalBirths: accBirths, intervalDeaths: accDeaths }, elapsed);
      accBirths = 0;
      accDeaths = 0;
    }

    if (callbacks?.onCheckpoint && opts.checkpointInterval > 0 && ticksDone % opts.checkpointInterval === 0) {
      callbacks.onCheckpoint(world, ticksDone);
    }

    if (lastMetrics.creatureCount === 0) {
      stoppedEarly = true;
      break;
    }
  }

  return {
    finalMetrics: lastMetrics,
    totalTimeMs: performance.now() - startTime,
    stoppedEarly,
  };
}

// ============================================================
// Export genotypes
// ============================================================

export interface RankedGenotype {
  fitness: number;
  dna: unknown;
  stats: { age: number; energy: number; groupId: number };
}

export function rankGenotypes(world: World, topK: number): RankedGenotype[] {
  const creatures = world.getCreatureStates();
  return creatures
    .map(c => ({
      fitness: c.age * (c.energy / world.config.energy.maxEnergy),
      dna: c.dna,
      stats: { age: c.age, energy: c.energy, groupId: c.dna.groupId },
    }))
    .sort((a, b) => b.fitness - a.fitness)
    .slice(0, topK);
}

export function exportBestGenotypes(world: World, path: string, topK: number): void {
  const ranked = rankGenotypes(world, topK);
  const output = {
    exportedAt: new Date().toISOString(),
    tick: world.tick,
    count: ranked.length,
    genotypes: ranked,
  };

  const outPath = resolve(path);
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Exported top ${ranked.length} genotypes to ${outPath}`);
}

// ============================================================
// Generational training
// ============================================================

export interface GenerationStats {
  generation: number;
  speciesCount: number;
  populationSize: number;
  bestFitness: number;
  avgFitness: number;
  worstFitness: number;
  elapsedMs: number;
}

export interface GenerationalCallbacks {
  onGeneration?: (stats: GenerationStats) => void;
  onCheckpoint?: (world: World, generation: number) => void;
}

export interface GenerationalResult {
  totalGenerations: number;
  totalTimeMs: number;
  finalStats: GenerationStats | null;
  hallOfFame: HallOfFame;
}

/**
 * Run generational evolution:
 *  1. Simulate genTicks ticks
 *  2. Evaluate fitness of all surviving creatures
 *  3. Run speciation and adjusted fitness
 *  4. Select top creatures (tournament/truncation)
 *  5. Clone with mutation to fill population
 *  6. Reset world with new population
 *  7. Repeat for N generations
 */
export function runGenerational(
  config: WorldConfig,
  opts: RunOptions,
  seedGenotypes?: DNA[],
  callbacks?: GenerationalCallbacks,
): GenerationalResult {
  const startTime = performance.now();
  const rng = new PRNG(config.simulation.seed);
  const speciationConfig: SpeciationConfig = { ...DEFAULT_SPECIATION_CONFIG };
  const hallOfFame = new HallOfFame(opts.exportTopK);

  let species: Species[] = [];
  let currentGenotypes: DNA[] | undefined = seedGenotypes;
  let finalStats: GenerationStats | null = null;

  resetSpeciesCounter();

  for (let gen = 0; gen < opts.generations; gen++) {
    const genStart = performance.now();

    // 1. Create and run a fresh world for this generation
    const world = new World(config);
    world.initialize(currentGenotypes);

    // Capture initial DNA so we have something to mutate if everyone dies
    if (!currentGenotypes || currentGenotypes.length === 0) {
      currentGenotypes = world.getCreatureStates().map(c => c.dna);
    }

    // Run for genTicks ticks
    for (let t = 0; t < opts.genTicks; t++) {
      const metrics = world.step();
      if (metrics.creatureCount === 0) break;
    }

    // 2. Evaluate fitness
    const creatures = world.getCreatureStates();
    const creatureFitness: CreatureFitness[] = creatures.map(c => ({
      creatureId: c.id,
      dna: c.dna,
      fitness: c.age * (c.energy / config.energy.maxEnergy),
    }));

    if (creatureFitness.length === 0) {
      // Everyone died — mutate from previous genotypes with higher mutation
      currentGenotypes = currentGenotypes.map(dna =>
        mutateDNA(dna, config.reproduction.mutationRate * 2, config.reproduction.mutationStrength * 2, rng)
      );
      const stats: GenerationStats = {
        generation: gen + 1,
        speciesCount: 0,
        populationSize: 0,
        bestFitness: 0,
        avgFitness: 0,
        worstFitness: 0,
        elapsedMs: performance.now() - genStart,
      };
      finalStats = stats;
      callbacks?.onGeneration?.(stats);
      continue;
    }

    // 2b. Update Hall of Fame
    const hofEntries: HallOfFameEntry[] = creatures.map(c => ({
      fitness: c.age * (c.energy / config.energy.maxEnergy),
      dna: c.dna,
      generation: gen + 1,
      stats: { age: c.age, energy: c.energy, groupId: c.dna.groupId },
    }));
    hallOfFame.update(hofEntries);

    // 3. Speciation
    species = assignSpecies(creatureFitness, species, speciationConfig);
    const adjustedFitnessMap = computeAdjustedFitness(creatureFitness, species);
    species = updateSpeciesStagnation(species, creatureFitness, speciationConfig);

    // 4. Select: sort by adjusted fitness, take top portion
    const sortedCreatures = [...creatureFitness].sort((a, b) => {
      const af = adjustedFitnessMap.get(a.creatureId) ?? 0;
      const bf = adjustedFitnessMap.get(b.creatureId) ?? 0;
      return bf - af;
    });

    const topCount = Math.max(2, Math.ceil(sortedCreatures.length * 0.3));
    const topCreatures = sortedCreatures.slice(0, topCount);

    // 5. Clone with mutation to fill population
    const targetPop = config.simulation.initialCreatures;
    const nextGenGenotypes: DNA[] = [];
    for (let i = 0; i < targetPop; i++) {
      const parent = topCreatures[i % topCreatures.length];
      const child = mutateDNA(
        parent.dna,
        config.reproduction.mutationRate,
        config.reproduction.mutationStrength,
        rng,
      );
      nextGenGenotypes.push(child);
    }

    currentGenotypes = nextGenGenotypes;

    // Compute stats
    const fitnesses = creatureFitness.map(c => c.fitness);
    const stats: GenerationStats = {
      generation: gen + 1,
      speciesCount: species.length,
      populationSize: creatureFitness.length,
      bestFitness: Math.max(...fitnesses),
      avgFitness: fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length,
      worstFitness: Math.min(...fitnesses),
      elapsedMs: performance.now() - genStart,
    };
    finalStats = stats;
    callbacks?.onGeneration?.(stats);
    callbacks?.onCheckpoint?.(world, gen + 1);
  }

  return {
    totalGenerations: opts.generations,
    totalTimeMs: performance.now() - startTime,
    finalStats,
    hallOfFame,
  };
}

/**
 * Extract the best DNA genotypes from a generational run's final population.
 * (For use when the world has already finished its last generation.)
 */
export function extractBestFromGenerational(
  lastGenGenotypes: DNA[] | undefined,
  topK: number,
): DNA[] {
  if (!lastGenGenotypes || lastGenGenotypes.length === 0) return [];
  return lastGenGenotypes.slice(0, topK);
}
