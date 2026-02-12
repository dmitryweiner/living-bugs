import { World } from '@living-bugs/sim-core';
import type { WorldConfig } from '@living-bugs/sim-core';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  parseArgs,
  runSimulation,
  runGenerational,
  exportBestGenotypes,
  saveCheckpoint,
  loadCheckpoint,
  loadSeedGenotypes,
} from './run.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================
// Load config
// ============================================================

function loadConfig(): WorldConfig {
  const configPath = resolve(__dirname, '../../../configs/world-config.json');
  const raw = readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as WorldConfig;
}

// ============================================================
// Main
// ============================================================

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    console.log(`
Living Bugs Headless Runner

Usage: npx tsx apps/headless/src/main.ts [options]

Options:
  --ticks N              Number of simulation ticks to run (default: 3000)
  --log-interval N       Print metrics every N ticks (default: 100)
  --export PATH          Export best genotypes to JSON file
  --top-k N              Number of top genotypes to export (default: 20)
  --max-creatures N      Override max creature count (default: from config)
  --checkpoint PATH      Save/load checkpoint from this file (enables resume)
  --checkpoint-interval N  Save checkpoint every N ticks (default: 10000)
  --seed PATH            Load seed genotypes from JSON file for initialization
  --mode MODE            Training mode: continuous (default) or generational
  --gen-ticks N          Ticks per generation in generational mode (default: 1000)
  --generations N        Number of generations in generational mode (default: 50)
  --help                 Show this help

Training pipeline examples:
  # Continuous mode (default):
  npx tsx apps/headless/src/main.ts --ticks 100000 --checkpoint checkpoint.json \\
    --export configs/seed-genotypes.json --max-creatures 300

  # Generational mode with NEAT speciation:
  npx tsx apps/headless/src/main.ts --mode generational --generations 100 \\
    --gen-ticks 2000 --export configs/seed-genotypes.json --max-creatures 300
`);
    process.exit(0);
  }

  const opts = parseArgs(args);
  const config = loadConfig();

  // CLI overrides
  if (opts.maxCreatures !== null) {
    config.simulation.maxCreatures = opts.maxCreatures;
  }

  // ========================================
  // Generational mode
  // ========================================
  if (opts.mode === 'generational') {
    console.log('=== Living Bugs Headless Runner (Generational) ===');
    console.log(`World: ${config.world.width}x${config.world.height}`);
    console.log(`Generations: ${opts.generations} | Ticks/gen: ${opts.genTicks}`);
    console.log(`Max creatures: ${config.simulation.maxCreatures}`);
    console.log('');

    // Load seed genotypes if provided
    let seedDNA: import('@living-bugs/sim-core').DNA[] = [];
    if (opts.seedGenotypesPath) {
      seedDNA = loadSeedGenotypes(opts.seedGenotypesPath);
      if (seedDNA.length > 0) {
        console.log(`Loaded ${seedDNA.length} seed genotypes from ${opts.seedGenotypesPath}`);
      }
    }

    let lastWorld: World | null = null;

    const result = runGenerational(
      config,
      opts,
      seedDNA.length > 0 ? seedDNA : undefined,
      {
        onGeneration: (stats) => {
          console.log(
            `[gen ${stats.generation.toString().padStart(4)}] ` +
            `species: ${stats.speciesCount.toString().padStart(3)} | ` +
            `pop: ${stats.populationSize.toString().padStart(5)} | ` +
            `best: ${stats.bestFitness.toFixed(1).padStart(8)} | ` +
            `avg: ${stats.avgFitness.toFixed(1).padStart(8)} | ` +
            `worst: ${stats.worstFitness.toFixed(1).padStart(8)} | ` +
            `${(stats.elapsedMs / 1000).toFixed(1)}s`
          );
        },
        onCheckpoint: (world) => {
          lastWorld = world;
        },
      }
    );

    const totalTime = (result.totalTimeMs / 1000).toFixed(2);
    console.log(`\nGenerational training complete. ${result.totalGenerations} generations in ${totalTime}s`);
    console.log(`Hall of Fame: ${result.hallOfFame.size} entries, best fitness: ${result.hallOfFame.getBest()?.fitness.toFixed(1) ?? 'N/A'}`);

    // Export hall of fame genotypes
    if (opts.exportPath) {
      const hofEntries = result.hallOfFame.getTopK(opts.exportTopK);
      const output = {
        exportedAt: new Date().toISOString(),
        mode: 'generational',
        generations: result.totalGenerations,
        count: hofEntries.length,
        genotypes: hofEntries.map(e => ({
          fitness: e.fitness,
          dna: e.dna,
          stats: e.stats,
        })),
      };
      const outPath = resolve(opts.exportPath);
      writeFileSync(outPath, JSON.stringify(output, null, 2));
      console.log(`Exported top ${hofEntries.length} hall of fame genotypes to ${outPath}`);
    }

    return;
  }

  // ========================================
  // Continuous mode (default)
  // ========================================

  // Create world
  const world = new World(config);

  // Try to resume from checkpoint
  let resumed = false;
  if (opts.checkpointPath) {
    const snapshot = loadCheckpoint(opts.checkpointPath);
    if (snapshot) {
      // Apply maxCreatures override to loaded config too
      if (opts.maxCreatures !== null) {
        snapshot.config.simulation.maxCreatures = opts.maxCreatures;
      }
      world.loadSnapshot(snapshot);
      resumed = true;
      console.log(`=== Resumed from checkpoint at tick ${snapshot.tick} ===`);
    }
  }

  // If not resumed, initialize fresh world
  if (!resumed) {
    // Try to load seed genotypes
    let seedDNA: import('@living-bugs/sim-core').DNA[] = [];
    if (opts.seedGenotypesPath) {
      seedDNA = loadSeedGenotypes(opts.seedGenotypesPath);
      if (seedDNA.length > 0) {
        console.log(`Loaded ${seedDNA.length} seed genotypes from ${opts.seedGenotypesPath}`);
      }
    }
    world.initialize(seedDNA.length > 0 ? seedDNA : undefined);
  }

  console.log('=== Living Bugs Headless Runner ===');
  console.log(`World: ${config.world.width}x${config.world.height}`);
  console.log(`Start tick: ${world.tick}`);
  console.log(`Training for: ${opts.ticks} more ticks (until tick ${world.tick + opts.ticks})`);
  console.log(`Creatures: ${world.creatures.size} | Max: ${config.simulation.maxCreatures}`);
  if (opts.checkpointPath) {
    console.log(`Checkpoint: ${resolve(opts.checkpointPath)} (every ${opts.checkpointInterval} ticks)`);
  }
  console.log('');

  const result = runSimulation(world, opts, {
    onLog: (metrics, elapsed) => {
      console.log(
        `[tick ${metrics.tick.toString().padStart(7)}] ` +
        `creatures: ${metrics.creatureCount.toString().padStart(5)} | ` +
        `food: ${metrics.foodCount.toString().padStart(5)} | ` +
        `avg energy: ${metrics.avgEnergy.toFixed(1).padStart(7)} | ` +
        `avg age: ${metrics.avgAge.toFixed(0).padStart(6)} | ` +
        `births: ${metrics.intervalBirths.toString().padStart(4)} | ` +
        `deaths: ${metrics.intervalDeaths.toString().padStart(4)} | ` +
        `${elapsed.toFixed(1)}s`
      );
    },
    onCheckpoint: (_w, ticksRun) => {
      if (opts.checkpointPath) {
        saveCheckpoint(world, opts.checkpointPath);
        console.log(`  Checkpoint saved (${ticksRun} ticks in this session, world tick ${world.tick})`);
      }
    },
  });

  if (result.stoppedEarly && result.finalMetrics) {
    console.log(`\nAll creatures died at tick ${result.finalMetrics.tick}. Stopping.`);
  }

  const totalTime = (result.totalTimeMs / 1000).toFixed(2);
  console.log(`\nSimulation complete. Total time: ${totalTime}s`);
  console.log(`Final tick: ${world.tick} | ${result.finalMetrics?.creatureCount ?? 0} creatures, ${result.finalMetrics?.foodCount ?? 0} food`);

  // Save final checkpoint
  if (opts.checkpointPath) {
    saveCheckpoint(world, opts.checkpointPath);
    console.log(`Final checkpoint saved to ${resolve(opts.checkpointPath)}`);
  }

  // Export best genotypes
  if (opts.exportPath) {
    exportBestGenotypes(world, opts.exportPath, opts.exportTopK);
  }
}

main();
