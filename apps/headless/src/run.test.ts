import { describe, it, expect, beforeEach } from 'vitest';
import { World, resetInnovationCounter } from '@living-bugs/sim-core';
import type { WorldConfig } from '@living-bugs/sim-core';
import { parseArgs, runSimulation, runGenerational, rankGenotypes, type RunOptions } from './run.js';

function defaultOpts(overrides: Partial<RunOptions> = {}): RunOptions {
  return {
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
    ...overrides,
  };
}

function testConfig(): WorldConfig {
  return {
    world: { width: 200, height: 200, boundary: 'torus' },
    simulation: { tickRate: 30, brainRate: 10, maxCreatures: 100, initialCreatures: 10, seed: 42 },
    energy: {
      initialEnergy: 150, maxEnergy: 300, baseMetabolism: 0.05,
      densityMetabolismFactor: 0,
      moveCost: 0.02, turnCost: 0.01, attackCost: 2.0,
      visionCostPerRay: 0.005, broadcastCost: 0.03,
    },
    food: { spawnRate: 5, nutritionValue: 30, maxCount: 100, radius: 4 },
    combat: { baseDamage: 15, attackRadius: 10, attackCooldown: 5 },
    reproduction: {
      energyThreshold: 120, offspringEnergyShare: 0.4,
      mutationRate: 0.1, mutationStrength: 0.2, cooldown: 20,
    },
    death: { foodDropRatio: 0.5, foodDropMax: 3 },
    donation: { donateRadius: 15, donateAmount: 10, donateCost: 1.0 },
    broadcast: { broadcastRadius: 100, signalChannels: 4 },
    obstacles: { count: 0, minRadius: 10, maxRadius: 20 },
    creatureDefaults: { radius: 5, maxSpeed: 2.0, maxTurnRate: 0.15 },
  };
}

