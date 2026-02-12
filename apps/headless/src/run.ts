import { World } from '@living-bugs/sim-core';
import type { WorldConfig, TickMetrics } from '@living-bugs/sim-core';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

// ============================================================
// CLI arguments
// ============================================================

export interface RunOptions {
  ticks: number;
  logInterval: number;
  exportPath: string | null;
  exportTopK: number;
}

export function parseArgs(args: string[]): RunOptions {
  const opts: RunOptions = {
    ticks: 3000,
    logInterval: 100,
    exportPath: null,
    exportTopK: 20,
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
    }
  }

  return opts;
}

// ============================================================
// Simulation runner
// ============================================================

export interface RunResult {
  finalMetrics: TickMetrics | null;
  totalTimeMs: number;
  stoppedEarly: boolean;
}

export function runSimulation(
  world: World,
  opts: RunOptions,
  onTick?: (metrics: TickMetrics, elapsed: number) => void,
): RunResult {
  const startTime = performance.now();
  let lastMetrics: TickMetrics | null = null;
  let stoppedEarly = false;

  for (let t = 0; t < opts.ticks; t++) {
    lastMetrics = world.step();

    if (onTick && (t + 1) % opts.logInterval === 0) {
      const elapsed = (performance.now() - startTime) / 1000;
      onTick(lastMetrics, elapsed);
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
  console.log(`\nExported top ${ranked.length} genotypes to ${outPath}`);
}
