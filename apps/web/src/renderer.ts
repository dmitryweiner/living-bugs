import * as PIXI from 'pixi.js';
import type { CreatureState, FoodItemState, ObstacleState, WorldConfig } from '@living-bugs/sim-core';

// ============================================================
// Constants
// ============================================================

/** Creature count threshold — above this, switch to fast (dot) mode. */
const BATCH_THRESHOLD = 3000;

/** Max overlay entities — only draw energy bars / direction ticks for this many. */
const MAX_OVERLAY_ENTITIES = 500;

const SELECTED_TINT = 0xffd740;
const ENERGY_GREEN = 0x4caf50;
const ENERGY_RED = 0xf44336;
const ENERGY_BG = 0x333333;
const FOOD_COLOR = 0x66bb6a;

/** One insect emoji per group. Child inherits parent's group → same emoji. */
const GROUP_EMOJIS = [
  '\u{1F41B}', // 🐛 bug
  '\u{1F41C}', // 🐜 ant
  '\u{1F997}', // 🦗 cricket
  '\u{1F41D}', // 🐝 bee
  '\u{1FAB2}', // 🪲 beetle
  '\u{1F98B}', // 🦋 butterfly
  '\u{1F41E}', // 🐞 ladybug
  '\u{1FAB0}', // 🪰 fly
];

const FOOD_EMOJIS = [
  '\u{1F34E}', // 🍎
  '\u{1F34F}', // 🍏
  '\u{1F350}', // 🍐
  '\u{1F34A}', // 🍊
  '\u{1F34B}', // 🍋
  '\u{1F347}', // 🍇
  '\u{1F353}', // 🍓
  '\u{1FAD0}', // 🫐
  '\u{1F352}', // 🍒
  '\u{1F351}', // 🍑
  '\u{1F95D}', // 🥝
  '\u{1F33F}', // 🌿
  '\u{1F340}', // 🍀
  '\u{1F331}', // 🌱
  '\u{1F343}', // 🍃
];

const OBSTACLE_EMOJIS = [
  '\u{1FAA8}', // 🪨 rock
  '\u{1F332}', // 🌲 evergreen tree
  '\u{1F333}', // 🌳 deciduous tree
  '\u{1F5FB}', // 🗻 mount fuji
  '\u{26F0}\u{FE0F}', // ⛰️ mountain
  '\u{1FAB5}', // 🪵 wood
];

const OBSTACLE_COLOR = 0x795548; // brown for fast mode

/** Distinct group colors for fast (dot) mode. */
const GROUP_COLORS = [
  0xf44336, // red
  0x2196f3, // blue
  0x4caf50, // green
  0xff9800, // orange
  0x9c27b0, // purple
  0x00bcd4, // cyan
  0xffeb3b, // yellow
  0xe91e63, // pink
];

// ============================================================
// Emoji → Texture cache
// ============================================================

const textureCache = new Map<string, PIXI.Texture>();

function emojiToTexture(emoji: string, size: number): PIXI.Texture {
  const key = `${emoji}_${size}`;
  let tex = textureCache.get(key);
  if (tex) return tex;

  const canvas = document.createElement('canvas');
  const res = Math.ceil(window.devicePixelRatio || 1);
  canvas.width = size * res;
  canvas.height = size * res;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(res, res);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${size * 0.8}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.fillText(emoji, size / 2, size / 2);

  tex = PIXI.Texture.from(canvas);
  textureCache.set(key, tex);
  return tex;
}

