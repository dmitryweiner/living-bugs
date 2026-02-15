import type { BrainGenome, ActivationType } from './types.js';

// ============================================================
// Brain Runtime — forward pass and Hebbian plasticity
// ============================================================

export interface BrainRuntime {
  genome: BrainGenome;
  nodeCount: number;
  inputCount: number;
  outputCount: number;
  evalOrder: number[];           // Topological order of node indices (for forward pass)
  nodeIdToIndex: Map<number, number>;  // nodeGene.id → index in arrays
  activations: Float32Array;     // Current values
  prevActivations: Float32Array; // Previous tick values (for recurrent connections)
  // Pre-computed per-node activation type (indexed by node index)
  _nodeActivationTypes: ActivationType[];
  // Connection data (parallel arrays for performance)
  connFrom: Int32Array;          // Index of source node
  connTo: Int32Array;            // Index of target node
  connWeight: Float32Array;      // Current runtime weight
  connEnabled: Uint8Array;       // 1 = enabled, 0 = disabled
  connCount: number;
}

// ============================================================
// Activation functions
// ============================================================

function activate(x: number, type: ActivationType): number {
  switch (type) {
    case 'sigmoid': return 1 / (1 + Math.exp(-x));
    case 'tanh': return Math.tanh(x);
    case 'relu': return Math.max(0, x);
    case 'linear': return x;
    case 'step': return x > 0 ? 1 : 0;
  }
}

// ============================================================
// Build runtime from genome
// ============================================================

export function buildBrainRuntime(genome: BrainGenome): BrainRuntime {
  const nodeIdToIndex = new Map<number, number>();
  const nodeCount = genome.nodeGenes.length;

  // Assign indices: inputs first, then outputs, then hidden (order of nodeGenes)
  const inputs = genome.nodeGenes.filter(n => n.type === 'input');
  const outputs = genome.nodeGenes.filter(n => n.type === 'output');
  const hidden = genome.nodeGenes.filter(n => n.type === 'hidden');

  let idx = 0;
  for (const n of inputs) nodeIdToIndex.set(n.id, idx++);
  for (const n of outputs) nodeIdToIndex.set(n.id, idx++);
  for (const n of hidden) nodeIdToIndex.set(n.id, idx++);

  // Build connection arrays
  const conns = genome.connectionGenes;
  const connCount = conns.length;
  const connFrom = new Int32Array(connCount);
  const connTo = new Int32Array(connCount);
  const connWeight = new Float32Array(connCount);
  const connEnabled = new Uint8Array(connCount);

  for (let i = 0; i < connCount; i++) {
    connFrom[i] = nodeIdToIndex.get(conns[i].fromNode) ?? -1;
    connTo[i] = nodeIdToIndex.get(conns[i].toNode) ?? -1;
    connWeight[i] = conns[i].weight;
    connEnabled[i] = conns[i].enabled ? 1 : 0;
  }

  // Topological sort for evaluation order (Kahn's algorithm)
  // Only non-input nodes need evaluation
  const evalOrder = topologicalSort(genome, nodeIdToIndex, inputs.length);

  // Pre-compute activation type per node index for fast lookup
  const _nodeActivationTypes: ActivationType[] = new Array(nodeCount).fill('linear');
  for (const ng of genome.nodeGenes) {
    const nIdx = nodeIdToIndex.get(ng.id);
    if (nIdx !== undefined) {
      _nodeActivationTypes[nIdx] = ng.activation;
    }
  }

  return {
    genome,
    nodeCount,
    inputCount: inputs.length,
    outputCount: outputs.length,
    evalOrder,
    nodeIdToIndex,
    activations: new Float32Array(nodeCount),
    prevActivations: new Float32Array(nodeCount),
    _nodeActivationTypes,
    connFrom,
    connTo,
    connWeight,
    connEnabled,
    connCount,
  };
}

