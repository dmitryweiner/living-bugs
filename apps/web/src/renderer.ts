import * as PIXI from 'pixi.js';
import type { CreatureState, FoodItemState, WorldConfig } from '@living-bugs/sim-core';

// ============================================================
// Emoji sets
// ============================================================

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

const SELECTED_TINT = 0xffd740;
const ENERGY_GREEN = 0x4caf50;
const ENERGY_RED = 0xf44336;
const ENERGY_BG = 0x333333;

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

// ============================================================
// Sprite entry tracked by entity id
// ============================================================

interface SpriteEntry {
  sprite: PIXI.Sprite;
  emojiKey: string; // to detect group change (shouldn't happen, but safe)
}

// ============================================================
// Renderer class (Pixi.js v7 — emoji sprites)
// ============================================================

export class Renderer {
  app: PIXI.Application;
  worldContainer: PIXI.Container;
  borderGfx: PIXI.Graphics;
  foodContainer: PIXI.Container;
  creatureContainer: PIXI.Container;
  overlayGfx: PIXI.Graphics; // energy bars + sensors
  config: WorldConfig;

  // Sprite pools keyed by entity id
  private creatureSprites = new Map<number, SpriteEntry>();
  private foodSprites = new Map<number, SpriteEntry>();

  // Pre-built textures
  private creatureTextures: PIXI.Texture[] = [];
  private foodTextures: PIXI.Texture[] = [];

  private selectedCreatureId: number | null = null;
  private isPanning = false;
  private lastMouse = { x: 0, y: 0 };
  private zoom = 1;
  private panX = 0;
  private panY = 0;

  onWorldClick: ((worldX: number, worldY: number) => void) | null = null;

  constructor(config: WorldConfig) {
    this.config = config;
    this.app = new PIXI.Application({
      backgroundColor: 0x0a0a0a,
      antialias: true,
      resizeTo: undefined as unknown as HTMLElement,
    });
    this.worldContainer = new PIXI.Container();
    this.borderGfx = new PIXI.Graphics();
    this.foodContainer = new PIXI.Container();
    this.creatureContainer = new PIXI.Container();
    this.overlayGfx = new PIXI.Graphics();
  }

  init(container: HTMLElement): void {
    this.app.renderer.resize(container.clientWidth, container.clientHeight);
    container.appendChild(this.app.view as HTMLCanvasElement);

    // Pre-render emoji textures
    const creatureSize = Math.round(this.config.creatureDefaults.radius * 4);
    for (const emoji of GROUP_EMOJIS) {
      this.creatureTextures.push(emojiToTexture(emoji, creatureSize));
    }
    const foodSize = Math.round(this.config.food.radius * 4);
    for (const emoji of FOOD_EMOJIS) {
      this.foodTextures.push(emojiToTexture(emoji, foodSize));
    }

    // Scene graph
    this.worldContainer.addChild(this.borderGfx);
    this.worldContainer.addChild(this.foodContainer);
    this.worldContainer.addChild(this.creatureContainer);
    this.worldContainer.addChild(this.overlayGfx);
    this.app.stage.addChild(this.worldContainer);

    // World border
    this.borderGfx.lineStyle(2, 0x333333);
    this.borderGfx.drawRect(0, 0, this.config.world.width, this.config.world.height);

    // Fit world in viewport
    const scaleX = container.clientWidth / this.config.world.width;
    const scaleY = container.clientHeight / this.config.world.height;
    this.zoom = Math.min(scaleX, scaleY) * 0.9;
    this.panX = (container.clientWidth - this.config.world.width * this.zoom) / 2;
    this.panY = (container.clientHeight - this.config.world.height * this.zoom) / 2;
    this.updateTransform();

    this.setupInteraction(container);

    window.addEventListener('resize', () => {
      this.app.renderer.resize(container.clientWidth, container.clientHeight);
    });
  }

  // ============================================================
  // Interaction (pan / zoom / click)
  // ============================================================