/** Create a simple white filled-circle texture for fast (dot) mode. */
function createCircleTexture(radius: number): PIXI.Texture {
  const key = `_circle_${radius}`;
  let tex = textureCache.get(key);
  if (tex) return tex;

  const canvas = document.createElement('canvas');
  const size = radius * 2;
  const res = Math.ceil(window.devicePixelRatio || 1);
  canvas.width = size * res;
  canvas.height = size * res;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(res, res);
  ctx.beginPath();
  ctx.arc(radius, radius, radius - 1, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  tex = PIXI.Texture.from(canvas);
  textureCache.set(key, tex);
  return tex;
}

// ============================================================
// Sprite entry tracked by entity id
// ============================================================

interface SpriteEntry {
  sprite: PIXI.Sprite;
  emojiKey: string;
}

// ============================================================
// Renderer class
// ============================================================

export class Renderer {
  app: PIXI.Application;
  worldContainer: PIXI.Container;
  backgroundGfx: PIXI.Graphics;
  borderGfx: PIXI.Graphics;
  obstacleContainer: PIXI.Container;
  foodContainer: PIXI.Container;
  creatureContainer: PIXI.Container;
  overlayGfx: PIXI.Graphics;
  config: WorldConfig;

  // Fast mode: ParticleContainers
  private fastCreatureContainer: PIXI.ParticleContainer | null = null;
  private fastFoodContainer: PIXI.ParticleContainer | null = null;
  private fastCreatureSprites: PIXI.Sprite[] = [];
  private fastFoodSprites: PIXI.Sprite[] = [];
  private circleTexture!: PIXI.Texture;
  private foodDotTexture!: PIXI.Texture;

  // Rich mode: sprite pools
  private creatureSprites = new Map<number, SpriteEntry>();
  private foodSprites = new Map<number, SpriteEntry>();
  private obstacleSprites = new Map<number, SpriteEntry>();

  // Pre-built textures
  private creatureTextures: PIXI.Texture[] = [];
  private foodTextures: PIXI.Texture[] = [];
  private obstacleTextures: PIXI.Texture[] = [];

  // Mode tracking
  private currentMode: 'rich' | 'fast' = 'rich';

  private selectedCreatureId: number | null = null;
  private isPanning = false;
  private lastMouse = { x: 0, y: 0 };
  private mouseDownPos = { x: 0, y: 0 };
  private didDrag = false;
  private zoom = 1;
  private panX = 0;
  private panY = 0;

  /** When true, camera follows the selected creature each frame. */
  private followMode = false;

  // Viewport bounds (in world coordinates)
  private viewportLeft = 0;
  private viewportTop = 0;
  private viewportRight = 0;
  private viewportBottom = 0;
  private canvasWidth = 0;
  private canvasHeight = 0;

  onWorldClick: ((worldX: number, worldY: number) => void) | null = null;

  constructor(config: WorldConfig) {
    this.config = config;
    this.app = new PIXI.Application({
      backgroundColor: 0x0a0a0a,
      antialias: true,
      resizeTo: undefined as unknown as HTMLElement,
    });
    this.worldContainer = new PIXI.Container();
    this.backgroundGfx = new PIXI.Graphics();
    this.borderGfx = new PIXI.Graphics();
    this.obstacleContainer = new PIXI.Container();
    this.foodContainer = new PIXI.Container();
    this.creatureContainer = new PIXI.Container();
    this.overlayGfx = new PIXI.Graphics();
  }

  async init(container: HTMLElement): Promise<void> {
    this.canvasWidth = container.clientWidth;
    this.canvasHeight = container.clientHeight;
    this.app.renderer.resize(this.canvasWidth, this.canvasHeight);
    container.appendChild(this.app.view as HTMLCanvasElement);

    // Pre-render textures
    const creatureSize = Math.round(this.config.creatureDefaults.radius * 4);
    for (const emoji of GROUP_EMOJIS) {
      this.creatureTextures.push(emojiToTexture(emoji, creatureSize));
    }
    const foodSize = Math.round(this.config.food.radius * 4);
    for (const emoji of FOOD_EMOJIS) {
      this.foodTextures.push(emojiToTexture(emoji, foodSize));
    }
    // Obstacle textures — use a larger size since obstacles can be big
    const obstacleSize = Math.round((this.config.obstacles?.maxRadius ?? 30) * 2.5);
    for (const emoji of OBSTACLE_EMOJIS) {
      this.obstacleTextures.push(emojiToTexture(emoji, obstacleSize));
    }

    // Create dot textures for fast mode
    this.circleTexture = createCircleTexture(16);
    this.foodDotTexture = createCircleTexture(8);

    // Scene graph (rich mode): bg → border → obstacles → food → creatures → overlay
    this.worldContainer.addChild(this.backgroundGfx);
    this.worldContainer.addChild(this.borderGfx);
    this.worldContainer.addChild(this.obstacleContainer);
    this.worldContainer.addChild(this.foodContainer);
    this.worldContainer.addChild(this.creatureContainer);
    this.worldContainer.addChild(this.overlayGfx);
    this.app.stage.addChild(this.worldContainer);

    // Generate cached background of random greenish circles
    this.generateBackground();

    // World border
    this.borderGfx.lineStyle(2, 0x333333);
    this.borderGfx.drawRect(0, 0, this.config.world.width, this.config.world.height);

    // Fit world in viewport
    const scaleX = this.canvasWidth / this.config.world.width;
    const scaleY = this.canvasHeight / this.config.world.height;
    this.zoom = Math.min(scaleX, scaleY) * 0.9;
    this.panX = (this.canvasWidth - this.config.world.width * this.zoom) / 2;
    this.panY = (this.canvasHeight - this.config.world.height * this.zoom) / 2;
    this.updateTransform();

    this.setupInteraction(container);

    window.addEventListener('resize', () => {
      this.canvasWidth = container.clientWidth;
      this.canvasHeight = container.clientHeight;
      this.app.renderer.resize(this.canvasWidth, this.canvasHeight);
      this.updateViewportBounds();
    });
  }

  // ============================================================
  // Cached background: random greenish circles
  // ============================================================

  private generateBackground(): void {
    const gfx = this.backgroundGfx;
    const w = this.config.world.width;
    const h = this.config.world.height;
    // Simple seeded pseudo-random for reproducible background
    let seed = 12345;
    const rand = () => { seed = (seed * 16807 + 0) % 2147483647; return (seed - 1) / 2147483646; };

    // Dark base fill
    gfx.beginFill(0x0d1a0d, 1);
    gfx.drawRect(0, 0, w, h);
    gfx.endFill();

    // Scatter ~200 translucent greenish circles
    const count = 200;
    for (let i = 0; i < count; i++) {
      const cx = rand() * w;
      const cy = rand() * h;
      const r = 20 + rand() * 80;
      // Random green-ish hue: vary green channel, add some blue/yellow
      const baseR = Math.floor(0x05 + rand() * 0x15);
      const baseG = Math.floor(0x18 + rand() * 0x30);
      const baseB = Math.floor(0x05 + rand() * 0x18);
      const color = (baseR << 16) | (baseG << 8) | baseB;
      const alpha = 0.15 + rand() * 0.25;

      gfx.beginFill(color, alpha);
      gfx.drawCircle(cx, cy, r);
      gfx.endFill();
    }
  }

  // ============================================================
  // Obstacle rendering (sprites placed once, not per-frame)
  // ============================================================

  renderObstacles(obstacles: ObstacleState[]): void {
    // Only reconcile if count changed (obstacles are static)
    if (this.obstacleSprites.size === obstacles.length) return;

    // Clear existing
    for (const [, entry] of this.obstacleSprites) {
      entry.sprite.destroy();
    }
    this.obstacleSprites.clear();
    this.obstacleContainer.removeChildren();

    for (const obs of obstacles) {
      const texIdx = obs.id % this.obstacleTextures.length;
      const sprite = new PIXI.Sprite(this.obstacleTextures[texIdx]);
      sprite.anchor.set(0.5);
      const desiredSize = obs.radius * 2.5;
      sprite.width = desiredSize;
      sprite.height = desiredSize;
      sprite.position.set(obs.position.x, obs.position.y);
      sprite.alpha = 0.85;
      this.obstacleContainer.addChild(sprite);
      this.obstacleSprites.set(obs.id, { sprite, emojiKey: OBSTACLE_EMOJIS[texIdx] });
    }
  }

  // ============================================================
  // Mode switching
  // ============================================================

  private switchToFastMode(): void {
    if (this.currentMode === 'fast') return;
    this.currentMode = 'fast';

    // Hide rich containers
    this.foodContainer.visible = false;
    this.creatureContainer.visible = false;

    // Clear rich sprites
    for (const [, entry] of this.creatureSprites) {
      entry.sprite.destroy();
    }
    this.creatureSprites.clear();
    for (const [, entry] of this.foodSprites) {
      entry.sprite.destroy();
    }
    this.foodSprites.clear();
    this.foodContainer.removeChildren();
    this.creatureContainer.removeChildren();

    // Create particle containers
    if (!this.fastCreatureContainer) {
      this.fastCreatureContainer = new PIXI.ParticleContainer(100000, {
        position: true,
        rotation: false,
        tint: true,
        scale: true,
        uvs: false,
        alpha: false,
      });
      this.worldContainer.addChildAt(this.fastCreatureContainer, 2);
    }
    this.fastCreatureContainer.visible = true;

    if (!this.fastFoodContainer) {
      this.fastFoodContainer = new PIXI.ParticleContainer(100000, {
        position: true,
        rotation: false,
        tint: true,
        scale: false,
        uvs: false,
        alpha: false,
      });
      this.worldContainer.addChildAt(this.fastFoodContainer, 1);
    }
    this.fastFoodContainer.visible = true;
  }

  private switchToRichMode(): void {
    if (this.currentMode === 'rich') return;
    this.currentMode = 'rich';

    // Hide fast containers
    if (this.fastCreatureContainer) {
      this.fastCreatureContainer.visible = false;
      this.fastCreatureContainer.removeChildren();
      this.fastCreatureSprites = [];
    }
    if (this.fastFoodContainer) {
      this.fastFoodContainer.visible = false;
      this.fastFoodContainer.removeChildren();
      this.fastFoodSprites = [];
    }

    // Show rich containers
    this.foodContainer.visible = true;
    this.creatureContainer.visible = true;
  }

  // ============================================================
  // Viewport calculations
  // ============================================================

  private updateViewportBounds(): void {
    const margin = 50; // extra margin in world units
    this.viewportLeft = -this.panX / this.zoom - margin;
    this.viewportTop = -this.panY / this.zoom - margin;
    this.viewportRight = (this.canvasWidth - this.panX) / this.zoom + margin;
    this.viewportBottom = (this.canvasHeight - this.panY) / this.zoom + margin;
  }

  private isInViewport(x: number, y: number): boolean {
    return x >= this.viewportLeft && x <= this.viewportRight &&
           y >= this.viewportTop && y <= this.viewportBottom;
  }

  // ============================================================
  // Interaction (pan / zoom / click)
  // ============================================================

  private setupInteraction(_container: HTMLElement): void {
    const canvas = this.app.view as HTMLCanvasElement;
    const DRAG_THRESHOLD = 5;

    canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      this.followMode = false;
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const oldZoom = this.zoom;
      this.zoom = Math.max(0.05, Math.min(20, this.zoom * zoomFactor));
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.panX = mx - (mx - this.panX) * (this.zoom / oldZoom);
      this.panY = my - (my - this.panY) * (this.zoom / oldZoom);
      this.updateTransform();
    }, { passive: false });

    canvas.addEventListener('mousedown', (e: MouseEvent) => {
      this.isPanning = true;
      this.didDrag = false;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.mouseDownPos = { x: e.clientX, y: e.clientY };
      if (e.button !== 0) e.preventDefault();
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.isPanning) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.panX += dx;
      this.panY += dy;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.updateTransform();

      const totalDx = e.clientX - this.mouseDownPos.x;
      const totalDy = e.clientY - this.mouseDownPos.y;
      if (Math.abs(totalDx) > DRAG_THRESHOLD || Math.abs(totalDy) > DRAG_THRESHOLD) {
        this.didDrag = true;
        this.followMode = false;
      }
    });

    window.addEventListener('mouseup', (e: MouseEvent) => {
      if (!this.isPanning) return;
      this.isPanning = false;

      if (e.button === 0 && !this.didDrag) {
        const rect = canvas.getBoundingClientRect();
        const worldX = (this.mouseDownPos.x - rect.left - this.panX) / this.zoom;
        const worldY = (this.mouseDownPos.y - rect.top - this.panY) / this.zoom;
        this.onWorldClick?.(worldX, worldY);
      }
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Touch support
    let lastTouches: { x: number; y: number }[] = [];
    let lastTouchCount = 0;

    canvas.addEventListener('touchstart', (e: TouchEvent) => {
      const count = e.touches.length;
      if (count === 1) {
        this.isPanning = true;
        this.didDrag = false;
        const t = e.touches[0];
        this.lastMouse = { x: t.clientX, y: t.clientY };
        this.mouseDownPos = { x: t.clientX, y: t.clientY };
      } else if (count === 2) {
        // Transition 1→2: stop 1-finger pan, mark as drag (no click on release)
        this.isPanning = false;
        this.didDrag = true;
      }
      lastTouches = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }));
      lastTouchCount = count;
    }, { passive: true });

    canvas.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault();
      const count = e.touches.length;

      if (count === 1 && this.isPanning) {
        const t = e.touches[0];
        this.panX += t.clientX - this.lastMouse.x;
        this.panY += t.clientY - this.lastMouse.y;
        this.lastMouse = { x: t.clientX, y: t.clientY };
        this.updateTransform();
        const totalDx = t.clientX - this.mouseDownPos.x;
        const totalDy = t.clientY - this.mouseDownPos.y;
        if (Math.abs(totalDx) > DRAG_THRESHOLD || Math.abs(totalDy) > DRAG_THRESHOLD) {
          this.didDrag = true;
          this.followMode = false;
        }
      } else if (count === 2) {
        this.followMode = false;
        const cur = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }));

        // Only compute pinch if previous frame also had 2 touches
        if (lastTouchCount === 2 && lastTouches.length === 2) {
          const prevDist = Math.hypot(lastTouches[0].x - lastTouches[1].x, lastTouches[0].y - lastTouches[1].y);
          const curDist = Math.hypot(cur[0].x - cur[1].x, cur[0].y - cur[1].y);
          if (prevDist > 0) {
            const factor = curDist / prevDist;
            const oldZoom = this.zoom;
            this.zoom = Math.max(0.05, Math.min(20, this.zoom * factor));
            const rect = canvas.getBoundingClientRect();
            const mx = (cur[0].x + cur[1].x) / 2 - rect.left;
            const my = (cur[0].y + cur[1].y) / 2 - rect.top;
            this.panX = mx - (mx - this.panX) * (this.zoom / oldZoom);
            this.panY = my - (my - this.panY) * (this.zoom / oldZoom);
            this.updateTransform();
          }
        }
        lastTouches = cur;
        lastTouchCount = 2;
        this.didDrag = true;
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e: TouchEvent) => {
      const remaining = e.touches.length;
      if (remaining === 0) {
        this.isPanning = false;
        if (!this.didDrag) {
          const rect = canvas.getBoundingClientRect();
          const worldX = (this.mouseDownPos.x - rect.left - this.panX) / this.zoom;
          const worldY = (this.mouseDownPos.y - rect.top - this.panY) / this.zoom;
          this.onWorldClick?.(worldX, worldY);
        }
      } else if (remaining === 1) {
        // Transition 2→1: resync lastMouse to the remaining finger so no jump
        const t = e.touches[0];
        this.lastMouse = { x: t.clientX, y: t.clientY };
        this.isPanning = true;
        // Keep didDrag = true so lifting the last finger doesn't trigger a click
      }
      lastTouches = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }));
      lastTouchCount = remaining;
    });
  }

  private updateTransform(): void {
    this.worldContainer.position.set(this.panX, this.panY);
    this.worldContainer.scale.set(this.zoom);
    this.updateViewportBounds();
  }

  setSelectedCreature(id: number | null): void {
    this.selectedCreatureId = id;
  }

  /** Get the current viewport bounds in world coordinates. */
  getViewportBounds(): { left: number; top: number; right: number; bottom: number } {
    return {
      left: this.viewportLeft,
      top: this.viewportTop,
      right: this.viewportRight,
      bottom: this.viewportBottom,
    };
  }

  /** Set camera to center on a world position. */
  centerOn(worldX: number, worldY: number): void {
    this.panX = this.canvasWidth / 2 - worldX * this.zoom;
    this.panY = this.canvasHeight / 2 - worldY * this.zoom;
    this.updateTransform();
  }

  /** Enable/disable camera follow mode. */
  setFollowMode(enabled: boolean): void {
    this.followMode = enabled;
  }

  /** Whether camera is in follow mode. */
  isFollowing(): boolean {
    return this.followMode;
  }

  /** Convert world coordinates to screen (canvas) coordinates. */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: worldX * this.zoom + this.panX,
      y: worldY * this.zoom + this.panY,
    };
  }

  /** Get the current zoom level. */
  getZoom(): number {
    return this.zoom;
  }

  // ============================================================
  // Render frame
  // ============================================================

  render(creatures: CreatureState[], food: FoodItemState[], obstacles?: ObstacleState[]): void {
    // Render obstacles once (they're static)
    if (obstacles) {
      this.renderObstacles(obstacles);
    }

    const totalEntities = creatures.length + food.length;

    if (totalEntities > BATCH_THRESHOLD) {
      this.switchToFastMode();
      this.renderFastFood(food);
      this.renderFastCreatures(creatures);
    } else {
      this.switchToRichMode();
      this.reconcileFood(food);
      this.reconcileCreatures(creatures);
    }

    this.drawOverlays(creatures);
  }

  // ============================================================
  // Fast mode rendering (ParticleContainer)
  // ============================================================

  private renderFastCreatures(creatures: CreatureState[]): void {
    const container = this.fastCreatureContainer!;

    // Grow sprite pool if needed
    while (this.fastCreatureSprites.length < creatures.length) {
      const sprite = new PIXI.Sprite(this.circleTexture);
      sprite.anchor.set(0.5);
      container.addChild(sprite);
      this.fastCreatureSprites.push(sprite);
    }

    // Update sprites
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      const sprite = this.fastCreatureSprites[i];
      sprite.visible = true;
      sprite.position.set(c.position.x, c.position.y);
      const scale = (c.dna.body.radius * 4) / 32; // circleTexture is 32px diameter, 2x visual size
      sprite.scale.set(scale);
      sprite.tint = c.id === this.selectedCreatureId
        ? SELECTED_TINT
        : GROUP_COLORS[c.dna.groupId % GROUP_COLORS.length];
    }

    // Hide excess sprites
    for (let i = creatures.length; i < this.fastCreatureSprites.length; i++) {
      this.fastCreatureSprites[i].visible = false;
    }
  }

  private renderFastFood(food: FoodItemState[]): void {
    const container = this.fastFoodContainer!;

    // Grow pool
    while (this.fastFoodSprites.length < food.length) {
      const sprite = new PIXI.Sprite(this.foodDotTexture);
      sprite.anchor.set(0.5);
      sprite.tint = FOOD_COLOR;
      container.addChild(sprite);
      this.fastFoodSprites.push(sprite);
    }

    for (let i = 0; i < food.length; i++) {
      const f = food[i];
      const sprite = this.fastFoodSprites[i];
      sprite.visible = true;
      sprite.position.set(f.position.x, f.position.y);
    }

    for (let i = food.length; i < this.fastFoodSprites.length; i++) {
      this.fastFoodSprites[i].visible = false;
    }
  }

  // ============================================================
  // Rich mode rendering (individual emoji sprites)
  // ============================================================

  private reconcileFood(food: FoodItemState[]): void {
    const alive = new Set<number>();

    for (const f of food) {
      alive.add(f.id);
      let entry = this.foodSprites.get(f.id);

      if (!entry) {
        const texIdx = f.id % this.foodTextures.length;
        const sprite = new PIXI.Sprite(this.foodTextures[texIdx]);
        sprite.anchor.set(0.5);
        const desiredSize = this.config.food.radius * 2.5;
        sprite.width = desiredSize;
        sprite.height = desiredSize;
        this.foodContainer.addChild(sprite);
        entry = { sprite, emojiKey: FOOD_EMOJIS[texIdx] };
        this.foodSprites.set(f.id, entry);
      }

      entry.sprite.position.set(f.position.x, f.position.y);
    }

    for (const [id, entry] of this.foodSprites) {
      if (!alive.has(id)) {
        this.foodContainer.removeChild(entry.sprite);
        entry.sprite.destroy();
        this.foodSprites.delete(id);
      }
    }
  }

  private reconcileCreatures(creatures: CreatureState[]): void {
    const alive = new Set<number>();

    for (const c of creatures) {
      alive.add(c.id);
      const groupIdx = c.dna.groupId % this.creatureTextures.length;
      const emojiKey = GROUP_EMOJIS[groupIdx];
      let entry = this.creatureSprites.get(c.id);

      if (!entry || entry.emojiKey !== emojiKey) {
        if (entry) {
          this.creatureContainer.removeChild(entry.sprite);
          entry.sprite.destroy();
        }
        const sprite = new PIXI.Sprite(this.creatureTextures[groupIdx]);
        sprite.anchor.set(0.5);
        this.creatureContainer.addChild(sprite);
        entry = { sprite, emojiKey };
        this.creatureSprites.set(c.id, entry);
      }

      const sprite = entry.sprite;
      const desiredSize = c.dna.body.radius * 5;
      sprite.width = desiredSize;
      sprite.height = desiredSize;
      sprite.position.set(c.position.x, c.position.y);
      sprite.rotation = c.angle;

      const isSelected = c.id === this.selectedCreatureId;
      sprite.tint = isSelected ? SELECTED_TINT : 0xffffff;
      sprite.alpha = isSelected ? 1 : 0.9;
    }

    for (const [id, entry] of this.creatureSprites) {
      if (!alive.has(id)) {
        this.creatureContainer.removeChild(entry.sprite);
        entry.sprite.destroy();
        this.creatureSprites.delete(id);
      }
    }
  }

  // ============================================================
  // Overlay: energy bars + sensor rays (viewport-culled)
  // ============================================================

  private drawOverlays(creatures: CreatureState[]): void {
    this.overlayGfx.clear();

    // Only draw overlays for creatures in the viewport, up to a limit
    let overlayCount = 0;

    for (const c of creatures) {
      // Always draw sensor rays for selected creature
      const isSelected = c.id === this.selectedCreatureId;

      if (isSelected) {
        // Selection ring
        this.overlayGfx.lineStyle(1.5, SELECTED_TINT, 0.7);
        this.overlayGfx.drawCircle(c.position.x, c.position.y, c.dna.body.radius + 3);
        this.drawSensors(c);
      }

      // Only draw energy bars / direction for in-viewport creatures
      if (!this.isInViewport(c.position.x, c.position.y)) continue;
      if (overlayCount >= MAX_OVERLAY_ENTITIES && !isSelected) continue;

      const radius = c.dna.body.radius;

      // Energy bar
      const barWidth = radius * 2.5;
      const barHeight = 2;
      const barY = c.position.y - radius - 5;
      const energyRatio = Math.max(0, Math.min(1, c.energy / this.config.energy.maxEnergy));

      this.overlayGfx.beginFill(ENERGY_BG);
      this.overlayGfx.drawRect(c.position.x - barWidth / 2, barY, barWidth, barHeight);
      this.overlayGfx.endFill();
      this.overlayGfx.beginFill(energyRatio > 0.3 ? ENERGY_GREEN : ENERGY_RED);
      this.overlayGfx.drawRect(c.position.x - barWidth / 2, barY, barWidth * energyRatio, barHeight);
      this.overlayGfx.endFill();

      // Direction tick
      const dx = Math.cos(c.angle) * radius * 1.6;
      const dy = Math.sin(c.angle) * radius * 1.6;
      this.overlayGfx.lineStyle(1, 0xffffff, 0.35);
      this.overlayGfx.moveTo(c.position.x, c.position.y);
      this.overlayGfx.lineTo(c.position.x + dx, c.position.y + dy);

      overlayCount++;
    }
  }

  private drawSensors(c: CreatureState): void {
    this.overlayGfx.lineStyle(0.5, 0xffeb3b, 0.3);
    for (const sensor of c.dna.sensors) {
      if (sensor.type === 'rayVision') {
        const angleStep = sensor.rayCount > 1 ? sensor.fov / (sensor.rayCount - 1) : 0;
        const startAngle = c.angle + sensor.offsetAngle - sensor.fov / 2;

        for (let r = 0; r < sensor.rayCount; r++) {
          const rayAngle = startAngle + angleStep * r;
          const endX = c.position.x + Math.cos(rayAngle) * sensor.maxDistance;
          const endY = c.position.y + Math.sin(rayAngle) * sensor.maxDistance;
          this.overlayGfx.moveTo(c.position.x, c.position.y);
          this.overlayGfx.lineTo(endX, endY);
        }
      }
    }
  }

  destroy(): void {
    this.app.destroy(true);
  }
}
