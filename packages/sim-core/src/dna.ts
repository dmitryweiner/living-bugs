import { PRNG } from './prng.js';
import type {
  DNA,
  BrainGenome,
  SensorGene,
  ActuatorGene,
  NodeGene,
  ConnectionGene,
  ActivationType,
} from './types.js';

// ============================================================
// Counting inputs/outputs from DNA
// ============================================================

export function countSensorInputs(sensors: SensorGene[]): number {
  let count = 2; // bias + random (always present)
  for (const s of sensors) {
    switch (s.type) {
      case 'rayVision':
        count += s.rayCount * 4; // distance, type_food, type_creature, type_iff
        break;
      case 'touch':
        count += 3; // touching_food, touching_creature, touching_iff
        break;
      case 'energySense':
        count += 1; // energy_level
        break;
      case 'broadcastReceiver':
        count += s.channels.length * 2; // strength + direction per channel
        break;
    }
  }
  return count;
}

export function countActuatorOutputs(actuators: ActuatorGene[]): number {
  let count = 0;
  for (const a of actuators) {
    switch (a.type) {
      case 'move':
        count += 2; // forward + turn
        break;
      case 'attack':
      case 'eat':
      case 'donate':
      case 'broadcast':
        count += 1;
        break;
    }
  }
  return count;
}

// ============================================================
// Create minimal brain genome from DNA
// ============================================================

let globalInnovation = 0;
const innovationCache = new Map<string, number>();

export function resetInnovationCounter(value = 0): void {
  globalInnovation = value;
  innovationCache.clear();
}

export function getInnovationCounter(): number {
  return globalInnovation;
}

function getInnovation(fromNode: number, toNode: number): number {
  const key = `${fromNode}->${toNode}`;
  let inn = innovationCache.get(key);
  if (inn === undefined) {
    inn = ++globalInnovation;
    innovationCache.set(key, inn);
  }
  return inn;
}

export function createMinimalBrain(
  sensors: SensorGene[],
  actuators: ActuatorGene[],
  rng: PRNG,
): BrainGenome {
  const inputCount = countSensorInputs(sensors);
  const outputCount = countActuatorOutputs(actuators);

  const nodeGenes: NodeGene[] = [];

  // Input nodes
  for (let i = 0; i < inputCount; i++) {
    nodeGenes.push({ id: i, type: 'input', activation: 'linear' });
  }

  // Output nodes
  for (let i = 0; i < outputCount; i++) {
    nodeGenes.push({ id: inputCount + i, type: 'output', activation: 'tanh' });
  }

  // Fully connected input → output
  const connectionGenes: ConnectionGene[] = [];
  for (let i = 0; i < inputCount; i++) {
    for (let o = 0; o < outputCount; o++) {
      connectionGenes.push({
        innovationNumber: getInnovation(i, inputCount + o),
        fromNode: i,
        toNode: inputCount + o,
        weight: rng.range(-1, 1),
        enabled: true,
      });
    }
  }

  return {
    plasticityRate: 0.01,
    nodeGenes,
    connectionGenes,
  };
}

// ============================================================
// Create default DNA for a new creature
// ============================================================

export function createDefaultDNA(groupId: number, rng: PRNG): DNA {
  const sensors: SensorGene[] = [
    { type: 'rayVision', rayCount: 3, fov: 1.5, maxDistance: 50, offsetAngle: 0 },
    { type: 'touch' },
    { type: 'energySense' },
  ];

  const actuators: ActuatorGene[] = [
    { type: 'move' },
    { type: 'eat' },
  ];

  const brain = createMinimalBrain(sensors, actuators, rng);

  return {
    groupId,
    hasIFF: false,
    body: { radius: 5 },
    sensors,
    actuators,
    brain,
  };
}

// ============================================================
// NEAT Crossover
// ============================================================

/**
 * NEAT crossover of two brain genomes using innovation numbers for alignment.
 * Matching genes are randomly inherited from either parent (bias toward fitter).
 * Disjoint / excess genes come from the fitter parent only.
 * If fitness is equal, disjoint/excess from both parents are included.
 */
