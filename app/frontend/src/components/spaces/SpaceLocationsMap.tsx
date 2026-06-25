/**
 * Read-only map of the locations and devices in a space. Location shapes are
 * drawn via the shared FieldBoundaryOverlay; each location gets a lettered
 * circular marker (A/B/C…) matching the list view, and devices get amber
 * markers. The map fits all features on first load.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Box } from '@mui/material';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L, { LatLngBounds, LatLng } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Device, LocationWithBoundary } from '../../services/api';
import FieldBoundaryOverlay from '../surveys/FieldBoundaryOverlay';
import { stopMapAnimation } from '../../utils/stopMapAnimation';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../../config';
import { spaceColors } from '../../pages/spaces/spacesTokens';

export interface LetteredLocation {
  location: LocationWithBoundary;
  letter: string;
  /** [lat, lng] representative point, or null if the location has no geometry. */
  point: [number, number] | null;
}

interface SpaceLocationsMapProps {
  letteredLocations: LetteredLocation[];
  devices: Device[];
  height?: number;
}

function circleMarkerIcon(label: string, color: string): L.DivIcon {
  return L.divIcon({
    className: 'space-location-marker',
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;">${label}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);

  useEffect(() => {
    if (!done.current && points.length > 0) {
      done.current = true;
      const bounds = new LatLngBounds(points.map(([lat, lng]) => new LatLng(lat, lng)));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
    return () => {
      stopMapAnimation(map);
    };
  }, [points, map]);

  return null;
}

export default function SpaceLocationsMap({
  letteredLocations,
  devices,
  height = 320,
}: SpaceLocationsMapProps) {
  const deviceColor = spaceColors.amberMonth;

  const fitPoints = useMemo<[number, number][]>(() => {
    const locPts = letteredLocations
      .map((l) => l.point)
      .filter((p): p is [number, number] => p != null);
    const devPts = devices
      .filter((d) => d.latitude && d.longitude)
      .map((d) => [d.latitude, d.longitude] as [number, number]);
    return [...locPts, ...devPts];
  }, [letteredLocations, devices]);

  const boundaries = useMemo(
    () => letteredLocations.map((l) => l.location),
    [letteredLocations],
  );

  return (
    <Box sx={{ height, width: '100%', position: 'relative' }}>
      <MapContainer
        center={DEFAULT_MAP_CENTER}
        zoom={DEFAULT_MAP_ZOOM}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {boundaries.length > 0 && <FieldBoundaryOverlay locations={boundaries} />}

        {letteredLocations.map(
          ({ letter, point, location }) =>
            point && (
              <Marker
                key={`loc-${location.id}`}
                position={point}
                icon={circleMarkerIcon(letter, spaceColors.brand)}
              />
            ),
        )}

        {devices
          .filter((d) => d.latitude && d.longitude)
          .map((d) => (
            <Marker
              key={`dev-${d.id}`}
              position={[d.latitude, d.longitude]}
              icon={circleMarkerIcon('', deviceColor)}
            />
          ))}

        <FitBounds points={fitPoints} />
      </MapContainer>
    </Box>
  );
}
