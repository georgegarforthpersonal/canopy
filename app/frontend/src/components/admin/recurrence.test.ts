import { describe, it, expect } from 'vitest';
import { generateDates } from './recurrence';

describe('generateDates', () => {
  it('returns a single date for a one-off, ignoring occurrences', () => {
    expect(generateDates('2026-07-04', 'once', 5)).toEqual(['2026-07-04']);
  });

  it('steps weekly', () => {
    expect(generateDates('2026-07-04', 'weekly', 3)).toEqual([
      '2026-07-04',
      '2026-07-11',
      '2026-07-18',
    ]);
  });

  it('steps fortnightly', () => {
    expect(generateDates('2026-07-04', 'fortnightly', 3)).toEqual([
      '2026-07-04',
      '2026-07-18',
      '2026-08-01',
    ]);
  });

  it('steps by calendar months and clamps short months', () => {
    expect(generateDates('2026-01-31', 'monthly', 3)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
  });

  it('returns [] for a blank or invalid start date', () => {
    expect(generateDates('', 'weekly', 3)).toEqual([]);
    expect(generateDates('not-a-date', 'weekly', 3)).toEqual([]);
  });

  it('returns [] for a non-positive occurrence count', () => {
    expect(generateDates('2026-07-04', 'weekly', 0)).toEqual([]);
    expect(generateDates('2026-07-04', 'weekly', -2)).toEqual([]);
  });
});
