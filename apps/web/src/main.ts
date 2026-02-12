import { World, createDefaultDNA, PRNG } from '@living-bugs/sim-core';
import type { WorldConfig, CreatureState, TickMetrics } from '@living-bugs/sim-core';
import { Renderer } from './renderer.js';
import { saveSnapshot, loadSnapshot, clearSnapshot } from './storage.js';

// ============================================================
// Load config (bundled by vite)
// ============================================================

async function loadConfig(): Promise<WorldConfig> {
  const resp = await fetch('/configs/world-config.json');
  return resp.json();
}

// ============================================================
// App state
// ============================================================

let world: World;
let renderer: Renderer;
let isPaused = false;
let speedMultiplier = 1;
let selectedCreatureId: number | null = null;
let activeTool: 'none' | 'food' | 'creature' = 'none';
let lastMetrics: TickMetrics | null = null;

// ============================================================
// HUD update
// ============================================================

function updateHUD(metrics: TickMetrics): void {
  document.getElementById('hud-tick')!.textContent = metrics.tick.toString();
  document.getElementById('hud-creatures')!.textContent = metrics.creatureCount.toString();
  document.getElementById('hud-food')!.textContent = metrics.foodCount.toString();
  document.getElementById('hud-energy')!.textContent = metrics.avgEnergy.toFixed(1);
  document.getElementById('hud-age')!.textContent = metrics.avgAge.toFixed(0);
}

// ============================================================
// Inspector update
// ============================================================

function updateInspector(creature: CreatureState | null): void {
  const panel = document.getElementById('inspector')!;
  const content = document.getElementById('inspector-content')!;

  if (!creature) {
    panel.classList.remove('open');
    return;
  }

  panel.classList.add('open');

  const sensors = creature.dna.sensors.map(s => {
    if (s.type === 'rayVision') return `RayVision(${s.rayCount} rays, fov=${s.fov.toFixed(2)})`;
    return s.type;
  }).join(', ');

  const actuators = creature.dna.actuators.map(a => a.type).join(', ');

  const brainNodes = creature.dna.brain.nodeGenes.length;
  const brainConns = creature.dna.brain.connectionGenes.filter(c => c.enabled).length;

  content.innerHTML = `
    <div class="field"><span class="label">ID: </span><span class="value">${creature.id}</span></div>
    <div class="field"><span class="label">Group: </span><span class="value">${creature.dna.groupId}</span></div>
    <div class="field"><span class="label">Age: </span><span class="value">${creature.age} ticks</span></div>
    <div class="field"><span class="label">Energy: </span><span class="value">${creature.energy.toFixed(1)} / ${world.config.energy.maxEnergy}</span></div>
    <div class="field"><span class="label">Radius: </span><span class="value">${creature.dna.body.radius.toFixed(1)}</span></div>
    <div class="field"><span class="label">IFF: </span><span class="value">${creature.dna.hasIFF ? 'Yes' : 'No'}</span></div>
    <div class="field"><span class="label">Speed: </span><span class="value">${creature.velocity.toFixed(2)}</span></div>
    <hr style="border-color:#333; margin:8px 0;">
    <div class="field"><span class="label">Sensors: </span><span class="value">${sensors}</span></div>
    <div class="field"><span class="label">Actuators: </span><span class="value">${actuators}</span></div>
    <hr style="border-color:#333; margin:8px 0;">
    <div class="field"><span class="label">Brain nodes: </span><span class="value">${brainNodes}</span></div>
    <div class="field"><span class="label">Brain conns: </span><span class="value">${brainConns}</span></div>
    <div class="field"><span class="label">Plasticity: </span><span class="value">${creature.dna.brain.plasticityRate.toFixed(4)}</span></div>
    <div class="field"><span class="label">Actions: </span><span class="value">${[
      creature.isEating ? 'EAT' : '',
      creature.isAttacking ? 'ATK' : '',
      creature.isDonating ? 'DON' : '',
      creature.isBroadcasting ? 'BRD' : '',
    ].filter(Boolean).join(' ') || 'idle'}</span></div>
  `;
}

