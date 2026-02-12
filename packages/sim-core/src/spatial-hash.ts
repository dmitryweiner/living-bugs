import type { Vec2 } from './types.js';

/**
 * Simple spatial hash grid for fast neighbor queries on a torus world.
 * Entities are indexed by their cell position. Queries return all entities
 * in the neighborhood of cells around the query point.
 */
export class SpatialHash<T extends { position: Vec2 }> {
  private cellSize: number;
  private cols: number;
  private rows: number;
  private worldWidth: number;
  private worldHeight: number;

  /** grid[row * cols + col] = array of entries in that cell */
  private grid: T[][];

  constructor(worldWidth: number, worldHeight: number, cellSize: number) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.cellSize = cellSize;
    this.cols = Math.ceil(worldWidth / cellSize);
    this.rows = Math.ceil(worldHeight / cellSize);
    this.grid = new Array(this.cols * this.rows);
    for (let i = 0; i < this.grid.length; i++) {
      this.grid[i] = [];
    }
  }

  /** Clear all entries. Call before re-inserting each tick. */
  clear(): void {
    for (let i = 0; i < this.grid.length; i++) {
      this.grid[i].length = 0;
    }
  }

  /** Insert an entity. */
  insert(entity: T): void {
    const col = this.posToCol(entity.position.x);
    const row = this.posToRow(entity.position.y);
    this.grid[row * this.cols + col].push(entity);
  }

  /**
   * Query all entities within `radius` of `center`.
   * Returns entities from all cells that *could* contain hits;
   * caller must do exact distance check.
   */
  queryRadius(center: Vec2, radius: number): T[] {
    const cellSpan = Math.ceil(radius / this.cellSize);
    const centerCol = this.posToCol(center.x);
    const centerRow = this.posToRow(center.y);

    const results: T[] = [];

    for (let dr = -cellSpan; dr <= cellSpan; dr++) {
      for (let dc = -cellSpan; dc <= cellSpan; dc++) {
        const col = ((centerCol + dc) % this.cols + this.cols) % this.cols;
        const row = ((centerRow + dr) % this.rows + this.rows) % this.rows;
        const bucket = this.grid[row * this.cols + col];
        for (let i = 0; i < bucket.length; i++) {
          results.push(bucket[i]);
        }
      }
    }

    return results;
  }

  /**
   * Query all entities in cells that a ray from `start` to `end` passes through,
   * plus a margin for entity radius.
   */
  queryRay(start: Vec2, end: Vec2, margin: number): T[] {
    // Compute bounding box of the ray in world coords, then find all overlapping cells.
    // For simplicity, use the axis-aligned bounding box + margin.
    const minX = Math.min(start.x, end.x) - margin;
    const maxX = Math.max(start.x, end.x) + margin;
    const minY = Math.min(start.y, end.y) - margin;
    const maxY = Math.max(start.y, end.y) + margin;

    const col0 = this.posToCol(minX);
    const col1 = this.posToCol(maxX);
    const row0 = this.posToRow(minY);
    const row1 = this.posToRow(maxY);

    const results: T[] = [];
    const visited = new Set<number>();

    // Handle wrap-around: iterate through the cell range
    const colSpan = ((col1 - col0) % this.cols + this.cols) % this.cols;
    const rowSpan = ((row1 - row0) % this.rows + this.rows) % this.rows;

    for (let dr = 0; dr <= rowSpan && dr <= this.rows; dr++) {
      for (let dc = 0; dc <= colSpan && dc <= this.cols; dc++) {
        const col = (col0 + dc) % this.cols;
        const row = (row0 + dr) % this.rows;
        const idx = row * this.cols + col;
        if (visited.has(idx)) continue;
        visited.add(idx);
        const bucket = this.grid[idx];
        for (let i = 0; i < bucket.length; i++) {
          results.push(bucket[i]);
        }
      }
    }

    return results;
  }

  private posToCol(x: number): number {
    // Wrap to [0, worldWidth) then divide by cellSize
    const wrapped = ((x % this.worldWidth) + this.worldWidth) % this.worldWidth;
    return Math.min(Math.floor(wrapped / this.cellSize), this.cols - 1);
  }

  private posToRow(y: number): number {
    const wrapped = ((y % this.worldHeight) + this.worldHeight) % this.worldHeight;
    return Math.min(Math.floor(wrapped / this.cellSize), this.rows - 1);
  }
}
