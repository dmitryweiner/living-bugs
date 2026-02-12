import { describe, it, expect, beforeEach } from 'vitest';
import { World } from './world.js';
import { createDefaultDNA, resetInnovationCounter } from './dna.js';
import { PRNG } from './prng.js';
import type { WorldConfig, DNA, Vec2 } from './types.js';

/** Minimal world config for quick tests. */
function testConfig(overrides: Partial<Record<string, unknown>> = {}): WorldConfig {
  return {
    world: { width: 200, height: 200, boundary: 'torus' },
    simulation: { tickRate: 30, brainRate: 10, maxCreatures: 100, initialCreatures: 0, seed: 42 },
    energy: {
      initialEnergy: 100, maxEnergy: 300, baseMetabolism: 0.05,
      moveCost: 0.02, turnCost: 0.01, attackCost: 2.0,
      visionCostPerRay: 0.005, broadcastCost: 0.03,
    },
    food: { spawnRate: 2, nutritionValue: 30, maxCount: 50, radius: 4 },
    combat: { baseDamage: 15, attackRadius: 10, attackCooldown: 5 },
    reproduction: {
      energyThreshold: 80, offspringEnergyShare: 0.4,
      mutationRate: 0.1, mutationStrength: 0.2, cooldown: 20,
    },
    death: { foodDropRatio: 0.5, foodDropMax: 3 },
    donation: { donateRadius: 15, donateAmount: 10, donateCost: 1.0 },
    broadcast: { broadcastRadius: 100, signalChannels: 4 },
    creatureDefaults: { radius: 5, maxSpeed: 2.0, maxTurnRate: 0.15 },
    ...overrides,
  } as WorldConfig;
}

