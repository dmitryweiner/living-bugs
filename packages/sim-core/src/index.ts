export { World } from './world.js';
export { PRNG } from './prng.js';
export {
  createDefaultDNA,
  mutateDNA,
  countSensorInputs,
  countActuatorOutputs,
  resetInnovationCounter,
  getInnovationCounter,
} from './dna.js';
export {
  buildBrainRuntime,
  brainForwardPass,
  hebbianUpdate,
} from './brain.js';
export {
  wrapPosition,
  torusDistance,
  circlesOverlap,
  rayCircleIntersect,
} from './geometry.js';
export { SpatialHash } from './spatial-hash.js';
export type {
  WorldConfig,
  DNA,
  BodyGene,
  SensorGene,
  ActuatorGene,
  RayVisionGene,
  TouchGene,
  EnergySenseGene,
  BroadcastReceiverGene,
  MoveActuatorGene,
  AttackActuatorGene,
  EatActuatorGene,
  DonateActuatorGene,
  BroadcastActuatorGene,
  BrainGenome,
  NodeGene,
  ConnectionGene,
  ActivationType,
  CreatureState,
  FoodItemState,
  Vec2,
  WorldSnapshot,
  SimEvent,
  TickMetrics,
} from './types.js';
export type { BrainRuntime } from './brain.js';
