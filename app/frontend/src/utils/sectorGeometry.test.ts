import { describe, it, expect } from 'vitest';
import { splitLine, pointAtFraction, nearestFractionOnLine } from './sectorGeometry';
import type { Position } from './geometry';

// A simple 2-segment line running east then continuing east (equal-ish spans).
const LINE: Position[] = [
  [0, 0],
  [1, 0],
  [2, 0],
];

describe('splitLine', () => {
  it('returns the whole line as one sector when there are no dividers', () => {
    const sectors = splitLine(LINE, []);
    expect(sectors).toHaveLength(1);
    expect(sectors[0]).toEqual(LINE);
  });

  it('splits into N+1 contiguous sectors that share boundary points', () => {
    const sectors = splitLine(LINE, [0.25, 0.75]);
    expect(sectors).toHaveLength(3);
    // Contiguous: each sector's last point equals the next sector's first point.
    expect(sectors[0][sectors[0].length - 1]).toEqual(sectors[1][0]);
    expect(sectors[1][sectors[1].length - 1]).toEqual(sectors[2][0]);
    // Starts at the line start, ends at the line end.
    expect(sectors[0][0]).toEqual([0, 0]);
    expect(sectors[2][sectors[2].length - 1]).toEqual([2, 0]);
  });

  it('places a mid divider at the geometric midpoint', () => {
    const [first] = splitLine(LINE, [0.5]);
    expect(first[first.length - 1]).toEqual([1, 0]);
  });

  it('ignores dividers outside (0, 1)', () => {
    expect(splitLine(LINE, [0, 1, 1.5])).toHaveLength(1);
  });
});

describe('pointAtFraction', () => {
  it('returns endpoints at 0 and 1', () => {
    expect(pointAtFraction(LINE, 0)).toEqual([0, 0]);
    expect(pointAtFraction(LINE, 1)).toEqual([2, 0]);
  });

  it('returns the midpoint at 0.5', () => {
    expect(pointAtFraction(LINE, 0.5)).toEqual([1, 0]);
  });
});

describe('nearestFractionOnLine', () => {
  it('projects a point near the middle to ~0.5', () => {
    const frac = nearestFractionOnLine(LINE, [1, 0.2]);
    expect(frac).toBeCloseTo(0.5, 5);
  });

  it('clamps a point before the start to 0', () => {
    const frac = nearestFractionOnLine(LINE, [-1, 0]);
    expect(frac).toBeCloseTo(0, 5);
  });
});
