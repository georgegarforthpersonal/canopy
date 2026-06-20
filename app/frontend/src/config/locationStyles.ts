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
export const LOCATION_TYPE_STYLE: Record<Exclude<LocationType, 'none'>, LocationStyle> = {
  area: { stroke: '#0072B2', fill: '#0072B2', fillOpacity: 0.2, weight: 2 },
  route: { stroke: '#D55E00', fill: '#D55E00', fillOpacity: 0.2, weight: 3 },
  point: { stroke: '#CC79A7', fill: '#CC79A7', fillOpacity: 0.8, weight: 2 },
};
