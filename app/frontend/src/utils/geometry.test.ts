/**
 * Geometry Utility Tests
 */

import { describe, it, expect } from 'vitest';
import {
  collectPositions,
  geometryAreaSqm,
  geometryLengthM,
  formatArea,
  formatLength,
  type GeoJsonGeometry,
} from './geometry';

describe('collectPositions', () => {
  it('flattens positions from any geometry nesting depth', () => {
    const point: GeoJsonGeometry = { type: 'Point', coordinates: [-2.4, 51.15] };
    const polygon: GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [[[-2.4, 51.15], [-2.39, 51.15], [-2.39, 51.16], [-2.4, 51.15]]],
    };
    expect(collectPositions(point)).toEqual([[-2.4, 51.15]]);
    expect(collectPositions(polygon)).toHaveLength(4);
    expect(collectPositions(null)).toEqual([]);
  });
});

describe('geometryAreaSqm', () => {
  it('measures a roughly 1km x 1km polygon near 1,000,000 m²', () => {
    // ~0.009 degrees latitude ≈ 1 km; longitude span chosen near the equator-ish UK lat.
    const polygon: GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [[
        [-2.4, 51.15],
        [-2.3856, 51.15],
        [-2.3856, 51.159],
        [-2.4, 51.159],
        [-2.4, 51.15],
      ]],
    };
    const area = geometryAreaSqm(polygon);
    expect(area).toBeGreaterThan(800_000);
    expect(area).toBeLessThan(1_200_000);
  });

  it('returns 0 for non-polygon geometry', () => {
    expect(geometryAreaSqm({ type: 'Point', coordinates: [-2.4, 51.15] })).toBe(0);
    expect(geometryAreaSqm(null)).toBe(0);
  });
});

describe('geometryLengthM', () => {
  it('measures the length of a line', () => {
    const line: GeoJsonGeometry = {
      type: 'LineString',
      coordinates: [
        [-2.4, 51.15],
        [-2.4, 51.159], // ~1 km north
      ],
    };
    const length = geometryLengthM(line);
    expect(length).toBeGreaterThan(900);
    expect(length).toBeLessThan(1100);
  });

  it('returns 0 for non-line geometry', () => {
    expect(geometryLengthM({ type: 'Point', coordinates: [-2.4, 51.15] })).toBe(0);
    expect(geometryLengthM(undefined)).toBe(0);
  });
});

describe('formatArea', () => {
  it('shows m² below a hectare and ha above', () => {
    expect(formatArea(500)).toBe('500 m²');
    expect(formatArea(15000)).toBe('1.50 ha');
    expect(formatArea(0)).toBe('');
  });
});

describe('formatLength', () => {
  it('shows m below a km and km above', () => {
    expect(formatLength(500)).toBe('500 m');
    expect(formatLength(1500)).toBe('1.50 km');
    expect(formatLength(0)).toBe('');
  });
});
