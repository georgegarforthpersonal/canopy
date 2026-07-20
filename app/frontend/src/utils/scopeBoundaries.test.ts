import { describe, it, expect } from 'vitest';
import { scopeBoundariesToLocations } from './scopeBoundaries';
import type { Location, LocationWithBoundary } from '../services/api';

const boundary = (id: number, sectorIds: number[] = []): LocationWithBoundary => ({
  id,
  name: `Location ${id}`,
  geometry: null,
  boundary_geometry: null,
  sectors: sectorIds.length
    ? sectorIds.map((sid, i) => ({ id: sid, name: `Sector ${sid}`, ordinal: i + 1, geometry: null }))
    : null,
});

const loc = (id: number): Location => ({ id, name: `Location ${id}` });

describe('scopeBoundariesToLocations', () => {
  it('keeps only boundaries whose id is in the available set', () => {
    const result = scopeBoundariesToLocations([boundary(1), boundary(2), boundary(3)], [loc(1), loc(3)]);
    expect(result.map((b) => b.id)).toEqual([1, 3]);
  });

  it('keeps a route when one of its sectors is assigned, even if the route itself is not', () => {
    const result = scopeBoundariesToLocations([boundary(1, [10, 11]), boundary(2, [20])], [loc(11)]);
    expect(result.map((b) => b.id)).toEqual([1]);
  });

  it('returns all boundaries when the survey type has no assigned locations', () => {
    const all = [boundary(1), boundary(2)];
    expect(scopeBoundariesToLocations(all, [])).toBe(all);
  });
});
