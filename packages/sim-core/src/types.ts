// ============================================================
// World Config types (matches configs/world-config.json)
// ============================================================

import type { ConfigValue } from './expr.js';

/**
 * WorldConfig — runtime parameters for the simulation.
 *
 * Selected fields accept `ConfigValue` (number | Expr) so that formulas
 * can be expressed in JSON without code changes. Structural fields
 * (world size, tick rate, etc.) remain plain numbers.
 */
export interface WorldConfig {
  world: {
    width: number;
    height: number;
    boundary: 'torus';
  };
  simulation: {
    tickRate: number;
    brainRate: number;
    maxCreatures: number;
    initialCreatures: number;
    seed: number;
  };
  energy: {
    initialEnergy: number;
    maxEnergy: number;
    baseMetabolism: ConfigValue;
    densityMetabolismFactor: number;
    moveCost: ConfigValue;
    turnCost: ConfigValue;
    attackCost: ConfigValue;
    visionCostPerRay: ConfigValue;
    broadcastCost: ConfigValue;
  };
  food: {
    spawnRate: number;
    nutritionValue: ConfigValue;
    maxCount: number;
    radius: number;
  };
  combat: {
    baseDamage: ConfigValue;
    attackRadius: number;
    attackCooldown: number;
  };
  reproduction: {
    energyThreshold: ConfigValue;
    offspringEnergyShare: number;
    mutationRate: number;
    mutationStrength: number;
    cooldown: number;
    /** Probability of sexual reproduction (crossover) when a mate is nearby. 0 = always asexual. */
    crossoverRate: number;
  };
  death: {
    foodDropRatio: number;
    foodDropMax: number;
  };
  donation: {
    donateRadius: number;
    donateAmount: ConfigValue;
    donateCost: ConfigValue;
  };
  broadcast: {
    broadcastRadius: number;
    signalChannels: number;
  };
  obstacles: {
    count: number;
    minRadius: number;
    maxRadius: number;
  };
  creatureDefaults: {
    radius: number;
    maxSpeed: number;
    maxTurnRate: number;
  };
}

// ============================================================
// DNA types
// ============================================================

export interface DNA {
  groupId: number;
  hasIFF: boolean;
  body: BodyGene;
  sensors: SensorGene[];
  actuators: ActuatorGene[];
  brain: BrainGenome;
}

export interface BodyGene {
  radius: number; // 3..10
}

// Sensor types
export type SensorGene =
  | RayVisionGene
  | TouchGene
  | EnergySenseGene
  | BroadcastReceiverGene;

export interface RayVisionGene {
  type: 'rayVision';
  rayCount: number;       // 1..16
  fov: number;            // 0.1..2π
  maxDistance: number;     // 10..200
  offsetAngle: number;    // -π..π
}

export interface TouchGene {
  type: 'touch';
}

export interface EnergySenseGene {
  type: 'energySense';
}

export interface BroadcastReceiverGene {
  type: 'broadcastReceiver';
  channels: number[];
}

// Actuator types
export type ActuatorGene =
  | MoveActuatorGene
  | AttackActuatorGene
  | EatActuatorGene
  | DonateActuatorGene
  | BroadcastActuatorGene;

export interface MoveActuatorGene {
  type: 'move';
}

export interface AttackActuatorGene {
  type: 'attack';
}

export interface EatActuatorGene {
  type: 'eat';
}

export interface DonateActuatorGene {
  type: 'donate';
}

export interface BroadcastActuatorGene {
  type: 'broadcast';
  channel: number;
}

// ============================================================
// Brain (NEAT genome) types
// ============================================================

export type ActivationType = 'sigmoid' | 'tanh' | 'relu' | 'linear' | 'step';

export interface NodeGene {
  id: number;
  type: 'input' | 'hidden' | 'output';
  activation: ActivationType;
}

export interface ConnectionGene {
  innovationNumber: number;
  fromNode: number;
  toNode: number;
  weight: number;
  enabled: boolean;
}

export interface BrainGenome {
  plasticityRate: number;
  nodeGenes: NodeGene[];
  connectionGenes: ConnectionGene[];
}

// ============================================================
// Entity types (runtime)
// ============================================================

export interface Vec2 {
  x: number;
  y: number;
}

export interface CreatureState {
  id: number;
  position: Vec2;
  angle: number;       // heading in radians
  energy: number;
  age: number;         // ticks alive
  dna: DNA;
  attackCooldown: number;
  reproductionCooldown: number;
  isBroadcasting: boolean;
  broadcastChannel: number;
  isAttacking: boolean;
  isDonating: boolean;
  isEating: boolean;
  velocity: number;    // current speed scalar
  angularVelocity: number; // current turn rate
  /** Runtime brain weights (Hebbian-modified). Present in snapshots for persistence. */
  runtimeWeights?: number[];
}

export interface FoodItemState {
  id: number;
  position: Vec2;
  nutrition: number;
}

export interface ObstacleState {
  id: number;
  position: Vec2;
  radius: number;
}

// ============================================================
// World snapshot (for save/load)
// ============================================================

export interface WorldSnapshot {
  tick: number;
  creatures: CreatureState[];
  food: FoodItemState[];
  obstacles: ObstacleState[];
  config: WorldConfig;
  prngState: number[];
  nextEntityId: number;
  innovationCounter: number;
}

// ============================================================
// Event types (for logging / debugging)
// ============================================================

export type SimEvent =
  | { type: 'creature_born'; tick: number; creatureId: number; parentId: number | null }
  | { type: 'creature_died'; tick: number; creatureId: number; cause: 'starvation' | 'killed' }
  | { type: 'creature_ate'; tick: number; creatureId: number; foodId: number; energyGained: number }
  | { type: 'creature_attacked'; tick: number; attackerId: number; targetId: number; damage: number }
  | { type: 'creature_donated'; tick: number; donorId: number; recipientId: number; amount: number }
  | { type: 'food_spawned'; tick: number; foodId: number };

// ============================================================
// Metrics
// ============================================================

export interface TickMetrics {
  tick: number;
  creatureCount: number;
  foodCount: number;
  avgEnergy: number;
  avgAge: number;
  births: number;
  deaths: number;
}