// ============================================================
// Controls setup
// ============================================================

function setupControls(): void {
  const btnPause = document.getElementById('btn-pause')!;
  const btnSpeed1 = document.getElementById('btn-speed1')!;
  const btnSpeed3 = document.getElementById('btn-speed3')!;
  const btnSpeed10 = document.getElementById('btn-speed10')!;

  btnPause.addEventListener('click', () => {
    isPaused = !isPaused;
    btnPause.textContent = isPaused ? 'Resume' : 'Pause';
    btnPause.classList.toggle('active', isPaused);
  });

  function setSpeed(s: number): void {
    speedMultiplier = s;
    btnSpeed1.classList.toggle('active', s === 1);
    btnSpeed3.classList.toggle('active', s === 3);
    btnSpeed10.classList.toggle('active', s === 10);
  }

  btnSpeed1.addEventListener('click', () => setSpeed(1));
  btnSpeed3.addEventListener('click', () => setSpeed(3));
  btnSpeed10.addEventListener('click', () => setSpeed(10));

  // Sandbox tools
  const toolNone = document.getElementById('tool-none')!;
  const toolFood = document.getElementById('tool-food')!;
  const toolCreature = document.getElementById('tool-creature')!;
  const toolSave = document.getElementById('tool-save')!;
  const toolLoad = document.getElementById('tool-load')!;
  const toolImport = document.getElementById('tool-import')!;

  function setTool(t: 'none' | 'food' | 'creature'): void {
    activeTool = t;
    toolNone.classList.toggle('active', t === 'none');
    toolFood.classList.toggle('active', t === 'food');
    toolCreature.classList.toggle('active', t === 'creature');
  }

  toolNone.addEventListener('click', () => setTool('none'));
  toolFood.addEventListener('click', () => setTool('food'));
  toolCreature.addEventListener('click', () => setTool('creature'));

  toolSave.addEventListener('click', async () => {
    const snapshot = world.getSnapshot();
    await saveSnapshot(snapshot);
    alert('World saved!');
  });

  toolLoad.addEventListener('click', async () => {
    const snapshot = await loadSnapshot();
    if (snapshot) {
      world.loadSnapshot(snapshot);
      alert(`World loaded from tick ${snapshot.tick}!`);
    } else {
      alert('No saved world found.');
    }
  });

  const toolReset = document.getElementById('tool-reset')!;
  toolReset.addEventListener('click', async () => {
    if (!confirm('Reset the world? All creatures and progress will be lost.')) return;
    localStorage.removeItem('living-bugs-emergency-save');
    await clearSnapshot();
    (window as any).__resetWorld();
    selectedCreatureId = null;
    renderer.setSelectedCreature(null);
    updateInspector(null);
  });

  toolImport.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.genotypes && Array.isArray(data.genotypes)) {
        let count = 0;
        const rng = new PRNG(Date.now());
        for (const g of data.genotypes) {
          if (g.dna) {
            world.spawnCreature(
              g.dna,
              { x: rng.range(0, world.config.world.width), y: rng.range(0, world.config.world.height) },
              rng.range(0, Math.PI * 2),
              world.config.energy.initialEnergy,
            );
            count++;
          }
        }
        alert(`Imported ${count} genotypes!`);
      }
    });
    input.click();
  });
}

// ============================================================
// Click handling
// ============================================================

function handleWorldClick(worldX: number, worldY: number): void {
  if (activeTool === 'food') {
    world.spawnFood({ x: worldX, y: worldY });
    return;
  }

  if (activeTool === 'creature') {
    const rng = new PRNG(Date.now());
    const dna = createDefaultDNA(rng.int(0, 3), rng);
    world.spawnCreature(dna, { x: worldX, y: worldY }, rng.range(0, Math.PI * 2), world.config.energy.initialEnergy);
    return;
  }

  // Select mode: find closest creature
  const creatures = world.getCreatureStates();
  let closest: CreatureState | null = null;
  let closestDist = 20; // Click threshold in world units

  for (const c of creatures) {
    const dx = c.position.x - worldX;
    const dy = c.position.y - worldY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < closestDist) {
      closestDist = dist;
      closest = c;
    }
  }

  selectedCreatureId = closest?.id ?? null;
  renderer.setSelectedCreature(selectedCreatureId);
  updateInspector(closest);
}

