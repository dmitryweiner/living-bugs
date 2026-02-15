import { describe, it, expect, beforeEach } from 'vitest';
import { SpatialHash } from './spatial-hash.js';
import type { Vec2 } from './types.js';

interface TestEntity {
  id: number;
  position: Vec2;
}

function entity(id: number, x: number, y: number): TestEntity {
  return { id, position: { x, y } };
}

describe('SpatialHash', () => {
  let hash: SpatialHash<TestEntity>;

  beforeEach(() => {
    // 200x200 world, 50x50 cells → 4x4 grid
    hash = new SpatialHash<TestEntity>(200, 200, 50);
  });

  describe('insert and clear', () => {
    it('inserts entities and returns them in queryRadius', () => {
      const e = entity(1, 25, 25);
      hash.insert(e);
      const results = hash.queryRadius({ x: 25, y: 25 }, 10);
      expect(results).toContain(e);
    });

    it('returns empty after clear', () => {
      hash.insert(entity(1, 25, 25));
      hash.clear();
      const results = hash.queryRadius({ x: 25, y: 25 }, 100);
      expect(results).toHaveLength(0);
    });

    it('handles multiple entities in the same cell', () => {
      const e1 = entity(1, 10, 10);
      const e2 = entity(2, 20, 20);
      hash.insert(e1);
      hash.insert(e2);
      const results = hash.queryRadius({ x: 15, y: 15 }, 50);
      expect(results).toContain(e1);
      expect(results).toContain(e2);
    });

    it('handles entities in different cells', () => {
      const e1 = entity(1, 10, 10);   // cell (0,0)
      const e2 = entity(2, 110, 110); // cell (2,2)
      hash.insert(e1);
      hash.insert(e2);
      // Query with small radius around e1 should not return e2
      const results = hash.queryRadius({ x: 10, y: 10 }, 10);
      expect(results).toContain(e1);
      expect(results).not.toContain(e2);
    });
  });

  describe('queryRadius', () => {
    it('returns entities within radius', () => {
      const e1 = entity(1, 50, 50);
      const e2 = entity(2, 60, 60);
      const e3 = entity(3, 180, 180); // far away
      hash.insert(e1);
      hash.insert(e2);
      hash.insert(e3);

      const results = hash.queryRadius({ x: 55, y: 55 }, 50);
      expect(results).toContain(e1);
      expect(results).toContain(e2);
      // e3 might or might not be returned (spatial hash returns candidates, not exact)
    });

    it('handles torus wrapping — query near left edge finds entities near right edge', () => {
      // World is 200x200
      const e = entity(1, 195, 100); // near right edge
      hash.insert(e);

      // Query from near left edge — should wrap and find e
      const results = hash.queryRadius({ x: 5, y: 100 }, 50);
      expect(results).toContain(e);
    });

    it('handles torus wrapping — query near top edge finds entities near bottom edge', () => {
      const e = entity(1, 100, 195); // near bottom edge
      hash.insert(e);

      const results = hash.queryRadius({ x: 100, y: 5 }, 50);
      expect(results).toContain(e);
    });

    it('handles torus wrapping — corner case', () => {
      const e = entity(1, 195, 195); // near bottom-right corner
      hash.insert(e);

      const results = hash.queryRadius({ x: 5, y: 5 }, 50);
      expect(results).toContain(e);
    });

    it('returns candidate entities (caller must do exact distance check)', () => {
      const e = entity(1, 90, 90); // very close to cell boundary
      hash.insert(e);

      // Even a small radius query spanning the cell should return it
      const results = hash.queryRadius({ x: 55, y: 55 }, 50);
      expect(results).toContain(e);
    });

    it('zero radius query returns entities in the same cell only', () => {
      const e1 = entity(1, 25, 25);  // cell (0,0)
      const e2 = entity(2, 75, 75);  // cell (1,1)
      hash.insert(e1);
      hash.insert(e2);

      const results = hash.queryRadius({ x: 25, y: 25 }, 0);
      expect(results).toContain(e1);
      expect(results).not.toContain(e2);
    });
  });

  describe('queryRay', () => {
    it('returns entities along a horizontal ray', () => {
      const e1 = entity(1, 50, 50);  // on the ray path
      const e2 = entity(2, 100, 50); // on the ray path, farther
      const e3 = entity(3, 50, 150); // off the ray path
      hash.insert(e1);
      hash.insert(e2);
      hash.insert(e3);

      // Start inside world bounds to avoid negative AABB wrapping
      const results = hash.queryRay({ x: 20, y: 50 }, { x: 150, y: 50 }, 5);
      expect(results).toContain(e1);
      expect(results).toContain(e2);
    });

    it('returns entities along a vertical ray', () => {
      const e1 = entity(1, 50, 50);
      const e2 = entity(2, 50, 150);
      hash.insert(e1);
      hash.insert(e2);

      const results = hash.queryRay({ x: 50, y: 20 }, { x: 50, y: 180 }, 5);
      expect(results).toContain(e1);
      expect(results).toContain(e2);
    });

    it('returns entities along a diagonal ray', () => {
      const e = entity(1, 100, 100);
      hash.insert(e);

      const results = hash.queryRay({ x: 30, y: 30 }, { x: 150, y: 150 }, 10);
      expect(results).toContain(e);
    });

    it('margin expands the query bounding box', () => {
      // Entity is slightly off the ray but within margin
      const e = entity(1, 100, 60);
      hash.insert(e);

      // Ray goes along y=50, margin=20 should catch entity at y=60
      const results = hash.queryRay({ x: 50, y: 50 }, { x: 150, y: 50 }, 20);
      expect(results).toContain(e);
    });

    it('does not duplicate entities in overlapping cells', () => {
      const e = entity(1, 50, 50);
      hash.insert(e);

      const results = hash.queryRay({ x: 0, y: 0 }, { x: 100, y: 100 }, 30);
      const count = results.filter(r => r.id === e.id).length;
      expect(count).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('handles entity at exact world boundary (0,0)', () => {
      const e = entity(1, 0, 0);
      hash.insert(e);
      const results = hash.queryRadius({ x: 0, y: 0 }, 10);
      expect(results).toContain(e);
    });

    it('handles entity at max boundary (worldWidth-1, worldHeight-1)', () => {
      const e = entity(1, 199, 199);
      hash.insert(e);
      const results = hash.queryRadius({ x: 199, y: 199 }, 10);
      expect(results).toContain(e);
    });

    it('handles negative coordinates (wraps correctly)', () => {
      // SpatialHash wraps negative coords via modulo
      const e = entity(1, -10, -10); // wraps to (190, 190) in a 200x200 world
      hash.insert(e);
      const results = hash.queryRadius({ x: 190, y: 190 }, 20);
      expect(results).toContain(e);
    });

    it('handles coordinates exceeding world bounds', () => {
      const e = entity(1, 250, 250); // wraps to (50, 50) in a 200x200 world
      hash.insert(e);
      const results = hash.queryRadius({ x: 50, y: 50 }, 20);
      expect(results).toContain(e);
    });

    it('works with very large query radius (spanning whole world)', () => {
      const e1 = entity(1, 10, 10);
      const e2 = entity(2, 190, 190);
      hash.insert(e1);
      hash.insert(e2);

      const results = hash.queryRadius({ x: 100, y: 100 }, 200);
      expect(results).toContain(e1);
      expect(results).toContain(e2);
    });

    it('works with very small world', () => {
      const small = new SpatialHash<TestEntity>(10, 10, 5);
      const e = entity(1, 5, 5);
      small.insert(e);
      const results = small.queryRadius({ x: 5, y: 5 }, 3);
      expect(results).toContain(e);
    });

    it('handles single-cell world', () => {
      const single = new SpatialHash<TestEntity>(10, 10, 20);
      const e1 = entity(1, 3, 3);
      const e2 = entity(2, 7, 7);
      single.insert(e1);
      single.insert(e2);
      const results = single.queryRadius({ x: 5, y: 5 }, 1);
      expect(results).toContain(e1);
      expect(results).toContain(e2);
    });
  });
});
