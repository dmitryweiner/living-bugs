import type { DNA, CreatureState, WorldConfig } from '@living-bugs/sim-core';
import { countSensorInputs, countActuatorOutputs, dnaCompatibilityDistance, DEFAULT_SPECIATION_CONFIG } from '@living-bugs/sim-core';

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

export class GenotypeBrowser {
  private entries: GenotypeEntry[] = [];
  private container: HTMLElement;
  private listContainer: HTMLElement;
  private isOpen = false;
  private compareMode = false;
  private selectedA: number | null = null;
  private selectedB: number | null = null;

  /** Callback: user wants to spawn a creature with this DNA. */
  onSpawn: ((dna: DNA) => void) | null = null;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'genotype-browser';
    this.container.className = 'genotype-browser';

    this.listContainer = document.createElement('div');
    this.listContainer.className = 'genotype-list';

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

    if (this.isOpen) this.render();
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
    this.container.appendChild(this.listContainer);
  }

  private render(): void {
    this.listContainer.innerHTML = '';

    if (this.entries.length === 0) {
      this.listContainer.innerHTML = '<div class="genotype-empty">No genotypes loaded. Import genotypes or wait for creatures to evolve.</div>';
      return;
    }

    // Compare view
    if (this.compareMode && this.selectedA !== null && this.selectedB !== null) {
      this.renderCompare(this.selectedA, this.selectedB);
      return;
    }

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const row = document.createElement('div');
      row.className = 'genotype-row';
      if (this.compareMode && (i === this.selectedA || i === this.selectedB)) {
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
        selectBtn.textContent = this.selectedA === i ? 'A' : this.selectedB === i ? 'B' : 'Select';
        selectBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.selectedA === null) {
            this.selectedA = i;
          } else if (this.selectedB === null && i !== this.selectedA) {
            this.selectedB = i;
          } else {
            this.selectedA = i;
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
