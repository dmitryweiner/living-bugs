import type { TickMetrics } from '@living-bugs/sim-core';

// ============================================================
// Sliding window data collection + Canvas 2D graphs
// ============================================================

/** How many data points to keep in the sliding window. */
const MAX_POINTS = 300;

/** Metrics sample collected each tick. */
interface Sample {
  tick: number;
  creatureCount: number;
  foodCount: number;
  avgEnergy: number;
  births: number;
  deaths: number;
}

// Colors for each line
const COLOR_CREATURES = '#4fc3f7';
const COLOR_FOOD = '#66bb6a';
const COLOR_ENERGY = '#ffb74d';
const COLOR_BIRTHS = '#81c784';
const COLOR_DEATHS = '#ef5350';

export class Analytics {
  private samples: Sample[] = [];
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sampleInterval: number;
  private tickCounter = 0;

  /**
   * @param canvasId - ID of the <canvas> element.
   * @param sampleInterval - Collect a sample every N ticks (smooths the graph).
   */
  constructor(canvasId: string, sampleInterval: number = 5) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.sampleInterval = sampleInterval;
  }

  /** Call each tick with the latest metrics. */
  record(metrics: TickMetrics): void {
    this.tickCounter++;
    if (this.tickCounter % this.sampleInterval !== 0) return;

    this.samples.push({
      tick: metrics.tick,
      creatureCount: metrics.creatureCount,
      foodCount: metrics.foodCount,
      avgEnergy: metrics.avgEnergy,
      births: metrics.births,
      deaths: metrics.deaths,
    });

    // Trim sliding window
    if (this.samples.length > MAX_POINTS) {
      this.samples.splice(0, this.samples.length - MAX_POINTS);
    }
  }

  /** Redraw the graph. Call less frequently (e.g. every 10 ticks). */
  draw(): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    if (this.samples.length < 2) {
      ctx.fillStyle = '#666';
      ctx.font = '11px sans-serif';
      ctx.fillText('Collecting data...', 10, h / 2);
      return;
    }

    const padding = { top: 8, right: 8, bottom: 20, left: 40 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    // Determine scales
    let maxCount = 10;
    let maxEnergy = 10;
    let maxRate = 5;

    for (const s of this.samples) {
      maxCount = Math.max(maxCount, s.creatureCount, s.foodCount);
      maxEnergy = Math.max(maxEnergy, s.avgEnergy);
      maxRate = Math.max(maxRate, s.births, s.deaths);
    }

    // Draw grid lines
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
    }

    // Helper: draw a line series
    const drawLine = (
      extractY: (s: Sample) => number,
      maxY: number,
      color: string,
      lineWidth: number = 1.5,
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();

      for (let i = 0; i < this.samples.length; i++) {
        const x = padding.left + (i / (this.samples.length - 1)) * plotW;
        const y = padding.top + plotH - (extractY(this.samples[i]) / maxY) * plotH;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.stroke();
    };

    // Draw series (using population scale for count-based, separate scale for energy)
    drawLine(s => s.creatureCount, maxCount, COLOR_CREATURES, 2);
    drawLine(s => s.foodCount, maxCount, COLOR_FOOD, 1.5);
    drawLine(s => s.avgEnergy, maxEnergy, COLOR_ENERGY, 1);

    // Y-axis labels
    ctx.fillStyle = '#666';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(maxCount.toString(), padding.left - 4, padding.top + 10);
    ctx.fillText('0', padding.left - 4, padding.top + plotH + 4);

    // Legend (bottom-left)
    ctx.textAlign = 'left';
    ctx.font = '9px sans-serif';
    const legendY = h - 4;
    let legendX = padding.left;

    const drawLegendItem = (label: string, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(legendX, legendY - 7, 8, 3);
      legendX += 10;
      ctx.fillStyle = '#888';
      ctx.fillText(label, legendX, legendY);
      legendX += ctx.measureText(label).width + 10;
    };

    drawLegendItem('Creatures', COLOR_CREATURES);
    drawLegendItem('Food', COLOR_FOOD);
    drawLegendItem('Avg Energy', COLOR_ENERGY);
  }

  /** Clear all collected data. */
  clear(): void {
    this.samples = [];
    this.tickCounter = 0;
  }
}
