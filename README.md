# Living Bugs

A browser-based artificial life simulation where creatures with neural-network brains evolve, compete, and cooperate in a 2D torus world.

## What is this?

Creatures are autonomous agents driven by NEAT neural networks encoded in their DNA. They gather food, attack enemies, donate resources to allies, and reproduce — both asexually (mutation only) and sexually (NEAT crossover). Over time, natural selection shapes increasingly complex behaviors — all emergent, with no hand-coded AI.

**Key features:**

- **Configurable world** — all rules (energy costs, combat damage, reproduction thresholds, food spawning) are defined in a single JSON config with support for DSL expressions (formulas), not in code
- **DNA & NEAT brains** — creatures have sensors (ray vision, touch, energy sense, broadcast receiver) and actuators (move, eat, attack, donate, broadcast) wired through an evolving neural network
- **NEAT crossover** — sexual reproduction aligns connection genes by innovation number; matching genes inherit from either parent, disjoint/excess from the fitter parent
- **Hebbian plasticity** — brain weights adapt during a creature's lifetime based on energy feedback; Hebbian-modified weights persist across save/load
- **Friend-or-foe (IFF)** — creatures can recognize group members and cooperate via resource donation and broadcast signaling
- **Deterministic simulation** — seeded PRNG ensures reproducibility across browser and headless runs
- **Generational training** — run NEAT speciation with crossover from the command line, then import evolved genotypes into the browser
- **Brain visualization** — inspect neural network topology of any genotype in the browser

## Project Structure

```
packages/sim-core/   # Simulation engine (pure TypeScript, no DOM dependencies)
apps/web/            # Browser app (Pixi.js v7, Vite)
apps/headless/       # CLI runner for batch evolution
configs/             # World configuration (JSON) + seed genotypes
design-docs/         # Design documents (world config, DNA format, brain format, phase summaries)
docs/                # Built web app (GitHub Pages)
```

## Quick Start

```bash
# Prerequisites: Node.js 22+
yarn install

# Run the browser sandbox
yarn dev:web          # -> http://localhost:3000

# Run tests
yarn test
```

## Commands

| Command | Description |
|---------|-------------|
| `yarn dev:web` | Start Vite dev server for the browser app |
| `yarn build:web` | Production build -> `docs/` (GitHub Pages) |
| `yarn build:core` | Build the simulation engine |
| `yarn test` | Run all unit tests (Vitest, 279 tests) |
| `yarn test:watch` | Tests in watch mode |
| `yarn typecheck` | Type-check the entire monorepo |

### Training Pipeline

| Command | Description |
|---------|-------------|
| `yarn train` | Generational training: 100 gen x 1000 ticks, export best to `configs/seed-genotypes.json` |
| `yarn train:short` | Quick training: 20 gen x 500 ticks |
| `yarn train:long` | Deep training: 500 gen x 2000 ticks |
| `yarn pipeline` | Full pipeline: train -> build:core -> build:web |
| `yarn pipeline:short` | Short pipeline: train:short -> build |

All training commands use `--seed configs/seed-genotypes.json` to bootstrap from previous runs. Delete `configs/seed-genotypes.json` to start from scratch.

## Browser Controls

- **Pan**: Drag or middle-click drag
- **Zoom**: Scroll wheel (desktop), pinch (mobile)
- **Inspect & follow**: Click a creature to select it — the camera enters follow mode and a floating inspector shows its DNA, brain, energy, and actions
- **Sandbox tools** (collapsible): Place food, place creatures, save/load world, import genotypes, config editor, genotype browser, analytics, minimap
- **Genotype browser**: Browse seed genotypes, current top creatures, and Hall of Fame; click "Brain" to visualize neural network topology; click "Spawn" to place a creature
- **Speed**: Pause, 0.1x, 1x, 10x

## Key Numbers

| Metric | Value |
|--------|-------|
| Default world size | 2000 x 2000 |
| Default initial creatures | 50 |
| Comfortable creature count | ~500 (browser), ~300 (headless training) |
| Default brain | ~18 input nodes, 3 output nodes, fully connected |
| DNA default sensors | rayVision (3 rays), touch, energySense |
| DNA default actuators | move, eat |
| Crossover rate | 0.7 (70% sexual reproduction when mate available) |

## Design Documents

- [World Config](design-docs/world-config.md) — all simulation parameters
- [DNA Format](design-docs/dna-format.md) — genome structure, sensors, actuators, mutation rules
- [Brain Format](design-docs/brain-format.md) — NEAT genome, forward pass, Hebbian plasticity
- [Phase 1 Summary](design-docs/phase1-summary.md) — monorepo scaffold, physics, DNA, brain, web sandbox
- [Phase 2 Summary](design-docs/phase2-summary.md) — DSL expressions, speciation, generational training, browser UX
- [Phase 3 Summary](design-docs/phase3-summary.md) — NEAT crossover, training pipeline, brain visualization, web polish

## License

Private project.
