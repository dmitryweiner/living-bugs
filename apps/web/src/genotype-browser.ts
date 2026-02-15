import type { DNA, CreatureState, WorldConfig } from '@living-bugs/sim-core';
import { countSensorInputs, countActuatorOutputs, dnaCompatibilityDistance, DEFAULT_SPECIATION_CONFIG } from '@living-bugs/sim-core';
import { renderBrainGraph } from './brain-graph.js';

// ============================================================
// Genotype Browser — browse and spawn genotypes
// ============================================================

export interface GenotypeEntry {
  /** Display label (e.g. "Seed #1" or "Top Creature #3"). */
  label: string;
  /** The DNA genome. */
  dna: DNA;
  /** Fitness score (if available). */
  fitness?: number;
  /** Source: imported seed, current top creature, or hall of fame. */
  source: 'seed' | 'current' | 'hof';
}

export type BrowserTab = 'all' | 'seed' | 'current' | 'hof';

export class GenotypeBrowser {
  private entries: GenotypeEntry[] = [];
  private container: HTMLElement;
  private listContainer: HTMLElement;
  private tabBar: HTMLElement;
  private isOpen = false;
  private compareMode = false;
  private selectedA: number | null = null;
  private selectedB: number | null = null;
  private brainCanvas: HTMLCanvasElement;
  private brainGraphIdx: number | null = null;
  private activeTab: BrowserTab = 'all';
  private hofEntries: GenotypeEntry[] = [];

  /** Callback: user wants to spawn a creature with this DNA. */
  onSpawn: ((dna: DNA) => void) | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'genotype-browser';
    this.container.className = 'genotype-browser';

    this.listContainer = document.createElement('div');
    this.listContainer.className = 'genotype-list';

    this.tabBar = document.createElement('div');
    this.tabBar.className = 'genotype-tabs';

    this.brainCanvas = document.createElement('canvas');
    this.brainCanvas.width = 400;
    this.brainCanvas.height = 300;
    this.brainCanvas.className = 'brain-graph-canvas';
    this.brainCanvas.style.display = 'none';