export function crossoverBrain(
  brain1: BrainGenome,
  brain2: BrainGenome,
  fitness1: number,
  fitness2: number,
  rng: PRNG,
): BrainGenome {
  // Determine which parent is fitter (or equal)
  const fitterBrain = fitness1 >= fitness2 ? brain1 : brain2;
  const otherBrain = fitness1 >= fitness2 ? brain2 : brain1;
  const equalFitness = Math.abs(fitness1 - fitness2) < 1e-9;

  // Index connection genes by innovation number
  const connsA = new Map<number, ConnectionGene>();
  for (const c of fitterBrain.connectionGenes) {
    connsA.set(c.innovationNumber, c);
  }
  const connsB = new Map<number, ConnectionGene>();
  for (const c of otherBrain.connectionGenes) {
    connsB.set(c.innovationNumber, c);
  }

  // Collect all innovation numbers
  const allInnovations = new Set([...connsA.keys(), ...connsB.keys()]);

  const childConnections: ConnectionGene[] = [];
  const usedNodeIds = new Set<number>();

  for (const inn of allInnovations) {
    const geneA = connsA.get(inn);
    const geneB = connsB.get(inn);

    let selected: ConnectionGene;

    if (geneA && geneB) {
      // Matching gene — randomly pick one, 60% bias toward fitter
      selected = rng.chance(0.6) ? { ...geneA } : { ...geneB };
      // If either parent has it disabled, 75% chance it stays disabled
      if (!geneA.enabled || !geneB.enabled) {
        selected.enabled = rng.chance(0.25);
      }
    } else if (geneA) {
      // Disjoint/excess from fitter parent — always include
      selected = { ...geneA };
    } else if (geneB) {
      // Disjoint/excess from other parent — only include if equal fitness
      if (!equalFitness) continue;
      selected = { ...geneB };
    } else {
      continue;
    }

    childConnections.push(selected);
    usedNodeIds.add(selected.fromNode);
    usedNodeIds.add(selected.toNode);
  }

  // Build node genes: union of nodes used by selected connections
  // Start with fitter parent's nodes as the base
  const nodeMap = new Map<number, NodeGene>();
  for (const n of fitterBrain.nodeGenes) {
    nodeMap.set(n.id, { ...n });
  }
  // Add any missing nodes from other parent that are referenced
  for (const n of otherBrain.nodeGenes) {
    if (usedNodeIds.has(n.id) && !nodeMap.has(n.id)) {
      nodeMap.set(n.id, { ...n });
    }
  }

  // Ensure all nodes referenced by connections exist
  // (input/output nodes should always be present from fitter parent)
  const childNodes = Array.from(nodeMap.values());

  return {
    plasticityRate: rng.chance(0.5) ? fitterBrain.plasticityRate : otherBrain.plasticityRate,
    nodeGenes: childNodes,
    connectionGenes: childConnections,
  };
}

/**
 * Crossover two DNA genomes producing a child.
 * Body and structural traits are blended; brain uses NEAT crossover.
 */
