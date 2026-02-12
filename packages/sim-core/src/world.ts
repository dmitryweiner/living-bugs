import Matter from 'matter-js';
import { PRNG } from './prng.js';
import { createDefaultDNA, countSensorInputs, countActuatorOutputs, mutateDNA, resetInnovationCounter, getInnovationCounter } from './dna.js';
import { buildBrainRuntime, brainForwardPass, hebbianUpdate, type BrainRuntime } from './brain.js';
import { wrapPosition, torusDistance, circlesOverlap, rayCircleIntersect } from './geometry.js';
import type {
  WorldConfig,
  CreatureState,
  FoodItemState,
  DNA,
  SimEvent,
  TickMetrics,
  WorldSnapshot,
  Vec2,
} from './types.js';

// ============================================================
// Internal creature / food with Matter.js body
// ============================================================

interface CreatureInternal {
  state: CreatureState;
  body: Matter.Body;
  brainRuntime: BrainRuntime;
  lastEnergy: number; // for modulator computation
}

interface FoodInternal {
  state: FoodItemState;
  body: Matter.Body;
}

// Collision categories
const CATEGORY_CREATURE = 0x0001;
const CATEGORY_FOOD = 0x0002;

// ============================================================
// World class
// ============================================================

export class World {
  config: WorldConfig;
  rng: PRNG;
  tick: number = 0;
  nextEntityId: number = 1;

  // Matter.js engine (no gravity, just collision detection)
  engine: Matter.Engine;

  // Entity storage
  creatures: Map<number, CreatureInternal> = new Map();
  food: Map<number, FoodInternal> = new Map();

  // Event log (capped per tick, flushed after reading)
  events: SimEvent[] = [];

  // Metrics for current tick
  private tickBirths = 0;
  private tickDeaths = 0;

  // Brain tick counter
  private brainTickAccumulator = 0;

