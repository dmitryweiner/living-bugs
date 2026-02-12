import { PRNG } from './prng.js';
import { createDefaultDNA, countSensorInputs, countActuatorOutputs, mutateDNA, resetInnovationCounter, getInnovationCounter } from './dna.js';
import { buildBrainRuntime, brainForwardPass, hebbianUpdate, type BrainRuntime } from './brain.js';
import { wrapPosition, torusDistance, circlesOverlap, rayCircleIntersect } from './geometry.js';
import { SpatialHash } from './spatial-hash.js';
import { resolveConfigValue, type ExprContext } from './expr.js';
import type {
  WorldConfig,
  CreatureState,
  FoodItemState,
  ObstacleState,
  DNA,
  SimEvent,
  TickMetrics,
  WorldSnapshot,
  Vec2,
} from './types.js';

// ============================================================
// Internal creature / food state
// ============================================================

interface CreatureInternal {
  state: CreatureState;
  brainRuntime: BrainRuntime;
  lastEnergy: number; // for modulator computation
}

interface FoodInternal {
  state: FoodItemState;
}

interface ObstacleInternal {
  state: ObstacleState;
}

// (Matter.js removed — using pure kinematic simulation with spatial hash)

// ============================================================
// Expression context builders
// ============================================================

/** Build an expression context from a creature's state. */
function creatureCtx(s: CreatureState): ExprContext {
  return {
    'creature.radius': s.dna.body.radius,
    'creature.energy': s.energy,
    'creature.age': s.age,
    'creature.speed': Math.abs(s.velocity),
    'creature.angularVelocity': Math.abs(s.angularVelocity),
    'creature.groupId': s.dna.groupId,
  };
}

/** Build an expression context from a food item. */
function foodCtx(f: FoodItemState): ExprContext {
  return {
    'food.nutrition': f.nutrition,
  };
}

// ============================================================
// World class
// ============================================================

export class World {
  config: WorldConfig;
  rng: PRNG;
  tick: number = 0;
  nextEntityId: number = 1;

  // Entity storage
  creatures: Map<number, CreatureInternal> = new Map();
  food: Map<number, FoodInternal> = new Map();
  obstacles: Map<number, ObstacleInternal> = new Map();

  // Event log (capped per tick, flushed after reading)
  events: SimEvent[] = [];

  // Metrics for current tick
  private tickBirths = 0;
  private tickDeaths = 0;

  // Brain tick counter
  private brainTickAccumulator = 0;

  // Spatial hashes for fast neighbor queries
  private creatureHash!: SpatialHash<CreatureState>;
  private foodHash!: SpatialHash<FoodItemState>;
  private obstacleHash!: SpatialHash<ObstacleState>;
  private readonly SPATIAL_CELL_SIZE = 100; // cells cover 100x100 units

  constructor(config: WorldConfig) {
    this.config = config;
    this.rng = new PRNG(config.simulation.seed);

    // Init spatial hashes
    this.rebuildSpatialHashes();
  }

  private rebuildSpatialHashes(): void {
    this.creatureHash = new SpatialHash<CreatureState>(
      this.config.world.width, this.config.world.height, this.SPATIAL_CELL_SIZE,
    );
    this.foodHash = new SpatialHash<FoodItemState>(
      this.config.world.width, this.config.world.height, this.SPATIAL_CELL_SIZE,
    );
    this.obstacleHash = new SpatialHash<ObstacleState>(
      this.config.world.width, this.config.world.height, this.SPATIAL_CELL_SIZE,
    );
  }

  /** Rebuild spatial hashes from current entity positions. Call once per tick. */
  private updateSpatialHashes(): void {
    this.creatureHash.clear();
    this.foodHash.clear();
    for (const [, c] of this.creatures) {
      this.creatureHash.insert(c.state);
    }
    for (const [, f] of this.food) {
      this.foodHash.insert(f.state);
    }
  }

  /** Rebuild the obstacle spatial hash. Called once after obstacles are placed (they are static). */
  private rebuildObstacleHash(): void {
    this.obstacleHash.clear();
    for (const [, o] of this.obstacles) {
      this.obstacleHash.insert(o.state);
    }
  }

