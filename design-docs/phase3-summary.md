# Phase 3 Summary — Evolution Quality, Performance & Polish

## Overview

Phase 3 adds NEAT crossover (sexual reproduction), matures the training pipeline with generational mode and DSL expressions, fills testing gaps (spatial hash), introduces brain graph visualization, and polishes the web UX with species-colored rendering, runtime weight persistence, and a Hall of Fame browser tab.

**Total new tests:** 33 (from 246 to 279)
**All 279 tests pass, all 3 projects type-check clean.**

---

## 3A — NEAT Crossover (Sexual Reproduction)

### What was built

Full NEAT crossover implementation enabling sexual reproduction between compatible creatures.

### New/modified files

**`packages/sim-core/src/dna.ts`** — Added two new functions:
- `crossoverBrain(brain1, brain2, fitness1, fitness2, rng)` — NEAT crossover of brain genomes:
  - Aligns connection genes by innovation number
  - Matching genes: randomly inherited from either parent (60% bias toward fitter)
  - Disjoint/excess genes: from fitter parent only (or both if equal fitness)
  - Disabled genes: 75% chance of staying disabled if either parent has them disabled
  - Node genes: union of all nodes referenced by selected connections
  - Plasticity rate: 50/50 from either parent
- `crossoverDNA(dna1, dna2, fitness1, fitness2, rng)` — Full DNA crossover:
  - Body radius: average of both parents (clamped to [3, 10])
  - Group ID, IFF: from fitter parent (80% probability)
  - Sensors: union with deduplication by type, random selection of overlapping versions
  - Actuators: union with deduplication
  - Brain: NEAT crossover via `crossoverBrain`
  - Always ensures `energySense` and `move` are present
  - Reconciles brain I/O after crossover

**`packages/sim-core/src/types.ts`** — Added:
- `crossoverRate: number` to `WorldConfig.reproduction`
- `runtimeWeights?: number[]` to `CreatureState` (for snapshot persistence)

**`packages/sim-core/src/world.ts`** — Modified `reproduce()`:
- With probability `crossoverRate`, searches for a nearby compatible mate (same group, minimum energy)
- If mate found: both parents contribute energy, crossover + mutation
- If no mate found: falls back to asexual reproduction
- Mate search uses spatial hash (`creatureHash.queryRadius`)

**`packages/sim-core/src/index.ts`** — Exported `crossoverBrain`, `crossoverDNA`, `exportWeights`, `importWeights`

**`configs/world-config.json`** — Added `"crossoverRate": 0.7` to reproduction section

### Tests added

11 new tests in `dna.test.ts`:
- `crossoverBrain`: valid genome, disjoint gene inheritance, equal fitness handling, disabled gene probability, connection-node integrity
- `crossoverDNA`: brain I/O reconciliation, body radius averaging, group ID inheritance, invariant preservation (energySense, move), JSON serialization, crossover + mutation stability over 50 iterations

---

## 3B — Training Pipeline Maturity

### What was changed

**`package.json`** — Training scripts switched from continuous to generational mode:
- `yarn train` → 100 generations, 1000 ticks/gen, with `--seed` bootstrap
- `yarn train:short` → 20 generations, 500 ticks/gen
- `yarn train:long` → 500 generations, 2000 ticks/gen
- All scripts use `--seed configs/seed-genotypes.json` for bootstrapping from previous runs

