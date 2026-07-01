/**
 * Split a drawn route into contiguous, named sectors.
 *
 * The route is drawn elsewhere (LocationDrawMap); here the user drops dividers
 * along it to carve it into sectors. Click the route to add a divider at the
 * nearest point; click a divider to remove it. Each resulting sector is shown
 * in a distinct shade with an inline-editable name. Sectors are always
 * contiguous (they share divider points), so there are no gaps.
 */

import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import { Box, Paper, Stack, TextField, Typography, Chip } from '@mui/material';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { formatLength, geometryLengthM, type GeoJsonGeometry, type Position } from '../../utils/geometry';
import { splitLine, pointAtFraction, nearestFractionOnLine } from '../../utils/sectorGeometry';

// Alternating red shades so adjacent sectors are distinguishable.
const SECTOR_COLORS = ['#D6273A', '#8A1C28'];

const toLatLng = ([lng, lat]: Position): [number, number] => [lat, lng];

/** Real-world length of a sector's coordinate array. */
function sectorLength(coords: Position[]): number {
  return geometryLengthM({ type: 'LineString', coordinates: coords });
}

interface SectorEditorProps {
  /** The route geometry being sectored (a LineString). */
  routeGeometry: GeoJsonGeometry;
  /** Internal divider fractions (0..1), sorted; N dividers => N+1 sectors. */
  dividers: number[];
  /** Sector names, length === dividers.length + 1. */
  names: string[];
  onChange: (dividers: number[], names: string[]) => void;
}

function FitToLine({ line }: { line: Position[] }) {
  const map = useMap();
  useEffect(() => {
    const bounds = L.latLngBounds(line.map(toLatLng));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
    // Fit once on mount; the route doesn't change while sectoring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function ClickToAddDivider({ line, onAdd }: { line: Position[]; onAdd: (frac: number) => void }) {
  useMapEvents({
    click: (e) => {
      onAdd(nearestFractionOnLine(line, [e.latlng.lng, e.latlng.lat]));
    },
  });
  return null;
}

export default function SectorEditor({ routeGeometry, dividers, names, onChange }: SectorEditorProps) {
  const line = useMemo<Position[]>(
    () => (routeGeometry.type === 'LineString' ? (routeGeometry.coordinates as Position[]) : []),
    [routeGeometry],
  );

  const sectors = useMemo(() => splitLine(line, dividers), [line, dividers]);

  const addDivider = (frac: number) => {
    // Ignore near-duplicate dividers (within 1% of an existing one or the ends).
    if (frac <= 0.01 || frac >= 0.99) return;
    if (dividers.some((d) => Math.abs(d - frac) < 0.01)) return;
    const nextDividers = [...dividers, frac].sort((a, b) => a - b);
    const insertAt = nextDividers.indexOf(frac) + 1;
    const nextNames = [...names];
    nextNames.splice(insertAt, 0, `Sector ${names.length + 1}`);
    onChange(nextDividers, renumberDefaults(nextNames));
  };

  const removeDivider = (index: number) => {
    const nextDividers = dividers.filter((_, i) => i !== index);
    // Merge the two sectors either side of the removed divider: drop the later name.
    const nextNames = names.filter((_, i) => i !== index + 1);
    onChange(nextDividers, renumberDefaults(nextNames));
  };

  const renameSector = (index: number, value: string) => {
    const nextNames = [...names];
    nextNames[index] = value;
    onChange(dividers, nextNames);
  };

  const center = line.length > 0 ? toLatLng(line[0]) : ([0, 0] as [number, number]);

  return (
    <Box>
      <Paper elevation={2} sx={{ mb: 1, overflow: 'hidden', position: 'relative' }}>
        {/* Offset past the Leaflet zoom control (top-left) so they don't overlap. */}
        <Stack direction="row" sx={{ position: 'absolute', top: 10, left: 52, right: 10, zIndex: 1000 }}>
          <Chip
            size="small"
            label={
              dividers.length === 0
                ? 'Click the route to add a divider'
                : `${sectors.length} sectors · click a divider dot to remove`
            }
            sx={{
              bgcolor: 'white',
              boxShadow: 2,
              maxWidth: 340,
              height: 'auto',
              '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5, lineHeight: 1.3 },
            }}
          />
        </Stack>
        <Box sx={{ height: { xs: '280px', sm: '360px' }, width: '100%' }}>
          <MapContainer center={center} zoom={14} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution="Tiles &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
            <FitToLine line={line} />
            <ClickToAddDivider line={line} onAdd={addDivider} />
            {sectors.map((coords, i) => (
              <Polyline
                key={i}
                positions={coords.map(toLatLng)}
                pathOptions={{ color: SECTOR_COLORS[i % SECTOR_COLORS.length], weight: 6 }}
              />
            ))}
            {dividers.map((frac, i) => {
              const [lng, lat] = pointAtFraction(line, frac);
              return (
                <CircleMarker
                  key={`div-${i}`}
                  center={[lat, lng]}
                  radius={7}
                  pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#111111', fillOpacity: 1 }}
                  eventHandlers={{ click: () => removeDivider(i) }}
                />
              );
            })}
          </MapContainer>
        </Box>
      </Paper>

      <Stack spacing={1}>
        {sectors.map((coords, i) => (
          <Stack key={i} direction="row" spacing={1} alignItems="center">
            <Box
              sx={{
                width: 22,
                height: 22,
                borderRadius: '4px',
                flexShrink: 0,
                bgcolor: SECTOR_COLORS[i % SECTOR_COLORS.length],
              }}
            />
            <TextField
              size="small"
              label={`Sector ${i + 1}`}
              value={names[i] ?? ''}
              onChange={(e) => renameSector(i, e.target.value)}
              fullWidth
            />
            <Typography variant="caption" color="text.secondary" sx={{ minWidth: 56, textAlign: 'right' }}>
              {formatLength(sectorLength(coords))}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

/** Rename any auto "Sector N" defaults so their numbers stay sequential. */
function renumberDefaults(names: string[]): string[] {
  return names.map((n, i) => (/^Sector \d+$/.test(n) ? `Sector ${i + 1}` : n));
}
