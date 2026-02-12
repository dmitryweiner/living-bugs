# Phase 2 Summary — DSL Config, Evolution Pipeline, Browser UX

## Overview

Phase 2 implements the remaining stages from the project plan: **Stage C** (expression language for configurable world rules), **Stage F** (NEAT speciation, generational training, hall of fame), and **Stage G** (browser UX improvements including batch rendering, config editor, analytics, minimap, and genotype browser).

**Total new tests:** 44 (from 194 → 238)  
**All 238 tests pass, all 3 projects type-check clean.**

---

## Stage C — DSL Config: Expression Language

### What was built

A JSON-based expression AST that allows world config values to be formulas instead of flat numbers. For example, `moveCost` can be `0.02` (backward compatible) or a formula like `0.02 * (creature.radius / 5)^2`.

### New files

- **`packages/sim-core/src/expr.ts`** — Core expression module:
  - `Expr` discriminated union with 15 node types: `lit`, `var`, `add`, `sub`, `mul`, `div`, `min`, `max`, `clamp`, `lt`/`gt`/`lte`/`gte`/`eq`, `if`, `abs`/`neg`/`floor`/`ceil`/`sqrt`, `pow`
  - `evalExpr(expr, ctx)` — recursive evaluator
  - `compileExpr(expr)` — closure-tree JIT (no `eval`/`Function`)
  - `resolveConfigValue(value, ctx)` — convenience: returns number as-is, evaluates Expr
  - `isExpr()` type guard
  - `ConfigValue = number | Expr` type alias
  - `ExprContext = Record<string, number>` for evaluation variables

- **`packages/sim-core/src/expr.test.ts`** — 62 tests covering all operators, nesting, error handling, and compile/eval equivalence

### Modified files

- **`packages/sim-core/src/types.ts`** — `WorldConfig` fields that benefit from expressions now accept `ConfigValue`:
  - `energy.baseMetabolism`, `energy.moveCost`, `energy.turnCost`, `energy.attackCost`, `energy.visionCostPerRay`, `energy.broadcastCost`
  - `food.nutritionValue`
  - `combat.baseDamage`
  - `reproduction.energyThreshold`
  - `donation.donateAmount`, `donation.donateCost`

- **`packages/sim-core/src/world.ts`** — All reads of expression-enabled config fields go through `resolveConfigValue()` with a creature context (`creature.radius`, `creature.energy`, `creature.age`, `creature.speed`, etc.)

- **`packages/sim-core/src/index.ts`** — Exports expression module

### Backward compatibility

Plain numbers still work everywhere. Existing `world-config.json` files require zero changes. The expression system is opt-in per field.

---

## Stage F — Evolution Pipeline

### F1: NEAT Speciation

**New file: `packages/sim-core/src/speciation.ts`** (+ 23 tests)

- `compatibilityDistance(brain1, brain2, c1, c2, c3)` — NEAT distance using excess genes, disjoint genes, and average weight difference of matching connection genes (by innovation number)
- `dnaCompatibilityDistance(dna1, dna2, config)` — convenience wrapper
- `assignSpecies(creatures, existingSpecies, config)` — assigns each creature to the nearest species (by representative distance) or creates a new one
- `adjustedFitness(rawFitness, speciesSize)` — fitness sharing (divide by species size)
- `computeAdjustedFitness(creatures, species)` — batch computation
- `updateSpeciesStagnation(species, creatures, config)` — tracks best fitness per species, increments stagnation counter, culls stagnant species (always keeps at least one)
- `SpeciationConfig` with defaults: `distanceThreshold=3.0`, `c1=1.0`, `c2=1.0`, `c3=0.4`, `stagnationLimit=15`

### F2: Generational Training Mode

**Modified: `apps/headless/src/run.ts`** and **`apps/headless/src/main.ts`** (+ 5 tests)

New CLI flags:
- `--mode continuous|generational` (default: `continuous` for backward compat)
- `--gen-ticks N` — ticks per generation (default: 1000)
- `--generations N` — number of generations (default: 50)

Generational mode workflow:
1. Create fresh world, initialize with current genotypes
2. Run for `genTicks` ticks
3. Evaluate fitness (`age × energy/maxEnergy`) for all survivors
4. Run speciation, compute adjusted fitness
5. Select top 30% by adjusted fitness
6. Clone with mutation to fill population back to `initialCreatures`
7. Update Hall of Fame
8. Repeat for N generations

Per-generation logging: generation number, species count, population, best/avg/worst fitness, elapsed time.

Recovery: if all creatures die in a generation, the previous genotypes are reused with higher mutation.

### F3: Hall of Fame

**New file: `packages/sim-core/src/hall-of-fame.ts`** (+ 12 tests)

- `HallOfFame` class: bounded list (default 50) of the best genotypes ever observed
- `update(candidates)` — merges new candidates, keeps top-K by fitness
- `getBest()`, `getTopK(k)`, `getDNAs(count)` — accessors
- `toJSON()` / `fromJSON()` — serialization for checkpointing
- Integrated into `runGenerational()` — every generation's creatures are candidates
- Exported alongside current-generation best in `main.ts`

---

## Stage G — Browser UX Polish

### G1: Batch Rendering

**Modified: `apps/web/src/renderer.ts`**

Dual-mode rendering with automatic switching:
- **Rich mode** (< 3,000 entities): Individual emoji sprites per creature/food, with energy bars and direction ticks for all visible creatures
- **Fast mode** (≥ 3,000 entities): `PIXI.ParticleContainer` with pre-allocated colored circle sprites, tinted by group color. Supports 100k+ sprites with minimal overhead.