**`apps/headless/src/run.ts`** — Integrated crossover into `runGenerational()`:
- Offspring are created via crossover (with config's `crossoverRate`) between top performers
- Mate selection prefers same-species partners (using speciation data)
- Falls back to different-species top creature if no same-species mate available
- Mutation applied after crossover

**`configs/world-config.json`** — Added DSL expressions for formula-driven balancing:
- `moveCost`: `0.02 * (creature.radius / 5)^2` — larger creatures pay quadratically more to move
- `attackCost`: `2.0 * (creature.radius / 5)` — larger creatures' attacks cost more
- `combat.baseDamage`: `15 * (creature.radius / 5)` — larger creatures deal more damage

---

## 3C — Spatial Hash Tests

### New file

**`packages/sim-core/src/spatial-hash.test.ts`** — 22 tests covering:
- `insert` / `clear`: entity placement, multi-entity per cell, clearing
- `queryRadius`: neighbor retrieval, torus wrapping (left/right edges, top/bottom edges, corner wrapping), zero radius, viewport-sized queries
- `queryRay`: horizontal, vertical, diagonal rays, margin expansion, no duplicates
- Edge cases: world boundary coordinates, negative coordinates, coordinates exceeding bounds, very large query radius, very small worlds, single-cell grids

---

## 3D — Brain Graph Visualization

### New file

**`apps/web/src/brain-graph.ts`** — Canvas 2D neural network topology viewer:
- **Layout algorithm**: Input nodes (left column), hidden nodes (middle, layered by BFS depth from inputs), output nodes (right column)
- **Nodes**: Circles colored by type (input=blue, hidden=gray, output=red), activation function abbreviation label
- **Connections**: Bezier curves; thickness proportional to |weight|; green=positive, red=negative; dashed if disabled; alpha scales with weight magnitude
- **Legend**: Node/connection counts at bottom of canvas
- **Integration**: "Brain" button per genotype entry in the browser; toggles canvas display

### Modified files

- **`apps/web/src/genotype-browser.ts`** — Added brain canvas element and "Brain" toggle button per genotype
- **`apps/web/index.html`** — Added CSS for `.brain-graph-canvas`

---

## 3E — Web Polish

### Runtime Weights in Snapshots

**`packages/sim-core/src/brain.ts`** — Added:
- `exportWeights(rt)` — export runtime `connWeight` array as `number[]`
- `importWeights(rt, weights)` — restore runtime weights from saved array

**`packages/sim-core/src/world.ts`** — Modified:
- `getSnapshot()` — includes `runtimeWeights` from each creature's brain runtime
- `loadSnapshot()` — restores Hebbian-modified weights via `importWeights`

This means Hebbian learning progress is now preserved across save/load cycles and browser tab closes.

### Species-Colored Rendering

**`apps/web/src/renderer.ts`** — In rich mode, creatures now receive a DNA-hash-based tint:
- `dnaHueHash(creature)` — hashes brain node count, connection count, sensor count, actuator count, and body radius to a hue value (0..360)
- `hslToHex(h, s, l)` — converts HSL to RGB hex
- Result: genetically similar creatures appear similar colors; different species are visually distinguishable

### Hall of Fame in Genotype Browser

**`apps/web/src/genotype-browser.ts`** — Added:
- Tab bar with 4 tabs: All, Seed, Current, Hall of Fame
- `setHallOfFame(genotypes)` method to populate HoF entries
- HoF entries loaded automatically from `seed-genotypes.json` (which contains fitness data from training)
- Tab filtering in render loop using `activeTab` state

**`apps/web/src/main.ts`** — Wired up:
- Seed genotype fitness data extracted and passed to `genotypeBrowser.setHallOfFame()`

**`apps/web/src/config-editor.ts`** — Added crossover rate slider to Reproduction category

**`apps/web/index.html`** — Added CSS for `.genotype-tabs`, `.genotype-tab`

---

## File Summary

### New files (2)

| File | Lines | Purpose |
|------|-------|---------|
| `packages/sim-core/src/spatial-hash.test.ts` | ~190 | 22 tests for spatial hash |
| `apps/web/src/brain-graph.ts` | ~250 | Neural network topology viewer |

### Modified files (12)

| File | Changes |
|------|---------|
| `packages/sim-core/src/types.ts` | Added `crossoverRate` to reproduction config, `runtimeWeights` to CreatureState |
| `packages/sim-core/src/dna.ts` | Added `crossoverBrain()`, `crossoverDNA()` (~130 lines) |
| `packages/sim-core/src/brain.ts` | Added `exportWeights()`, `importWeights()` |
| `packages/sim-core/src/world.ts` | Sexual reproduction in `reproduce()`, runtime weights in snapshot save/load |
| `packages/sim-core/src/index.ts` | Exported crossover and weight functions |
| `packages/sim-core/src/dna.test.ts` | 11 new crossover tests |
| `packages/sim-core/src/world.test.ts` | Added `crossoverRate: 0` to test config |
| `apps/headless/src/run.ts` | Crossover integration in `runGenerational()` |
| `apps/headless/src/run.test.ts` | Added `crossoverRate: 0` to test config |
| `apps/web/src/renderer.ts` | Species-colored rendering (DNA hash tint) |
| `apps/web/src/genotype-browser.ts` | Brain graph button, tab bar, Hall of Fame tab |
| `apps/web/src/config-editor.ts` | Crossover rate slider |
| `apps/web/src/main.ts` | HoF data wiring |
| `apps/web/index.html` | CSS for tabs, brain graph canvas |
| `configs/world-config.json` | `crossoverRate`, DSL expressions for moveCost/attackCost/baseDamage |
| `package.json` | Training scripts switched to generational mode with `--seed` |

---

## Testing

| Module | File | Tests | What's covered |
|--------|------|-------|----------------|
| PRNG | `prng.test.ts` | 15 | Determinism, range, distribution, state save/restore |
| Geometry | `geometry.test.ts` | 23 | Torus wrapping, distance, circle overlap, ray-circle intersection |
| DNA | `dna.test.ts` | 40 | I/O counting, brain creation, default DNA, mutation invariants, **crossover brain/DNA** |
| Brain | `brain.test.ts` | 17 | Build runtime, forward pass, Hebbian plasticity |
| World | `world.test.ts` | 39 | Init, spawn, step, metabolism, starvation, eating, reproduction, combat+IFF, food, metrics, snapshot, determinism |
| Spatial Hash | `spatial-hash.test.ts` | 22 | **Insert, clear, queryRadius, queryRay, torus wrapping, edge cases** |
| Expression | `expr.test.ts` | 62 | All operators, nesting, error handling, compile/eval equivalence |
| Speciation | `speciation.test.ts` | 23 | Compatibility distance, species assignment, adjusted fitness, stagnation |
| Hall of Fame | `hall-of-fame.test.ts` | 12 | Update, merge, eviction, serialization |
| Headless | `run.test.ts` | 26 | CLI arg parsing, simulation run, early stop, genotype ranking, generational mode |

**Total: 279 tests**, all passing.

---

## What's Next

Potential future work:
- NEAT speciation in the web app for live species tracking
- Batch brain evaluation for same-topology creatures (performance)
- Lamarckian inheritance option (runtime weights passed to offspring)
- Network visualization in the creature inspector (not just genotype browser)
- Sexual selection pressures (mate choice based on fitness signals)
- Multi-objective fitness (survival, reproduction count, energy efficiency)
- Replay system for recording and reviewing evolution history