// ============================================================
// Game loop
// ============================================================

function gameLoop(): void {
  if (!isPaused) {
    for (let i = 0; i < speedMultiplier; i++) {
      lastMetrics = world.step();
    }
  }

  if (lastMetrics) {
    updateHUD(lastMetrics);
  }

  // Update selected creature inspector
  if (selectedCreatureId !== null) {
    const c = world.getCreatureById(selectedCreatureId);
    if (c) {
      updateInspector(c);
    } else {
      // Creature died
      selectedCreatureId = null;
      renderer.setSelectedCreature(null);
      updateInspector(null);
    }
  }

  // Render
  renderer.render(world.getCreatureStates(), world.getFoodStates());

  requestAnimationFrame(gameLoop);
}

// ============================================================
// Autosave on close
// ============================================================

function setupAutosave(): void {
  window.addEventListener('beforeunload', () => {
    // Synchronous save to localStorage as fallback
    try {
      const snapshot = world.getSnapshot();
      localStorage.setItem('living-bugs-emergency-save', JSON.stringify(snapshot));
    } catch {
      // Ignore errors on save
    }
  });

  // Also try async save on visibility change
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') {
      try {
        await saveSnapshot(world.getSnapshot());
      } catch {
        // Ignore
      }
    }
  });
}

// ============================================================
// Init
// ============================================================

async function init(): Promise<void> {
  // Load config — use static import so Vite bundles it correctly
  // (works both on dev server and any deploy path like GitHub Pages)
  const configModule = await import('../../../configs/world-config.json');
  const config: WorldConfig = configModule.default as WorldConfig;

  // Create world
  world = new World(config);

  // Expose for debugging: window.__world, window.__resetWorld()
  (window as any).__world = world;
  (window as any).__resetWorld = () => {
    localStorage.removeItem('living-bugs-emergency-save');
    world.creatures.clear();
    world.food.clear();
    world.tick = 0;
    world.nextEntityId = 1;
    world.initialize();
    console.log('World reset to fresh state');
  };

  // ?reset in URL forces a fresh start (clears all saves)
  const forceReset = new URLSearchParams(window.location.search).has('reset');
  if (forceReset) {
    localStorage.removeItem('living-bugs-emergency-save');
    await clearSnapshot();
    console.log('Force reset: cleared all saves');
  }

  // Try to load saved state (unless force reset)
  if (!forceReset) {
    const saved = await loadSnapshot();
    if (saved) {
      world.loadSnapshot(saved);
      console.log(`Restored world from tick ${saved.tick}`);
    } else {
      const emergency = localStorage.getItem('living-bugs-emergency-save');
      if (emergency) {
        try {
          const snapshot = JSON.parse(emergency);
          world.loadSnapshot(snapshot);
          localStorage.removeItem('living-bugs-emergency-save');
          console.log('Restored from emergency save');
        } catch {
          world.initialize();
        }
      } else {
        world.initialize();
      }
    }
  } else {
    world.initialize();
    // Remove ?reset from URL without reloading
    window.history.replaceState({}, '', window.location.pathname);
  }

  // Create renderer
  const container = document.getElementById('canvas-container')!;
  renderer = new Renderer(config);
  await renderer.init(container);

  renderer.onWorldClick = handleWorldClick;

  // Setup controls
  setupControls();
  setupAutosave();

  // Start game loop
  lastMetrics = world.getMetrics();
  updateHUD(lastMetrics);
  gameLoop();
}

init().catch(console.error);
