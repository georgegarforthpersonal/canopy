import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  CircularProgress,
  LinearProgress,
  Alert,
  Tooltip,
  IconButton,
  ToggleButtonGroup,
  ToggleButton,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
} from '@mui/material';
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, AttributionControl, useMap, useMapEvents } from 'react-leaflet';
import { DivIcon, LatLngBounds, LatLng, Map as LeafletMap } from 'leaflet';
import MapIcon from '@mui/icons-material/Map';
import SatelliteIcon from '@mui/icons-material/Satellite';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import dayjs from 'dayjs';
import 'leaflet/dist/leaflet.css';
import { stopMapAnimation } from '../../utils/stopMapAnimation';
import { ecotopiaAPI } from '../../services/api';
import type { EcotopiaDevice, EcotopiaGpsFix } from '../../services/api';
import { useMapFullscreen, MapResizeHandler } from '../../hooks';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../../config';
import { brandColors } from '../../theme';

// Tracks always start from the programme start, not a rolling window. The GPS
// endpoint takes a `days` count, so we convert this date to days at request time.
const TRACK_START = '2026-06-02';

// Cluster radius in screen pixels (~50 m at zoom 16) — pins closer than this
// at the current zoom are merged into a single group marker.
const CLUSTER_PIXEL_RADIUS = 20;

// Convert pixel radius → decimal places for the grid-snapping approach so
// that the threshold scales smoothly as the user zooms in or out.
function colocationDecimals(zoom: number): number {
  const thresholdDeg = (CLUSTER_PIXEL_RADIUS * 360) / (Math.pow(2, zoom) * 256);
  return Math.max(1, Math.round(-Math.log10(thresholdDeg)));
}

function tagName(device: EcotopiaDevice): string {
  return device.uuid ? device.uuid.slice(-4).toUpperCase() : device.id;
}

function birdLabel(device: EcotopiaDevice): string | null {
  if (!device.sex && !device.ring_number) return null;
  const symbol = device.sex === 'female' ? '♀' : device.sex === 'male' ? '♂' : '';
  const ring = device.ring_number
    ? `${device.ring_number}${device.ring_colour ? ` (${device.ring_colour})` : ''}`
    : '';
  return [symbol, ring].filter(Boolean).join(' ');
}

interface DeviceGroup {
  key: string;
  latitude: number;
  longitude: number;
  devices: EcotopiaDevice[];
}

function groupByLocation(devices: EcotopiaDevice[], zoom: number, selectedId: string | null): DeviceGroup[] {
  const dp = colocationDecimals(zoom);
  const groups = new Map<string, DeviceGroup>();
  for (const d of devices) {
    if (d.latitude == null || d.longitude == null) continue;
    // The selected tracker always gets its own pin so it stays visible even when
    // zoomed out far enough to cluster its neighbours.
    const key = d.id === selectedId ? `sel:${d.id}` : `${d.latitude.toFixed(dp)},${d.longitude.toFixed(dp)}`;
    const existing = groups.get(key);
    if (existing) existing.devices.push(d);
    else groups.set(key, { key, latitude: d.latitude, longitude: d.longitude, devices: [d] });
  }
  return Array.from(groups.values());
}

// Circular pin for a single device. When another tracker is selected the
// unselected pins are dimmed + desaturated (focus + context); the selected pin
// is emphasised with a larger size and a white ring.
function badgeIcon(
  text: string,
  bg: string,
  opts: { dimmed?: boolean; emphasized?: boolean } = {},
): DivIcon {
  const { dimmed = false, emphasized = false } = opts;
  const size = emphasized ? 40 : 34;
  const fontSize = emphasized ? 13 : 11;
  const shadow = emphasized
    ? 'box-shadow:0 0 0 3px rgba(255,255,255,0.95),0 2px 6px rgba(0,0,0,0.4);'
    : 'box-shadow:0 1px 4px rgba(0,0,0,0.35);';
  const dim = dimmed ? 'filter:grayscale(100%);opacity:0.4;' : '';
  return new DivIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:2px solid #fff;color:#fff;display:flex;align-items:center;justify-content:center;font-size:${fontSize}px;font-weight:700;line-height:1;${shadow}${dim}">${text}</div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Pill-shaped icon for co-located groups — visually distinct from individual circular pins.
function clusterIcon(count: number, dimmed = false): DivIcon {
  const w = 42, h = 28;
  const dim = dimmed ? 'filter:grayscale(100%);opacity:0.4;' : '';
  return new DivIcon({
    html: `<div style="width:${w}px;height:${h}px;border-radius:6px;background:${brandColors.main};border:2px solid #fff;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,0.35);${dim}">${count}</div>`,
    className: '',
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
  });
}

// Fits the view to all tags once, on first load. Selecting or deselecting a
// tracker never moves the map — the only post-load view change is a cluster tap.
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const hasFit = useRef(false);
  useEffect(() => {
    if (!hasFit.current && points.length > 0) {
      hasFit.current = true;
      if (points.length === 1) {
        map.setView(points[0], 14);
      } else {
        map.fitBounds(new LatLngBounds(points.map((p) => new LatLng(p[0], p[1]))), { padding: [60, 60], maxZoom: 15 });
      }
    }
    return () => { stopMapAnimation(map); };
  }, [points, map]);
  return null;
}

