import { World, createDefaultDNA, PRNG } from '@living-bugs/sim-core';
import type { WorldConfig, CreatureState, TickMetrics, DNA } from '@living-bugs/sim-core';
import { Renderer } from './renderer.js';
import { saveSnapshot, loadSnapshot, clearSnapshot } from './storage.js';
import { ConfigEditor } from './config-editor.js';
import { Analytics } from './analytics.js';
import { Minimap } from './minimap.js';
import { GenotypeBrowser } from './genotype-browser.js';

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
let configEditor: ConfigEditor;
let analytics: Analytics;
let minimap: Minimap;
let genotypeBrowser: GenotypeBrowser;
let isPaused = false;
let speedMultiplier = 1;
let selectedCreatureId: number | null = null;
let activeTool: 'none' | 'food' | 'creature' = 'none';
let lastMetrics: TickMetrics | null = null;
let seedGenotypesGlobal: DNA[] = [];

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
    if (s.type === 'rayVision') return `RayVision(${s.rayCount}r, fov=${s.fov.toFixed(1)})`;
    return s.type;
  }).join(', ');

  const actuators = creature.dna.actuators.map(a => a.type).join(', ');

  const brainNodes = creature.dna.brain.nodeGenes.length;
  const brainConns = creature.dna.brain.connectionGenes.filter(c => c.enabled).length;

  const energyPct = Math.min(100, (creature.energy / world.config.energy.maxEnergy) * 100);
  const energyColor = energyPct > 60 ? '#4caf50' : energyPct > 30 ? '#ffb74d' : '#ef5350';

  const actions = [
    creature.isEating ? 'EAT' : '',
    creature.isAttacking ? 'ATK' : '',
    creature.isDonating ? 'DON' : '',
    creature.isBroadcasting ? 'BRD' : '',
  ].filter(Boolean).join(' ') || 'idle';

  content.innerHTML = `
    <div class="field" style="margin-bottom:8px;">
      <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
        <span class="label">Energy</span>
        <span class="value" style="font-size:11px;">${creature.energy.toFixed(1)} / ${world.config.energy.maxEnergy}</span>
      </div>
      <div style="background:#222; border-radius:3px; height:6px; overflow:hidden;">
        <div style="background:${energyColor}; width:${energyPct.toFixed(1)}%; height:100%; border-radius:3px; transition:width 0.1s;"></div>
      </div>
    </div>
    <div class="field"><span class="label">ID: </span><span class="value">#${creature.id}</span> <span class="label" style="margin-left:8px;">Group: </span><span class="value">${creature.dna.groupId}</span></div>
    <div class="field"><span class="label">Age: </span><span class="value">${creature.age}</span> <span class="label" style="margin-left:8px;">Radius: </span><span class="value">${creature.dna.body.radius.toFixed(1)}</span></div>
    <div class="field"><span class="label">Speed: </span><span class="value">${creature.velocity.toFixed(2)}</span> <span class="label" style="margin-left:8px;">IFF: </span><span class="value">${creature.dna.hasIFF ? 'Yes' : 'No'}</span></div>
    <div class="field"><span class="label">Action: </span><span class="value" style="color:${actions === 'idle' ? '#666' : '#ffb74d'}">${actions}</span></div>
    <hr style="border-color:#333; margin:6px 0;">
    <div class="field"><span class="label">Brain: </span><span class="value">${brainNodes}n / ${brainConns}c</span> <span class="label" style="margin-left:8px;">Plasticity: </span><span class="value">${creature.dna.brain.plasticityRate.toFixed(3)}</span></div>
    <div class="field"><span class="label">Sensors: </span><span class="value" style="font-size:10px;">${sensors}</span></div>
    <div class="field"><span class="label">Actuators: </span><span class="value" style="font-size:10px;">${actuators}</span></div>
  `;
}

// ============================================================
// Inspector positioning (floating under creature)
// ============================================================

