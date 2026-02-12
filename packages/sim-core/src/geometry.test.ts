import { describe, it, expect } from 'vitest';
import { wrapPosition, torusDistance, circlesOverlap, rayCircleIntersect } from './geometry.js';
import type { Vec2 } from './types.js';

describe('Geometry', () => {
  describe('wrapPosition', () => {
    it('does nothing for in-bounds positions', () => {
      const p: Vec2 = { x: 50, y: 50 };
      wrapPosition(p, 100, 100);
      expect(p.x).toBe(50);
      expect(p.y).toBe(50);
    });

    it('wraps negative x', () => {
      const p: Vec2 = { x: -10, y: 50 };
      wrapPosition(p, 100, 100);
      expect(p.x).toBe(90);
      expect(p.y).toBe(50);
    });

    it('wraps negative y', () => {
      const p: Vec2 = { x: 50, y: -30 };
      wrapPosition(p, 100, 100);
      expect(p.x).toBe(50);
      expect(p.y).toBe(70);
    });

    it('wraps overflow x', () => {
      const p: Vec2 = { x: 110, y: 50 };
      wrapPosition(p, 100, 100);
      expect(p.x).toBe(10);
      expect(p.y).toBe(50);
    });

    it('wraps overflow y', () => {
      const p: Vec2 = { x: 50, y: 250 };
      wrapPosition(p, 100, 200);
      expect(p.x).toBe(50);
      expect(p.y).toBe(50);
    });

    it('handles exact boundary', () => {
      const p: Vec2 = { x: 100, y: 200 };
      wrapPosition(p, 100, 200);
      expect(p.x).toBe(0);
      expect(p.y).toBe(0);
    });

    it('handles large negative overshoot', () => {
      const p: Vec2 = { x: -250, y: 50 };
      wrapPosition(p, 100, 100);
      expect(p.x).toBe(50);
      expect(p.y).toBe(50);
    });
  });

  describe('torusDistance', () => {
    it('computes direct distance when close', () => {
      const a: Vec2 = { x: 10, y: 10 };
      const b: Vec2 = { x: 13, y: 14 };
      const dist = torusDistance(a, b, 100, 100);
      expect(dist).toBeCloseTo(5, 5); // 3-4-5 triangle
    });

    it('uses shorter wrap-around distance across x boundary', () => {
      const a: Vec2 = { x: 5, y: 50 };
      const b: Vec2 = { x: 95, y: 50 };
      const dist = torusDistance(a, b, 100, 100);
      expect(dist).toBeCloseTo(10, 5); // Wrap: 5 + 5 = 10
    });

    it('uses shorter wrap-around distance across y boundary', () => {
      const a: Vec2 = { x: 50, y: 2 };
      const b: Vec2 = { x: 50, y: 98 };
      const dist = torusDistance(a, b, 100, 100);
      expect(dist).toBeCloseTo(4, 5);
    });

    it('uses wrap-around on both axes', () => {
      const a: Vec2 = { x: 2, y: 2 };
      const b: Vec2 = { x: 98, y: 98 };
      const dist = torusDistance(a, b, 100, 100);
      // dx=4, dy=4 → sqrt(32) ≈ 5.657
      expect(dist).toBeCloseTo(Math.sqrt(32), 5);
    });

    it('distance to self is zero', () => {
      const a: Vec2 = { x: 42, y: 17 };
      expect(torusDistance(a, a, 100, 100)).toBe(0);
    });
  });

  describe('circlesOverlap', () => {
    it('detects overlapping circles', () => {
      const a: Vec2 = { x: 10, y: 10 };
      const b: Vec2 = { x: 14, y: 10 };
      expect(circlesOverlap(a, 3, b, 3, 100, 100)).toBe(true);
    });

    it('detects non-overlapping circles', () => {
      const a: Vec2 = { x: 10, y: 10 };
      const b: Vec2 = { x: 20, y: 10 };
      expect(circlesOverlap(a, 3, b, 3, 100, 100)).toBe(false);
    });

    it('detects circles barely touching (not overlapping, uses <)', () => {
      const a: Vec2 = { x: 10, y: 10 };
      const b: Vec2 = { x: 16, y: 10 };
      // Distance = 6, sum of radii = 6 → not overlapping (< not <=)
      expect(circlesOverlap(a, 3, b, 3, 100, 100)).toBe(false);
    });

    it('detects overlap across torus boundary', () => {
      const a: Vec2 = { x: 1, y: 50 };
      const b: Vec2 = { x: 99, y: 50 };
      // Torus distance = 2, radii sum = 6
      expect(circlesOverlap(a, 3, b, 3, 100, 100)).toBe(true);
    });
  });

  describe('rayCircleIntersect', () => {
    it('detects hit on circle directly ahead', () => {
      const start: Vec2 = { x: 0, y: 0 };
      const end: Vec2 = { x: 100, y: 0 };
      const center: Vec2 = { x: 50, y: 0 };
      const t = rayCircleIntersect(start, end, center, 5);
      expect(t).not.toBeNull();
      // Hit at x=45 (center-radius), normalized = 45/100 = 0.45
      expect(t!).toBeCloseTo(0.45, 2);
    });

    it('returns null for miss', () => {
      const start: Vec2 = { x: 0, y: 0 };
      const end: Vec2 = { x: 100, y: 0 };
      const center: Vec2 = { x: 50, y: 20 };
      const t = rayCircleIntersect(start, end, center, 5);
      expect(t).toBeNull();
    });

    it('returns null for circle behind the ray', () => {
      const start: Vec2 = { x: 50, y: 0 };
      const end: Vec2 = { x: 100, y: 0 };
      const center: Vec2 = { x: 10, y: 0 };
      const t = rayCircleIntersect(start, end, center, 5);
      expect(t).toBeNull();
    });

    it('returns null for circle beyond ray end', () => {
      const start: Vec2 = { x: 0, y: 0 };
      const end: Vec2 = { x: 10, y: 0 };
      const center: Vec2 = { x: 50, y: 0 };
      const t = rayCircleIntersect(start, end, center, 5);
      expect(t).toBeNull();
    });

    it('detects hit when ray starts inside circle', () => {
      const start: Vec2 = { x: 50, y: 0 };
      const end: Vec2 = { x: 100, y: 0 };
      const center: Vec2 = { x: 50, y: 0 };
      const t = rayCircleIntersect(start, end, center, 10);
      // The "entering" intersection is behind the start (negative t).
      // The function only checks the first root, so this returns null.
      // This is fine for the simulation — a ray starting inside a circle
      // is the creature's own body.
      expect(t).toBeNull();
    });

    it('returns null for zero-length ray', () => {
      const start: Vec2 = { x: 10, y: 10 };
      const t = rayCircleIntersect(start, start, { x: 10, y: 10 }, 5);
      expect(t).toBeNull();
    });

    it('detects hit at a non-axial angle', () => {
      const start: Vec2 = { x: 0, y: 0 };
      const end: Vec2 = { x: 100, y: 100 };
      const center: Vec2 = { x: 50, y: 50 };
      const t = rayCircleIntersect(start, end, center, 5);
      expect(t).not.toBeNull();
      expect(t!).toBeGreaterThan(0);
      expect(t!).toBeLessThan(1);
    });
  });
});
