import { describe, expect, it } from 'vitest';
import {
  deriveBand,
  frequencyScoreErrors,
  hasFrequencyScore,
  percentAsNumber,
  pickFrequencyScore,
  summariseFrequencyScore,
} from './frequencyScore';

describe('percentAsNumber', () => {
  it('passes numbers through', () => {
    expect(percentAsNumber(41.66)).toBe(41.66);
  });

  it('parses the API string serialisation of NUMERIC', () => {
    expect(percentAsNumber('53.30')).toBe(53.3);
  });

  it('treats null, undefined, empty and junk as not recorded', () => {
    expect(percentAsNumber(null)).toBeNull();
    expect(percentAsNumber(undefined)).toBeNull();
    expect(percentAsNumber('')).toBeNull();
    expect(percentAsNumber('abc')).toBeNull();
  });
});

describe('deriveBand', () => {
  it('applies the band ranges', () => {
    expect(deriveBand(92.82)).toBe('5');
    expect(deriveBand(73.76)).toBe('4');
    expect(deriveBand(53.3)).toBe('3');
    expect(deriveBand(26.2)).toBe('2');
    expect(deriveBand(15.0)).toBe('1+');
    expect(deriveBand(4.2)).toBe('1');
  });

  it('rounds to the whole percent first, as the source reports do', () => {
    // 20.8 prints as band 2 in the reports (rounds to 21), not 1+.
    expect(deriveBand(20.8)).toBe('2');
    expect(deriveBand(10.4)).toBe('1');
  });
});

describe('pickFrequencyScore', () => {
  it('always returns both keys so spreading clears stale values', () => {
    expect(pickFrequencyScore(null)).toEqual({
      percent_frequency: null,
      frequency_band: null,
    });
    const stale = { percent_frequency: 12.5, frequency_band: '1+', other: true };
    expect({ ...stale, ...pickFrequencyScore(null) }).toEqual({
      percent_frequency: null,
      frequency_band: null,
      other: true,
    });
  });

  it('copies recorded values', () => {
    expect(pickFrequencyScore({ percent_frequency: 81.2, frequency_band: '5' })).toEqual({
      percent_frequency: 81.2,
      frequency_band: '5',
    });
  });
});

describe('hasFrequencyScore', () => {
  it('is false for empty scores', () => {
    expect(hasFrequencyScore(null)).toBe(false);
    expect(hasFrequencyScore({})).toBe(false);
    expect(hasFrequencyScore({ percent_frequency: null, frequency_band: null })).toBe(false);
  });

  it('is true when either field is recorded', () => {
    expect(hasFrequencyScore({ frequency_band: '+' })).toBe(true);
    expect(hasFrequencyScore({ percent_frequency: 2.78 })).toBe(true);
    expect(hasFrequencyScore({ percent_frequency: '2.78' })).toBe(true);
  });
});

describe('frequencyScoreErrors', () => {
  it('accepts a valid score', () => {
    expect(frequencyScoreErrors({ percent_frequency: 41.66, frequency_band: '3' })).toEqual([]);
    expect(frequencyScoreErrors({ frequency_band: '+' })).toEqual([]);
    expect(frequencyScoreErrors(null)).toEqual([]);
  });

  it('rejects out-of-range and over-precise percents', () => {
    expect(frequencyScoreErrors({ percent_frequency: 120 })).toHaveLength(1);
    expect(frequencyScoreErrors({ percent_frequency: -1 })).toHaveLength(1);
    expect(frequencyScoreErrors({ percent_frequency: 12.345 })).toHaveLength(1);
  });

  it('rejects bands off the scale', () => {
    expect(frequencyScoreErrors({ frequency_band: '6' })).toHaveLength(1);
    expect(frequencyScoreErrors({ frequency_band: 'x' })).toHaveLength(1);
  });
});

describe('summariseFrequencyScore', () => {
  it('returns null when nothing was recorded', () => {
    expect(summariseFrequencyScore(null)).toBeNull();
    expect(summariseFrequencyScore({})).toBeNull();
  });

  it('describes what was recorded', () => {
    expect(
      summariseFrequencyScore({ percent_frequency: 41.66, frequency_band: '3' }),
    ).toBe('41.66% of quadrats (band 3)');
    expect(summariseFrequencyScore({ percent_frequency: '53.30' })).toBe('53.3% of quadrats');
    expect(summariseFrequencyScore({ frequency_band: '+' })).toBe('band +');
  });
});
