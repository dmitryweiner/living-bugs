import { describe, it, expect, beforeEach } from 'vitest';
import { buildBrainRuntime, brainForwardPass, hebbianUpdate } from './brain.js';
import type { BrainGenome, NodeGene, ConnectionGene } from './types.js';

/** Helper: create a simple 2-input, 1-output brain with explicit weights. */
function makeTinyBrain(w1: number, w2: number): BrainGenome {
  return {
    plasticityRate: 0.01,
    nodeGenes: [
      { id: 0, type: 'input', activation: 'linear' },
      { id: 1, type: 'input', activation: 'linear' },
      { id: 2, type: 'output', activation: 'linear' },
    ],
    connectionGenes: [
      { innovationNumber: 1, fromNode: 0, toNode: 2, weight: w1, enabled: true },
      { innovationNumber: 2, fromNode: 1, toNode: 2, weight: w2, enabled: true },
    ],
  };
}

describe('Brain', () => {
  describe('buildBrainRuntime', () => {
    it('assigns correct node counts', () => {
      const genome = makeTinyBrain(1, 1);
      const rt = buildBrainRuntime(genome);
      expect(rt.nodeCount).toBe(3);
      expect(rt.inputCount).toBe(2);
      expect(rt.outputCount).toBe(1);
    });

    it('maps connections correctly', () => {
      const genome = makeTinyBrain(0.5, -0.3);
      const rt = buildBrainRuntime(genome);
      expect(rt.connCount).toBe(2);
      expect(rt.connWeight[0]).toBeCloseTo(0.5, 5);
      expect(rt.connWeight[1]).toBeCloseTo(-0.3, 5);
    });

    it('handles disabled connections', () => {
      const genome = makeTinyBrain(1, 1);
      genome.connectionGenes[1].enabled = false;
      const rt = buildBrainRuntime(genome);
      expect(rt.connEnabled[0]).toBe(1);
      expect(rt.connEnabled[1]).toBe(0);
    });

    it('correctly handles hidden nodes', () => {
      const genome: BrainGenome = {
        plasticityRate: 0,
        nodeGenes: [
          { id: 0, type: 'input', activation: 'linear' },
          { id: 1, type: 'output', activation: 'linear' },
          { id: 2, type: 'hidden', activation: 'relu' },
        ],
        connectionGenes: [
          { innovationNumber: 1, fromNode: 0, toNode: 2, weight: 2, enabled: true },
          { innovationNumber: 2, fromNode: 2, toNode: 1, weight: 1, enabled: true },
        ],
      };
      const rt = buildBrainRuntime(genome);
      expect(rt.inputCount).toBe(1);
      expect(rt.outputCount).toBe(1);
      expect(rt.nodeCount).toBe(3);
      // Hidden node should be evaluated before output in topological order
      // Indices: 0=input, 1=output, 2=hidden
      expect(rt.evalOrder).toEqual([2, 1]);
    });
  });

  describe('brainForwardPass', () => {
    it('computes linear pass correctly (y = w1*x1 + w2*x2)', () => {
      const genome = makeTinyBrain(0.5, -0.3);
      const rt = buildBrainRuntime(genome);
      const inputs = new Float32Array([2.0, 3.0]);
      const outputs = brainForwardPass(rt, inputs);
      // Expected: 0.5*2 + (-0.3)*3 = 1.0 - 0.9 = 0.1
      expect(outputs.length).toBe(1);
      expect(outputs[0]).toBeCloseTo(0.1, 4);
    });

    it('disables connections with enabled=0', () => {
      const genome = makeTinyBrain(0.5, -0.3);
      genome.connectionGenes[1].enabled = false;
      const rt = buildBrainRuntime(genome);
      const inputs = new Float32Array([2.0, 3.0]);
      const outputs = brainForwardPass(rt, inputs);
      // Only first connection active: 0.5 * 2 = 1.0
      expect(outputs[0]).toBeCloseTo(1.0, 4);
    });

    it('applies activation functions', () => {
      const genome: BrainGenome = {
        plasticityRate: 0,
        nodeGenes: [
          { id: 0, type: 'input', activation: 'linear' },
          { id: 1, type: 'output', activation: 'sigmoid' },
        ],
        connectionGenes: [
          { innovationNumber: 1, fromNode: 0, toNode: 1, weight: 1, enabled: true },
        ],
      };
      const rt = buildBrainRuntime(genome);
      const inputs = new Float32Array([0.0]);
      const outputs = brainForwardPass(rt, inputs);
      // sigmoid(0) = 0.5
      expect(outputs[0]).toBeCloseTo(0.5, 4);
    });

    it('works with hidden layers (input -> hidden -> output)', () => {
      const genome: BrainGenome = {
        plasticityRate: 0,
        nodeGenes: [
          { id: 0, type: 'input', activation: 'linear' },
          { id: 1, type: 'output', activation: 'linear' },
          { id: 2, type: 'hidden', activation: 'relu' },
        ],
        connectionGenes: [
          { innovationNumber: 1, fromNode: 0, toNode: 2, weight: 2, enabled: true },
          { innovationNumber: 2, fromNode: 2, toNode: 1, weight: 0.5, enabled: true },
        ],
      };
      const rt = buildBrainRuntime(genome);
      const inputs = new Float32Array([3.0]);
      const outputs = brainForwardPass(rt, inputs);
      // hidden = relu(2 * 3) = 6, output = 6 * 0.5 = 3
      expect(outputs[0]).toBeCloseTo(3.0, 4);
    });

    it('handles relu with negative input', () => {
      const genome: BrainGenome = {
        plasticityRate: 0,
        nodeGenes: [
          { id: 0, type: 'input', activation: 'linear' },
          { id: 1, type: 'output', activation: 'linear' },
          { id: 2, type: 'hidden', activation: 'relu' },
        ],
        connectionGenes: [
          { innovationNumber: 1, fromNode: 0, toNode: 2, weight: -1, enabled: true },
          { innovationNumber: 2, fromNode: 2, toNode: 1, weight: 1, enabled: true },
        ],
      };
      const rt = buildBrainRuntime(genome);
      const inputs = new Float32Array([5.0]);
      const outputs = brainForwardPass(rt, inputs);
      // hidden = relu(-1 * 5) = relu(-5) = 0, output = 0 * 1 = 0
      expect(outputs[0]).toBeCloseTo(0, 4);
    });

    it('step activation works', () => {
      const genome: BrainGenome = {
        plasticityRate: 0,
        nodeGenes: [
          { id: 0, type: 'input', activation: 'linear' },
          { id: 1, type: 'output', activation: 'step' },
        ],
        connectionGenes: [
          { innovationNumber: 1, fromNode: 0, toNode: 1, weight: 1, enabled: true },
        ],
      };
      const rt = buildBrainRuntime(genome);
      expect(brainForwardPass(rt, new Float32Array([1.0]))[0]).toBe(1);
      expect(brainForwardPass(rt, new Float32Array([-1.0]))[0]).toBe(0);
      expect(brainForwardPass(rt, new Float32Array([0.0]))[0]).toBe(0);
    });

    it('tanh activation works', () => {
      const genome: BrainGenome = {
        plasticityRate: 0,
        nodeGenes: [
          { id: 0, type: 'input', activation: 'linear' },
          { id: 1, type: 'output', activation: 'tanh' },
        ],
        connectionGenes: [
          { innovationNumber: 1, fromNode: 0, toNode: 1, weight: 1, enabled: true },
        ],
      };
      const rt = buildBrainRuntime(genome);
      const out = brainForwardPass(rt, new Float32Array([1.0]))[0];
      expect(out).toBeCloseTo(Math.tanh(1), 4);
    });

    it('handles multiple outputs', () => {
      const genome: BrainGenome = {
        plasticityRate: 0,
        nodeGenes: [
          { id: 0, type: 'input', activation: 'linear' },
          { id: 1, type: 'output', activation: 'linear' },
          { id: 2, type: 'output', activation: 'linear' },
        ],
        connectionGenes: [
          { innovationNumber: 1, fromNode: 0, toNode: 1, weight: 2, enabled: true },
          { innovationNumber: 2, fromNode: 0, toNode: 2, weight: -1, enabled: true },
        ],
      };
      const rt = buildBrainRuntime(genome);
      const outputs = brainForwardPass(rt, new Float32Array([3.0]));
      expect(outputs.length).toBe(2);
      expect(outputs[0]).toBeCloseTo(6.0, 4);
      expect(outputs[1]).toBeCloseTo(-3.0, 4);
    });

    it('is deterministic (same inputs → same outputs)', () => {
      const genome = makeTinyBrain(0.7, -0.4);
      const rt = buildBrainRuntime(genome);
      const inputs = new Float32Array([1.5, 2.5]);
      const out1 = brainForwardPass(rt, inputs);
      const out2 = brainForwardPass(rt, inputs);
      expect(out1[0]).toBe(out2[0]);
    });
  });

  describe('hebbianUpdate', () => {
    it('adjusts weights based on activations and modulator', () => {
      const genome = makeTinyBrain(0.5, -0.3);
      genome.plasticityRate = 0.1;
      const rt = buildBrainRuntime(genome);

      // Run a forward pass to set activations
      brainForwardPass(rt, new Float32Array([1.0, 0.5]));

      const w0Before = rt.connWeight[0];
      const w1Before = rt.connWeight[1];

      hebbianUpdate(rt, 1.0); // positive modulator

      // dw = lr * pre * post * modulator
      // For conn 0: pre = activations[input0] = 1.0, post = activations[output], mod = 1.0
      // Weights should have changed
      expect(rt.connWeight[0]).not.toBe(w0Before);
    });

    it('does nothing when plasticity rate is 0', () => {
      const genome = makeTinyBrain(0.5, -0.3);
      genome.plasticityRate = 0;
      const rt = buildBrainRuntime(genome);

      brainForwardPass(rt, new Float32Array([1.0, 0.5]));

      const w0Before = rt.connWeight[0];
      const w1Before = rt.connWeight[1];

      hebbianUpdate(rt, 1.0);

      expect(rt.connWeight[0]).toBe(w0Before);
      expect(rt.connWeight[1]).toBe(w1Before);
    });

    it('clamps weights to [-5, 5]', () => {
      const genome = makeTinyBrain(4.9, -4.9);
      genome.plasticityRate = 1.0; // Very high for testing
      const rt = buildBrainRuntime(genome);

      // Set large activations
      brainForwardPass(rt, new Float32Array([10.0, 10.0]));
      hebbianUpdate(rt, 1.0);

      expect(rt.connWeight[0]).toBeLessThanOrEqual(5);
      expect(rt.connWeight[0]).toBeGreaterThanOrEqual(-5);
      expect(rt.connWeight[1]).toBeLessThanOrEqual(5);
      expect(rt.connWeight[1]).toBeGreaterThanOrEqual(-5);
    });

    it('negative modulator reverses weight change direction', () => {
      // Use non-zero weights so the output (post) activation is non-zero
      const genome1 = makeTinyBrain(1.0, 1.0);
      genome1.plasticityRate = 0.1;
      const rt1 = buildBrainRuntime(genome1);

      brainForwardPass(rt1, new Float32Array([1.0, 1.0]));
      const w0Before1 = rt1.connWeight[0];
      hebbianUpdate(rt1, 1.0); // positive modulator
      const wPos = rt1.connWeight[0] - w0Before1;

      const genome2 = makeTinyBrain(1.0, 1.0);
      genome2.plasticityRate = 0.1;
      const rt2 = buildBrainRuntime(genome2);

      brainForwardPass(rt2, new Float32Array([1.0, 1.0]));
      const w0Before2 = rt2.connWeight[0];
      hebbianUpdate(rt2, -1.0); // negative modulator
      const wNeg = rt2.connWeight[0] - w0Before2;

      expect(wPos).toBeGreaterThan(0);
      expect(wNeg).toBeLessThan(0);
    });
  });
});