  private setupInteraction(_container: HTMLElement): void {
    const canvas = this.app.view as HTMLCanvasElement;

    canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
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
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
        this.isPanning = true;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        e.preventDefault();
      }
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
      if (this.isPanning) {
        this.panX += e.clientX - this.lastMouse.x;
        this.panY += e.clientY - this.lastMouse.y;
        this.lastMouse = { x: e.clientX, y: e.clientY };
        this.updateTransform();
      }
    });

    window.addEventListener('mouseup', () => { this.isPanning = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('click', (e: MouseEvent) => {
      if (e.shiftKey) return;
      const rect = canvas.getBoundingClientRect();
      const worldX = (e.clientX - rect.left - this.panX) / this.zoom;
      const worldY = (e.clientY - rect.top - this.panY) / this.zoom;
      this.onWorldClick?.(worldX, worldY);
    });
  }

  private updateTransform(): void {
    this.worldContainer.position.set(this.panX, this.panY);
    this.worldContainer.scale.set(this.zoom);
  }

  setSelectedCreature(id: number | null): void {
    this.selectedCreatureId = id;
  }

  // ============================================================
  // Render frame
  // ============================================================

  render(creatures: CreatureState[], food: FoodItemState[]): void {
    this.reconcileFood(food);
    this.reconcileCreatures(creatures);
    this.drawOverlays(creatures);
  }

  // ----------------------------------------------------------
  // Food sprites
  // ----------------------------------------------------------

  private reconcileFood(food: FoodItemState[]): void {
    const alive = new Set<number>();

    for (const f of food) {
      alive.add(f.id);
      let entry = this.foodSprites.get(f.id);

      if (!entry) {
        // Pick a stable emoji based on id
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

    // Remove sprites for food that no longer exists
    for (const [id, entry] of this.foodSprites) {
      if (!alive.has(id)) {
        this.foodContainer.removeChild(entry.sprite);
        entry.sprite.destroy();
        this.foodSprites.delete(id);
      }
    }
  }

  // ----------------------------------------------------------
  // Creature sprites
  // ----------------------------------------------------------

  private reconcileCreatures(creatures: CreatureState[]): void {
    const alive = new Set<number>();

    for (const c of creatures) {
      alive.add(c.id);
      const groupIdx = c.dna.groupId % this.creatureTextures.length;
      const emojiKey = GROUP_EMOJIS[groupIdx];
      let entry = this.creatureSprites.get(c.id);

      if (!entry || entry.emojiKey !== emojiKey) {
        // Create or recreate sprite
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
      const desiredSize = c.dna.body.radius * 2.5;
      sprite.width = desiredSize;
      sprite.height = desiredSize;
      sprite.position.set(c.position.x, c.position.y);
      sprite.rotation = c.angle;

      // Selection highlight
      const isSelected = c.id === this.selectedCreatureId;
      sprite.tint = isSelected ? SELECTED_TINT : 0xffffff;
      sprite.alpha = isSelected ? 1 : 0.9;
    }

    // Remove dead creatures
    for (const [id, entry] of this.creatureSprites) {
      if (!alive.has(id)) {
        this.creatureContainer.removeChild(entry.sprite);
        entry.sprite.destroy();
        this.creatureSprites.delete(id);
      }
    }
  }

  // ----------------------------------------------------------
  // Overlay: energy bars + sensor rays (drawn with Graphics)
  // ----------------------------------------------------------

  private drawOverlays(creatures: CreatureState[]): void {
    this.overlayGfx.clear();

    for (const c of creatures) {
      const radius = c.dna.body.radius;
      const isSelected = c.id === this.selectedCreatureId;

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

      // Selected creature: sensors + selection ring
      if (isSelected) {
        // Ring
        this.overlayGfx.lineStyle(1.5, SELECTED_TINT, 0.7);
        this.overlayGfx.drawCircle(c.position.x, c.position.y, radius + 3);

        this.drawSensors(c);
      }
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