  constructor(config: WorldConfig) {
    this.config = config;
    this.rng = new PRNG(config.simulation.seed);

    // Create Matter.js engine with zero gravity
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 0, scale: 0 },
    });

    // Disable sleeping for simplicity
    this.engine.enableSleeping = false;
  }

  // ============================================================
  // Initialization
  // ============================================================

  initialize(): void {
    const { initialCreatures } = this.config.simulation;
    const numGroups = 4;

    for (let i = 0; i < initialCreatures; i++) {
      const groupId = i % numGroups;
      const dna = createDefaultDNA(groupId, this.rng);
      const pos: Vec2 = {
        x: this.rng.range(0, this.config.world.width),
        y: this.rng.range(0, this.config.world.height),
      };
      const angle = this.rng.range(0, Math.PI * 2);
      this.spawnCreature(dna, pos, angle, this.config.energy.initialEnergy);
    }

    // Spawn initial food
    for (let i = 0; i < this.config.food.maxCount / 2; i++) {
      this.spawnFood({
        x: this.rng.range(0, this.config.world.width),
        y: this.rng.range(0, this.config.world.height),
      });
    }
  }

  // ============================================================
  // Spawn entities
  // ============================================================

  spawnCreature(dna: DNA, position: Vec2, angle: number, energy: number): number {
    const id = this.nextEntityId++;
    const body = Matter.Bodies.circle(position.x, position.y, dna.body.radius, {
      frictionAir: 0.1,
      restitution: 0.3,
      collisionFilter: {
        category: CATEGORY_CREATURE,
        mask: CATEGORY_CREATURE | CATEGORY_FOOD,
      },
      label: `creature_${id}`,
    });
    Matter.Body.setAngle(body, angle);
    Matter.Composite.add(this.engine.world, body);

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

    this.creatures.set(id, { state, body, brainRuntime, lastEnergy: energy });
    this.events.push({ type: 'creature_born', tick: this.tick, creatureId: id, parentId: null });
    this.tickBirths++;

    return id;
  }

  spawnFood(position: Vec2, nutrition?: number): number {
    const id = this.nextEntityId++;
    const n = nutrition ?? this.config.food.nutritionValue;
    const body = Matter.Bodies.circle(position.x, position.y, this.config.food.radius, {
      isStatic: true,
      collisionFilter: {
        category: CATEGORY_FOOD,
        mask: CATEGORY_CREATURE,
      },
      label: `food_${id}`,
    });
    Matter.Composite.add(this.engine.world, body);

    const state: FoodItemState = { id, position: { ...position }, nutrition: n };
    this.food.set(id, { state, body });
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
    const dropCount = Math.min(
      foodDropMax,
      Math.floor(c.state.energy > 0 ? c.state.energy * foodDropRatio / this.config.food.nutritionValue : c.lastEnergy * foodDropRatio / this.config.food.nutritionValue)
    );
    for (let i = 0; i < Math.max(0, dropCount); i++) {
      const offset: Vec2 = {
        x: c.state.position.x + this.rng.range(-c.state.dna.body.radius * 2, c.state.dna.body.radius * 2),
        y: c.state.position.y + this.rng.range(-c.state.dna.body.radius * 2, c.state.dna.body.radius * 2),
      };
      wrapPosition(offset, this.config.world.width, this.config.world.height);
      this.spawnFood(offset);
    }

    Matter.Composite.remove(this.engine.world, c.body);
    this.creatures.delete(id);
    this.events.push({ type: 'creature_died', tick: this.tick, creatureId: id, cause });
    this.tickDeaths++;
  }

  private removeFood(id: number): void {
    const f = this.food.get(id);
    if (!f) return;
    Matter.Composite.remove(this.engine.world, f.body);
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

      // Apply movement
      const speed = s.velocity;
      const dx = Math.cos(s.angle) * speed;
      const dy = Math.sin(s.angle) * speed;
      Matter.Body.setVelocity(creature.body, { x: dx, y: dy });
      Matter.Body.setAngle(creature.body, s.angle + s.angularVelocity);

      // Energy cost
      const rayCount = s.dna.sensors
        .filter(se => se.type === 'rayVision')
        .reduce((sum, se) => sum + (se.type === 'rayVision' ? se.rayCount : 0), 0);
      const metabolismScale = Math.pow(s.dna.body.radius / cfg.creatureDefaults.radius, 2);
      const cost = cfg.energy.baseMetabolism * metabolismScale
        + cfg.energy.moveCost * Math.abs(speed)
        + cfg.energy.turnCost * Math.abs(s.angularVelocity)
        + cfg.energy.visionCostPerRay * rayCount
        + (s.isBroadcasting ? cfg.energy.broadcastCost : 0);
      s.energy -= cost;

      // Age
      s.age++;

      // Check death
      if (s.energy <= 0) {
        toDie.push({ id, cause: 'starvation' });
        continue;
      }

      // Check reproduction
      if (s.energy >= cfg.reproduction.energyThreshold && s.reproductionCooldown <= 0) {
        if (this.creatures.size < cfg.simulation.maxCreatures) {
          toReproduce.push(id);
        }
      }
    }

    // 4. Physics step (capped at 16.667ms as Matter.js recommends)
    Matter.Engine.update(this.engine, Math.min(16.667, 1000 / this.config.simulation.tickRate));

    // 5. Sync positions from Matter.js back to state
    for (const [, creature] of this.creatures) {
      creature.state.position.x = creature.body.position.x;
      creature.state.position.y = creature.body.position.y;
      creature.state.angle = creature.body.angle;
      wrapPosition(creature.state.position, this.config.world.width, this.config.world.height);
      Matter.Body.setPosition(creature.body, creature.state.position);
    }

    // 6. Handle collisions (eating, attacking, donating)
    this.handleCollisions();

    // 7. Process deaths
    for (const { id, cause } of toDie) {
      this.removeCreature(id, cause);
    }

    // 8. Process reproduction
    for (const parentId of toReproduce) {
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

            // Simple raycasting: check against all nearby entities
            let closestDist = 1.0;
            let hitFood = 0;
            let hitCreature = 0;
            let hitIFF = 0;

            // Check food
            for (const [, food] of this.food) {
              const d = rayCircleIntersect(
                s.position, { x: endX, y: endY },
                food.state.position, this.config.food.radius
              );
              if (d !== null && d < closestDist) {
                closestDist = d;
                hitFood = 1;
                hitCreature = 0;
                hitIFF = 0;
              }
            }

            // Check creatures
            for (const [, other] of this.creatures) {
              if (other.state.id === s.id) continue;
              const d = rayCircleIntersect(
                s.position, { x: endX, y: endY },
                other.state.position, other.state.dna.body.radius
              );
              if (d !== null && d < closestDist) {
                closestDist = d;
                hitFood = 0;
                hitCreature = 1;
                hitIFF = s.dna.hasIFF
                  ? (other.state.dna.groupId === s.dna.groupId ? 1 : -1)
                  : 0;
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

          // Check collisions with food
          for (const [, food] of this.food) {
            if (circlesOverlap(s.position, s.dna.body.radius, food.state.position, this.config.food.radius, this.config.world.width, this.config.world.height)) {
              touchFood = 1;
              break;
            }
          }

          // Check collisions with creatures
          for (const [, other] of this.creatures) {
            if (other.state.id === s.id) continue;
            if (circlesOverlap(s.position, s.dna.body.radius, other.state.position, other.state.dna.body.radius, this.config.world.width, this.config.world.height)) {
              touchCreature = 1;
              touchIFF = s.dna.hasIFF
                ? (other.state.dna.groupId === s.dna.groupId ? 1 : -1)
                : 0;
              break;
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
          for (const ch of sensor.channels) {
            let bestStrength = 0;
            let bestDirection = 0;

            for (const [, other] of this.creatures) {
              if (other.state.id === s.id) continue;
              if (!other.state.isBroadcasting) continue;
              if (other.state.broadcastChannel !== ch) continue;

              const dist = torusDistance(s.position, other.state.position, this.config.world.width, this.config.world.height);
              if (dist > this.config.broadcast.broadcastRadius) continue;

              const strength = 1 - dist / this.config.broadcast.broadcastRadius;
              if (strength > bestStrength) {
                bestStrength = strength;
                const dx = other.state.position.x - s.position.x;
                const dy = other.state.position.y - s.position.y;
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

    for (const [, creature] of this.creatures) {
      const s = creature.state;

      // Eating
      if (s.isEating) {
        for (const [foodId, food] of this.food) {
          if (circlesOverlap(s.position, s.dna.body.radius, food.state.position, cfg.food.radius, cfg.world.width, cfg.world.height)) {
            s.energy = Math.min(cfg.energy.maxEnergy, s.energy + food.state.nutrition);
            foodToRemove.push(foodId);
            this.events.push({
              type: 'creature_ate', tick: this.tick,
              creatureId: s.id, foodId, energyGained: food.state.nutrition,
            });
            break; // One food per tick
          }
        }
      }

      // Attacking
      if (s.isAttacking && s.attackCooldown <= 0) {
        s.energy -= cfg.energy.attackCost;
        s.attackCooldown = cfg.combat.attackCooldown;

        for (const [, target] of this.creatures) {
          if (target.state.id === s.id) continue;
          const dist = torusDistance(s.position, target.state.position, cfg.world.width, cfg.world.height);
          if (dist <= cfg.combat.attackRadius) {
            // IFF check
            if (s.dna.hasIFF && target.state.dna.groupId === s.dna.groupId) continue;
            target.state.energy -= cfg.combat.baseDamage;
            this.events.push({
              type: 'creature_attacked', tick: this.tick,
              attackerId: s.id, targetId: target.state.id, damage: cfg.combat.baseDamage,
            });
            if (target.state.energy <= 0) {
              this.removeCreature(target.state.id, 'killed');
            }
          }
        }
      }

      // Donating
      if (s.isDonating && s.dna.hasIFF) {
        let bestDist = cfg.donation.donateRadius;
        let bestTarget: CreatureInternal | null = null;

        for (const [, other] of this.creatures) {
          if (other.state.id === s.id) continue;
          if (other.state.dna.groupId !== s.dna.groupId) continue;
          const dist = torusDistance(s.position, other.state.position, cfg.world.width, cfg.world.height);
          if (dist < bestDist) {
            bestDist = dist;
            bestTarget = other;
          }
        }

        s.energy -= cfg.donation.donateCost;
        if (bestTarget) {
          bestTarget.state.energy = Math.min(
            cfg.energy.maxEnergy,
            bestTarget.state.energy + cfg.donation.donateAmount
          );
          s.energy -= cfg.donation.donateAmount;
          this.events.push({
            type: 'creature_donated', tick: this.tick,
            donorId: s.id, recipientId: bestTarget.state.id, amount: cfg.donation.donateAmount,
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
      this.spawnFood({
        x: this.rng.range(0, cfg.world.width),
        y: this.rng.range(0, cfg.world.height),
      });
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

    return {
      tick: this.tick,
      creatures,
      food,
      config: this.config,
      prngState: this.rng.getState(),
      nextEntityId: this.nextEntityId,
      innovationCounter: getInnovationCounter(),
    };
  }

  loadSnapshot(snapshot: WorldSnapshot): void {
    // Clear existing world
    Matter.Composite.clear(this.engine.world, false);
    this.creatures.clear();
    this.food.clear();

    this.config = snapshot.config;
    this.tick = snapshot.tick;
    this.nextEntityId = snapshot.nextEntityId;
    this.rng.setState(snapshot.prngState);
    resetInnovationCounter(snapshot.innovationCounter);

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

  getCreatureById(id: number): CreatureState | undefined {
    return this.creatures.get(id)?.state;
  }
}
