import { World } from '@living-bugs/sim-core';
import type { WorldConfig, TickMetrics, WorldSnapshot, DNA } from '@living-bugs/sim-core';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ============================================================
// CLI arguments
// ============================================================

export interface RunOptions {
  ticks: number;
  logInterval: number;
  exportPath: string | null;
  exportTopK: number;
  maxCreatures: number | null;
  checkpointPath: string | null;
  checkpointInterval: number;
  seedGenotypesPath: string | null;
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
