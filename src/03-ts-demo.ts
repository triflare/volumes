/// <reference path="../types/scratch.d.ts" />

// A 2D point with typed coordinates.
interface Point {
  x: number;
  y: number;
}

export function distanceBetween(a: Point, b: Point): number {
  const dx: number = b.x - a.x;
  const dy: number = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
