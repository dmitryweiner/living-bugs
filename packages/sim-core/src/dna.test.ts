import { describe, it, expect, beforeEach } from 'vitest';
import { PRNG } from './prng.js';
import {
  countSensorInputs,
  countActuatorOutputs,
  createMinimalBrain,
  createDefaultDNA,
  mutateDNA,
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
});
