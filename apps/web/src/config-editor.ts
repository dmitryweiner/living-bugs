import type { WorldConfig } from '@living-bugs/sim-core';
import { isExpr } from '@living-bugs/sim-core';
import type { ConfigValue } from '@living-bugs/sim-core';

// ============================================================
// Config field definition
// ============================================================

interface ConfigField {
  label: string;
  path: string;        // e.g. "energy.moveCost"
  min: number;
  max: number;
  step: number;
  isInteger?: boolean;
}

interface ConfigCategory {
  name: string;
  fields: ConfigField[];
}

const CATEGORIES: ConfigCategory[] = [
  {
    name: 'Energy',
    fields: [
      { label: 'Initial Energy', path: 'energy.initialEnergy', min: 10, max: 1000, step: 10 },
      { label: 'Max Energy', path: 'energy.maxEnergy', min: 50, max: 2000, step: 50 },
      { label: 'Base Metabolism', path: 'energy.baseMetabolism', min: 0, max: 1, step: 0.005 },
      { label: 'Density Metabolism Factor', path: 'energy.densityMetabolismFactor', min: 0, max: 20, step: 0.5 },
      { label: 'Move Cost', path: 'energy.moveCost', min: 0, max: 0.5, step: 0.005 },
      { label: 'Turn Cost', path: 'energy.turnCost', min: 0, max: 0.5, step: 0.005 },
      { label: 'Attack Cost', path: 'energy.attackCost', min: 0, max: 20, step: 0.5 },
      { label: 'Vision Cost/Ray', path: 'energy.visionCostPerRay', min: 0, max: 0.1, step: 0.001 },
      { label: 'Broadcast Cost', path: 'energy.broadcastCost', min: 0, max: 0.5, step: 0.005 },
    ],
  },
  {
    name: 'Food',
    fields: [
      { label: 'Spawn Rate', path: 'food.spawnRate', min: 0, max: 50, step: 1, isInteger: true },
      { label: 'Nutrition Value', path: 'food.nutritionValue', min: 1, max: 200, step: 1 },
      { label: 'Max Count', path: 'food.maxCount', min: 10, max: 10000, step: 50, isInteger: true },
    ],
  },
  {
    name: 'Combat',
    fields: [
      { label: 'Base Damage', path: 'combat.baseDamage', min: 0, max: 100, step: 1 },
      { label: 'Attack Radius', path: 'combat.attackRadius', min: 1, max: 50, step: 1 },
      { label: 'Attack Cooldown', path: 'combat.attackCooldown', min: 0, max: 30, step: 1, isInteger: true },
    ],
  },
  {
    name: 'Reproduction',
    fields: [
      { label: 'Energy Threshold', path: 'reproduction.energyThreshold', min: 50, max: 500, step: 10 },
      { label: 'Offspring Energy %', path: 'reproduction.offspringEnergyShare', min: 0.1, max: 0.9, step: 0.05 },
      { label: 'Mutation Rate', path: 'reproduction.mutationRate', min: 0, max: 1, step: 0.01 },
      { label: 'Mutation Strength', path: 'reproduction.mutationStrength', min: 0, max: 2, step: 0.05 },
      { label: 'Cooldown', path: 'reproduction.cooldown', min: 0, max: 200, step: 5, isInteger: true },
      { label: 'Crossover Rate', path: 'reproduction.crossoverRate', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    name: 'Broadcast',
    fields: [
      { label: 'Broadcast Radius', path: 'broadcast.broadcastRadius', min: 10, max: 500, step: 10 },
      { label: 'Signal Channels', path: 'broadcast.signalChannels', min: 1, max: 16, step: 1, isInteger: true },
    ],
  },
  {
    name: 'Simulation',
    fields: [
      { label: 'Max Creatures', path: 'simulation.maxCreatures', min: 10, max: 50000, step: 100, isInteger: true },
    ],
  },
];

// ============================================================
// Helpers
// ============================================================

function getNestedValue(obj: any, path: string): ConfigValue {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    cur = cur[p];
  }
  return cur as ConfigValue;
}

function setNestedValue(obj: any, path: string, value: number): void {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function resolveNumericValue(val: ConfigValue): number {
  if (typeof val === 'number') return val;
  // For expression values, just show 0 as placeholder
  return 0;
}

// ============================================================
// Config Editor
// ============================================================

export class ConfigEditor {
  private container: HTMLElement;
  private config: WorldConfig;
  private defaultConfig: WorldConfig;
  private isOpen = false;
  private inputElements = new Map<string, { slider: HTMLInputElement; number: HTMLInputElement }>();

  constructor(config: WorldConfig) {
    this.config = config;
    this.defaultConfig = JSON.parse(JSON.stringify(config));
    this.container = document.createElement('div');
    this.container.id = 'config-editor';
    this.container.className = 'config-editor';
  }

  /** Mount the editor panel into the DOM. */
  mount(parentEl: HTMLElement): void {
    this.buildUI();
    parentEl.appendChild(this.container);
  }

  /** Toggle panel visibility. */
  toggle(): void {
    this.isOpen = !this.isOpen;
    this.container.classList.toggle('open', this.isOpen);
    if (this.isOpen) this.syncFromConfig();
  }

  /** Sync UI from config (in case config was changed externally). */
  syncFromConfig(): void {
    for (const [path, els] of this.inputElements) {
      const val = getNestedValue(this.config, path);
      if (isExpr(val)) {
        els.slider.disabled = true;
        els.number.disabled = true;
        els.number.value = '(expr)';
      } else {
        const numVal = resolveNumericValue(val);
        els.slider.disabled = false;
        els.number.disabled = false;
        els.slider.value = numVal.toString();
        els.number.value = numVal.toString();
      }
    }
  }

  /** Reset all values to defaults. */
  resetToDefaults(): void {
    for (const cat of CATEGORIES) {
      for (const field of cat.fields) {
        const defaultVal = getNestedValue(this.defaultConfig, field.path);
        if (typeof defaultVal === 'number') {
          setNestedValue(this.config, field.path, defaultVal);
        }
      }
    }
    this.syncFromConfig();
  }

  // ============================================================
  // Build the DOM
  // ============================================================

  private buildUI(): void {
    this.container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'config-editor-header';
    header.innerHTML = '<h3>Config Editor</h3>';

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset';
    resetBtn.className = 'config-reset-btn';
    resetBtn.addEventListener('click', () => this.resetToDefaults());
    header.appendChild(resetBtn);

    this.container.appendChild(header);

    // Categories
    for (const cat of CATEGORIES) {
      const section = document.createElement('div');
      section.className = 'config-section';

      const catHeader = document.createElement('div');
      catHeader.className = 'config-cat-header';
      catHeader.textContent = cat.name;
      catHeader.addEventListener('click', () => {
        section.classList.toggle('collapsed');
      });
      section.appendChild(catHeader);

      const fieldsContainer = document.createElement('div');
      fieldsContainer.className = 'config-fields';

      for (const field of cat.fields) {
        fieldsContainer.appendChild(this.buildField(field));
      }

      section.appendChild(fieldsContainer);
      this.container.appendChild(section);
    }
  }

  private buildField(field: ConfigField): HTMLElement {
    const row = document.createElement('div');
    row.className = 'config-field';

    const label = document.createElement('label');
    label.textContent = field.label;
    label.className = 'config-label';
    row.appendChild(label);

    const controls = document.createElement('div');
    controls.className = 'config-controls';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = field.min.toString();
    slider.max = field.max.toString();
    slider.step = field.step.toString();
    slider.className = 'config-slider';

    const numberInput = document.createElement('input');
    numberInput.type = 'text';
    numberInput.className = 'config-number';

    // Get current value
    const curVal = getNestedValue(this.config, field.path);
    if (isExpr(curVal)) {
      slider.disabled = true;
      numberInput.disabled = true;
      numberInput.value = '(expr)';
    } else {
      const numVal = resolveNumericValue(curVal);
      slider.value = numVal.toString();
      numberInput.value = numVal.toString();
    }

    // Slider → update config and number
    slider.addEventListener('input', () => {
      const val = field.isInteger ? parseInt(slider.value, 10) : parseFloat(slider.value);
      numberInput.value = val.toString();
      setNestedValue(this.config, field.path, val);
    });

    // Number → update config and slider
    numberInput.addEventListener('change', () => {
      const raw = parseFloat(numberInput.value);
      if (isNaN(raw)) return;
      const val = field.isInteger ? Math.round(raw) : raw;
      const clamped = Math.max(field.min, Math.min(field.max, val));
      numberInput.value = clamped.toString();
      slider.value = clamped.toString();
      setNestedValue(this.config, field.path, clamped);
    });

    this.inputElements.set(field.path, { slider, number: numberInput });

    controls.appendChild(slider);
    controls.appendChild(numberInput);
    row.appendChild(controls);

    return row;
  }
}