  // ============================================================
  // Initialization
  // ============================================================

  /**
   * Initialize the world with creatures and food.
   * @param seedGenotypes - Optional pre-trained DNA to seed creatures from.
   *   If provided, creatures are spawned cycling through these genotypes
   *   (with light mutation) instead of using random default DNA.
   */
  initialize(seedGenotypes?: DNA[]): void {
    // Spawn obstacles first so creatures and food avoid them
    this.spawnObstacles();
    this.rebuildObstacleHash();

    const { initialCreatures } = this.config.simulation;
    const numGroups = 4;

    for (let i = 0; i < initialCreatures; i++) {
      let dna: DNA;
      if (seedGenotypes && seedGenotypes.length > 0) {
        // Pick a seed genotype (cycle through), apply light mutation
        const seed = seedGenotypes[i % seedGenotypes.length];
        dna = mutateDNA(
          seed,
          this.config.reproduction.mutationRate * 0.5, // lighter mutation to preserve training
          this.config.reproduction.mutationStrength * 0.5,
          this.rng,
        );
      } else {
        const groupId = i % numGroups;
        dna = createDefaultDNA(groupId, this.rng);
      }
      const pos = this.findClearPosition(this.config.creatureDefaults.radius);
      const angle = this.rng.range(0, Math.PI * 2);
      this.spawnCreature(dna, pos, angle, this.config.energy.initialEnergy);
    }

    // Spawn initial food
    for (let i = 0; i < this.config.food.maxCount / 2; i++) {
      this.spawnFood(this.findClearPosition(this.config.food.radius));
    }

    // Build initial spatial hashes
    this.updateSpatialHashes();
  }

  // ============================================================
  // Obstacle spawning
  // ============================================================

  private spawnObstacles(): void {
    const cfg = this.config.obstacles;
    if (!cfg || cfg.count <= 0) return;

    for (let i = 0; i < cfg.count; i++) {
      const id = this.nextEntityId++;
      const radius = this.rng.range(cfg.minRadius, cfg.maxRadius);
      // Keep obstacles away from world edges by their radius
      const pos: Vec2 = {
        x: this.rng.range(radius, this.config.world.width - radius),
        y: this.rng.range(radius, this.config.world.height - radius),
      };
      const state: ObstacleState = { id, position: pos, radius };
      this.obstacles.set(id, { state });
    }
  }

  /**
   * Find a random position that doesn't overlap with any obstacle.
   * Tries up to 20 times, then falls back to a random position.
   */
  private findClearPosition(entityRadius: number): Vec2 {
    for (let attempt = 0; attempt < 20; attempt++) {
      const pos: Vec2 = {
        x: this.rng.range(0, this.config.world.width),
        y: this.rng.range(0, this.config.world.height),
      };
      if (!this.overlapsObstacle(pos, entityRadius)) {
        return pos;
      }
    }
    // Fallback — just return a random position
    return {
      x: this.rng.range(0, this.config.world.width),
      y: this.rng.range(0, this.config.world.height),
    };
  }

