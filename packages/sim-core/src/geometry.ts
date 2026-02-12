import type { Vec2 } from './types.js';

/** Wrap position into [0, width) x [0, height) (torus). Mutates pos. */
export function wrapPosition(pos: Vec2, width: number, height: number): void {
  pos.x = ((pos.x % width) + width) % width;
  pos.y = ((pos.y % height) + height) % height;
}

/** Shortest distance between two points on a torus. */
export function torusDistance(a: Vec2, b: Vec2, width: number, height: number): number {
  let dx = Math.abs(a.x - b.x);
  let dy = Math.abs(a.y - b.y);
  if (dx > width / 2) dx = width - dx;
  if (dy > height / 2) dy = height - dy;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Check if two circles overlap on a torus. */
export function circlesOverlap(
  a: Vec2, ra: number, b: Vec2, rb: number,
  width: number, height: number,
): boolean {
  return torusDistance(a, b, width, height) < ra + rb;
}

/**
 * Ray-circle intersection test.
 * Returns normalized distance [0,1] along the ray, or null if no hit.
 */
export function rayCircleIntersect(
  rayStart: Vec2, rayEnd: Vec2, center: Vec2, radius: number,
): number | null {
  const dx = rayEnd.x - rayStart.x;
  const dy = rayEnd.y - rayStart.y;
  const rayLen = Math.sqrt(dx * dx + dy * dy);
  if (rayLen === 0) return null;

  const fx = rayStart.x - center.x;
  const fy = rayStart.y - center.y;

  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;

  let discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  discriminant = Math.sqrt(discriminant);
  const t = (-b - discriminant) / (2 * a);

  if (t >= 0 && t <= 1) {
    return t;
  }
  return null;
}
