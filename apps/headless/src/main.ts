import { World } from '@living-bugs/sim-core';
import type { WorldConfig } from '@living-bugs/sim-core';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, runSimulation, exportBestGenotypes } from './run.js';

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

  const opts = parseArgs(args);
  const config = loadConfig();

  console.log('=== Living Bugs Headless Runner ===');
  console.log(`World: ${config.world.width}x${config.world.height}`);
  console.log(`Initial creatures: ${config.simulation.initialCreatures}`);
  console.log(`Running for ${opts.ticks} ticks...\n`);

  const world = new World(config);
  world.initialize();

  const result = runSimulation(world, opts, (metrics, elapsed) => {
    console.log(
      `[tick ${metrics.tick.toString().padStart(6)}] ` +
      `creatures: ${metrics.creatureCount.toString().padStart(5)} | ` +
      `food: ${metrics.foodCount.toString().padStart(5)} | ` +
      `avg energy: ${metrics.avgEnergy.toFixed(1).padStart(7)} | ` +
      `avg age: ${metrics.avgAge.toFixed(0).padStart(5)} | ` +
      `births: ${metrics.births.toString().padStart(3)} | ` +
      `deaths: ${metrics.deaths.toString().padStart(3)} | ` +
      `${elapsed.toFixed(1)}s`
    );
  });

  if (result.stoppedEarly && result.finalMetrics) {
    console.log(`\nAll creatures died at tick ${result.finalMetrics.tick}. Stopping.`);
  }

  const totalTime = (result.totalTimeMs / 1000).toFixed(2);
  console.log(`\nSimulation complete. Total time: ${totalTime}s`);
  console.log(`Final: ${result.finalMetrics?.creatureCount ?? 0} creatures, ${result.finalMetrics?.foodCount ?? 0} food`);

  if (opts.exportPath) {
    exportBestGenotypes(world, opts.exportPath, opts.exportTopK);
  }
}

main();
