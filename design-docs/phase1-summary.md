# Phase 1 — Summary

## What was done

Phase 1 implemented the full vertical slice of the Living Bugs simulation:
from a monorepo scaffold to a working browser sandbox with evolving creatures.

---

## Deliverables

### Design documents

| Document | Path | Description |
|----------|------|-------------|
| World Config | `design-docs/world-config.md` | All `WorldConfig` parameters: world geometry, energy economy, food spawning, combat, reproduction, death, donation, broadcast. Full JSON example with defaults. |
| DNA Format | `design-docs/dna-format.md` | Genome structure: body genes, 4 sensor types (rayVision, touch, energySense, broadcastReceiver), 5 actuator types (move, attack, eat, donate, broadcast), mutation rules, I/O counting for the neural net. |
| Brain Format | `design-docs/brain-format.md` | NEAT genome: nodeGenes, connectionGenes with innovation numbers, forward pass with topological sort, Hebbian plasticity rule, 6 mutation operators, brain I/O reconciliation when DNA changes. |

### Code

**Monorepo structure:**

```
living-bugs/
  packages/sim-core/   # Simulation engine (pure TS, no DOM)
  apps/web/            # Pixi.js browser app
  apps/headless/       # Node.js CLI runner
  configs/             # world-config.json
  design-docs/         # Design documents
  docs/                # Built web app (GitHub Pages)
```

**`packages/sim-core`** — simulation engine:

- `types.ts` — full TypeScript type system (WorldConfig, DNA, BrainGenome, CreatureState, FoodItemState, WorldSnapshot, SimEvent, TickMetrics)
- `prng.ts` — seeded xoshiro128** PRNG with state serialization
- `dna.ts` — DNA creation from defaults, full mutation pipeline (parameter jitter, structural add/remove sensors & actuators), NEAT brain mutations (weight jitter, add connection, add node, toggle, activation change), brain I/O reconciliation after structural DNA changes
- `brain.ts` — brain runtime: Float32Array-based storage, topological sort, forward pass, Hebbian plasticity updates
- `world.ts` — full World engine:
  - Matter.js integration (zero-gravity, circle bodies, collision detection)
  - Torus world (wrap-around at boundaries)
  - Food spawning (configurable rate, max count)
  - Energy metabolism (base + movement + vision + broadcast costs; scales with body size)
  - Collision-based eating (requires `eat` actuator activation)
  - Area-of-effect attacks with IFF (friend-or-foe) filtering
  - Resource donation between group members
  - Broadcast signalling across channels
  - Asexual reproduction at energy threshold with DNA mutation
  - Death with food drop from corpse
  - Brain forward pass at configurable rate (brain rate < tick rate)
  - Full snapshot save/load for state persistence

**`apps/headless`** — console evolution runner:

- CLI with `--ticks`, `--log-interval`, `--export`, `--top-k` options
- Formatted metric logging per interval
- Top-K genotype export to JSON

**`apps/web`** — browser sandbox:

- Pixi.js v7 rendering (WebGL)
- Camera: pan (shift+drag / middle-click), zoom (scroll wheel)
- HUD: live tick, creature count, food count, avg energy, avg age
- Creature inspector: click to select; shows DNA, sensors, actuators, brain stats, energy, current actions
- Sandbox tools: Place Food, Place Creature, Save World, Load World, Import Genotypes
- Speed controls: Pause, 1x / 3x / 10x
- Autosave: IndexedDB on visibility change, localStorage emergency save on beforeunload
- Group color coding (8 distinct colors)

---

## Architecture

```
                  world-config.json
                        │
                        ▼
               ┌─────────────────┐
               │    sim-core     │
               │  World, Entity, │
               │  DNA, Brain,    │
               │  PRNG, Physics  │
               └───────┬─────────┘
                ┌──────┴──────┐
                ▼             ▼
         ┌───────────┐ ┌───────────┐
         │  apps/web  │ │ apps/     │
         │  Pixi.js   │ │ headless  │
         │  Sandbox   │ │ CLI       │
         └───────────┘ └─────┬─────┘
                             │
                             ▼
                    best_genotypes.json
                             │
                             ▼
                       apps/web (import)
```

The same `sim-core` module runs identically in both browser and Node.js,
ensuring deterministic simulation (given the same PRNG seed and config).

---

## How to run

```bash
# Prerequisites
fnm use 22           # Node.js 22 (or any >= 18)
npm install          # Install all workspace dependencies

# Development
npm run dev:web      # Web app at http://localhost:3000
npm run build:web    # Build web app to /docs for GitHub Pages

# Tests
npm test             # Run all unit tests (vitest)
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run with coverage report

# Headless simulation
npx tsx apps/headless/src/main.ts                          # Default: 3000 ticks
npx tsx apps/headless/src/main.ts --ticks 10000            # Custom tick count
npx tsx apps/headless/src/main.ts --export best.json       # Export top genotypes
```

---

## Key numbers

| Metric | Value |
|--------|-------|
| Default world size | 800 x 800 |
| Default initial creatures | 100 |
| Comfortable creature count | ~500-2000 (browser), ~3000+ (headless) |
| Headless throughput | ~300 ticks in 1.4s with 200 creatures |
| DNA default sensors | rayVision (3 rays), touch, energySense |
| DNA default actuators | move, eat |
| Default brain | fully connected input→output, ~18 connections |

---

## Testing

The project uses **Vitest** for unit tests. Tests cover:

| Module | File | Tests | What's covered |
|--------|------|-------|----------------|
| PRNG | `packages/sim-core/src/prng.test.ts` | 15 | Determinism, range, distribution, state save/restore |
| Geometry | `packages/sim-core/src/geometry.test.ts` | 23 | Torus wrapping, distance, circle overlap, ray-circle intersection |
| DNA | `packages/sim-core/src/dna.test.ts` | 29 | I/O counting, brain creation, default DNA, mutation invariants |
| Brain | `packages/sim-core/src/brain.test.ts` | 17 | Build runtime, forward pass (linear, relu, sigmoid, tanh, step, hidden layers), Hebbian plasticity |
| World | `packages/sim-core/src/world.test.ts` | 31 | Init, spawn, step, metabolism, starvation, eating, reproduction, combat+IFF, food spawning, metrics, snapshot, determinism |
| Headless | `apps/headless/src/run.test.ts` | 12 | CLI arg parsing, simulation run, early stop, genotype ranking |

**Total: 127 tests**, all passing.

### Testing guidelines

- Every new module **must** have a corresponding `*.test.ts` file
- Tests should cover: happy path, edge cases, and invariant preservation
- Simulation tests should use a minimal `testConfig()` (small world, few creatures) for speed
- Use `resetInnovationCounter()` in `beforeEach` when testing DNA/brain creation
- Prefer pure-function extraction for testability (e.g. geometry helpers, arg parsing)
- Run `npm test` before merging any changes

---

## What's next

- Performance optimization for larger populations (spatial hash for sensor queries, batch brain evaluation)
- NEAT speciation (distance metric, fitness sharing) for diversity preservation
- Richer UI: config editor panel with sliders, graph of population over time, minimap
- Genotype browser: inspect and compare exported genotypes
- More sensor/actuator types as evolution demands