// Clears the selected tracker when the user clicks the map background. Leaflet
// marker clicks don't propagate here, so pin taps still select normally.
function MapClickHandler({ onClick }: { onClick: () => void }) {
  useMapEvents({ click: () => onClick() });
  return null;
}

// Notifies the parent whenever the map zoom level changes so grouping can
// recalculate — pins that overlap at low zoom split apart as the user zooms in.
function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const handler = () => onZoom(map.getZoom());
    map.on('zoomend', handler);
    return () => {
      map.off('zoomend', handler);
    };
  }, [map, onZoom]);
  return null;
}

// The selected tracker's historical path, terminating at its current pin.
function TrackOverlay({ device, track, color }: { device: EcotopiaDevice; track: EcotopiaGpsFix[]; color: string }) {
  let points: [number, number][] = track.map((f) => [f.latitude, f.longitude]);
  // The paginated GPS history can lag behind status_gps, so extend the line to
  // the device's current position so it ends at the badge pin.
  if (device.latitude != null && device.longitude != null) {
    const last = points[points.length - 1];
    if (!last || Math.abs(last[0] - device.latitude) > 1e-5 || Math.abs(last[1] - device.longitude) > 1e-5) {
      points = [...points, [device.latitude, device.longitude]];
    }
  }
  if (points.length === 0) return null;
  return (
    <>
      {points.length > 1 && <Polyline positions={points} pathOptions={{ color, weight: 3, opacity: 0.85 }} />}
      <CircleMarker
        center={points[points.length - 1]}
        radius={5}
        pathOptions={{ color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1 }}
      />
    </>
  );
}