  /** Check if a circle at `pos` with `radius` overlaps any obstacle. */
  private overlapsObstacle(pos: Vec2, radius: number): boolean {
    for (const [, o] of this.obstacles) {
      if (circlesOverlap(pos, radius, o.state.position, o.state.radius,
        this.config.world.width, this.config.world.height)) {
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // Spawn entities
  // ============================================================

  spawnCreature(dna: DNA, position: Vec2, angle: number, energy: number): number {
    const id = this.nextEntityId++;

    const brainRuntime = buildBrainRuntime(dna.brain);

    const state: CreatureState = {
      id,
      position: { x: position.x, y: position.y },
      angle,
      energy,
      age: 0,
      dna,
      attackCooldown: 0,
      reproductionCooldown: 0,
      isBroadcasting: false,
      broadcastChannel: 0,
      isAttacking: false,
      isDonating: false,
      isEating: false,
      velocity: 0,
      angularVelocity: 0,
    };

    this.creatures.set(id, { state, brainRuntime, lastEnergy: energy });
    this.events.push({ type: 'creature_born', tick: this.tick, creatureId: id, parentId: null });
    this.tickBirths++;

    return id;
  }

  spawnFood(position: Vec2, nutrition?: number): number {
    const id = this.nextEntityId++;
    const n = nutrition ?? resolveConfigValue(this.config.food.nutritionValue, {});

    const state: FoodItemState = { id, position: { ...position }, nutrition: n };
    this.food.set(id, { state });
    this.events.push({ type: 'food_spawned', tick: this.tick, foodId: id });

    return id;
  }

  // ============================================================
  // Remove entities
  // ============================================================

  private removeCreature(id: number, cause: 'starvation' | 'killed'): void {
    const c = this.creatures.get(id);
    if (!c) return;

    // Drop food on death
    const { foodDropRatio, foodDropMax } = this.config.death;
    const nutritionVal = resolveConfigValue(this.config.food.nutritionValue, {});
    const dropCount = Math.min(
      foodDropMax,
      Math.floor(c.state.energy > 0 ? c.state.energy * foodDropRatio / nutritionVal : c.lastEnergy * foodDropRatio / nutritionVal)
    );
    for (let i = 0; i < Math.max(0, dropCount); i++) {
      const offset: Vec2 = {
        x: c.state.position.x + this.rng.range(-c.state.dna.body.radius * 2, c.state.dna.body.radius * 2),
        y: c.state.position.y + this.rng.range(-c.state.dna.body.radius * 2, c.state.dna.body.radius * 2),
      };
      wrapPosition(offset, this.config.world.width, this.config.world.height);
      this.spawnFood(offset);
    }

    this.creatures.delete(id);
    this.events.push({ type: 'creature_died', tick: this.tick, creatureId: id, cause });
    this.tickDeaths++;
  }

  private removeFood(id: number): void {
    this.food.delete(id);
  }

  // ============================================================
  // Main simulation step
  // ============================================================

  step(): TickMetrics {
    this.events = [];
    this.tickBirths = 0;
    this.tickDeaths = 0;

    // 1. Spawn food
    this.spawnFoodTick();

    // 2. Run brains (at brain rate)
    this.brainTickAccumulator++;
    const brainInterval = Math.round(this.config.simulation.tickRate / this.config.simulation.brainRate);
    const runBrain = this.brainTickAccumulator >= brainInterval;
    if (runBrain) {
      this.brainTickAccumulator = 0;
    }

    // 3. Process each creature
    const toReproduce: number[] = [];
    const toDie: { id: number; cause: 'starvation' | 'killed' }[] = [];

    for (const [id, creature] of this.creatures) {
      const s = creature.state;
      const cfg = this.config;

      // Decrease cooldowns
      if (s.attackCooldown > 0) s.attackCooldown--;
      if (s.reproductionCooldown > 0) s.reproductionCooldown--;

      // Run brain or use random commands
      if (runBrain) {
        const inputs = this.gatherSensorInputs(creature);
        const outputs = brainForwardPass(creature.brainRuntime, inputs);
        this.applyBrainOutputs(creature, outputs);

        // Hebbian update
        const energyDelta = s.energy - creature.lastEnergy;
        const modulator = Math.max(-1, Math.min(1, energyDelta / 10));
        hebbianUpdate(creature.brainRuntime, modulator);
        creature.lastEnergy = s.energy;
      }

      // Apply kinematic movement
      const speed = s.velocity;
      s.angle += s.angularVelocity;
      s.position.x += Math.cos(s.angle) * speed;
      s.position.y += Math.sin(s.angle) * speed;
      wrapPosition(s.position, this.config.world.width, this.config.world.height);

      // Resolve obstacle collisions — push creature out
      this.resolveObstacleCollision(s);

      // Energy cost (config values may be expressions)
      const cCtx = creatureCtx(s);
      const rayCount = s.dna.sensors
        .filter(se => se.type === 'rayVision')
        .reduce((sum, se) => sum + (se.type === 'rayVision' ? se.rayCount : 0), 0);
      const metabolismScale = Math.pow(s.dna.body.radius / cfg.creatureDefaults.radius, 2);
      const densityRatio = this.creatures.size / cfg.simulation.maxCreatures;
      const densityMultiplier = 1 + cfg.energy.densityMetabolismFactor * densityRatio;
      const cost = resolveConfigValue(cfg.energy.baseMetabolism, cCtx) * metabolismScale * densityMultiplier
        + resolveConfigValue(cfg.energy.moveCost, cCtx) * Math.abs(speed)
        + resolveConfigValue(cfg.energy.turnCost, cCtx) * Math.abs(s.angularVelocity)
        + resolveConfigValue(cfg.energy.visionCostPerRay, cCtx) * rayCount
        + (s.isBroadcasting ? resolveConfigValue(cfg.energy.broadcastCost, cCtx) : 0);
      s.energy -= cost;

      // Age
      s.age++;

      // Check death
      if (s.energy <= 0) {
        toDie.push({ id, cause: 'starvation' });
        continue;
      }

      // Check reproduction
      if (s.energy >= resolveConfigValue(cfg.reproduction.energyThreshold, cCtx) && s.reproductionCooldown <= 0) {
        if (this.creatures.size < cfg.simulation.maxCreatures) {
          toReproduce.push(id);
        }
      }
    }

    // 4. Rebuild spatial hashes after positions are updated
    this.updateSpatialHashes();

    // 6. Handle collisions (eating, attacking, donating)
    this.handleCollisions();

    // 7. Process deaths
    for (const { id, cause } of toDie) {
      this.removeCreature(id, cause);
    }

    // 8. Process reproduction (enforce maxCreatures strictly)
    for (const parentId of toReproduce) {
      if (this.creatures.size >= this.config.simulation.maxCreatures) break;
      this.reproduce(parentId);
    }

    this.tick++;

    return this.getMetrics();
  }

  // ============================================================
  // Sensor gathering
  // ============================================================

  private gatherSensorInputs(creature: CreatureInternal): Float32Array {
    const s = creature.state;
    const inputCount = countSensorInputs(s.dna.sensors);
    const inputs = new Float32Array(inputCount);
    let idx = 0;

    // Bias + Random
    inputs[idx++] = 1.0;
    inputs[idx++] = this.rng.random();

    for (const sensor of s.dna.sensors) {
      switch (sensor.type) {
        case 'rayVision': {
          const angleStep = sensor.rayCount > 1 ? sensor.fov / (sensor.rayCount - 1) : 0;
          const startAngle = s.angle + sensor.offsetAngle - sensor.fov / 2;

          for (let r = 0; r < sensor.rayCount; r++) {
            const rayAngle = startAngle + angleStep * r;
            const endX = s.position.x + Math.cos(rayAngle) * sensor.maxDistance;
            const endY = s.position.y + Math.sin(rayAngle) * sensor.maxDistance;
            const rayEnd: Vec2 = { x: endX, y: endY };

            // Simple raycasting: check against nearby entities via spatial hash
            let closestDist = 1.0;
            let hitFood = 0;
            let hitCreature = 0;
            let hitIFF = 0;

            // Check food (spatial hash query)
            const nearbyFood = this.foodHash.queryRay(s.position, rayEnd, this.config.food.radius);
            for (const foodState of nearbyFood) {
              const d = rayCircleIntersect(
                s.position, rayEnd,
                foodState.position, this.config.food.radius
              );
              if (d !== null && d < closestDist) {
                closestDist = d;
                hitFood = 1;
                hitCreature = 0;
                hitIFF = 0;
              }
            }

            // Check creatures (spatial hash query)
            const nearbyCreatures = this.creatureHash.queryRay(s.position, rayEnd, this.config.creatureDefaults.radius * 2);
            for (const otherState of nearbyCreatures) {
              if (otherState.id === s.id) continue;
              const d = rayCircleIntersect(
                s.position, rayEnd,
                otherState.position, otherState.dna.body.radius
              );
              if (d !== null && d < closestDist) {
                closestDist = d;
                hitFood = 0;
                hitCreature = 1;
                hitIFF = s.dna.hasIFF
                  ? (otherState.dna.groupId === s.dna.groupId ? 1 : -1)
                  : 0;
              }
            }

            // Check obstacles (spatial hash query)
            const maxObsRadius = this.config.obstacles?.maxRadius ?? 0;
            if (maxObsRadius > 0) {
              const nearbyObs = this.obstacleHash.queryRay(s.position, rayEnd, maxObsRadius);
              for (const obsState of nearbyObs) {
                const d = rayCircleIntersect(
                  s.position, rayEnd,
                  obsState.position, obsState.radius
                );
                if (d !== null && d < closestDist) {
                  closestDist = d;
                  hitFood = 0;
                  hitCreature = 0;
                  hitIFF = 0;
                }
              }
            }

            inputs[idx++] = closestDist;
            inputs[idx++] = hitFood;
            inputs[idx++] = hitCreature;
            inputs[idx++] = hitIFF;
          }
          break;
        }

        case 'touch': {
          let touchFood = 0;
          let touchCreature = 0;
          let touchIFF = 0;

          // Check collisions with food (spatial hash)
          const touchFoodCandidates = this.foodHash.queryRadius(s.position, s.dna.body.radius + this.config.food.radius);
          for (const foodState of touchFoodCandidates) {
            if (circlesOverlap(s.position, s.dna.body.radius, foodState.position, this.config.food.radius, this.config.world.width, this.config.world.height)) {
              touchFood = 1;
              break;
            }
          }

          // Check collisions with creatures (spatial hash)
          const touchCreatureCandidates = this.creatureHash.queryRadius(s.position, s.dna.body.radius + this.config.creatureDefaults.radius * 2);
          for (const otherState of touchCreatureCandidates) {
            if (otherState.id === s.id) continue;
            if (circlesOverlap(s.position, s.dna.body.radius, otherState.position, otherState.dna.body.radius, this.config.world.width, this.config.world.height)) {
              touchCreature = 1;
              touchIFF = s.dna.hasIFF
                ? (otherState.dna.groupId === s.dna.groupId ? 1 : -1)
                : 0;
              break;
            }
          }

          // Obstacles block creature movement so touching is implicit via collision,
          // but the touch sensor can detect it too (shows as touching "creature" with IFF=0)
          if (touchCreature === 0) {
            const touchObsMaxR = this.config.obstacles?.maxRadius ?? 0;
            if (touchObsMaxR > 0) {
              const touchObsCandidates = this.obstacleHash.queryRadius(s.position, s.dna.body.radius + touchObsMaxR);
              for (const obsState of touchObsCandidates) {
                if (circlesOverlap(s.position, s.dna.body.radius, obsState.position, obsState.radius, this.config.world.width, this.config.world.height)) {
                  touchCreature = 1; // Obstacles feel like solid objects
                  touchIFF = 0;
                  break;
                }
              }
            }
          }

          inputs[idx++] = touchFood;
          inputs[idx++] = touchCreature;
          inputs[idx++] = touchIFF;
          break;
        }

        case 'energySense': {
          inputs[idx++] = s.energy / this.config.energy.maxEnergy;
          break;
        }

        case 'broadcastReceiver': {
          const bcRadius = this.config.broadcast.broadcastRadius;
          const nearbyBroadcasters = this.creatureHash.queryRadius(s.position, bcRadius);
          for (const ch of sensor.channels) {
            let bestStrength = 0;
            let bestDirection = 0;

            for (const otherState of nearbyBroadcasters) {
              if (otherState.id === s.id) continue;
              if (!otherState.isBroadcasting) continue;
              if (otherState.broadcastChannel !== ch) continue;

              const dist = torusDistance(s.position, otherState.position, this.config.world.width, this.config.world.height);
              if (dist > bcRadius) continue;

              const strength = 1 - dist / bcRadius;
              if (strength > bestStrength) {
                bestStrength = strength;
                const dx = otherState.position.x - s.position.x;
                const dy = otherState.position.y - s.position.y;
                const dirAngle = Math.atan2(dy, dx) - s.angle;
                bestDirection = Math.max(-1, Math.min(1, dirAngle / Math.PI));
              }
            }

            inputs[idx++] = bestStrength;
            inputs[idx++] = bestDirection;
          }
          break;
        }
      }
    }

    return inputs;
  }

  // ============================================================
  // Apply brain outputs to creature actions
  // ============================================================

  private applyBrainOutputs(creature: CreatureInternal, outputs: Float32Array): void {
    const s = creature.state;
    const cfg = this.config;
    let idx = 0;

    for (const actuator of s.dna.actuators) {
      switch (actuator.type) {
        case 'move': {
          const forward = outputs[idx++] ?? 0;
          const turn = outputs[idx++] ?? 0;
          // forward: -1..1 → speed: -maxSpeed*0.5..maxSpeed
          s.velocity = forward > 0
            ? forward * cfg.creatureDefaults.maxSpeed
            : forward * cfg.creatureDefaults.maxSpeed * 0.5;
          s.angularVelocity = turn * cfg.creatureDefaults.maxTurnRate;
          break;
        }
        case 'attack': {
          s.isAttacking = (outputs[idx++] ?? 0) > 0.5;
          break;
        }
        case 'eat': {
          s.isEating = (outputs[idx++] ?? 0) > 0.5;
          break;
        }
        case 'donate': {
          s.isDonating = (outputs[idx++] ?? 0) > 0.5;
          break;
        }
        case 'broadcast': {
          s.isBroadcasting = (outputs[idx++] ?? 0) > 0.5;
          s.broadcastChannel = actuator.channel;
          break;
        }
      }
    }
  }

  // ============================================================
  // Collision handling (eat, attack, donate)
  // ============================================================

  private handleCollisions(): void {
    const cfg = this.config;
    const foodToRemove: number[] = [];
    const eatRadius = cfg.creatureDefaults.radius * 2 + cfg.food.radius;

    for (const [, creature] of this.creatures) {
      const s = creature.state;

      // Eating — spatial hash query
      if (s.isEating) {
        const nearbyFood = this.foodHash.queryRadius(s.position, eatRadius);
        for (const foodState of nearbyFood) {
          if (circlesOverlap(s.position, s.dna.body.radius, foodState.position, cfg.food.radius, cfg.world.width, cfg.world.height)) {
            const fCtx = { ...creatureCtx(s), ...foodCtx(foodState) };
            const nutrition = resolveConfigValue(cfg.food.nutritionValue, fCtx);
            s.energy = Math.min(cfg.energy.maxEnergy, s.energy + nutrition);
            foodToRemove.push(foodState.id);
            this.events.push({
              type: 'creature_ate', tick: this.tick,
              creatureId: s.id, foodId: foodState.id, energyGained: nutrition,
            });
            break; // One food per tick
          }
        }
      }

      // Attacking — spatial hash query
      if (s.isAttacking && s.attackCooldown <= 0) {
        const atkCtx = creatureCtx(s);
        s.energy -= resolveConfigValue(cfg.energy.attackCost, atkCtx);
        s.attackCooldown = cfg.combat.attackCooldown;

        const nearbyTargets = this.creatureHash.queryRadius(s.position, cfg.combat.attackRadius);
        for (const targetState of nearbyTargets) {
          if (targetState.id === s.id) continue;
          const dist = torusDistance(s.position, targetState.position, cfg.world.width, cfg.world.height);
          if (dist <= cfg.combat.attackRadius) {
            // IFF check
            if (s.dna.hasIFF && targetState.dna.groupId === s.dna.groupId) continue;
            const damage = resolveConfigValue(cfg.combat.baseDamage, atkCtx);
            targetState.energy -= damage;
            this.events.push({
              type: 'creature_attacked', tick: this.tick,
              attackerId: s.id, targetId: targetState.id, damage,
            });
            if (targetState.energy <= 0) {
              this.removeCreature(targetState.id, 'killed');
            }
          }
        }
      }

      // Donating — spatial hash query
      if (s.isDonating && s.dna.hasIFF) {
        let bestDist = cfg.donation.donateRadius;
        let bestTarget: CreatureInternal | null = null;

        const nearbyAllies = this.creatureHash.queryRadius(s.position, cfg.donation.donateRadius);
        for (const otherState of nearbyAllies) {
          if (otherState.id === s.id) continue;
          if (otherState.dna.groupId !== s.dna.groupId) continue;
          const dist = torusDistance(s.position, otherState.position, cfg.world.width, cfg.world.height);
          if (dist < bestDist) {
            bestDist = dist;
            // Need the internal creature to modify energy
            bestTarget = this.creatures.get(otherState.id) ?? null;
          }
        }

        const donCtx = creatureCtx(s);
        s.energy -= resolveConfigValue(cfg.donation.donateCost, donCtx);
        if (bestTarget) {
          const donateAmount = resolveConfigValue(cfg.donation.donateAmount, donCtx);
          bestTarget.state.energy = Math.min(
            cfg.energy.maxEnergy,
            bestTarget.state.energy + donateAmount
          );
          s.energy -= donateAmount;
          this.events.push({
            type: 'creature_donated', tick: this.tick,
            donorId: s.id, recipientId: bestTarget.state.id, amount: donateAmount,
          });
        }
      }
    }

    // Remove eaten food
    for (const id of foodToRemove) {
      this.removeFood(id);
    }
  }

  // ============================================================
  // Obstacle collision resolution
  // ============================================================

  private resolveObstacleCollision(s: CreatureState): void {
    const maxRadius = this.config.obstacles?.maxRadius ?? 0;
    if (maxRadius === 0) return;

    const queryRadius = s.dna.body.radius + maxRadius;
    const nearbyObstacles = this.obstacleHash.queryRadius(s.position, queryRadius);

    for (const obs of nearbyObstacles) {
      const dist = torusDistance(s.position, obs.position, this.config.world.width, this.config.world.height);
      const minDist = s.dna.body.radius + obs.radius;
      if (dist < minDist && dist > 0.001) {
        // Push creature out along the vector from obstacle center to creature
        const pushDist = minDist - dist;
        // Use simple dx/dy (works for non-wrapping short distances)
        let dx = s.position.x - obs.position.x;
        let dy = s.position.y - obs.position.y;
        // Handle torus wrapping for the push direction
        if (dx > this.config.world.width / 2) dx -= this.config.world.width;
        else if (dx < -this.config.world.width / 2) dx += this.config.world.width;
        if (dy > this.config.world.height / 2) dy -= this.config.world.height;
        else if (dy < -this.config.world.height / 2) dy += this.config.world.height;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0.001) {
          s.position.x += (dx / len) * pushDist;
          s.position.y += (dy / len) * pushDist;
          wrapPosition(s.position, this.config.world.width, this.config.world.height);
        }
      }
    }
  }

  // ============================================================
  // Reproduction
  // ============================================================

  private reproduce(parentId: number): void {
    const parent = this.creatures.get(parentId);
    if (!parent) return;

    const cfg = this.config;
    const s = parent.state;

    const childEnergy = s.energy * cfg.reproduction.offspringEnergyShare;
    s.energy -= childEnergy;
    s.reproductionCooldown = cfg.reproduction.cooldown;

    // Child position: near parent
    const offsetAngle = this.rng.range(0, Math.PI * 2);
    const offsetDist = s.dna.body.radius * 2.5;
    const childPos: Vec2 = {
      x: s.position.x + Math.cos(offsetAngle) * offsetDist,
      y: s.position.y + Math.sin(offsetAngle) * offsetDist,
    };
    wrapPosition(childPos, this.config.world.width, this.config.world.height);

    // Mutate DNA
    const childDNA = mutateDNA(
      s.dna,
      cfg.reproduction.mutationRate,
      cfg.reproduction.mutationStrength,
      this.rng
    );

    const childId = this.spawnCreature(childDNA, childPos, this.rng.range(0, Math.PI * 2), childEnergy);
    // Fix the event to record parent
    const lastEvent = this.events[this.events.length - 1];
    if (lastEvent && lastEvent.type === 'creature_born') {
      lastEvent.parentId = parentId;
    }
  }

  // ============================================================
  // Food spawning
  // ============================================================

  private spawnFoodTick(): void {
    const cfg = this.config;
    if (this.food.size >= cfg.food.maxCount) return;

    for (let i = 0; i < cfg.food.spawnRate; i++) {
      if (this.food.size >= cfg.food.maxCount) break;
      this.spawnFood(this.findClearPosition(cfg.food.radius));
    }
  }

  // ============================================================
  // Metrics
  // ============================================================

  getMetrics(): TickMetrics {
    let totalEnergy = 0;
    let totalAge = 0;
    const count = this.creatures.size;

    for (const [, c] of this.creatures) {
      totalEnergy += c.state.energy;
      totalAge += c.state.age;
    }

    return {
      tick: this.tick,
      creatureCount: count,
      foodCount: this.food.size,
      avgEnergy: count > 0 ? totalEnergy / count : 0,
      avgAge: count > 0 ? totalAge / count : 0,
      births: this.tickBirths,
      deaths: this.tickDeaths,
    };
  }

  // ============================================================
  // Snapshot (save/load)
  // ============================================================

  getSnapshot(): WorldSnapshot {
    const creatures: CreatureState[] = [];
    for (const [, c] of this.creatures) {
      creatures.push({ ...c.state });
    }

    const food: FoodItemState[] = [];
    for (const [, f] of this.food) {
      food.push({ ...f.state });
    }

    const obstacles: ObstacleState[] = [];
    for (const [, o] of this.obstacles) {
      obstacles.push({ ...o.state });
    }

    return {
      tick: this.tick,
      creatures,
      food,
      obstacles,
      config: this.config,
      prngState: this.rng.getState(),
      nextEntityId: this.nextEntityId,
      innovationCounter: getInnovationCounter(),
    };
  }

  loadSnapshot(snapshot: WorldSnapshot): void {
    // Clear existing world
    this.creatures.clear();
    this.food.clear();
    this.obstacles.clear();

    this.config = snapshot.config;
    this.tick = snapshot.tick;
    this.nextEntityId = snapshot.nextEntityId;
    this.rng.setState(snapshot.prngState);
    resetInnovationCounter(snapshot.innovationCounter);

    // Recreate obstacles
    if (snapshot.obstacles) {
      for (const o of snapshot.obstacles) {
        this.obstacles.set(o.id, { state: { ...o } });
      }
    }
    this.rebuildObstacleHash();

    // Recreate food
    for (const f of snapshot.food) {
      this.spawnFood(f.position, f.nutrition);
    }

    // Recreate creatures
    for (const c of snapshot.creatures) {
      this.spawnCreature(c.dna, c.position, c.angle, c.energy);
      // Restore state fields
      const internal = this.creatures.get(c.id);
      if (internal) {
        internal.state.age = c.age;
        internal.state.attackCooldown = c.attackCooldown;
        internal.state.reproductionCooldown = c.reproductionCooldown;
      }
    }

    // Rebuild spatial hashes after loading
    this.updateSpatialHashes();
  }

  // ============================================================
  // Query helpers (for UI / headless)
  // ============================================================

  getCreatureStates(): CreatureState[] {
    return Array.from(this.creatures.values()).map(c => c.state);
  }

  getFoodStates(): FoodItemState[] {
    return Array.from(this.food.values()).map(f => f.state);
  }

  getObstacleStates(): ObstacleState[] {
    return Array.from(this.obstacles.values()).map(o => o.state);
  }

  getCreatureById(id: number): CreatureState | undefined {
    return this.creatures.get(id)?.state;
  }
}