function topologicalSort(
  genome: BrainGenome,
  nodeIdToIndex: Map<number, number>,
  inputCount: number,
): number[] {
  const nodeCount = genome.nodeGenes.length;
  const nonInputIndices: number[] = [];
  for (let i = inputCount; i < nodeCount; i++) {
    nonInputIndices.push(i);
  }

  // Build adjacency: which nodes feed into which
  const inDegree = new Map<number, number>();
  const adj = new Map<number, number[]>();
  for (const ni of nonInputIndices) {
    inDegree.set(ni, 0);
    adj.set(ni, []);
  }

  for (const conn of genome.connectionGenes) {
    if (!conn.enabled) continue;
    const fromIdx = nodeIdToIndex.get(conn.fromNode);
    const toIdx = nodeIdToIndex.get(conn.toNode);
    if (fromIdx === undefined || toIdx === undefined) continue;
    if (toIdx < inputCount) continue; // Skip connections to inputs
    if (fromIdx >= inputCount) {
      // Only count edges from non-input nodes (input nodes are always "ready")
      inDegree.set(toIdx, (inDegree.get(toIdx) ?? 0) + 1);
    }
    if (adj.has(fromIdx)) {
      adj.get(fromIdx)!.push(toIdx);
    }
  }

  // Kahn's algorithm
  const queue: number[] = [];
  for (const ni of nonInputIndices) {
    if ((inDegree.get(ni) ?? 0) === 0) {
      queue.push(ni);
    }
  }

  const result: number[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const neighbor of (adj.get(node) ?? [])) {
      const deg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0) {
        queue.push(neighbor);
      }
    }
  }

  // Any nodes not in result have cyclic dependencies → add them at the end
  // (they will use prevActivations for recurrent connections)
  for (const ni of nonInputIndices) {
    if (!result.includes(ni)) {
      result.push(ni);
    }
  }

  return result;
}

// ============================================================
// Forward pass
// ============================================================

export function brainForwardPass(
  rt: BrainRuntime,
  sensorInputs: Float32Array,
): Float32Array {
  const { activations, prevActivations, evalOrder, connFrom, connTo, connWeight, connEnabled, connCount, inputCount, outputCount, nodeCount } = rt;

  // Save previous activations for recurrent connections
  prevActivations.set(activations);

  // Set input values
  for (let i = 0; i < inputCount && i < sensorInputs.length; i++) {
    activations[i] = sensorInputs[i];
  }

  // Clear non-input activations
  for (let i = inputCount; i < nodeCount; i++) {
    activations[i] = 0;
  }

  // Build a fast index→activation lookup for node genes
  const nodeActivationTypes = rt._nodeActivationTypes;

  // Process each non-input node in topological order:
  // 1. Accumulate incoming weighted signals
  // 2. Apply activation function
  // This ensures hidden nodes are fully evaluated before their outputs are used.
  for (const ni of evalOrder) {
    // Accumulate weighted inputs for this node
    for (let c = 0; c < connCount; c++) {
      if (!connEnabled[c]) continue;
      if (connTo[c] !== ni) continue;
      const from = connFrom[c];
      if (from < 0) continue;
      activations[ni] += connWeight[c] * activations[from];
    }

    // Apply activation function
    activations[ni] = activate(activations[ni], nodeActivationTypes[ni]);
  }

  // Extract outputs (they are at indices inputCount..inputCount+outputCount-1)
  const outputs = new Float32Array(outputCount);
  for (let i = 0; i < outputCount; i++) {
    outputs[i] = activations[inputCount + i];
  }

  return outputs;
}

// ============================================================
// Runtime weight export / import (for snapshot persistence)
// ============================================================

/** Export current runtime weights as a plain number array. */
export function exportWeights(rt: BrainRuntime): number[] {
  return Array.from(rt.connWeight);
}

/** Import runtime weights from a plain number array. */
export function importWeights(rt: BrainRuntime, weights: number[]): void {
  for (let i = 0; i < rt.connCount && i < weights.length; i++) {
    rt.connWeight[i] = weights[i];
  }
}

// ============================================================
// Hebbian plasticity update
// ============================================================

export function hebbianUpdate(rt: BrainRuntime, modulator: number): void {
  const lr = rt.genome.plasticityRate;
  if (lr === 0) return;

  const { activations, connFrom, connTo, connWeight, connEnabled, connCount } = rt;

  for (let c = 0; c < connCount; c++) {
    if (!connEnabled[c]) continue;
    const from = connFrom[c];
    const to = connTo[c];
    if (from < 0 || to < 0) continue;

    const pre = activations[from];
    const post = activations[to];
    const dw = lr * pre * post * modulator;
    connWeight[c] = Math.max(-5, Math.min(5, connWeight[c] + dw));
  }
}
