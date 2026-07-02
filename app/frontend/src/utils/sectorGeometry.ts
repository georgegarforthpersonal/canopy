/**
 * Geometry helpers for splitting a route (LineString) into contiguous sectors.
 *
 * A route is divided by "dividers" — internal boundary positions expressed as
 * fractions of the route's total length, strictly between 0 and 1. N dividers
 * yield N + 1 contiguous sectors that share their boundary points exactly (no
 * gaps, no overlaps). Distances use a simple equirectangular metric, which is
 * more than accurate enough over the length of a survey transect and only needs
 * to be internally consistent to produce sensible fractions.
 */

import type { Position } from './geometry';

/** Approximate planar length of a segment (metric is internally consistent). */
function segmentLength(a: Position, b: Position): number {
  const latRad = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const dx = (b[0] - a[0]) * Math.cos(latRad);
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/** Cumulative distance to each vertex; last entry is the total length. */
export function cumulativeDistances(line: Position[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < line.length; i++) {
    cum.push(cum[i - 1] + segmentLength(line[i - 1], line[i]));
  }
  return cum;
}

function lerp(a: Position, b: Position, t: number): Position {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Point at an absolute distance along the line. */
function pointAtDistance(line: Position[], cum: number[], dist: number): Position {
  const total = cum[cum.length - 1];
  if (dist <= 0) return line[0];
  if (dist >= total) return line[line.length - 1];
  for (let i = 1; i < line.length; i++) {
    if (cum[i] >= dist) {
      const segStart = cum[i - 1];
      const segLen = cum[i] - segStart;
      const t = segLen === 0 ? 0 : (dist - segStart) / segLen;
      return lerp(line[i - 1], line[i], t);
    }
  }
  return line[line.length - 1];
}

/** Point at a fraction (0..1) of the line's length. */
export function pointAtFraction(line: Position[], fraction: number): Position {
  const cum = cumulativeDistances(line);
  return pointAtDistance(line, cum, fraction * cum[cum.length - 1]);
}

/**
 * Split a line into contiguous sub-lines at the given divider fractions.
 * Dividers need not be pre-sorted; values outside (0, 1) are ignored.
 * Returns `dividers.length + 1` sectors, each a LineString coordinate array.
 */
export function splitLine(line: Position[], dividers: number[]): Position[][] {
  if (line.length < 2) return [line];
  const cum = cumulativeDistances(line);
  const total = cum[cum.length - 1];
  const bounds = [0, ...dividers.filter((d) => d > 0 && d < 1).sort((a, b) => a - b), 1];

  const sectors: Position[][] = [];
  for (let s = 0; s < bounds.length - 1; s++) {
    const d0 = bounds[s] * total;
    const d1 = bounds[s + 1] * total;
    const pts: Position[] = [pointAtDistance(line, cum, d0)];
    for (let i = 0; i < line.length; i++) {
      if (cum[i] > d0 && cum[i] < d1) pts.push(line[i]);
    }
    pts.push(pointAtDistance(line, cum, d1));
    sectors.push(pts);
  }
  return sectors;
}

/** Squared distance from point p to segment ab, plus the clamped parameter t. */
function projectOnSegment(p: Position, a: Position, b: Position): { t: number; dist2: number } {
  const latRad = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const cos = Math.cos(latRad);
  const ax = a[0] * cos;
  const bx = b[0] * cos;
  const px = p[0] * cos;
  const dx = bx - ax;
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t;
  const cy = a[1] + dy * t;
  const ex = px - cx;
  const ey = p[1] - cy;
  return { t, dist2: ex * ex + ey * ey };
}

/**
 * Fraction (0..1) of the point on the line nearest to `p` — used to turn a map
 * click into a divider position.
 */
export function nearestFractionOnLine(line: Position[], p: Position): number {
  const cum = cumulativeDistances(line);
  const total = cum[cum.length - 1];
  if (total === 0) return 0;
  let best = { dist2: Infinity, frac: 0 };
  for (let i = 1; i < line.length; i++) {
    const { t, dist2 } = projectOnSegment(p, line[i - 1], line[i]);
    if (dist2 < best.dist2) {
      const dist = cum[i - 1] + (cum[i] - cum[i - 1]) * t;
      best = { dist2, frac: dist / total };
    }
  }
  return best.frac;
}
