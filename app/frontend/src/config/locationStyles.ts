import type { LocationType } from '../services/api';

export interface LocationStyle {
  stroke: string;
  fill: string;
  fillOpacity: number;
  weight: number;
}

/**
 * Fixed map styling per location type. Colours are from the Okabe–Ito
 * colourblind-safe palette and deliberately avoid green, which is hard to
 * separate from vegetation on satellite imagery.
 */
// Route/transect red.
export const ROUTE_COLOR = '#D6273A';

export const LOCATION_TYPE_STYLE: Record<Exclude<LocationType, 'none'>, LocationStyle> = {
  area: { stroke: '#0072B2', fill: '#0072B2', fillOpacity: 0.2, weight: 2 },
  route: { stroke: ROUTE_COLOR, fill: ROUTE_COLOR, fillOpacity: 0.2, weight: 5 },
  point: { stroke: '#CC79A7', fill: '#CC79A7', fillOpacity: 0.8, weight: 2 },
  // A sector is a segment of a route; share the route colour and weight.
  sector: { stroke: ROUTE_COLOR, fill: ROUTE_COLOR, fillOpacity: 0.2, weight: 5 },
};

/**
 * Discrete per-location colour choices, keyed by the name stored in
 * `location.color`. Same Okabe–Ito-based, satellite-legible constraints as the
 * type defaults above (saturated hues, no green). Null/unknown keys fall back
 * to the location_type default, so the palette can evolve without touching data.
 */
export const LOCATION_COLORS: Record<string, { label: string; hex: string }> = {
  blue: { label: 'Blue', hex: '#0072B2' },
  red: { label: 'Red', hex: ROUTE_COLOR },
  pink: { label: 'Pink', hex: '#CC79A7' },
  orange: { label: 'Orange', hex: '#E69F00' },
  purple: { label: 'Purple', hex: '#7B4FA6' },
  teal: { label: 'Teal', hex: '#009E9B' },
  brown: { label: 'Brown', hex: '#8C5A2B' },
  black: { label: 'Black', hex: '#2B2B2B' },
};

/** A location's stroke/fill hue, honouring its colour key when set. */
export interface ColorableLocation {
  location_type?: LocationType;
  color?: string | null;
}

/**
 * Map style for a location: the fixed per-type style, with stroke/fill swapped
 * for the location's own colour when one is set. Opacity and weight always come
 * from the type so shapes keep reading as area / route / point.
 */
export function styleForLocation(loc: ColorableLocation): LocationStyle {
  const type = loc.location_type && loc.location_type !== 'none' ? loc.location_type : 'area';
  const base = LOCATION_TYPE_STYLE[type];
  const custom = loc.color ? LOCATION_COLORS[loc.color] : undefined;
  if (!custom) return base;
  return { ...base, stroke: custom.hex, fill: custom.hex };
}
