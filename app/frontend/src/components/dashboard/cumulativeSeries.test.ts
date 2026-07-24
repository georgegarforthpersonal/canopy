import { describe, it, expect } from 'vitest';
import { combineCumulative, totalUniqueSpecies, typesInSeries } from './cumulativeSeries';
import type { CumulativeSpeciesDataPoint } from '../../services/api';

const point = (
  date: string,
  type: string,
  cumulative_count: number,
  new_species: string[] = [],
): CumulativeSpeciesDataPoint => ({ date, type, cumulative_count, new_species });

describe('combineCumulative', () => {
  it('sums per-type cumulatives with forward-fill on missing dates', () => {
    const data = [
      point('2026-01-01', 'bird', 2, ['Skylark', 'Wren']),
      point('2026-02-01', 'mammal', 1, ['Badger']),
      point('2026-03-01', 'bird', 3, ['Turtle Dove']),
    ];
    expect(combineCumulative(data)).toEqual([
      point('2026-01-01', 'all', 2, ['Skylark', 'Wren']),
      // bird holds at 2 while mammal arrives
      point('2026-02-01', 'all', 3, ['Badger']),
      point('2026-03-01', 'all', 4, ['Turtle Dove']),
    ]);
  });

  it('passes a single-type series through with combined tagging', () => {
    const data = [point('2026-01-01', 'bird', 5, ['a'])];
    expect(combineCumulative(data)).toEqual([point('2026-01-01', 'all', 5, ['a'])]);
  });

  it('handles an empty series', () => {
    expect(combineCumulative([])).toEqual([]);
  });
});

describe('totalUniqueSpecies', () => {
  it('sums each type\'s maximum', () => {
    expect(
      totalUniqueSpecies([
        point('2026-01-01', 'bird', 2),
        point('2026-03-01', 'bird', 7),
        point('2026-02-01', 'mammal', 3),
      ]),
    ).toBe(10);
  });

  it('is zero for an empty series', () => {
    expect(totalUniqueSpecies([])).toBe(0);
  });
});

describe('typesInSeries', () => {
  it('lists distinct types', () => {
    expect(
      typesInSeries([point('a', 'bird', 1), point('b', 'mammal', 1), point('c', 'bird', 2)]),
    ).toEqual(['bird', 'mammal']);
  });
});