export function crossoverDNA(
  dna1: DNA,
  dna2: DNA,
  fitness1: number,
  fitness2: number,
  rng: PRNG,
): DNA {
  const fitter = fitness1 >= fitness2 ? dna1 : dna2;
  const other = fitness1 >= fitness2 ? dna2 : dna1;

  // Body: average radius
  const childRadius = clamp((dna1.body.radius + dna2.body.radius) / 2, 3, 10);

  // groupId from fitter parent
  const groupId = fitter.groupId;

  // hasIFF from fitter parent (with small chance from other)
  const hasIFF = rng.chance(0.8) ? fitter.hasIFF : other.hasIFF;

  // Sensors: union of both parents, deduplicated by type
  // For duplicate types, randomly pick one version
  const sensorMap = new Map<string, SensorGene>();
  for (const s of fitter.sensors) {
    const key = s.type + (s.type === 'rayVision' ? `-${Math.round(s.offsetAngle * 100)}` : '');
    sensorMap.set(key, JSON.parse(JSON.stringify(s)));
  }
  for (const s of other.sensors) {
    const key = s.type + (s.type === 'rayVision' ? `-${Math.round(s.offsetAngle * 100)}` : '');
    if (!sensorMap.has(key)) {
      // Include from other parent with 50% chance
      if (rng.chance(0.5)) {
        sensorMap.set(key, JSON.parse(JSON.stringify(s)));
      }
    } else {
      // Randomly swap for the other parent's version
      if (rng.chance(0.3)) {
        sensorMap.set(key, JSON.parse(JSON.stringify(s)));
      }
    }
  }
  // Ensure energySense is always present
  if (![...sensorMap.values()].some(s => s.type === 'energySense')) {
    sensorMap.set('energySense', { type: 'energySense' });
  }
  const childSensors = Array.from(sensorMap.values());

  // Actuators: union of both parents, deduplicated by type
  const actuatorMap = new Map<string, ActuatorGene>();
  for (const a of fitter.actuators) {
    actuatorMap.set(a.type, JSON.parse(JSON.stringify(a)));
  }
  for (const a of other.actuators) {
    if (!actuatorMap.has(a.type)) {
      if (rng.chance(0.5)) {
        actuatorMap.set(a.type, JSON.parse(JSON.stringify(a)));
      }
    }
  }
  // Ensure move is always present
  if (!actuatorMap.has('move')) {
    actuatorMap.set('move', { type: 'move' });
  }
  const childActuators = Array.from(actuatorMap.values());

  // Brain: NEAT crossover
  const childBrain = crossoverBrain(dna1.brain, dna2.brain, fitness1, fitness2, rng);

  const child: DNA = {
    groupId,
    hasIFF,
    body: { radius: childRadius },
    sensors: childSensors,
    actuators: childActuators,
    brain: childBrain,
  };

  // Reconcile brain I/O to match new sensor/actuator set
  reconcileBrainIO(child, rng);

  return child;
}

// ============================================================
// DNA Mutation
// ============================================================