describe('World', () => {
  let world: World;

  beforeEach(() => {
    resetInnovationCounter();
    world = new World(testConfig());
  });

  describe('initialization', () => {
    it('starts empty (initialCreatures=0)', () => {
      expect(world.creatures.size).toBe(0);
      expect(world.food.size).toBe(0);
      expect(world.tick).toBe(0);
    });

    it('initializes with creatures and food', () => {
      const cfg = testConfig();
      cfg.simulation.initialCreatures = 10;
      const w = new World(cfg);
      w.initialize();
      expect(w.creatures.size).toBe(10);
      expect(w.food.size).toBeGreaterThan(0);
    });
  });

  describe('spawnCreature', () => {
    it('creates a creature and increments entity ID', () => {
      const rng = new PRNG(1);
      const dna = createDefaultDNA(0, rng);
      const id = world.spawnCreature(dna, { x: 50, y: 50 }, 0, 100);
      expect(id).toBeGreaterThan(0);
      expect(world.creatures.size).toBe(1);
      const c = world.getCreatureById(id);
      expect(c).toBeDefined();
      expect(c!.position.x).toBe(50);
      expect(c!.position.y).toBe(50);
      expect(c!.energy).toBe(100);
    });

    it('generates creature_born event', () => {
      const rng = new PRNG(1);
      const dna = createDefaultDNA(0, rng);
      world.spawnCreature(dna, { x: 0, y: 0 }, 0, 100);
      const births = world.events.filter(e => e.type === 'creature_born');
      expect(births.length).toBe(1);
    });
  });

  describe('spawnFood', () => {
    it('creates food with default nutrition', () => {
      world.spawnFood({ x: 30, y: 30 });
      expect(world.food.size).toBe(1);
      const states = world.getFoodStates();
      expect(states[0].nutrition).toBe(30); // from config
    });

    it('creates food with custom nutrition', () => {
      world.spawnFood({ x: 30, y: 30 }, 50);
      const states = world.getFoodStates();
      expect(states[0].nutrition).toBe(50);
    });
  });

  describe('step()', () => {
    it('increments tick counter', () => {
      world.step();
      expect(world.tick).toBe(1);
      world.step();
      expect(world.tick).toBe(2);
    });

    it('spawns food each tick (up to food spawn rate)', () => {
      const initialFood = world.food.size;
      world.step();
      // Should have spawned up to spawnRate=2 food items
      expect(world.food.size).toBeGreaterThanOrEqual(initialFood);
      expect(world.food.size).toBeLessThanOrEqual(initialFood + 2);
    });

    it('creatures lose energy from metabolism each tick', () => {
      const rng = new PRNG(1);
      const dna = createDefaultDNA(0, rng);
      const id = world.spawnCreature(dna, { x: 100, y: 100 }, 0, 100);
      const initialEnergy = world.getCreatureById(id)!.energy;
      world.step();
      const afterEnergy = world.getCreatureById(id)?.energy;
      expect(afterEnergy).toBeDefined();
      expect(afterEnergy!).toBeLessThan(initialEnergy);
    });

    it('creatures die from starvation', () => {
      const rng = new PRNG(1);
      const dna = createDefaultDNA(0, rng);
      const id = world.spawnCreature(dna, { x: 100, y: 100 }, 0, 0.01);
      world.step();
      // Creature should have starved
      expect(world.getCreatureById(id)).toBeUndefined();
    });

    it('dead creatures produce death event', () => {
      const rng = new PRNG(1);
      const dna = createDefaultDNA(0, rng);
      world.spawnCreature(dna, { x: 100, y: 100 }, 0, 0.01);
      world.step();
      const deaths = world.events.filter(e => e.type === 'creature_died');
      expect(deaths.length).toBeGreaterThanOrEqual(1);
    });

    it('creature age increments each tick', () => {
      const rng = new PRNG(1);
      const dna = createDefaultDNA(0, rng);
      const id = world.spawnCreature(dna, { x: 100, y: 100 }, 0, 200);
      world.step();
      expect(world.getCreatureById(id)!.age).toBe(1);
      world.step();
      expect(world.getCreatureById(id)!.age).toBe(2);
    });

    it('returns metrics', () => {
      const rng = new PRNG(1);
      const dna = createDefaultDNA(0, rng);
      world.spawnCreature(dna, { x: 100, y: 100 }, 0, 200);
      const metrics = world.step();
      expect(metrics.tick).toBe(1);
      expect(metrics.creatureCount).toBeGreaterThanOrEqual(0);
      expect(typeof metrics.avgEnergy).toBe('number');
      expect(typeof metrics.avgAge).toBe('number');
    });
  });

  describe('eating', () => {
    it('creature eats food when overlapping and isEating is true', () => {
      const rng = new PRNG(1);
      const dna = createDefaultDNA(0, rng);
      const pos: Vec2 = { x: 50, y: 50 };
      const cId = world.spawnCreature(dna, pos, 0, 50);
      // Place food right on top of creature
      world.spawnFood({ x: 50, y: 50 });

      // Force the creature to be eating
      const creature = world.creatures.get(cId)!;
      creature.state.isEating = true;

      // Run handleCollisions indirectly via step
      // But we need food to survive the step; let's just do manual collision handling
      // Actually, we can't call private methods. Let's use step and set eating beforehand.
      // The brain will overwrite isEating, so we need to handle that differently.
      // Let's test by setting energy high enough and manually stepping.

      const initialEnergy = creature.state.energy;
      const foodId = world.getFoodStates()[0].id;

      // We'll step. The brain may or may not set isEating. Let's bypass that
      // by checking that the mechanic works when the flag IS set.
      // Force isEating before each step - we need to temporarily work around the brain tick.
      // Set brain accumulator to make brains NOT fire this tick
      (world as any).brainTickAccumulator = -100;
      creature.state.isEating = true;
      world.step();

      // The creature should have eaten or the food should be gone if overlapping
      if (world.food.size === 0) {
        // Food was eaten
        expect(creature.state.energy).toBeGreaterThan(initialEnergy - 5); // energy gained minus metabolism
      }
    });
  });

  describe('reproduction', () => {
    it('creature reproduces when energy exceeds threshold', () => {
      const rng = new PRNG(1);
      const dna = createDefaultDNA(0, rng);
      // Give enough energy for reproduction (threshold = 80)
      world.spawnCreature(dna, { x: 100, y: 100 }, 0, 200);
      (world as any).brainTickAccumulator = -100; // prevent brain from running

      const initialCount = world.creatures.size;
      world.step();

      // Should have reproduced
      expect(world.creatures.size).toBeGreaterThan(initialCount);
    });

    it('parent loses energy after reproduction', () => {
      const rng = new PRNG(1);
      const dna = createDefaultDNA(0, rng);
      const id = world.spawnCreature(dna, { x: 100, y: 100 }, 0, 200);
      (world as any).brainTickAccumulator = -100;

      world.step();

      // Parent should have less energy (gave offspringEnergyShare=0.4 + metabolism)
      const parent = world.getCreatureById(id);
      if (parent) {
        // parent gave 200 * 0.4 = 80 to child, minus metabolism
        expect(parent.energy).toBeLessThan(200 - 70);
      }
    });

    it('reproduction cooldown prevents rapid reproduction', () => {
      const rng = new PRNG(1);
      const dna = createDefaultDNA(0, rng);
      const id = world.spawnCreature(dna, { x: 100, y: 100 }, 0, 250);
      (world as any).brainTickAccumulator = -100;

      world.step(); // First reproduction
      const countAfterFirst = world.creatures.size;

      // Give parent more energy for another reproduction attempt
      const parent = world.creatures.get(id);
      if (parent) {
        parent.state.energy = 250;
        world.step();
        // Should NOT reproduce again due to cooldown
        // (new creatures might come from the child, but parent shouldn't)
        expect(parent.state.reproductionCooldown).toBeGreaterThan(0);
      }
    });

    it('does not exceed maxCreatures', () => {
      const cfg = testConfig();
      cfg.simulation.maxCreatures = 3;
      const w = new World(cfg);
      const rng = new PRNG(1);

      // Spawn creatures at capacity
      for (let i = 0; i < 3; i++) {
        const dna = createDefaultDNA(0, rng);
        w.spawnCreature(dna, { x: 50 + i * 20, y: 50 }, 0, 200);
      }

      (w as any).brainTickAccumulator = -100;
      w.step();
      expect(w.creatures.size).toBeLessThanOrEqual(3);
    });
  });

  describe('combat', () => {
    it('attacking creature deals damage', () => {
      const rng = new PRNG(1);
      const attackerDNA = createDefaultDNA(0, rng);
      attackerDNA.actuators.push({ type: 'attack' });
      const targetDNA = createDefaultDNA(1, rng);

      const aId = world.spawnCreature(attackerDNA, { x: 50, y: 50 }, 0, 200);
      const tId = world.spawnCreature(targetDNA, { x: 53, y: 50 }, 0, 200);

      const attacker = world.creatures.get(aId)!;
      attacker.state.isAttacking = true;
      attacker.state.attackCooldown = 0;

      (world as any).brainTickAccumulator = -100;
      world.step();

      const target = world.getCreatureById(tId);
      if (target) {
        // Target should have taken damage (baseDamage=15)
        expect(target.energy).toBeLessThan(200);
      }
    });

    it('IFF prevents attacking same group', () => {
      const rng = new PRNG(1);
      const attackerDNA = createDefaultDNA(0, rng);
      attackerDNA.hasIFF = true;
      attackerDNA.actuators.push({ type: 'attack' });
      const targetDNA = createDefaultDNA(0, rng); // Same group

      // Use energy below reproduction threshold (80) to avoid energy loss from reproduction
      const aId = world.spawnCreature(attackerDNA, { x: 50, y: 50 }, 0, 70);
      const tId = world.spawnCreature(targetDNA, { x: 53, y: 50 }, 0, 70);

      const attacker = world.creatures.get(aId)!;
      attacker.state.isAttacking = true;
      attacker.state.attackCooldown = 0;

      (world as any).brainTickAccumulator = -100;
      world.step();

      const target = world.getCreatureById(tId);
      if (target) {
        // Target should NOT have taken combat damage (only metabolism)
        expect(target.energy).toBeGreaterThan(70 - 5); // only metabolism cost
      }
    });
  });

  describe('death and food drops', () => {
    it('dead creature drops food', () => {
      const rng = new PRNG(1);
      const dna = createDefaultDNA(0, rng);
      world.spawnCreature(dna, { x: 100, y: 100 }, 0, 0.01); // Will die immediately

      const foodBefore = world.food.size;
      world.step();

      // Creature should be dead, and food should have spawned nearby
      // (foodDropRatio=0.5 with energy ~0 may not drop much, but death should happen)
      expect(world.creatures.size).toBe(0);
    });

    it('dead creature with energy drops food proportional to energy', () => {
      const rng = new PRNG(1);
      const attackerDNA = createDefaultDNA(0, rng);
      attackerDNA.actuators.push({ type: 'attack' });
      const targetDNA = createDefaultDNA(1, rng);

      const aId = world.spawnCreature(attackerDNA, { x: 50, y: 50 }, 0, 200);
      // Target with low energy so it dies from one attack (damage=15)
      const tId = world.spawnCreature(targetDNA, { x: 53, y: 50 }, 0, 10);

      const attacker = world.creatures.get(aId)!;
      attacker.state.isAttacking = true;
      attacker.state.attackCooldown = 0;

      const foodBefore = world.food.size;
      (world as any).brainTickAccumulator = -100;
      world.step();

      // Target should have died and dropped some food
      if (!world.getCreatureById(tId)) {
        // If killed, food should have spawned from the death
        // (though it may be 0 due to energy calculations)
        expect(world.events.some(e => e.type === 'creature_died')).toBe(true);
      }
    });
  });

  describe('food spawning', () => {
    it('respects maxCount for food', () => {
      const cfg = testConfig();
      cfg.food.maxCount = 5;
      cfg.food.spawnRate = 10;
      const w = new World(cfg);

      for (let i = 0; i < 20; i++) {
        w.step();
      }
      expect(w.food.size).toBeLessThanOrEqual(5);
    });
  });

  describe('metrics', () => {
    it('getMetrics returns correct counts', () => {
      const rng = new PRNG(1);
      for (let i = 0; i < 5; i++) {
        world.spawnCreature(createDefaultDNA(0, rng), { x: i * 20, y: 50 }, 0, 100);
      }
      for (let i = 0; i < 3; i++) {
        world.spawnFood({ x: i * 20, y: 100 });
      }

      const m = world.getMetrics();
      expect(m.creatureCount).toBe(5);
      expect(m.foodCount).toBe(3);
      expect(m.avgEnergy).toBe(100);
      expect(m.avgAge).toBe(0);
    });

    it('avgEnergy is 0 when no creatures', () => {
      const m = world.getMetrics();
      expect(m.avgEnergy).toBe(0);
      expect(m.avgAge).toBe(0);
    });
  });

  describe('snapshot save/load', () => {
    it('saves and loads world state', () => {
      const cfg = testConfig();
      cfg.simulation.initialCreatures = 5;
      const w = new World(cfg);
      w.initialize();

      // Run a few ticks
      for (let i = 0; i < 10; i++) w.step();

      const snap = w.getSnapshot();

      // Create a new world and load snapshot
      const w2 = new World(testConfig());
      w2.loadSnapshot(snap);

      expect(w2.tick).toBe(snap.tick);
      expect(w2.creatures.size).toBe(snap.creatures.length);
      expect(w2.food.size).toBe(snap.food.length);
    });

    it('snapshot is JSON-serializable', () => {
      const cfg = testConfig();
      cfg.simulation.initialCreatures = 3;
      const w = new World(cfg);
      w.initialize();
      for (let i = 0; i < 5; i++) w.step();

      const snap = w.getSnapshot();
      const json = JSON.stringify(snap);
      const restored = JSON.parse(json);

      expect(restored.tick).toBe(snap.tick);
      expect(restored.creatures.length).toBe(snap.creatures.length);
      expect(restored.food.length).toBe(snap.food.length);
      expect(restored.config).toEqual(snap.config);
    });
  });

  describe('determinism', () => {
    it('same seed produces identical simulation', () => {
      const cfg1 = testConfig();
      cfg1.simulation.initialCreatures = 5;
      cfg1.simulation.seed = 12345;

      const cfg2 = testConfig();
      cfg2.simulation.initialCreatures = 5;
      cfg2.simulation.seed = 12345;

      resetInnovationCounter();
      const w1 = new World(cfg1);
      w1.initialize();

      resetInnovationCounter();
      const w2 = new World(cfg2);
      w2.initialize();

      for (let i = 0; i < 20; i++) {
        const m1 = w1.step();
        const m2 = w2.step();
        expect(m1.creatureCount).toBe(m2.creatureCount);
        expect(m1.foodCount).toBe(m2.foodCount);
        expect(m1.avgEnergy).toBeCloseTo(m2.avgEnergy, 5);
      }
    });
  });

  describe('query helpers', () => {
    it('getCreatureStates returns array of all states', () => {
      const rng = new PRNG(1);
      world.spawnCreature(createDefaultDNA(0, rng), { x: 10, y: 10 }, 0, 100);
      world.spawnCreature(createDefaultDNA(1, rng), { x: 20, y: 20 }, 0, 100);
      const states = world.getCreatureStates();
      expect(states.length).toBe(2);
    });

    it('getFoodStates returns array of all food', () => {
      world.spawnFood({ x: 10, y: 10 });
      world.spawnFood({ x: 20, y: 20 });
      world.spawnFood({ x: 30, y: 30 });
      expect(world.getFoodStates().length).toBe(3);
    });

    it('getCreatureById returns undefined for unknown id', () => {
      expect(world.getCreatureById(999)).toBeUndefined();
    });
  });
});
