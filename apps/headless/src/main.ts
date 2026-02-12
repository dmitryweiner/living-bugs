import { World } from '@living-bugs/sim-core';
import type { WorldConfig, TickMetrics } from '@living-bugs/sim-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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
// CLI arguments
// ============================================================

interface RunOptions {
  ticks: number;
  logInterval: number;
  exportPath: string | null;
  exportTopK: number;
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
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
      case '--help':
        console.log(`
Living Bugs Headless Runner

Usage: npm start -- [options]

Options:
  --ticks N          Number of simulation ticks to run (default: 3000)
  --log-interval N   Print metrics every N ticks (default: 100)
  --export PATH      Export best genotypes to JSON file
  --top-k N          Number of top genotypes to export (default: 20)
  --help             Show this help
`);
        process.exit(0);
    }
  }

  return opts;
}

// ============================================================
// Main
// ============================================================

function main(): void {
  const opts = parseArgs();
  const config = loadConfig();

  console.log('=== Living Bugs Headless Runner ===');
  console.log(`World: ${config.world.width}x${config.world.height}`);
  console.log(`Initial creatures: ${config.simulation.initialCreatures}`);
  console.log(`Running for ${opts.ticks} ticks...\n`);

  const world = new World(config);
  world.initialize();

  const startTime = performance.now();
  let lastMetrics: TickMetrics | null = null;

  for (let t = 0; t < opts.ticks; t++) {
    lastMetrics = world.step();

    if ((t + 1) % opts.logInterval === 0) {
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      console.log(
        `[tick ${lastMetrics.tick.toString().padStart(6)}] ` +
        `creatures: ${lastMetrics.creatureCount.toString().padStart(5)} | ` +
        `food: ${lastMetrics.foodCount.toString().padStart(5)} | ` +
        `avg energy: ${lastMetrics.avgEnergy.toFixed(1).padStart(7)} | ` +
        `avg age: ${lastMetrics.avgAge.toFixed(0).padStart(5)} | ` +
        `births: ${lastMetrics.births.toString().padStart(3)} | ` +
        `deaths: ${lastMetrics.deaths.toString().padStart(3)} | ` +
        `${elapsed}s`
      );
    }

    // Early stop if no creatures left
    if (lastMetrics.creatureCount === 0) {
      console.log(`\nAll creatures died at tick ${lastMetrics.tick}. Stopping.`);
      break;
    }
  }

  const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log(`\nSimulation complete. Total time: ${totalTime}s`);
  console.log(`Final: ${lastMetrics?.creatureCount ?? 0} creatures, ${lastMetrics?.foodCount ?? 0} food`);

  // Export best genotypes
  if (opts.exportPath) {
    exportBestGenotypes(world, opts.exportPath, opts.exportTopK);
  }
}

// ============================================================
// Export
// ============================================================

function exportBestGenotypes(world: World, path: string, topK: number): void {
  const creatures = world.getCreatureStates();

  // Fitness = age * (energy / maxEnergy)
  const ranked = creatures
    .map(c => ({
      fitness: c.age * (c.energy / world.config.energy.maxEnergy),
      dna: c.dna,
      stats: { age: c.age, energy: c.energy, groupId: c.dna.groupId },
    }))
    .sort((a, b) => b.fitness - a.fitness)
    .slice(0, topK);

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

main();
