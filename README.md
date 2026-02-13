# Living Bugs

A browser-based artificial life simulation where creatures with neural-network brains evolve, compete, and cooperate in a 2D torus world.

## What is this?

Creatures are autonomous agents driven by NEAT neural networks encoded in their DNA. They gather food, attack enemies, donate resources to allies, and reproduce asexually with mutation. Over time, natural selection shapes increasingly complex behaviors — all emergent, with no hand-coded AI.

**Key features:**

- **Configurable world** — all rules (energy costs, combat damage, reproduction thresholds, food spawning) are defined in a single JSON config, not in code
- **DNA & NEAT brains** — creatures have sensors (ray vision, touch, energy sense, broadcast receiver) and actuators (move, eat, attack, donate, broadcast) wired through an evolving neural network
- **Hebbian plasticity** — brain weights adapt during a creature's lifetime based on energy feedback
- **Friend-or-foe (IFF)** — creatures can recognize group members and cooperate via resource donation and broadcast signaling
- **Deterministic simulation** — seeded PRNG ensures reproducibility across browser and headless runs
- **Headless mode** — run thousands of generations from the command line, then import evolved genotypes into the browser

## Project Structure

```
packages/sim-core/   # Simulation engine (pure TypeScript, no DOM dependencies)
apps/web/            # Browser app (Pixi.js v7, Vite)
apps/headless/       # CLI runner for batch evolution
configs/             # World configuration (JSON)
design-docs/         # Design documents (world config, DNA format, brain format)
docs/                # Built web app (GitHub Pages)
```

## Quick Start

```bash
# Prerequisites: Node.js 22+
yarn install

# Run the browser sandbox
yarn dev:web          # → http://localhost:3000

# Run headless evolution
npx tsx apps/headless/src/main.ts --ticks 10000 --export best.json

# Run tests
yarn test
```

## Commands

| Command | Description |
|---------|-------------|
| `yarn dev:web` | Start Vite dev server for the browser app |
| `yarn build:web` | Production build → `docs/` (GitHub Pages) |
| `yarn build:core` | Build the simulation engine |
| `yarn test` | Run all unit tests (Vitest) |
| `yarn test:watch` | Tests in watch mode |
| `yarn typecheck` | Type-check the entire monorepo |

## Browser Controls

- **Pan**: Drag or middle-click drag
- **Zoom**: Scroll wheel (desktop), pinch (mobile)
- **Inspect & follow**: Click a creature to select it — the camera enters follow mode (keeps the creature centered) and a floating inspector panel shows its DNA, brain, energy, and actions. Drag/zoom to exit follow mode; click × to close inspector.
- **Sandbox tools** (collapsible): Place food, place creatures, save/load world, import genotypes, config editor, genotype browser, analytics, minimap
- **Speed**: Pause, 0.1x, 1x, 10x

## Design Documents

- [World Config](design-docs/world-config.md) — all simulation parameters
- [DNA Format](design-docs/dna-format.md) — genome structure, sensors, actuators, mutation rules
- [Brain Format](design-docs/brain-format.md) — NEAT genome, forward pass, Hebbian plasticity

## License

Private project.
