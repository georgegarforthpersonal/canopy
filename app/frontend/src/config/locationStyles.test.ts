import { describe, it, expect } from 'vitest';
import { LOCATION_COLORS, LOCATION_TYPE_STYLE, styleForLocation } from './locationStyles';

describe('styleForLocation', () => {
  it('returns the type default when no colour is set', () => {
    expect(styleForLocation({ location_type: 'route', color: null })).toEqual(
      LOCATION_TYPE_STYLE.route,
    );
    expect(styleForLocation({ location_type: 'point' })).toEqual(LOCATION_TYPE_STYLE.point);
  });

  it('swaps stroke/fill for the chosen colour but keeps type opacity and weight', () => {
    const style = styleForLocation({ location_type: 'route', color: 'orange' });
    expect(style.stroke).toBe(LOCATION_COLORS.orange.hex);
    expect(style.fill).toBe(LOCATION_COLORS.orange.hex);
    expect(style.weight).toBe(LOCATION_TYPE_STYLE.route.weight);
    expect(style.fillOpacity).toBe(LOCATION_TYPE_STYLE.route.fillOpacity);
  });

  it('falls back to the type default for an unknown colour key', () => {
    expect(styleForLocation({ location_type: 'area', color: 'chartreuse' })).toEqual(
      LOCATION_TYPE_STYLE.area,
    );
  });

  it('treats a missing or "none" type as area for styling purposes', () => {
    expect(styleForLocation({ color: 'teal' }).stroke).toBe(LOCATION_COLORS.teal.hex);
    expect(styleForLocation({ location_type: 'none' })).toEqual(LOCATION_TYPE_STYLE.area);
  });
});