Performance optimizations:
- Viewport culling: only draw overlays for creatures in the visible area
- Overlay cap: maximum 500 energy bars per frame
- Sensor rays: only drawn for the selected creature
- Sprite pool: pre-allocated and recycled (no per-frame allocation)

New public methods: `getViewportBounds()`, `centerOn(worldX, worldY)`

### G2: Config Editor Panel

**New file: `apps/web/src/config-editor.ts`**

Collapsible side panel with live config editing:
- **6 categories**: Energy, Food, Combat, Reproduction, Broadcast, Simulation
- Each field has a **slider** + **number input** with min/max/step
- **Live update**: changing a value immediately modifies `world.config` (takes effect next tick)
- **Expression-aware**: fields with Expr values show as disabled "(expr)"
- **Reset to defaults** button restores original config
- Toggle via "Config" button in sandbox toolbar

### G3: Population Analytics

**New file: `apps/web/src/analytics.ts`**

Canvas 2D line chart with sliding window:
- Collects samples every 5 ticks (configurable)
- Sliding window of 300 data points
- Three line series: **creature count** (blue), **food count** (green), **average energy** (orange)
- Y-axis labels, grid lines, color-coded legend
- Redraws every 10 frames for performance
- Toggle via "Analytics" button in sandbox toolbar

### G4: Minimap

**New file: `apps/web/src/minimap.ts`**

180×180 canvas overlay in bottom-right corner:
- Shows **entire world** at a glance
- **Colored dots** for creatures (by group color)
- **Green dots** for food
- **Viewport rectangle** shows current camera view
- **Click to jump**: clicking the minimap centers the camera on that world position
- Toggle via "Minimap" button in sandbox toolbar

### G5: Genotype Browser

**New file: `apps/web/src/genotype-browser.ts`**

Panel for browsing and spawning genotypes:
- Lists **seed genotypes** (from training) and **current top-10 creatures** (by fitness)
- Each entry shows: source tag, fitness, group, body radius, sensor/actuator count, brain complexity (nodes/connections)
- **Spawn button**: places a creature with that DNA at a random position
- **Compare mode**: select two genotypes for side-by-side diff showing:
  - NEAT compatibility distance
  - All DNA properties compared (group, radius, IFF, sensors, actuators, brain nodes/connections, inputs/outputs, plasticity rate, fitness)
- Toggle via "Genotypes" button in sandbox toolbar

### HTML/CSS Changes

**Modified: `apps/web/index.html`**

- Added CSS for config editor, analytics panel, minimap container, and genotype browser
- Added 3 new toolbar buttons: Config, Analytics, Minimap, Genotypes
- Added `<canvas>` elements for analytics and minimap
- Maintained backward-compatible layout

---

## Infrastructure Changes

| Change | File | Reason |
|--------|------|--------|
| Added `"type": "module"` | `package.json` (root) | Fix vitest 4 + vite 7 ESM compatibility |
| Installed `@types/node` | `package.json` (root devDeps) | Fix headless app type-checking |
| Added `"types": ["node"]` | `apps/headless/tsconfig.json` | Enable Node.js type declarations |
| Built sim-core dist | `packages/sim-core/dist/` | Updated dist with new exports for project references |

---

## File Summary

### New files (8)

| File | Lines | Purpose |
|------|-------|---------|
| `packages/sim-core/src/expr.ts` | ~260 | Expression AST + evaluators |
| `packages/sim-core/src/expr.test.ts` | ~225 | 62 tests for expressions |
| `packages/sim-core/src/speciation.ts` | ~230 | NEAT speciation engine |
| `packages/sim-core/src/speciation.test.ts` | ~250 | 23 tests for speciation |
| `packages/sim-core/src/hall-of-fame.ts` | ~100 | Hall of Fame tracker |
| `packages/sim-core/src/hall-of-fame.test.ts` | ~100 | 12 tests for Hall of Fame |
| `apps/web/src/config-editor.ts` | ~220 | Config editor UI panel |
| `apps/web/src/analytics.ts` | ~150 | Population analytics chart |
| `apps/web/src/minimap.ts` | ~90 | World minimap overlay |
| `apps/web/src/genotype-browser.ts` | ~250 | Genotype browser panel |

### Modified files (8)

| File | Changes |
|------|---------|
| `packages/sim-core/src/types.ts` | Added `ConfigValue` import, changed 11 WorldConfig fields to `ConfigValue` |
| `packages/sim-core/src/world.ts` | Added `resolveConfigValue()` calls, creature context builder |
| `packages/sim-core/src/index.ts` | Added exports for expr, speciation, hall-of-fame |
| `apps/headless/src/run.ts` | Added generational mode, speciation imports, Hall of Fame integration |
| `apps/headless/src/run.test.ts` | Added tests for new CLI args and generational mode |
| `apps/headless/src/main.ts` | Added generational mode branch, help text |
| `apps/web/src/renderer.ts` | Dual-mode rendering, viewport culling, ParticleContainer |
| `apps/web/src/main.ts` | Integrated config editor, analytics, minimap, genotype browser |
| `apps/web/index.html` | New UI panels, styles, toolbar buttons |

---

## What's Next

With Phase 2 complete, the simulation engine has:
- Configurable rules via JSON expressions
- Proper NEAT speciation with fitness sharing
- Generational training with hall of fame
- A performant renderer scaling to 10k+ creatures
- A full sandbox UI with config editing, analytics, minimap, and genotype browsing

Potential future work:
- DSL expressions in `world-config.json` for formula-driven balancing
- Longer generational training runs to produce stronger seed genotypes
- Network visualization (brain graph) in the genotype browser
- Species-colored rendering in rich mode
- Export/import of Hall of Fame data in the web app