function positionInspector(worldX: number, worldY: number, radius: number): void {
  const panel = document.getElementById('inspector')!;
  if (!panel.classList.contains('open')) return;

  const screen = renderer.worldToScreen(worldX, worldY);
  const container = document.getElementById('canvas-container')!;
  const containerRect = container.getBoundingClientRect();
  const panelW = panel.offsetWidth;
  const panelH = panel.offsetHeight;

  // Place below creature with a small gap
  const gap = 12;
  const screenRadius = radius * renderer.getZoom();
  let x = screen.x - panelW / 2;
  let y = screen.y + screenRadius + gap;

  // Clamp to container bounds
  x = Math.max(4, Math.min(x, containerRect.width - panelW - 4));
  y = Math.max(4, Math.min(y, containerRect.height - panelH - 4));

  // If below would go off-screen, place above
  if (y + panelH > containerRect.height - 4) {
    y = screen.y - screenRadius - gap - panelH;
    y = Math.max(4, y);
  }

  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;
}

// ============================================================
// Controls setup
// ============================================================

function setupControls(): void {
  const btnPause = document.getElementById('btn-pause')!;
  const btnSpeed01 = document.getElementById('btn-speed01')!;
  const btnSpeed1 = document.getElementById('btn-speed1')!;
  const btnSpeed10 = document.getElementById('btn-speed10')!;

  btnPause.addEventListener('click', () => {
    isPaused = !isPaused;
    btnPause.textContent = isPaused ? 'Resume' : 'Pause';
    btnPause.classList.toggle('active', isPaused);
  });

  function setSpeed(s: number): void {
    speedMultiplier = s;
    btnSpeed01.classList.toggle('active', s === 0.1);
    btnSpeed1.classList.toggle('active', s === 1);
    btnSpeed10.classList.toggle('active', s === 10);
  }

  btnSpeed01.addEventListener('click', () => setSpeed(0.1));
  btnSpeed1.addEventListener('click', () => setSpeed(1));
  btnSpeed10.addEventListener('click', () => setSpeed(10));

  // Collapsible sandbox tools
  const sandboxToggle = document.getElementById('sandbox-toggle')!;
  const sandboxTools = document.getElementById('sandbox-tools')!;
  sandboxToggle.addEventListener('click', () => {
    sandboxTools.classList.toggle('collapsed');
  });

  // Inspector close button
  const inspectorClose = document.getElementById('inspector-close')!;
  inspectorClose.addEventListener('click', () => {
    selectedCreatureId = null;
    renderer.setSelectedCreature(null);
    renderer.setFollowMode(false);
    updateInspector(null);
  });

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

  // Config editor toggle
  const toolConfig = document.getElementById('tool-config')!;
  toolConfig.addEventListener('click', () => {
    configEditor.toggle();
    toolConfig.classList.toggle('active');
  });

  // Genotype browser toggle
  const toolGenotypes = document.getElementById('tool-genotypes')!;
  toolGenotypes.addEventListener('click', () => {
    // Update with current data before showing
    genotypeBrowser.update(seedGenotypesGlobal, world.getCreatureStates(), world.config);
    genotypeBrowser.toggle();
    toolGenotypes.classList.toggle('active');
  });

  // Analytics toggle
  const toolAnalytics = document.getElementById('tool-analytics')!;
  toolAnalytics.addEventListener('click', () => {
    const panel = document.getElementById('analytics-panel')!;
    panel.classList.toggle('open');
    toolAnalytics.classList.toggle('active');
  });

  // Minimap toggle
  const toolMinimap = document.getElementById('tool-minimap')!;
  toolMinimap.addEventListener('click', () => {
    const panel = document.getElementById('minimap-container')!;
    panel.classList.toggle('open');
    toolMinimap.classList.toggle('active');
  });

  const toolReset = document.getElementById('tool-reset')!;
  toolReset.addEventListener('click', async () => {
    if (!confirm('Reset the world? All creatures and progress will be lost.')) return;
    localStorage.removeItem('living-bugs-emergency-save');
    await clearSnapshot();
    (window as any).__resetWorld();
    selectedCreatureId = null;
    renderer.setSelectedCreature(null);
    renderer.setFollowMode(false);
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
  if (closest) {
    // Enter follow mode: camera will center on this creature each frame
    renderer.setFollowMode(true);
    renderer.centerOn(closest.position.x, closest.position.y);
  }
  updateInspector(closest);
}

// ============================================================
// Game loop
// ============================================================

let frameCount = 0;
let slowAccumulator = 0;

function gameLoop(): void {
  if (!isPaused) {
    if (speedMultiplier >= 1) {
      for (let i = 0; i < speedMultiplier; i++) {
        lastMetrics = world.step();
        if (lastMetrics) analytics.record(lastMetrics);
      }
    } else {
      // Fractional speed: accumulate and step when >= 1
      slowAccumulator += speedMultiplier;
      if (slowAccumulator >= 1) {
        slowAccumulator -= 1;
        lastMetrics = world.step();
        if (lastMetrics) analytics.record(lastMetrics);
      }
    }
  }

  if (lastMetrics) {
    updateHUD(lastMetrics);
  }

  // Redraw analytics and minimap every 10 frames
  frameCount++;
  if (frameCount % 10 === 0) {
    analytics.draw();
    const creatures = world.getCreatureStates();
    const food = world.getFoodStates();
    const obstacles = world.getObstacleStates();
    minimap.draw(creatures, food, renderer.getViewportBounds(), obstacles);
  }

  // Update selected creature inspector + follow mode
  if (selectedCreatureId !== null) {
    const c = world.getCreatureById(selectedCreatureId);
    if (c) {
      // Follow mode: keep camera centered on creature
      if (renderer.isFollowing()) {
        renderer.centerOn(c.position.x, c.position.y);
      }
      updateInspector(c);
      positionInspector(c.position.x, c.position.y, c.dna.body.radius);
    } else {
      // Creature died
      selectedCreatureId = null;
      renderer.setSelectedCreature(null);
      renderer.setFollowMode(false);
      updateInspector(null);
    }
  }

  // Render
  renderer.render(world.getCreatureStates(), world.getFoodStates(), world.getObstacleStates());

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

  // Load pre-trained seed genotypes (from headless training)
  let seedGenotypes: DNA[] = [];
  try {
    const seedModule = await import('../../../configs/seed-genotypes.json');
    const seedData = seedModule.default as { genotypes?: { dna: DNA }[] };
    if (seedData.genotypes && Array.isArray(seedData.genotypes)) {
      seedGenotypes = seedData.genotypes.map(g => g.dna);
      seedGenotypesGlobal = seedGenotypes;
      console.log(`Loaded ${seedGenotypes.length} seed genotypes from headless training`);
    }
  } catch {
    console.log('No seed genotypes found, using random DNA');
  }

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
    world.initialize(seedGenotypes);
    console.log('World reset to fresh state (with seed genotypes)');
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
          world.initialize(seedGenotypes);
        }
      } else {
        world.initialize(seedGenotypes);
      }
    }
  } else {
    world.initialize(seedGenotypes);
    // Remove ?reset from URL without reloading
    window.history.replaceState({}, '', window.location.pathname);
  }

  // Create renderer
  const container = document.getElementById('canvas-container')!;
  renderer = new Renderer(config);
  await renderer.init(container);

  renderer.onWorldClick = handleWorldClick;

  // Create config editor
  configEditor = new ConfigEditor(config);
  configEditor.mount(container);

  // Create analytics
  analytics = new Analytics('analytics-canvas', 5);

  // Create minimap
  minimap = new Minimap('minimap-canvas', config);
  minimap.onJump = (worldX, worldY) => {
    renderer.centerOn(worldX, worldY);
  };

  // Create genotype browser
  genotypeBrowser = new GenotypeBrowser();
  genotypeBrowser.mount(container);
  genotypeBrowser.onSpawn = (dna) => {
    const rng = new PRNG(Date.now());
    world.spawnCreature(
      dna,
      { x: rng.range(0, world.config.world.width), y: rng.range(0, world.config.world.height) },
      rng.range(0, Math.PI * 2),
      world.config.energy.initialEnergy,
    );
  };

  // Setup controls
  setupControls();
  setupAutosave();

  // Start game loop
  lastMetrics = world.getMetrics();
  updateHUD(lastMetrics);
  gameLoop();
}

init().catch(console.error);
