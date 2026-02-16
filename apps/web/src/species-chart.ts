import type { CreatureState } from '@living-bugs/sim-core';

// ============================================================
// Species population chart — shows per-group creature counts
// over a sliding time window using stacked area + line overlay.
// ============================================================

const MAX_POINTS = 300;
const NUM_GROUPS = 4;

interface SpeciesSample {
  tick: number;
  counts: number[]; // counts[groupId]
}

const GROUP_COLORS = [
  '#ef5350', // Group 0 — Solo Hunter (red)
  '#66bb6a', // Group 1 — Social Cooperator (green)
  '#42a5f5', // Group 2 — Solo Forager (blue)
  '#ffb74d', // Group 3 — Social Predator (orange)
];

const GROUP_LABELS = [
  'Solo Hunter',
  'Social Coop',
  'Solo Forager',
  'Social Pred',
];

export class SpeciesChart {
  private samples: SpeciesSample[] = [];
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sampleInterval: number;
  private tickCounter = 0;

  constructor(canvasId: string, sampleInterval: number = 5) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.sampleInterval = sampleInterval;
  }

  /** Call each tick with current creature states. */
  record(creatures: CreatureState[], tick: number): void {
    this.tickCounter++;
    if (this.tickCounter % this.sampleInterval !== 0) return;

    const counts = new Array(NUM_GROUPS).fill(0);
    for (const c of creatures) {
      const g = c.dna.groupId;
      if (g >= 0 && g < NUM_GROUPS) counts[g]++;
    }

    this.samples.push({ tick, counts });

    if (this.samples.length > MAX_POINTS) {
      this.samples.splice(0, this.samples.length - MAX_POINTS);
    }
  }

  /** Redraw the chart. */
  draw(): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    if (this.samples.length < 2) {
      ctx.fillStyle = '#666';
      ctx.font = '11px sans-serif';
      ctx.fillText('Collecting species data...', 10, h / 2);
      return;
    }

    const padding = { top: 8, right: 8, bottom: 24, left: 36 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    // Find max total (for stacked scale) and max individual
    let maxTotal = 10;
    for (const s of this.samples) {
      let total = 0;
      for (let g = 0; g < NUM_GROUPS; g++) total += s.counts[g];
      maxTotal = Math.max(maxTotal, total);
    }

    // Draw grid
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
    }

    const n = this.samples.length;

    // Stacked area: draw from bottom group up
    // Build cumulative stacks
    const stacks: number[][] = []; // stacks[pointIdx][groupIdx] = cumulative top
    for (let i = 0; i < n; i++) {
      const cum: number[] = [];
      let running = 0;
      for (let g = 0; g < NUM_GROUPS; g++) {
        running += this.samples[i].counts[g];
        cum.push(running);
      }
      stacks.push(cum);
    }

    const xOf = (i: number) => padding.left + (i / (n - 1)) * plotW;
    const yOf = (val: number) =>
      padding.top + plotH - (val / maxTotal) * plotH;

    // Draw filled areas (from top group down so lower areas overlap)
    for (let g = NUM_GROUPS - 1; g >= 0; g--) {
      ctx.fillStyle = GROUP_COLORS[g] + '40'; // semi-transparent fill
      ctx.beginPath();
      // Top edge (cumulative)
      ctx.moveTo(xOf(0), yOf(stacks[0][g]));
      for (let i = 1; i < n; i++) {
        ctx.lineTo(xOf(i), yOf(stacks[i][g]));
      }
      // Bottom edge (previous group's cumulative, or 0)
      if (g > 0) {
        for (let i = n - 1; i >= 0; i--) {
          ctx.lineTo(xOf(i), yOf(stacks[i][g - 1]));
        }
      } else {
        ctx.lineTo(xOf(n - 1), yOf(0));
        ctx.lineTo(xOf(0), yOf(0));
      }
      ctx.closePath();
      ctx.fill();
    }

    // Draw line borders on top of each area
    for (let g = 0; g < NUM_GROUPS; g++) {
      ctx.strokeStyle = GROUP_COLORS[g];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = xOf(i);
        const y = yOf(stacks[i][g]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Y-axis labels
    ctx.fillStyle = '#666';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(maxTotal.toString(), padding.left - 4, padding.top + 10);
    ctx.fillText(Math.round(maxTotal / 2).toString(), padding.left - 4, padding.top + plotH / 2 + 4);
    ctx.fillText('0', padding.left - 4, padding.top + plotH + 4);

    // Legend (bottom)
    ctx.textAlign = 'left';
    ctx.font = '9px sans-serif';
    const legendY = h - 4;
    let legendX = padding.left;

    for (let g = 0; g < NUM_GROUPS; g++) {
      ctx.fillStyle = GROUP_COLORS[g];
      ctx.fillRect(legendX, legendY - 7, 8, 3);
      legendX += 10;
      ctx.fillStyle = '#888';
      const label = GROUP_LABELS[g];
      ctx.fillText(label, legendX, legendY);
      legendX += ctx.measureText(label).width + 8;
    }

    // Current counts in top-right
    if (this.samples.length > 0) {
      const last = this.samples[this.samples.length - 1];
      ctx.textAlign = 'right';
      ctx.font = '10px sans-serif';
      let cy = padding.top + 12;
      for (let g = 0; g < NUM_GROUPS; g++) {
        ctx.fillStyle = GROUP_COLORS[g];
        ctx.fillText(`${GROUP_LABELS[g]}: ${last.counts[g]}`, w - padding.right - 4, cy);
        cy += 12;
      }
    }
  }

  clear(): void {
    this.samples = [];
    this.tickCounter = 0;
  }
}
