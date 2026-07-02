/**
 * Geometry helpers for location shapes.
 *
 * Works directly on GeoJSON geometries (coordinates are [lng, lat], matching the
 * API and what Leaflet's `toGeoJSON()` produces) so the same shape can be measured
 * before it is sent to the backend.
 */

import L from 'leaflet';

/** A single GeoJSON position: [lng, lat]. */
export type Position = [number, number];

export type GeoJsonGeometryType =
  | 'Point'
  | 'MultiPoint'
  | 'LineString'
  | 'MultiLineString'
  | 'Polygon'
  | 'MultiPolygon';

export interface GeoJsonGeometry {
  type: GeoJsonGeometryType;
  // Coordinates nest differently per geometry type; callers narrow by `type`.
  coordinates: Position | Position[] | Position[][] | Position[][][];
}

const EARTH_RADIUS_M = 6378137; // WGS84 equatorial radius

/**
 * Geodesic area (m²) of a single ring of [lng, lat] positions, using the same
 * spherical-excess approximation as Leaflet.Draw.
 */
function ringAreaSqm(ring: Position[]): number {
  if (ring.length < 3) return 0;
  const d2r = Math.PI / 180;
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    area += (lng2 - lng1) * d2r * (2 + Math.sin(lat1 * d2r) + Math.sin(lat2 * d2r));
  }
  return Math.abs((area * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

function polygonAreaSqm(rings: Position[][]): number {
  if (rings.length === 0) return 0;
  const [outer, ...holes] = rings;
  return ringAreaSqm(outer) - holes.reduce((sum, hole) => sum + ringAreaSqm(hole), 0);
}

/** Area in square metres of a Polygon / MultiPolygon geometry (0 otherwise). */
export function geometryAreaSqm(geometry: GeoJsonGeometry | null | undefined): number {
  if (!geometry) return 0;
  if (geometry.type === 'Polygon') {
    return polygonAreaSqm(geometry.coordinates as Position[][]);
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates as Position[][][]).reduce(
      (sum, polygon) => sum + polygonAreaSqm(polygon),
      0,
    );
  }
  return 0;
}

function lineLengthM(line: Position[]): number {
  let length = 0;
  for (let i = 1; i < line.length; i++) {
    const from = L.latLng(line[i - 1][1], line[i - 1][0]);
    const to = L.latLng(line[i][1], line[i][0]);
    length += from.distanceTo(to);
  }
  return length;
}

/** Length in metres of a LineString / MultiLineString geometry (0 otherwise). */
export function geometryLengthM(geometry: GeoJsonGeometry | null | undefined): number {
  if (!geometry) return 0;
  if (geometry.type === 'LineString') {
    return lineLengthM(geometry.coordinates as Position[]);
  }
  if (geometry.type === 'MultiLineString') {
    return (geometry.coordinates as Position[][]).reduce(
      (sum, line) => sum + lineLengthM(line),
      0,
    );
  }
  return 0;
}

/** Human-readable area, switching from m² to hectares above 1 ha. */
export function formatArea(sqm: number): string {
  if (sqm <= 0) return '';
  const hectares = sqm / 10000;
  if (hectares >= 1) return `${hectares.toFixed(2)} ha`;
  return `${Math.round(sqm)} m²`;
}

/** Human-readable length, switching from m to km above 1 km. */
export function formatLength(metres: number): string {
  if (metres <= 0) return '';
  if (metres >= 1000) return `${(metres / 1000).toFixed(2)} km`;
  return `${Math.round(metres)} m`;
}
