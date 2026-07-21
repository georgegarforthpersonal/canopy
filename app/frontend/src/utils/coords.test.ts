/**
 * Coordinate Parsing Utility Tests
 */

import { describe, it, expect } from 'vitest';
import { parseLatLng } from './coords';

describe('parseLatLng', () => {
  it('parses comma-and-space separated coordinates', () => {
    expect(parseLatLng('51.12345, -2.34567')).toEqual({ ok: true, lat: 51.12345, lng: -2.34567 });
  });

  it('parses comma-only separated coordinates', () => {
    expect(parseLatLng('51.12345,-2.34567')).toEqual({ ok: true, lat: 51.12345, lng: -2.34567 });
  });

  it('parses whitespace-only separated coordinates', () => {
    expect(parseLatLng('51.12345 -2.34567')).toEqual({ ok: true, lat: 51.12345, lng: -2.34567 });
  });

  it('parses integer degrees', () => {
    expect(parseLatLng('51, -2')).toEqual({ ok: true, lat: 51, lng: -2 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseLatLng('  51.1, -2.3  ')).toEqual({ ok: true, lat: 51.1, lng: -2.3 });
  });

  it('accepts boundary values', () => {
    expect(parseLatLng('90, 180')).toEqual({ ok: true, lat: 90, lng: 180 });
    expect(parseLatLng('-90, -180')).toEqual({ ok: true, lat: -90, lng: -180 });
  });

  it('rejects empty input', () => {
    expect(parseLatLng('').ok).toBe(false);
    expect(parseLatLng('   ').ok).toBe(false);
  });

  it('rejects a single number', () => {
    expect(parseLatLng('51.12345').ok).toBe(false);
  });

  it('rejects three numbers', () => {
    expect(parseLatLng('51.1, -2.3, 4.5').ok).toBe(false);
  });

  it('rejects non-numeric tokens', () => {
    expect(parseLatLng('fifty-one, minus-two').ok).toBe(false);
    expect(parseLatLng('51.1N, 2.3W').ok).toBe(false);
    expect(parseLatLng('51.1.2, -2.3').ok).toBe(false);
  });

  it('reports a format error distinct from range errors', () => {
    const format = parseLatLng('nonsense');
    const range = parseLatLng('91, 0');
    expect(format.ok).toBe(false);
    expect(range.ok).toBe(false);
    if (!format.ok && !range.ok) {
      expect(format.error).not.toBe(range.error);
    }
  });

  it('rejects out-of-range latitude', () => {
    const result = parseLatLng('90.0001, 0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Latitude');
    expect(parseLatLng('-91, 0').ok).toBe(false);
  });

  it('rejects out-of-range longitude', () => {
    const result = parseLatLng('0, 180.5');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Longitude');
    expect(parseLatLng('0, -181').ok).toBe(false);
  });
});
