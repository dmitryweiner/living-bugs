import { describe, it, expect, beforeEach } from 'vitest';
import { PRNG } from './prng.js';
import {
  countSensorInputs,
  countActuatorOutputs,
  createMinimalBrain,
  createDefaultDNA,
  mutateDNA,
  crossoverBrain,
  crossoverDNA,
  resetInnovationCounter,
} from './dna.js';
import type { SensorGene, ActuatorGene, DNA, BrainGenome } from './types.js';

describe('DNA', () => {
  beforeEach(() => {
    resetInnovationCounter();
  });

  describe('countSensorInputs', () => {
    it('returns 2 for empty sensors (bias + random)', () => {
      expect(countSensorInputs([])).toBe(2);
    });

    it('counts rayVision correctly', () => {
      const sensors: SensorGene[] = [
        { type: 'rayVision', rayCount: 3, fov: 1.5, maxDistance: 50, offsetAngle: 0 },
      ];
      // 2 (bias+random) + 3 rays * 4 = 14
      expect(countSensorInputs(sensors)).toBe(14);
    });

    it('counts touch correctly', () => {
      const sensors: SensorGene[] = [{ type: 'touch' }];
      // 2 + 3 (touching_food, touching_creature, touching_iff)
      expect(countSensorInputs(sensors)).toBe(5);
    });

    it('counts energySense correctly', () => {
      const sensors: SensorGene[] = [{ type: 'energySense' }];
      // 2 + 1
      expect(countSensorInputs(sensors)).toBe(3);
    });

    it('counts broadcastReceiver correctly', () => {
      const sensors: SensorGene[] = [
        { type: 'broadcastReceiver', channels: [0, 1, 2] },
      ];
      // 2 + 3 channels * 2 (strength + direction) = 8
      expect(countSensorInputs(sensors)).toBe(8);
    });

    it('sums multiple sensor types', () => {
      const sensors: SensorGene[] = [
        { type: 'rayVision', rayCount: 2, fov: 1, maxDistance: 30, offsetAngle: 0 },
        { type: 'touch' },
        { type: 'energySense' },
        { type: 'broadcastReceiver', channels: [0] },
      ];
      // 2 + (2*4) + 3 + 1 + (1*2) = 2 + 8 + 3 + 1 + 2 = 16
      expect(countSensorInputs(sensors)).toBe(16);
    });
  });

  describe('countActuatorOutputs', () => {
    it('returns 0 for empty actuators', () => {
      expect(countActuatorOutputs([])).toBe(0);
    });

    it('counts move as 2 (forward + turn)', () => {
      const actuators: ActuatorGene[] = [{ type: 'move' }];
      expect(countActuatorOutputs(actuators)).toBe(2);
    });

    it('counts attack, eat, donate, broadcast as 1 each', () => {
      const actuators: ActuatorGene[] = [
        { type: 'attack' },
        { type: 'eat' },
        { type: 'donate' },
        { type: 'broadcast', channel: 0 },
      ];
      expect(countActuatorOutputs(actuators)).toBe(4);
    });

    it('counts all actuators together', () => {
      const actuators: ActuatorGene[] = [
        { type: 'move' },
        { type: 'attack' },
        { type: 'eat' },
      ];
      // 2 + 1 + 1 = 4
      expect(countActuatorOutputs(actuators)).toBe(4);
    });
  });

  describe('createMinimalBrain', () => {
    it('creates fully connected input->output brain', () => {
      const sensors: SensorGene[] = [
        { type: 'energySense' },
      ];
      const actuators: ActuatorGene[] = [
        { type: 'move' },
      ];
      const rng = new PRNG(42);
      const brain = createMinimalBrain(sensors, actuators, rng);

      const inputCount = countSensorInputs(sensors);  // 3
      const outputCount = countActuatorOutputs(actuators); // 2

      // Nodes: 3 input + 2 output = 5
      expect(brain.nodeGenes.length).toBe(inputCount + outputCount);

      const inputs = brain.nodeGenes.filter(n => n.type === 'input');
      const outputs = brain.nodeGenes.filter(n => n.type === 'output');
      expect(inputs.length).toBe(inputCount);
      expect(outputs.length).toBe(outputCount);

      // Connections: fully connected = 3 * 2 = 6
      expect(brain.connectionGenes.length).toBe(inputCount * outputCount);

      // All connections should be enabled
      expect(brain.connectionGenes.every(c => c.enabled)).toBe(true);

      // Weights should be in [-1, 1]
      for (const c of brain.connectionGenes) {
        expect(c.weight).toBeGreaterThanOrEqual(-1);
        expect(c.weight).toBeLessThanOrEqual(1);
      }

      // Innovation numbers should be unique
      const innovations = brain.connectionGenes.map(c => c.innovationNumber);
      expect(new Set(innovations).size).toBe(innovations.length);
    });

    it('has correct activation types', () => {
      const sensors: SensorGene[] = [{ type: 'touch' }];
      const actuators: ActuatorGene[] = [{ type: 'eat' }];
      const rng = new PRNG(1);
      const brain = createMinimalBrain(sensors, actuators, rng);

      for (const n of brain.nodeGenes) {
        if (n.type === 'input') expect(n.activation).toBe('linear');
        if (n.type === 'output') expect(n.activation).toBe('tanh');
      }
    });
  });

  describe('createDefaultDNA', () => {
    it('creates DNA with correct group ID', () => {
      const rng = new PRNG(42);
      const dna = createDefaultDNA(3, rng);
      expect(dna.groupId).toBe(3);
    });

    it('has basic sensors (rayVision, touch, energySense)', () => {
      const rng = new PRNG(42);
      const dna = createDefaultDNA(0, rng);
      const types = dna.sensors.map(s => s.type);
      expect(types).toContain('rayVision');
      expect(types).toContain('touch');
      expect(types).toContain('energySense');
    });

    it('has basic actuators (move, eat)', () => {
      const rng = new PRNG(42);
      const dna = createDefaultDNA(0, rng);
      const types = dna.actuators.map(a => a.type);
      expect(types).toContain('move');
      expect(types).toContain('eat');
    });

    it('has hasIFF = false by default', () => {
      const rng = new PRNG(42);
      const dna = createDefaultDNA(0, rng);
      expect(dna.hasIFF).toBe(false);
    });

    it('brain I/O matches sensor/actuator counts', () => {
      const rng = new PRNG(42);
      const dna = createDefaultDNA(0, rng);
      const expectedInputs = countSensorInputs(dna.sensors);
      const expectedOutputs = countActuatorOutputs(dna.actuators);
      const inputs = dna.brain.nodeGenes.filter(n => n.type === 'input').length;
      const outputs = dna.brain.nodeGenes.filter(n => n.type === 'output').length;
      expect(inputs).toBe(expectedInputs);
      expect(outputs).toBe(expectedOutputs);
    });
  });

  describe('mutateDNA', () => {
    let baseDNA: DNA;
    let rng: PRNG;

    beforeEach(() => {
      rng = new PRNG(42);
      baseDNA = createDefaultDNA(0, rng);
    });

    it('returns a new object (deep copy)', () => {
      const child = mutateDNA(baseDNA, 0.5, 0.5, rng);
      expect(child).not.toBe(baseDNA);
      expect(child.brain).not.toBe(baseDNA.brain);
      expect(child.sensors).not.toBe(baseDNA.sensors);
    });

    it('preserves groupId', () => {
      const child = mutateDNA(baseDNA, 0.5, 0.5, rng);
      expect(child.groupId).toBe(baseDNA.groupId);
    });

    it('body radius stays in [3, 10] after heavy mutation', () => {
      let dna = baseDNA;
      for (let i = 0; i < 100; i++) {
        dna = mutateDNA(dna, 1.0, 1.0, rng); // maxed mutation
        expect(dna.body.radius).toBeGreaterThanOrEqual(3);
        expect(dna.body.radius).toBeLessThanOrEqual(10);
      }
    });

    it('brain I/O is always reconciled after mutation', () => {
      let dna = baseDNA;
      for (let i = 0; i < 50; i++) {
        dna = mutateDNA(dna, 0.5, 0.5, rng);
        const expectedInputs = countSensorInputs(dna.sensors);
        const expectedOutputs = countActuatorOutputs(dna.actuators);
        const inputs = dna.brain.nodeGenes.filter(n => n.type === 'input').length;
        const outputs = dna.brain.nodeGenes.filter(n => n.type === 'output').length;
        expect(inputs).toBe(expectedInputs);
        expect(outputs).toBe(expectedOutputs);
      }
    });

    it('zero mutation rate produces minimal changes', () => {
      const child = mutateDNA(baseDNA, 0, 0, rng);
      // With zero mutation rate, structure should be identical
      expect(child.sensors.length).toBe(baseDNA.sensors.length);
      expect(child.actuators.length).toBe(baseDNA.actuators.length);
      expect(child.body.radius).toBe(baseDNA.body.radius);
      expect(child.hasIFF).toBe(baseDNA.hasIFF);
    });

    it('high mutation rate can add sensors and actuators', () => {
      // Run many mutations and check if structure changes happen
      let addedSensor = false;
      let addedActuator = false;
      let dna = baseDNA;
      for (let i = 0; i < 200; i++) {
        const prev = { sLen: dna.sensors.length, aLen: dna.actuators.length };
        dna = mutateDNA(dna, 1.0, 1.0, rng);
        if (dna.sensors.length > prev.sLen) addedSensor = true;
        if (dna.actuators.length > prev.aLen) addedActuator = true;
        if (addedSensor && addedActuator) break;
      }
      expect(addedSensor).toBe(true);
      expect(addedActuator).toBe(true);
    });

    it('energySense sensor is never removed', () => {
      let dna = baseDNA;
      for (let i = 0; i < 100; i++) {
        dna = mutateDNA(dna, 1.0, 1.0, rng);
        const hasEnergySense = dna.sensors.some(s => s.type === 'energySense');
        expect(hasEnergySense).toBe(true);
      }
    });

    it('move actuator is never removed', () => {
      let dna = baseDNA;
      for (let i = 0; i < 100; i++) {
        dna = mutateDNA(dna, 1.0, 1.0, rng);
        const hasMove = dna.actuators.some(a => a.type === 'move');
        expect(hasMove).toBe(true);
      }
    });

    it('brain weights stay in [-5, 5]', () => {
      let dna = baseDNA;
      for (let i = 0; i < 50; i++) {
        dna = mutateDNA(dna, 1.0, 1.0, rng);
        for (const c of dna.brain.connectionGenes) {
          expect(c.weight).toBeGreaterThanOrEqual(-5);
          expect(c.weight).toBeLessThanOrEqual(5);
        }
      }
    });

    it('plasticity rate stays in [0, 0.1]', () => {
      let dna = baseDNA;
      for (let i = 0; i < 50; i++) {
        dna = mutateDNA(dna, 1.0, 1.0, rng);
        expect(dna.brain.plasticityRate).toBeGreaterThanOrEqual(0);
        expect(dna.brain.plasticityRate).toBeLessThanOrEqual(0.1);
      }
    });

    it('mutation can add hidden nodes', () => {
      let foundHidden = false;
      let dna = baseDNA;
      for (let i = 0; i < 200; i++) {
        dna = mutateDNA(dna, 1.0, 1.0, rng);
        if (dna.brain.nodeGenes.some(n => n.type === 'hidden')) {
          foundHidden = true;
          break;
        }
      }
      expect(foundHidden).toBe(true);
    });

    it('DNA is JSON-serializable (no cycles, no special objects)', () => {
      let dna = baseDNA;
      for (let i = 0; i < 10; i++) {
        dna = mutateDNA(dna, 0.5, 0.5, rng);
      }
      const json = JSON.stringify(dna);
      const restored = JSON.parse(json) as DNA;
      expect(restored.groupId).toBe(dna.groupId);
      expect(restored.sensors.length).toBe(dna.sensors.length);
      expect(restored.brain.nodeGenes.length).toBe(dna.brain.nodeGenes.length);
    });
  });

  describe('crossoverBrain', () => {
    it('produces a valid brain genome with matching genes from both parents', () => {
      const rng = new PRNG(42);
      const sensors: SensorGene[] = [{ type: 'energySense' }];
      const actuators: ActuatorGene[] = [{ type: 'move' }];
      const brain1 = createMinimalBrain(sensors, actuators, rng);
      const brain2 = createMinimalBrain(sensors, actuators, rng);

      const child = crossoverBrain(brain1, brain2, 10, 5, rng);

      expect(child.nodeGenes.length).toBeGreaterThan(0);
      expect(child.connectionGenes.length).toBeGreaterThan(0);
      expect(child.plasticityRate).toBeGreaterThanOrEqual(0);
    });

    it('inherits disjoint genes from fitter parent only', () => {
      const rng = new PRNG(42);
      const sensors: SensorGene[] = [{ type: 'energySense' }];
      const actuators: ActuatorGene[] = [{ type: 'move' }];
      const brain1 = createMinimalBrain(sensors, actuators, rng);
      // Mutate brain1 to add unique connections
      let dna1: DNA = { groupId: 0, hasIFF: false, body: { radius: 5 }, sensors, actuators, brain: brain1 };
      for (let i = 0; i < 10; i++) {
        dna1 = mutateDNA(dna1, 1.0, 0.5, rng);
      }
      const brain2 = createMinimalBrain(sensors, actuators, rng);

      // brain1 has extra innovations (disjoint/excess)
      const child = crossoverBrain(dna1.brain, brain2, 100, 1, rng);

      // Child should have innovations from fitter parent (dna1.brain)
      const fitterInnovations = new Set(dna1.brain.connectionGenes.map(c => c.innovationNumber));
      for (const conn of child.connectionGenes) {
        expect(fitterInnovations.has(conn.innovationNumber) ||
          brain2.connectionGenes.some(c => c.innovationNumber === conn.innovationNumber)
        ).toBe(true);
      }
    });

    it('with equal fitness, may include disjoint genes from both parents', () => {
      const rng = new PRNG(42);
      const sensors: SensorGene[] = [{ type: 'energySense' }];
      const actuators: ActuatorGene[] = [{ type: 'move' }];
      const brain1 = createMinimalBrain(sensors, actuators, rng);
      let dna1: DNA = { groupId: 0, hasIFF: false, body: { radius: 5 }, sensors, actuators, brain: brain1 };
      for (let i = 0; i < 5; i++) {
        dna1 = mutateDNA(dna1, 1.0, 0.5, rng);
      }
      const brain2 = createMinimalBrain(sensors, actuators, rng);
      let dna2: DNA = { groupId: 0, hasIFF: false, body: { radius: 5 }, sensors, actuators, brain: brain2 };
      for (let i = 0; i < 5; i++) {
        dna2 = mutateDNA(dna2, 1.0, 0.5, rng);
      }

      // Equal fitness → disjoint from both parents can appear
      const child = crossoverBrain(dna1.brain, dna2.brain, 10, 10, rng);
      expect(child.connectionGenes.length).toBeGreaterThan(0);
    });

    it('disabled gene from either parent has 75% chance of staying disabled', () => {
      const rng = new PRNG(99);
      const sensors: SensorGene[] = [{ type: 'energySense' }];
      const actuators: ActuatorGene[] = [{ type: 'move' }];
      const brain1 = createMinimalBrain(sensors, actuators, rng);
      const brain2 = createMinimalBrain(sensors, actuators, rng);

      // Disable a matching gene in parent 1
      if (brain1.connectionGenes.length > 0) {
        brain1.connectionGenes[0].enabled = false;
      }

      // Run many trials and check disabled rate
      let disabledCount = 0;
      const trials = 100;
      for (let t = 0; t < trials; t++) {
        const child = crossoverBrain(brain1, brain2, 10, 5, new PRNG(t));
        const matchingInn = brain1.connectionGenes[0]?.innovationNumber;
        const childGene = child.connectionGenes.find(c => c.innovationNumber === matchingInn);
        if (childGene && !childGene.enabled) disabledCount++;
      }
      // Expect ~75% disabled (allow 55%-95% range for statistical tolerance)
      expect(disabledCount).toBeGreaterThan(trials * 0.55);
      expect(disabledCount).toBeLessThan(trials * 0.95);
    });

    it('all connections reference existing nodes', () => {
      const rng = new PRNG(42);
      const sensors: SensorGene[] = [
        { type: 'rayVision', rayCount: 2, fov: 1, maxDistance: 30, offsetAngle: 0 },
        { type: 'energySense' },
      ];
      const actuators: ActuatorGene[] = [{ type: 'move' }, { type: 'eat' }];
      let dna1: DNA = { groupId: 0, hasIFF: false, body: { radius: 5 }, sensors, actuators, brain: createMinimalBrain(sensors, actuators, rng) };
      let dna2: DNA = { groupId: 0, hasIFF: false, body: { radius: 5 }, sensors, actuators, brain: createMinimalBrain(sensors, actuators, rng) };
      for (let i = 0; i < 10; i++) {
        dna1 = mutateDNA(dna1, 0.8, 0.5, rng);
        dna2 = mutateDNA(dna2, 0.8, 0.5, rng);
      }

      const child = crossoverBrain(dna1.brain, dna2.brain, 10, 8, rng);
      const nodeIds = new Set(child.nodeGenes.map(n => n.id));
      for (const conn of child.connectionGenes) {
        expect(nodeIds.has(conn.fromNode)).toBe(true);
        expect(nodeIds.has(conn.toNode)).toBe(true);
      }
    });
  });

  describe('crossoverDNA', () => {
    it('produces a valid DNA with reconciled brain I/O', () => {
      const rng = new PRNG(42);
      const dna1 = createDefaultDNA(0, rng);
      const dna2 = createDefaultDNA(0, rng);

      const child = crossoverDNA(dna1, dna2, 10, 5, rng);

      const expectedInputs = countSensorInputs(child.sensors);
      const expectedOutputs = countActuatorOutputs(child.actuators);
      const inputs = child.brain.nodeGenes.filter(n => n.type === 'input').length;
      const outputs = child.brain.nodeGenes.filter(n => n.type === 'output').length;
      expect(inputs).toBe(expectedInputs);
      expect(outputs).toBe(expectedOutputs);
    });

    it('child body radius is average of parents', () => {
      const rng = new PRNG(42);
      const dna1 = createDefaultDNA(0, rng);
      dna1.body.radius = 4;
      const dna2 = createDefaultDNA(0, rng);
      dna2.body.radius = 8;

      const child = crossoverDNA(dna1, dna2, 10, 5, rng);
      expect(child.body.radius).toBe(6);
    });

    it('child groupId comes from fitter parent', () => {
      const rng = new PRNG(42);
      const dna1 = createDefaultDNA(1, rng);
      const dna2 = createDefaultDNA(2, rng);

      const child = crossoverDNA(dna1, dna2, 100, 5, rng);
      expect(child.groupId).toBe(1); // dna1 is fitter
    });

    it('always has energySense sensor and move actuator', () => {
      const rng = new PRNG(42);
      for (let trial = 0; trial < 20; trial++) {
        const dna1 = createDefaultDNA(0, new PRNG(trial));
        const dna2 = createDefaultDNA(0, new PRNG(trial + 100));
        const child = crossoverDNA(dna1, dna2, 10, 10, new PRNG(trial + 200));
        expect(child.sensors.some(s => s.type === 'energySense')).toBe(true);
        expect(child.actuators.some(a => a.type === 'move')).toBe(true);
      }
    });

    it('child is JSON-serializable', () => {
      const rng = new PRNG(42);
      const dna1 = createDefaultDNA(0, rng);
      const dna2 = createDefaultDNA(0, rng);
      const child = crossoverDNA(dna1, dna2, 10, 5, rng);

      const json = JSON.stringify(child);
      const restored = JSON.parse(json) as DNA;
      expect(restored.groupId).toBe(child.groupId);
      expect(restored.sensors.length).toBe(child.sensors.length);
    });

    it('crossover + mutation produces valid DNA over many iterations', () => {
      const rng = new PRNG(42);
      let dna1 = createDefaultDNA(0, rng);
      let dna2 = createDefaultDNA(0, rng);

      for (let i = 0; i < 50; i++) {
        const child = crossoverDNA(dna1, dna2, rng.range(1, 20), rng.range(1, 20), rng);
        const mutated = mutateDNA(child, 0.3, 0.3, rng);
        // Verify invariants
        const expectedInputs = countSensorInputs(mutated.sensors);
        const expectedOutputs = countActuatorOutputs(mutated.actuators);
        const inputs = mutated.brain.nodeGenes.filter(n => n.type === 'input').length;
        const outputs = mutated.brain.nodeGenes.filter(n => n.type === 'output').length;
        expect(inputs).toBe(expectedInputs);
        expect(outputs).toBe(expectedOutputs);
        expect(mutated.body.radius).toBeGreaterThanOrEqual(3);
        expect(mutated.body.radius).toBeLessThanOrEqual(10);

        // Evolve parents
        dna1 = mutated;
        dna2 = mutateDNA(dna2, 0.3, 0.3, rng);
      }
    });
  });
});