    this.buildUI();
  }

  mount(parentEl: HTMLElement): void {
    parentEl.appendChild(this.container);
  }

  toggle(): void {
    this.isOpen = !this.isOpen;
    this.container.classList.toggle('open', this.isOpen);
    if (this.isOpen) this.render();
  }

  /**
   * Update the browser with seed genotypes and current top creatures.
   */
  update(seedGenotypes: DNA[], topCreatures: CreatureState[], config: WorldConfig): void {
    this.entries = [];

    // Seed genotypes
    for (let i = 0; i < seedGenotypes.length; i++) {
      this.entries.push({
        label: `Seed #${i + 1}`,
        dna: seedGenotypes[i],
        source: 'seed',
      });
    }

    // Current top creatures by fitness (age * energy / maxEnergy)
    const sorted = [...topCreatures]
      .map(c => ({
        creature: c,
        fitness: c.age * (c.energy / config.energy.maxEnergy),
      }))
      .sort((a, b) => b.fitness - a.fitness)
      .slice(0, 10);

    for (let i = 0; i < sorted.length; i++) {
      this.entries.push({
        label: `Top #${i + 1} (id:${sorted[i].creature.id})`,
        dna: sorted[i].creature.dna,
        fitness: sorted[i].fitness,
        source: 'current',
      });
    }

    // Include Hall of Fame entries
    this.entries.push(...this.hofEntries);

    if (this.isOpen) this.render();
  }

  /**
   * Set Hall of Fame genotypes (from seed-genotypes.json or uploaded file).
   */
  setHallOfFame(genotypes: { dna: DNA; fitness?: number }[]): void {
    this.hofEntries = genotypes.map((g, i) => ({
      label: `HoF #${i + 1}`,
      dna: g.dna,
      fitness: g.fitness,
      source: 'hof' as const,
    }));
  }

  // ============================================================
  // UI building
  // ============================================================

  private buildUI(): void {
    // Header
    const header = document.createElement('div');
    header.className = 'genotype-header';
    header.innerHTML = '<h3>Genotype Browser</h3>';

    const compareBtn = document.createElement('button');
    compareBtn.textContent = 'Compare';
    compareBtn.className = 'genotype-compare-btn';
    compareBtn.addEventListener('click', () => {
      this.compareMode = !this.compareMode;
      compareBtn.classList.toggle('active', this.compareMode);
      this.selectedA = null;
      this.selectedB = null;
      this.render();
    });
    header.appendChild(compareBtn);

    this.container.appendChild(header);
    this.buildTabBar();
    this.container.appendChild(this.tabBar);
    this.container.appendChild(this.brainCanvas);
    this.container.appendChild(this.listContainer);
  }

  private buildTabBar(): void {
    this.tabBar.innerHTML = '';
    const tabs: { id: BrowserTab; label: string }[] = [
      { id: 'all', label: 'All' },
      { id: 'seed', label: 'Seed' },
      { id: 'current', label: 'Current' },
      { id: 'hof', label: 'Hall of Fame' },
    ];
    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.textContent = tab.label;
      btn.className = `genotype-tab${this.activeTab === tab.id ? ' active' : ''}`;
      btn.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.buildTabBar();
        this.render();
      });
      this.tabBar.appendChild(btn);
    }
  }

  private render(): void {
    this.listContainer.innerHTML = '';

    // Filter entries by active tab
    const filtered = this.activeTab === 'all'
      ? this.entries
      : this.entries.filter(e => e.source === this.activeTab);

    if (filtered.length === 0) {
      this.listContainer.innerHTML = '<div class="genotype-empty">No genotypes in this tab. Import genotypes or wait for creatures to evolve.</div>';
      return;
    }

    // Compare view
    if (this.compareMode && this.selectedA !== null && this.selectedB !== null) {
      this.renderCompare(this.selectedA, this.selectedB);
      return;
    }

    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i];
      // Find the actual index in this.entries for compare/brain graph
      const globalIdx = this.entries.indexOf(entry);
      const row = document.createElement('div');
      row.className = 'genotype-row';
      if (this.compareMode && (globalIdx === this.selectedA || globalIdx === this.selectedB)) {
        row.classList.add('selected');
      }

      const info = this.summarizeDNA(entry.dna);

      row.innerHTML = `
        <div class="genotype-label">${entry.label}</div>
        <div class="genotype-info">
          <span class="gi-tag ${entry.source}">${entry.source}</span>
          ${entry.fitness !== undefined ? `<span class="gi-fitness">F:${entry.fitness.toFixed(1)}</span>` : ''}
          <span class="gi-detail">G:${entry.dna.groupId} R:${entry.dna.body.radius.toFixed(1)}</span>
          <span class="gi-detail">S:${info.sensorCount} A:${info.actuatorCount}</span>
          <span class="gi-detail">N:${info.nodeCount} C:${info.connCount}</span>
        </div>
      `;

      // Buttons
      const btnContainer = document.createElement('div');
      btnContainer.className = 'genotype-actions';

      if (this.compareMode) {
        const selectBtn = document.createElement('button');
        selectBtn.textContent = this.selectedA === globalIdx ? 'A' : this.selectedB === globalIdx ? 'B' : 'Select';
        selectBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.selectedA === null) {
            this.selectedA = globalIdx;
          } else if (this.selectedB === null && globalIdx !== this.selectedA) {
            this.selectedB = globalIdx;
          } else {
            this.selectedA = globalIdx;
            this.selectedB = null;
          }
          this.render();
        });
        btnContainer.appendChild(selectBtn);
      } else {
        const spawnBtn = document.createElement('button');
        spawnBtn.textContent = 'Spawn';
        spawnBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onSpawn?.(entry.dna);
        });
        btnContainer.appendChild(spawnBtn);

        const brainBtn = document.createElement('button');
        brainBtn.textContent = this.brainGraphIdx === globalIdx ? 'Hide' : 'Brain';
        brainBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.brainGraphIdx === globalIdx) {
            this.brainGraphIdx = null;
            this.brainCanvas.style.display = 'none';
          } else {
            this.brainGraphIdx = globalIdx;
            this.brainCanvas.style.display = 'block';
            renderBrainGraph(this.brainCanvas, entry.dna.brain);
          }
          this.render();
        });
        btnContainer.appendChild(brainBtn);
      }

      row.appendChild(btnContainer);
      this.listContainer.appendChild(row);
    }
  }

  private renderCompare(idxA: number, idxB: number): void {
    const a = this.entries[idxA];
    const b = this.entries[idxB];

    const distance = dnaCompatibilityDistance(a.dna, b.dna, DEFAULT_SPECIATION_CONFIG);
    const infoA = this.summarizeDNA(a.dna);
    const infoB = this.summarizeDNA(b.dna);

    this.listContainer.innerHTML = `
      <div class="genotype-compare">
        <div class="compare-header">
          <span>Compatibility distance: <strong>${distance.toFixed(3)}</strong></span>
          <button class="compare-back-btn">Back</button>
        </div>
        <table class="compare-table">
          <tr><th></th><th>${a.label}</th><th>${b.label}</th></tr>
          <tr><td>Group</td><td>${a.dna.groupId}</td><td>${b.dna.groupId}</td></tr>
          <tr><td>Radius</td><td>${a.dna.body.radius.toFixed(2)}</td><td>${b.dna.body.radius.toFixed(2)}</td></tr>
          <tr><td>IFF</td><td>${a.dna.hasIFF ? 'Yes' : 'No'}</td><td>${b.dna.hasIFF ? 'Yes' : 'No'}</td></tr>
          <tr><td>Sensors</td><td>${infoA.sensorCount}</td><td>${infoB.sensorCount}</td></tr>
          <tr><td>Actuators</td><td>${infoA.actuatorCount}</td><td>${infoB.actuatorCount}</td></tr>
          <tr><td>Brain Nodes</td><td>${infoA.nodeCount}</td><td>${infoB.nodeCount}</td></tr>
          <tr><td>Brain Conns</td><td>${infoA.connCount}</td><td>${infoB.connCount}</td></tr>
          <tr><td>Inputs</td><td>${infoA.inputCount}</td><td>${infoB.inputCount}</td></tr>
          <tr><td>Outputs</td><td>${infoA.outputCount}</td><td>${infoB.outputCount}</td></tr>
          <tr><td>Plasticity</td><td>${a.dna.brain.plasticityRate.toFixed(4)}</td><td>${b.dna.brain.plasticityRate.toFixed(4)}</td></tr>
          ${a.fitness !== undefined || b.fitness !== undefined ? `<tr><td>Fitness</td><td>${a.fitness?.toFixed(1) ?? 'N/A'}</td><td>${b.fitness?.toFixed(1) ?? 'N/A'}</td></tr>` : ''}
        </table>
      </div>
    `;

    const backBtn = this.listContainer.querySelector('.compare-back-btn');
    backBtn?.addEventListener('click', () => {
      this.selectedA = null;
      this.selectedB = null;
      this.render();
    });
  }

  private summarizeDNA(dna: DNA): {
    sensorCount: number;
    actuatorCount: number;
    nodeCount: number;
    connCount: number;
    inputCount: number;
    outputCount: number;
  } {
    return {
      sensorCount: dna.sensors.length,
      actuatorCount: dna.actuators.length,
      nodeCount: dna.brain.nodeGenes.length,
      connCount: dna.brain.connectionGenes.filter(c => c.enabled).length,
      inputCount: countSensorInputs(dna.sensors),
      outputCount: countActuatorOutputs(dna.actuators),
    };
  }
}