// Read-only list of every located tag. The selected row is highlighted to tie
// it to the pin on the map; selection itself happens by tapping a pin.
function TrackerTable({
  devices,
  colors,
  selectedId,
}: {
  devices: EcotopiaDevice[];
  colors: Map<string, string>;
  selectedId: string | null;
}) {
  return (
    <TableContainer component={Paper} elevation={0} sx={{ mt: 2, border: '1px solid', borderColor: 'divider' }}>
      <Table
        size="small"
        aria-label="tracker devices"
        sx={{ '& .MuiTableCell-root': { px: 1, fontSize: '0.8125rem' } }}
      >
        <TableHead>
          <TableRow>
            <TableCell>Tag</TableCell>
            <TableCell>Bird</TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>Last fix</TableCell>
            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>Battery</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {devices.map((d) => (
            <TableRow key={d.id} selected={d.id === selectedId}>
              <TableCell>
                <Stack direction="row" alignItems="center" gap={1}>
                  <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: colors.get(d.id) ?? brandColors.main, flexShrink: 0 }} />
                  <Typography sx={{ fontWeight: 600, fontSize: 'inherit' }}>
                    {tagName(d)}
                  </Typography>
                  {d.description && (
                    <Typography variant="caption" color="text.secondary">
                      {d.description}
                    </Typography>
                  )}
                </Stack>
              </TableCell>
              <TableCell>{birdLabel(d) ?? '—'}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {d.gps_timestamp ? dayjs(d.gps_timestamp).format('D MMM HH:mm') : '—'}
              </TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                {d.battery_voltage != null ? `${d.battery_voltage.toFixed(1)} V` : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** Cannwood-only GPS Tracking tab: tracked tags at their latest GNSS location, with
 *  co-located tags clustered. Clicking a single tracker's pin — or its row in the
 *  table below the map — overlays that one tracker's historical track. */
export function DeviceTrackerMap() {
  const { isFullscreen, toggleFullscreen, fullscreenContainerSx, fullscreenMapSx } = useMapFullscreen();
  const [mapType, setMapType] = useState<'street' | 'satellite'>('street');

  const [zoom, setZoom] = useState<number>(DEFAULT_MAP_ZOOM);
  const mapRef = useRef<LeafletMap | null>(null);

  const [devices, setDevices] = useState<EcotopiaDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Historical track of the one tracker the user clicked on. The map always shows
  // current positions; selecting a tracker overlays that single tracker's history.
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [track, setTrack] = useState<EcotopiaGpsFix[]>([]);
  const [trackLoading, setTrackLoading] = useState(false);

  const trackDays = useMemo(() => Math.max(1, dayjs().diff(dayjs(TRACK_START), 'day')), []);

  const toggleSelect = (id: string) => setSelectedDeviceId((cur) => (cur === id ? null : id));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    ecotopiaAPI
      .getDevices()
      .then((data) => !cancelled && setDevices(data))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load devices'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Drop the previous tracker's path immediately so we never draw a new
    // tracker's pin along the old track while the new history loads.
    setTrack([]);
    if (!selectedDeviceId) return;
    let cancelled = false;
    setTrackLoading(true);
    ecotopiaAPI
      .getGpsHistory(selectedDeviceId, trackDays)
      .then((fixes) => !cancelled && setTrack(fixes))
      .catch(() => !cancelled && setTrack([]))
      .finally(() => !cancelled && setTrackLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedDeviceId, trackDays]);

  const groups = useMemo(() => groupByLocation(devices, zoom, selectedDeviceId), [devices, zoom, selectedDeviceId]);
  const locatedDevices = useMemo(
    () =>
      devices
        .filter((d) => d.latitude != null && d.longitude != null)
        .sort((a, b) => tagName(a).localeCompare(tagName(b))),
    [devices],
  );

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );

  // Each tracker's colour is defined server-side on the bird mapping, so it stays
  // stable across renders and consistent with any other view that uses it.
  const deviceColors = useMemo<Map<string, string>>(
    () => new Map(devices.map((d) => [d.id, d.track_colour ?? brandColors.main])),
    [devices],
  );

  const fitPoints = useMemo<[number, number][]>(
    () => locatedDevices.map((d) => [d.latitude!, d.longitude!] as [number, number]),
    [locatedDevices],
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error) return <Alert severity="error">{error}</Alert>;
  if (locatedDevices.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400, color: 'text.secondary' }}>
        <Typography variant="body1">No tracker devices with a recent location</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Paper
        elevation={0}
        className="fullscreen-map-container"
        sx={{ overflow: 'hidden', border: '1px solid', borderColor: 'divider', position: 'relative', ...fullscreenContainerSx }}
      >
        {trackLoading && (
          <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1100, height: 3 }} />
        )}
        <Stack direction="row" spacing={0.5} sx={{ position: 'absolute', top: 10, right: 10, zIndex: 1000 }}>
          <ToggleButtonGroup
            value={mapType}
            exclusive
            onChange={(_, v) => v && setMapType(v)}
            size="small"
            sx={{ bgcolor: 'white', boxShadow: 2 }}
          >
            <ToggleButton value="street" aria-label="street map">
              <Tooltip title="Street Map">
                <MapIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="satellite" aria-label="satellite view">
              <Tooltip title="Satellite View">
                <SatelliteIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
          <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
            <IconButton size="small" onClick={toggleFullscreen} sx={{ bgcolor: 'white', boxShadow: 2, '&:hover': { bgcolor: 'grey.100' } }}>
              {isFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Stack>

        <Box sx={{ height: 500, width: '100%', ...fullscreenMapSx }}>
          <MapContainer ref={mapRef} center={DEFAULT_MAP_CENTER} zoom={DEFAULT_MAP_ZOOM} attributionControl={false} style={{ height: '100%', width: '100%' }}>
            <AttributionControl prefix={false} />
            {mapType === 'satellite' ? (
              <TileLayer
                key="satellite"
                attribution='Tiles &copy; Esri'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
            ) : (
              <TileLayer
                key="street"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
            )}

            {selectedDevice && (
              <TrackOverlay
                device={selectedDevice}
                track={track}
                color={deviceColors.get(selectedDevice.id) ?? brandColors.main}
              />
            )}

            {groups.map((group) => {
              const hasSelection = selectedDeviceId != null;
              if (group.devices.length === 1) {
                const d = group.devices[0];
                const isSel = d.id === selectedDeviceId;
                const icon = badgeIcon(tagName(d), deviceColors.get(d.id) ?? brandColors.main, {
                  emphasized: isSel,
                  dimmed: hasSelection && !isSel,
                });
                return (
                  <Marker
                    key={group.key}
                    position={[group.latitude, group.longitude]}
                    icon={icon}
                    zIndexOffset={isSel ? 1000 : 0}
                    eventHandlers={{ click: () => toggleSelect(d.id) }}
                  />
                );
              }
              // The selected tracker is never in a cluster, so clusters dim whenever
              // one is selected. A cluster can't toggle a track unambiguously — tap it
              // to zoom in and split it into individually-clickable pins.
              const icon = clusterIcon(group.devices.length, hasSelection);
              return (
                <Marker
                  key={group.key}
                  position={[group.latitude, group.longitude]}
                  icon={icon}
                  eventHandlers={{
                    click: () => {
                      const m = mapRef.current;
                      if (m) m.flyTo([group.latitude, group.longitude], Math.min(m.getZoom() + 2, 17));
                    },
                  }}
                />
              );
            })}

            <ZoomWatcher onZoom={setZoom} />
            <MapClickHandler onClick={() => setSelectedDeviceId(null)} />
            <FitBounds points={fitPoints} />
            <MapResizeHandler isFullscreen={isFullscreen} />
          </MapContainer>
        </Box>
      </Paper>

      <TrackerTable devices={locatedDevices} colors={deviceColors} selectedId={selectedDeviceId} />
    </Box>
  );
}