describe('headless runner', () => {
  beforeEach(() => {
    resetInnovationCounter();
  });

  describe('parseArgs', () => {
    it('returns defaults for empty args', () => {
      const opts = parseArgs([]);
      expect(opts.ticks).toBe(3000);
      expect(opts.logInterval).toBe(100);
      expect(opts.exportPath).toBeNull();
      expect(opts.exportTopK).toBe(20);
      expect(opts.maxCreatures).toBeNull();
      expect(opts.checkpointPath).toBeNull();
      expect(opts.checkpointInterval).toBe(10000);
      expect(opts.seedGenotypesPath).toBeNull();
    });

    it('parses --ticks', () => {
      const opts = parseArgs(['--ticks', '500']);
      expect(opts.ticks).toBe(500);
    });

    it('parses --log-interval', () => {
      const opts = parseArgs(['--log-interval', '50']);
      expect(opts.logInterval).toBe(50);
    });

    it('parses --export', () => {
      const opts = parseArgs(['--export', '/tmp/out.json']);
      expect(opts.exportPath).toBe('/tmp/out.json');
    });

    it('parses --top-k', () => {
      const opts = parseArgs(['--top-k', '5']);
      expect(opts.exportTopK).toBe(5);
    });

    it('parses --checkpoint', () => {
      const opts = parseArgs(['--checkpoint', 'cp.json']);
      expect(opts.checkpointPath).toBe('cp.json');
    });

    it('parses --checkpoint-interval', () => {
      const opts = parseArgs(['--checkpoint-interval', '5000']);
      expect(opts.checkpointInterval).toBe(5000);
    });

    it('parses --seed', () => {
      const opts = parseArgs(['--seed', 'seed.json']);
      expect(opts.seedGenotypesPath).toBe('seed.json');
    });

    it('parses --max-creatures', () => {
      const opts = parseArgs(['--max-creatures', '200']);
      expect(opts.maxCreatures).toBe(200);
    });

    it('parses --mode', () => {
      const opts = parseArgs(['--mode', 'generational']);
      expect(opts.mode).toBe('generational');
    });

    it('parses --gen-ticks', () => {
      const opts = parseArgs(['--gen-ticks', '2000']);
      expect(opts.genTicks).toBe(2000);
    });

    it('parses --generations', () => {
      const opts = parseArgs(['--generations', '100']);
      expect(opts.generations).toBe(100);
    });

    it('defaults mode to continuous', () => {
      const opts = parseArgs([]);
      expect(opts.mode).toBe('continuous');
      expect(opts.genTicks).toBe(1000);
      expect(opts.generations).toBe(50);
    });

    it('parses multiple flags', () => {
      const opts = parseArgs([
        '--ticks', '100',
        '--log-interval', '10',
        '--export', 'result.json',
        '--top-k', '3',
        '--checkpoint', 'cp.json',
        '--seed', 'seed.json',
      ]);
      expect(opts.ticks).toBe(100);
      expect(opts.logInterval).toBe(10);
      expect(opts.exportPath).toBe('result.json');
      expect(opts.exportTopK).toBe(3);
      expect(opts.checkpointPath).toBe('cp.json');
      expect(opts.seedGenotypesPath).toBe('seed.json');
    });
  });

  describe('runSimulation', () => {
    it('runs for the specified number of ticks', () => {
      const world = new World(testConfig());
      world.initialize();
      const result = runSimulation(world, defaultOpts({ ticks: 10 }));
      expect(result.finalMetrics).not.toBeNull();
      expect(result.finalMetrics!.tick).toBeGreaterThanOrEqual(1);
      expect(result.totalTimeMs).toBeGreaterThan(0);
    });

    it('calls onLog callback at log interval', () => {
      const world = new World(testConfig());
      world.initialize();
      const ticks: number[] = [];
      runSimulation(
        world,
        defaultOpts({ ticks: 10, logInterval: 5 }),
        { onLog: (metrics) => ticks.push(metrics.tick) },
      );
      // Should have been called at tick 5 and tick 10
      expect(ticks.length).toBe(2);
    });

    it('calls onCheckpoint at checkpoint interval', () => {
      const world = new World(testConfig());
      world.initialize();
      const checkpoints: number[] = [];
      runSimulation(
        world,
        defaultOpts({ ticks: 30, checkpointPath: 'dummy', checkpointInterval: 10 }),
        { onCheckpoint: (_w, ticksRun) => checkpoints.push(ticksRun) },
      );
      expect(checkpoints).toEqual([10, 20, 30]);
    });

    it('stops early when all creatures die', () => {
      const cfg = testConfig();
      cfg.simulation.initialCreatures = 1;
      cfg.energy.initialEnergy = 0.01; // Very low energy → quick death
      cfg.food.spawnRate = 0;
      const world = new World(cfg);
      world.initialize();
      const result = runSimulation(world, defaultOpts({ ticks: 1000 }));
      expect(result.stoppedEarly).toBe(true);
      expect(result.finalMetrics!.creatureCount).toBe(0);
    });
  });

  describe('rankGenotypes', () => {
    it('returns ranked creatures by fitness', () => {
      const world = new World(testConfig());
      world.initialize();
      // Run a few ticks to get some age
      for (let i = 0; i < 20; i++) world.step();

      const ranked = rankGenotypes(world, 5);
      expect(ranked.length).toBeLessThanOrEqual(5);

      // Check that they're sorted by fitness descending
      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i - 1].fitness).toBeGreaterThanOrEqual(ranked[i].fitness);
      }
    });

    it('returns empty array when no creatures', () => {
      const cfg = testConfig();
      cfg.simulation.initialCreatures = 0;
      const world = new World(cfg);
      const ranked = rankGenotypes(world, 10);
      expect(ranked.length).toBe(0);
    });

    it('caps at topK', () => {
      const world = new World(testConfig());
      world.initialize();
      for (let i = 0; i < 5; i++) world.step();
      const ranked = rankGenotypes(world, 3);
      expect(ranked.length).toBeLessThanOrEqual(3);
    });
  });

  describe('runGenerational', () => {
    it('runs for the specified number of generations', () => {
      const config = testConfig();
      const result = runGenerational(
        config,
        defaultOpts({ generations: 3, genTicks: 50 }),
      );
      expect(result.totalGenerations).toBe(3);
      expect(result.totalTimeMs).toBeGreaterThan(0);
      expect(result.finalStats).not.toBeNull();
    });

    it('calls onGeneration callback for each generation', () => {
      const config = testConfig();
      const gens: number[] = [];
      runGenerational(
        config,
        defaultOpts({ generations: 5, genTicks: 30 }),
        undefined,
        { onGeneration: (stats) => gens.push(stats.generation) },
      );
      expect(gens).toEqual([1, 2, 3, 4, 5]);
    });

    it('reports species count in stats', () => {
      const config = testConfig();
      let lastStats: import('./run.js').GenerationStats | null = null;
      runGenerational(
        config,
        defaultOpts({ generations: 3, genTicks: 100 }),
        undefined,
        { onGeneration: (stats) => { lastStats = stats; } },
      );
      expect(lastStats).not.toBeNull();
      expect(lastStats!.speciesCount).toBeGreaterThanOrEqual(0);
    });

    it('recovers when all creatures die in a generation', () => {
      const config = testConfig();
      config.energy.initialEnergy = 5; // very low energy
      config.food.spawnRate = 0; // no food
      const result = runGenerational(
        config,
        defaultOpts({ generations: 3, genTicks: 200 }),
      );
      // Should complete without crashing
      expect(result.totalGenerations).toBe(3);
    });

    it('calls onCheckpoint with the world', () => {
      const config = testConfig();
      let checkpointCount = 0;
      runGenerational(
        config,
        defaultOpts({ generations: 3, genTicks: 30 }),
        undefined,
        { onCheckpoint: () => { checkpointCount++; } },
      );
      expect(checkpointCount).toBe(3);
    });
  });
});