const ACTIVATION_TYPES: ActivationType[] = ['sigmoid', 'tanh', 'relu', 'linear', 'step'];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function mutateDNA(parent: DNA, mutationRate: number, mutationStrength: number, rng: PRNG): DNA {
  const child: DNA = JSON.parse(JSON.stringify(parent));

  // 1. Body mutation
  if (rng.chance(mutationRate)) {
    child.body.radius = clamp(
      child.body.radius + rng.gaussian() * mutationStrength * 7,
      3, 10
    );
  }

  // 2. hasIFF mutation (rare)
  if (rng.chance(mutationRate / 5)) {
    child.hasIFF = !child.hasIFF;
  }

  // 3. Sensor parameter mutations
  for (const sensor of child.sensors) {
    if (sensor.type === 'rayVision') {
      if (rng.chance(mutationRate)) {
        sensor.fov = clamp(sensor.fov + rng.gaussian() * mutationStrength * 2, 0.1, Math.PI * 2);
      }
      if (rng.chance(mutationRate)) {
        sensor.maxDistance = clamp(
          sensor.maxDistance + rng.gaussian() * mutationStrength * 50, 10, 200
        );
      }
      if (rng.chance(mutationRate)) {
        sensor.offsetAngle = wrapAngle(sensor.offsetAngle + rng.gaussian() * mutationStrength);
      }
      if (rng.chance(mutationRate / 2)) {
        sensor.rayCount = clamp(sensor.rayCount + (rng.chance(0.5) ? 1 : -1), 1, 16);
      }
    }
    if (sensor.type === 'broadcastReceiver') {
      if (rng.chance(mutationRate / 2)) {
        if (sensor.channels.length > 0 && rng.chance(0.5)) {
          // Remove a channel
          const idx = rng.int(0, sensor.channels.length - 1);
          sensor.channels.splice(idx, 1);
        } else {
          // Add a channel (0..3 by default)
          const newCh = rng.int(0, 3);
          if (!sensor.channels.includes(newCh)) {
            sensor.channels.push(newCh);
          }
        }
      }
    }
  }

  // 4. Structural mutations: add/remove sensors
  if (rng.chance(mutationRate / 3)) {
    const newSensorTypes: SensorGene[] = [
      { type: 'rayVision', rayCount: 3, fov: 1.5, maxDistance: 50, offsetAngle: rng.range(-Math.PI, Math.PI) },
      { type: 'touch' },
      { type: 'broadcastReceiver', channels: [rng.int(0, 3)] },
    ];
    child.sensors.push(rng.pick(newSensorTypes));
  }
  if (rng.chance(mutationRate / 3) && child.sensors.length > 1) {
    // Don't remove energySense
    const removable = child.sensors
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.type !== 'energySense');
    if (removable.length > 0) {
      const { i } = rng.pick(removable);
      child.sensors.splice(i, 1);
    }
  }

  // 5. Structural mutations: add/remove actuators
  if (rng.chance(mutationRate / 4)) {
    const existing = new Set(child.actuators.map(a => a.type));
    const candidates: ActuatorGene[] = [
      { type: 'attack' as const },
      { type: 'eat' as const },
      { type: 'donate' as const },
      { type: 'broadcast' as const, channel: rng.int(0, 3) },
    ];
    const possible = candidates.filter(a => !existing.has(a.type));
    if (possible.length > 0) {
      child.actuators.push(rng.pick(possible));
    }
  }
  if (rng.chance(mutationRate / 4) && child.actuators.length > 1) {
    const removable = child.actuators
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.type !== 'move');
    if (removable.length > 0) {
      const { i } = rng.pick(removable);
      child.actuators.splice(i, 1);
    }
  }

  // 6. Mutate brain (see brain.ts for NEAT mutations)
  mutateBrainGenome(child.brain, mutationRate, mutationStrength, rng);

  // 7. Reconcile brain inputs/outputs if sensors/actuators changed
  reconcileBrainIO(child, rng);

  return child;
}

// ============================================================
// Brain genome mutation (NEAT)
// ============================================================

function mutateBrainGenome(
  brain: BrainGenome,
  mutationRate: number,
  mutationStrength: number,
  rng: PRNG,
): void {
  // Weight jitter
  for (const conn of brain.connectionGenes) {
    if (rng.chance(mutationRate)) {
      conn.weight = clamp(conn.weight + rng.gaussian() * mutationStrength, -5, 5);
    }
  }

  // Add connection
  if (rng.chance(mutationRate * 0.5)) {
    const nodes = brain.nodeGenes;
    const from = rng.pick(nodes);
    const to = rng.pick(nodes.filter(n => n.type !== 'input'));
    if (from && to && from.id !== to.id) {
      const exists = brain.connectionGenes.some(
        c => c.fromNode === from.id && c.toNode === to.id
      );
      if (!exists) {
        brain.connectionGenes.push({
          innovationNumber: getInnovation(from.id, to.id),
          fromNode: from.id,
          toNode: to.id,
          weight: rng.range(-1, 1),
          enabled: true,
        });
      }
    }
  }

  // Add node (split existing connection)
  if (rng.chance(mutationRate * 0.3)) {
    const enabled = brain.connectionGenes.filter(c => c.enabled);
    if (enabled.length > 0) {
      const conn = rng.pick(enabled);
      conn.enabled = false;

      const newId = Math.max(...brain.nodeGenes.map(n => n.id)) + 1;
      brain.nodeGenes.push({
        id: newId,
        type: 'hidden',
        activation: rng.pick(['sigmoid', 'tanh', 'relu'] as ActivationType[]),
      });

      brain.connectionGenes.push({
        innovationNumber: getInnovation(conn.fromNode, newId),
        fromNode: conn.fromNode,
        toNode: newId,
        weight: 1.0,
        enabled: true,
      });
      brain.connectionGenes.push({
        innovationNumber: getInnovation(newId, conn.toNode),
        fromNode: newId,
        toNode: conn.toNode,
        weight: conn.weight,
        enabled: true,
      });
    }
  }

  // Toggle connection
  if (rng.chance(mutationRate * 0.1)) {
    if (brain.connectionGenes.length > 0) {
      const conn = rng.pick(brain.connectionGenes);
      conn.enabled = !conn.enabled;
    }
  }

  // Change activation of hidden node
  if (rng.chance(mutationRate * 0.1)) {
    const hiddens = brain.nodeGenes.filter(n => n.type === 'hidden');
    if (hiddens.length > 0) {
      const node = rng.pick(hiddens);
      node.activation = rng.pick(ACTIVATION_TYPES);
    }
  }

  // Plasticity rate jitter
  if (rng.chance(mutationRate)) {
    brain.plasticityRate = clamp(
      brain.plasticityRate + rng.gaussian() * 0.005,
      0, 0.1
    );
  }
}

