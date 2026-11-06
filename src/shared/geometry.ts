export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Corners of a pen (an oriented rectangle) centred on (x, y). */
export function penCorners(x: number, y: number, angle: number, length: number, width: number): Vec[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const hl = length / 2;
  const hw = width / 2;
  return [
    { x: x + c * hl - s * hw, y: y + s * hl + c * hw },
    { x: x - c * hl - s * hw, y: y - s * hl + c * hw },
    { x: x - c * hl + s * hw, y: y - s * hl - c * hw },
    { x: x + c * hl + s * hw, y: y + s * hl - c * hw },
  ];
}

function project(points: readonly Vec[], axis: Vec): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const d = p.x * axis.x + p.y * axis.y;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/**
 * Separating-axis test between a convex polygon and an axis-aligned rectangle.
 * Returns true when they overlap with positive area (touching edges do not count).
 */
export function polygonOverlapsRect(poly: readonly Vec[], rect: Rect): boolean {
  const rectPts: Vec[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
  const axes: Vec[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    axes.push({ x: -ey / len, y: ex / len });
  }
  for (const axis of axes) {
    const [pMin, pMax] = project(poly, axis);
    const [rMin, rMax] = project(rectPts, axis);
    if (pMax <= rMin || rMax <= pMin) return false;
  }
  return true;
}

export function pointInRect(p: Vec, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Shortest distance from a point to the nearest table edge (negative when outside). */
export function edgeDistance(p: Vec, r: Rect): number {
  const inside = Math.min(p.x - r.x, r.x + r.w - p.x, p.y - r.y, r.y + r.h - p.y);
  return inside;
}

export function distToSegment(p: Vec, a: Vec, b: Vec): { dist: number; t: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby || 1;
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  return { dist: Math.hypot(p.x - cx, p.y - cy), t };
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
