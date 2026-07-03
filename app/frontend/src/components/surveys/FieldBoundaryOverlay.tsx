/**
 * FieldBoundaryOverlay Component
 *
 * Renders location geometry with labels on Leaflet maps. Supports areas
 * (polygons), routes (lines) and points, used as a visual reference when
 * recording sightings or managing locations.
 *
 * When `onEditLocation` is supplied the shapes become clickable and open a
 * popup (mirroring the device markers) with Edit / Delete actions. Area
 * polygons are then selectable on their outline only, so clicking inside a
 * field doesn't grab the click.
 */

import { useState, Fragment, type ReactElement } from 'react';
import { Polygon, Polyline, CircleMarker, Marker, Tooltip, Popup } from 'react-leaflet';
import L, { type LatLngExpression } from 'leaflet';
import { Button, Chip, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { locationDisplayName } from '../../services/api';
import type { LocationWithBoundary, Sector, LocationType } from '../../services/api';
import {
  geometryAreaSqm,
  geometryLengthM,
  formatArea,
  formatLength,
  type GeoJsonGeometry,
  type Position,
} from '../../utils/geometry';
import { LOCATION_TYPE_STYLE, ROUTE_COLOR } from '../../config';
import MapEntityPopup from '../MapEntityPopup';

// Endpoint / sector-boundary markers for a sectored route:
// filled circle = route start, hollow circle = each sector change, square = end.
const START_ICON = L.divIcon({
  className: '',
  html: `<div style="box-sizing:border-box;width:16px;height:16px;border-radius:50%;background:${ROUTE_COLOR};border:2px solid #fff;box-shadow:0 0 0 1.5px ${ROUTE_COLOR}"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});
const DIVIDER_ICON = L.divIcon({
  className: '',
  html: `<div style="box-sizing:border-box;width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid ${ROUTE_COLOR};box-shadow:0 0 0 1px rgba(0,0,0,0.15)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});
const END_ICON = L.divIcon({
  className: '',
  html: `<div style="box-sizing:border-box;width:14px;height:14px;border-radius:3px;background:#fff;border:3px solid ${ROUTE_COLOR};box-shadow:0 0 0 1px rgba(0,0,0,0.15)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

interface FieldBoundaryOverlayProps {
  locations: LocationWithBoundary[];
  interactive?: boolean; // Whether geometry responds to hover/click
  // When provided, clicking a location's shape (or any of its sectors) opens a
  // popup with Edit/Delete — used to manage locations from a map view.
  onEditLocation?: (loc: LocationWithBoundary) => void;
  onDeleteLocation?: (loc: LocationWithBoundary) => void;
}

// Dark red used to single out a hovered sector.
const SECTOR_HOVER_STROKE = '#8A1C28';

const TYPE_LABEL: Record<LocationType, string> = {
  area: 'Area',
  route: 'Transect',
  point: 'Point',
  none: 'Location',
  sector: 'Sector',
};

// GeoJSON positions are [lng, lat]; Leaflet wants [lat, lng].
const toLatLng = ([lng, lat]: Position): [number, number] => [lat, lng];
const ringToLatLngs = (ring: Position[]) => ring.map(toLatLng);

// Shapes share Leaflet's overlayPane where later renders stack on top; draw
// largest first so smaller shapes stay clickable (area → route → point).
function stackRank(geometry: GeoJsonGeometry): number {
  switch (geometry.type) {
    case 'Polygon':
    case 'MultiPolygon':
      return 0;
    case 'LineString':
    case 'MultiLineString':
      return 1;
    default: // Point
      return 2;
  }
}

/**
 * Endpoint + sector-boundary markers for a sectored route: a filled circle at
 * the route start, a hollow circle at each sector change, and a square at the
 * end. Non-interactive so they never steal hover/click from the sector lines.
 */
function sectorEndpointMarkers(
  locId: number | string,
  sectors: (Sector & { geometry: GeoJsonGeometry })[],
): ReactElement[] {
  const markers: ReactElement[] = [];
  const firstCoords = sectors[0].geometry.coordinates as Position[];
  markers.push(
    <Marker key={`${locId}-start`} position={toLatLng(firstCoords[0])} icon={START_ICON} interactive={false} />,
  );
  // A divider sits at the shared point between consecutive sectors.
  for (let i = 0; i < sectors.length - 1; i++) {
    const coords = sectors[i].geometry.coordinates as Position[];
    markers.push(
      <Marker
        key={`${locId}-div-${i}`}
        position={toLatLng(coords[coords.length - 1])}
        icon={DIVIDER_ICON}
        interactive={false}
      />,
    );
  }
  const lastCoords = sectors[sectors.length - 1].geometry.coordinates as Position[];
  markers.push(
    <Marker
      key={`${locId}-end`}
      position={toLatLng(lastCoords[lastCoords.length - 1])}
      icon={END_ICON}
      interactive={false}
    />,
  );
  return markers;
}

function nameLabel(name: string, hover: boolean) {
  // Hover-only when the shape is interactive (managed maps); permanent on
  // read-only reference maps, where there's nothing to hover over.
  return hover ? (
    <Tooltip direction="top" className="field-boundary-label" sticky>
      {name}
    </Tooltip>
  ) : (
    <Tooltip permanent direction="center" className="field-boundary-label">
      {name}
    </Tooltip>
  );
}

/** One-line "type · size" detail for a location's popup. */
function locationDetail(loc: LocationWithBoundary, geometry: GeoJsonGeometry): string {
  if (loc.location_type === 'route') {
    const n = loc.sectors?.length ?? 0;
    const len = formatLength(geometryLengthM(geometry));
    return n > 0 ? `${n} sector${n === 1 ? '' : 's'} · ${len}` : len;
  }
  if (loc.location_type === 'area') return formatArea(geometryAreaSqm(geometry));
  return '';
}

export default function FieldBoundaryOverlay({
  locations,
  interactive = false,
  onEditLocation,
  onDeleteLocation,
}: FieldBoundaryOverlayProps) {
  const [hoveredSectorId, setHoveredSectorId] = useState<number | null>(null);

  // A click handler implies the shapes must respond to pointer events.
  const clickable = !!onEditLocation;
  const isInteractive = interactive || clickable;

  const renderPopup = (loc: LocationWithBoundary, geometry: GeoJsonGeometry) => {
    if (!clickable) return null;
    const detail = locationDetail(loc, geometry);
    return (
      <Popup>
        <MapEntityPopup
          title={locationDisplayName(loc)}
          chips={
            <Chip
              label={TYPE_LABEL[loc.location_type ?? 'none']}
              size="small"
              variant="outlined"
              sx={{ height: 20, fontSize: '0.7rem' }}
            />
          }
          detail={
            detail ? (
              <Typography variant="caption" color="text.secondary">
                {detail}
              </Typography>
            ) : undefined
          }
          actions={
            <>
              <Button
                size="small"
                startIcon={<EditIcon sx={{ fontSize: 14 }} />}
                onClick={() => onEditLocation!(loc)}
                sx={{ fontSize: '0.7rem', minWidth: 0, py: 0.25 }}
              >
                Edit
              </Button>
              {onDeleteLocation && (
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteIcon sx={{ fontSize: 14 }} />}
                  onClick={() => onDeleteLocation(loc)}
                  sx={{ fontSize: '0.7rem', minWidth: 0, py: 0.25 }}
                >
                  Delete
                </Button>
              )}
            </>
          }
        />
      </Popup>
    );
  };

  // A sector can arrive twice: nested in its parent route AND as a standalone
  // location (e.g. a space's assigned locations). Drawing both stacks a plain
  // polyline over the route's segment, blocking its hover highlight — skip the
  // standalone copy when its route is already rendered.
  const coveredSectorIds = new Set(
    locations.flatMap((l) =>
      l.location_type === 'route' && l.geometry ? (l.sectors ?? []).map((s) => s.id) : [],
    ),
  );

  const renderable = locations
    .filter((loc) => !(loc.location_type === 'sector' && coveredSectorIds.has(loc.id)))
    .map((loc) => ({ loc, geometry: loc.geometry }))
    .filter((entry): entry is { loc: LocationWithBoundary; geometry: GeoJsonGeometry } => entry.geometry !== null)
    .sort((a, b) => stackRank(a.geometry) - stackRank(b.geometry));

  if (renderable.length === 0) {
    return null;
  }

  // Endpoint/divider markers for standalone sectors, grouped by parent route
  // and ordered by ordinal, mirroring how a sectored route renders.
  const standaloneSectorGroups = new Map<string, (Sector & { geometry: GeoJsonGeometry })[]>();
  for (const { loc, geometry } of renderable) {
    if (loc.location_type !== 'sector' || geometry.type !== 'LineString') continue;
    const key = loc.parent_name ?? `sector-${loc.id}`;
    const group = standaloneSectorGroups.get(key) ?? [];
    group.push({ id: loc.id, name: loc.name, ordinal: loc.ordinal ?? 0, geometry });
    standaloneSectorGroups.set(key, group);
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
              pathOptions={{
                fillColor: style.fill,
                fillOpacity: style.fillOpacity,
                color: style.stroke,
                weight: style.weight,
                // Only the outline is selectable, not the filled interior.
                className: clickable ? 'location-outline-only' : undefined,
              }}
              interactive={isInteractive}
            >
              {nameLabel(loc.name, isInteractive)}
              {renderPopup(loc, geometry)}
            </Polygon>
          );
        }

        if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
          const style = LOCATION_TYPE_STYLE.route;

          // Routes divided into sectors render one polyline per sector (each
          // with its own LineString geometry) instead of the undivided line.
          const sectors = (loc.sectors ?? []).filter(
            (s): s is Sector & { geometry: GeoJsonGeometry } => s.geometry !== null,
          );
          if (loc.location_type === 'route' && sectors.length > 0) {
            const sectorLines = sectors.map((sector, idx) => {
              const sectorPositions = ringToLatLngs(sector.geometry.coordinates as Position[]);
              const hovered = isInteractive && hoveredSectorId === sector.id;
              const sectorLabel = `${loc.name} · ${sector.name || `Sector ${sector.ordinal}`}`;
              return (
                <Polyline
                  key={`${loc.id}-sector-${sector.id}`}
                  positions={sectorPositions as LatLngExpression[]}
                  pathOptions={{
                    color: hovered ? SECTOR_HOVER_STROKE : style.stroke,
                    weight: hovered ? style.weight + 3 : style.weight,
                  }}
                  interactive={isInteractive}
                  eventHandlers={
                    isInteractive
                      ? {
                          mouseover: () => setHoveredSectorId(sector.id),
                          mouseout: () =>
                            setHoveredSectorId((prev) => (prev === sector.id ? null : prev)),
                        }
                      : undefined
                  }
                >
                  {isInteractive ? (
                    // Hover reveals which sector is which.
                    <Tooltip direction="top" className="field-boundary-label" sticky>
                      {sectorLabel}
                    </Tooltip>
                  ) : (
                    // Reference layer: keep the single permanent route-name label.
                    idx === 0 && nameLabel(loc.name, false)
                  )}
                  {renderPopup(loc, geometry)}
                </Polyline>
              );
            });
            return (
              <Fragment key={`${loc.id}-sectors`}>
                {sectorLines}
                {sectorEndpointMarkers(loc.id, sectors)}
              </Fragment>
            );
          }

          // A standalone sector (rendered without its parent route) draws like
          // a segment of a sectored route: per-sector hover highlight and a
          // "<route> · <sector>" label. Its endpoint markers render per group
          // below, so a fully-assigned route reads the same as in admin.
          if (loc.location_type === 'sector' && geometry.type === 'LineString') {
            const hovered = isInteractive && hoveredSectorId === loc.id;
            const label = loc.parent_name ? `${loc.parent_name} · ${loc.name}` : loc.name;
            return (
              <Polyline
                key={loc.id}
                positions={ringToLatLngs(geometry.coordinates as Position[]) as LatLngExpression[]}
                pathOptions={{
                  color: hovered ? SECTOR_HOVER_STROKE : style.stroke,
                  weight: hovered ? style.weight + 3 : style.weight,
                }}
                interactive={isInteractive}
                eventHandlers={
                  isInteractive
                    ? {
                        mouseover: () => setHoveredSectorId(loc.id),
                        mouseout: () =>
                          setHoveredSectorId((prev) => (prev === loc.id ? null : prev)),
                      }
                    : undefined
                }
              >
                {nameLabel(label, isInteractive)}
                {renderPopup(loc, geometry)}
              </Polyline>
            );
          }

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
              interactive={isInteractive}
            >
              {/* A sector shown as its own location is named after its route. */}
              {nameLabel(locationDisplayName(loc), isInteractive)}
              {renderPopup(loc, geometry)}
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
              interactive={isInteractive}
            >
              {nameLabel(loc.name, isInteractive)}
              {renderPopup(loc, geometry)}
            </CircleMarker>
          );
        }

        return null;
      })}
      {Array.from(standaloneSectorGroups.entries()).flatMap(([key, sectors]) =>
        sectorEndpointMarkers(`standalone-${key}`, sectors.sort((a, b) => a.ordinal - b.ordinal)),
      )}
    </>
  );
}