// ============================================================
// Reconcile brain I/O after sensor/actuator changes
// ============================================================

function reconcileBrainIO(dna: DNA, rng: PRNG): void {
  const neededInputs = countSensorInputs(dna.sensors);
  const neededOutputs = countActuatorOutputs(dna.actuators);

  const brain = dna.brain;
  const currentInputs = brain.nodeGenes.filter(n => n.type === 'input');
  const currentOutputs = brain.nodeGenes.filter(n => n.type === 'output');

  // Adjust inputs
  if (currentInputs.length < neededInputs) {
    // Add missing input nodes
    const maxId = Math.max(...brain.nodeGenes.map(n => n.id), 0);
    for (let i = currentInputs.length; i < neededInputs; i++) {
      const newId = maxId + 1 + (i - currentInputs.length);
      brain.nodeGenes.push({ id: newId, type: 'input', activation: 'linear' });
      // Add random connections to existing output/hidden nodes
      const targets = brain.nodeGenes.filter(n => n.type !== 'input');
      if (targets.length > 0) {
        const target = rng.pick(targets);
        brain.connectionGenes.push({
          innovationNumber: getInnovation(newId, target.id),
          fromNode: newId,
          toNode: target.id,
          weight: rng.range(-0.5, 0.5),
          enabled: true,
        });
      }
    }
  } else if (currentInputs.length > neededInputs) {
    // Remove excess input nodes and their connections
    const toRemoveIds = new Set(
      currentInputs.slice(neededInputs).map(n => n.id)
    );
    brain.nodeGenes = brain.nodeGenes.filter(n => !toRemoveIds.has(n.id));
    brain.connectionGenes = brain.connectionGenes.filter(
      c => !toRemoveIds.has(c.fromNode)
    );
  }

  // Adjust outputs
  if (currentOutputs.length < neededOutputs) {
    const maxId = Math.max(...brain.nodeGenes.map(n => n.id), 0);
    for (let i = currentOutputs.length; i < neededOutputs; i++) {
      const newId = maxId + 1 + (i - currentOutputs.length);
      brain.nodeGenes.push({ id: newId, type: 'output', activation: 'tanh' });
      const sources = brain.nodeGenes.filter(n => n.type !== 'output' || n.id === newId);
      if (sources.length > 0) {
        const source = rng.pick(sources.filter(n => n.type === 'input'));
        if (source) {
          brain.connectionGenes.push({
            innovationNumber: getInnovation(source.id, newId),
            fromNode: source.id,
            toNode: newId,
            weight: rng.range(-0.5, 0.5),
            enabled: true,
          });
        }
      }
    }
  } else if (currentOutputs.length > neededOutputs) {
    const toRemoveIds = new Set(
      currentOutputs.slice(neededOutputs).map(n => n.id)
    );
    brain.nodeGenes = brain.nodeGenes.filter(n => !toRemoveIds.has(n.id));
    brain.connectionGenes = brain.connectionGenes.filter(
      c => !toRemoveIds.has(c.toNode)
    );
  }
}
