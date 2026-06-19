/**
 * FieldBoundaryOverlay Component
 *
 * Renders location geometry with labels on Leaflet maps. Supports areas
 * (polygons), routes (lines) and points, used as a visual reference when
 * recording sightings or managing locations.
 */

import { Polygon, Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import type { LocationWithBoundary } from '../../services/api';
import type { GeoJsonGeometry, Position } from '../../utils/geometry';
import { LOCATION_TYPE_STYLE } from '../../config';

interface FieldBoundaryOverlayProps {
  locations: LocationWithBoundary[];
  interactive?: boolean; // Whether geometry responds to hover/click
}

// GeoJSON positions are [lng, lat]; Leaflet wants [lat, lng].
const toLatLng = ([lng, lat]: Position): [number, number] => [lat, lng];
const ringToLatLngs = (ring: Position[]) => ring.map(toLatLng);

function geometryLabel(name: string) {
  return (
    <Tooltip permanent direction="center" className="field-boundary-label">
      {name}
    </Tooltip>
  );
}

export default function FieldBoundaryOverlay({
  locations,
  interactive = false,
}: FieldBoundaryOverlayProps) {
  const renderable = locations
    .map((loc) => ({ loc, geometry: loc.geometry }))
    .filter((entry): entry is { loc: LocationWithBoundary; geometry: GeoJsonGeometry } => entry.geometry !== null);

  if (renderable.length === 0) {
    return null;
  }

  return (
    <>
      {renderable.map(({ loc, geometry }) => {
        if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
          const style = LOCATION_TYPE_STYLE.area;
          const rings: Position[][] =
            geometry.type === 'Polygon'
              ? (geometry.coordinates as Position[][])
              : (geometry.coordinates as Position[][][]).flat();
          const positions = rings.map(ringToLatLngs);
          return (
            <Polygon
              key={loc.id}
              positions={positions as LatLngExpression[][]}
              pathOptions={{ fillColor: style.fill, fillOpacity: style.fillOpacity, color: style.stroke, weight: style.weight }}
              interactive={interactive}
            >
              {geometryLabel(loc.name)}
            </Polygon>
          );
        }

        if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
          const style = LOCATION_TYPE_STYLE.route;
          const lines: Position[][] =
            geometry.type === 'LineString'
              ? [geometry.coordinates as Position[]]
              : (geometry.coordinates as Position[][]);
          const positions = lines.map(ringToLatLngs);
          return (
            <Polyline
              key={loc.id}
              positions={positions as LatLngExpression[][]}
              pathOptions={{ color: style.stroke, weight: style.weight }}
              interactive={interactive}
            >
              {geometryLabel(loc.name)}
            </Polyline>
          );
        }

        if (geometry.type === 'Point') {
          const style = LOCATION_TYPE_STYLE.point;
          const position = toLatLng(geometry.coordinates as Position);
          return (
            <CircleMarker
              key={loc.id}
              center={position}
              radius={7}
              pathOptions={{ color: style.stroke, fillColor: style.fill, fillOpacity: style.fillOpacity, weight: style.weight }}
              interactive={interactive}
            >
              {geometryLabel(loc.name)}
            </CircleMarker>
          );
        }

        return null;
      })}
    </>
  );
}
