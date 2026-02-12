import type { CreatureState, FoodItemState, ObstacleState, WorldConfig } from '@living-bugs/sim-core';

// ============================================================
// Minimap — small canvas showing entire world overview
// ============================================================

/** Group colors matching the renderer fast-mode palette. */
const GROUP_COLORS = [
  '#f44336', '#2196f3', '#4caf50', '#ff9800',
  '#9c27b0', '#00bcd4', '#ffeb3b', '#e91e63',
];
const FOOD_COLOR = '#66bb6a';
const VIEWPORT_COLOR = 'rgba(79, 195, 247, 0.4)';
const VIEWPORT_BORDER = 'rgba(79, 195, 247, 0.8)';
const OBSTACLE_COLOR = '#795548';
const BG_COLOR = '#0d0d0d';
const BORDER_COLOR = '#333';

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: WorldConfig;
  private scaleX: number;
  private scaleY: number;

  /** Callback: user clicked on the minimap to jump to a location. */
  onJump: ((worldX: number, worldY: number) => void) | null = null;

  constructor(canvasId: string, config: WorldConfig) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.config = config;
    this.scaleX = this.canvas.width / config.world.width;
    this.scaleY = this.canvas.height / config.world.height;

    // Click to jump
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const worldX = mx / this.scaleX;
      const worldY = my / this.scaleY;
      this.onJump?.(worldX, worldY);
    });
  }

  /**
   * Draw the minimap.
   * @param creatures - Current creature states.
   * @param food - Current food states.
   * @param viewportRect - Visible area in world coordinates [left, top, right, bottom].
   * @param obstacles - Optional obstacle states.
   */
  draw(
    creatures: CreatureState[],
    food: FoodItemState[],
    viewportRect: { left: number; top: number; right: number; bottom: number },
    obstacles?: ObstacleState[],
  ): void {
    const { ctx, canvas, scaleX, scaleY } = this;
    const w = canvas.width;
    const h = canvas.height;

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Border
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);

    // Obstacles (brown circles)
    if (obstacles) {
      ctx.fillStyle = OBSTACLE_COLOR;
      for (const o of obstacles) {
        const x = o.position.x * scaleX;
        const y = o.position.y * scaleY;
        const r = Math.max(1.5, o.radius * scaleX);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Food (small green dots)
    ctx.fillStyle = FOOD_COLOR;
    for (const f of food) {
      const x = f.position.x * scaleX;
      const y = f.position.y * scaleY;
      ctx.fillRect(x, y, 1, 1);
    }

    // Creatures (colored dots by group)
    for (const c of creatures) {
      const x = c.position.x * scaleX;
      const y = c.position.y * scaleY;
      ctx.fillStyle = GROUP_COLORS[c.dna.groupId % GROUP_COLORS.length];
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }

    // Viewport rectangle
    const vl = Math.max(0, viewportRect.left * scaleX);
    const vt = Math.max(0, viewportRect.top * scaleY);
    const vr = Math.min(w, viewportRect.right * scaleX);
    const vb = Math.min(h, viewportRect.bottom * scaleY);
    const vw = vr - vl;
    const vh = vb - vt;

    ctx.fillStyle = VIEWPORT_COLOR;
    ctx.fillRect(vl, vt, vw, vh);
    ctx.strokeStyle = VIEWPORT_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(vl, vt, vw, vh);
  }
}
