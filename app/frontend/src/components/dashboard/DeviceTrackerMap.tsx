import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  CircularProgress,
  Alert,
  Tooltip,
  IconButton,
  ToggleButtonGroup,
  ToggleButton,
  Divider,
  Button,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
} from '@mui/material';
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, useMap } from 'react-leaflet';
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
const TRACK_START_LABEL = 'Jun 2, 2026';

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
    ? `ring ${device.ring_number}${device.ring_colour ? ` (${device.ring_colour})` : ''}`
    : '';
  return [symbol, ring].filter(Boolean).join(' ');
}

interface DeviceGroup {
  key: string;
  latitude: number;
  longitude: number;
  devices: EcotopiaDevice[];
}

function groupByLocation(devices: EcotopiaDevice[], zoom: number): DeviceGroup[] {
  const dp = colocationDecimals(zoom);
  const groups = new Map<string, DeviceGroup>();
  for (const d of devices) {
    if (d.latitude == null || d.longitude == null) continue;
    const key = `${d.latitude.toFixed(dp)},${d.longitude.toFixed(dp)}`;
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

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join('|');
  useEffect(() => {
    if (points.length === 0) return () => { stopMapAnimation(map); };
    if (points.length === 1) {
      map.setView(points[0], 14);
    } else {
      map.fitBounds(new LatLngBounds(points.map((p) => new LatLng(p[0], p[1]))), { padding: [60, 60], maxZoom: 15 });
    }
    return () => { stopMapAnimation(map); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
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
  const [trackError, setTrackError] = useState<string | null>(null);

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
    if (!selectedDeviceId) {
      setTrack([]);
      setTrackError(null);
      return;
    }
    let cancelled = false;
    // Drop the previously-selected tracker's path immediately so we never render
    // a new tracker's pin/colour along the old tracker's track while the new
    // history loads.
    setTrack([]);
    setTrackLoading(true);
    setTrackError(null);
    ecotopiaAPI
      .getGpsHistory(selectedDeviceId, trackDays)
      .then((fixes) => !cancelled && setTrack(fixes))
      .catch((err) => !cancelled && setTrackError(err instanceof Error ? err.message : 'Failed to load track'))
      .finally(() => !cancelled && setTrackLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedDeviceId, trackDays]);

  const groups = useMemo(() => groupByLocation(devices, zoom), [devices, zoom]);
  const locatedDevices = useMemo(
    () =>
      devices
        .filter((d) => d.latitude != null && d.longitude != null)
        .sort((a, b) => tagName(a).localeCompare(tagName(b))),
    [devices],
  );
  const locatedCount = locatedDevices.length;

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

  const fitPoints = useMemo<[number, number][]>(() => {
    if (selectedDeviceId && track.length > 0) {
      return track.map((f) => [f.latitude, f.longitude] as [number, number]);
    }
    // Use raw device positions, not groups: groups depends on zoom, so using it
    // here would cause FitBounds to re-fire on every zoom change and fight the user.
    return devices
      .filter((d) => d.latitude != null && d.longitude != null)
      .map((d) => [d.latitude!, d.longitude!] as [number, number]);
  }, [selectedDeviceId, track, devices]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error) return <Alert severity="error">{error}</Alert>;
  if (locatedCount === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400, color: 'text.secondary' }}>
        <Typography variant="body1">No tracker devices with a recent location</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Paper elevation={0} sx={{ p: 2, mb: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
          <Stack direction="row" alignItems="center" gap={2}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Tracker Locations
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {locatedCount} tag{locatedCount === 1 ? '' : 's'} with a recent fix · tap a pin or row for its track
            </Typography>
          </Stack>
          <Stack direction="row" alignItems="center" gap={1}>
            <ToggleButtonGroup value={mapType} exclusive onChange={(_, v) => v && setMapType(v)} size="small" sx={{ height: '32px' }}>
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
          </Stack>
        </Stack>

        {selectedDevice && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
              <Typography variant="body2">
                {trackLoading
                  ? 'Loading track…'
                  : trackError
                    ? `Error: ${trackError}`
                    : `Track for ${tagName(selectedDevice)} since ${TRACK_START_LABEL}`}
              </Typography>
              <Button size="small" onClick={() => setSelectedDeviceId(null)} sx={{ textTransform: 'none' }}>
                Clear
              </Button>
            </Stack>
          </>
        )}
      </Paper>

      <Paper
        elevation={0}
        className="fullscreen-map-container"
        sx={{ overflow: 'hidden', border: '1px solid', borderColor: 'divider', position: 'relative', ...fullscreenContainerSx }}
      >
        <Stack direction="row" spacing={0.5} sx={{ position: 'absolute', top: 10, right: 10, zIndex: 1000 }}>
          <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
            <IconButton size="small" onClick={toggleFullscreen} sx={{ bgcolor: 'white', boxShadow: 2, '&:hover': { bgcolor: 'grey.100' } }}>
              {isFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Stack>

        <Box sx={{ height: 500, width: '100%', ...fullscreenMapSx }}>
          <MapContainer ref={mapRef} center={DEFAULT_MAP_CENTER} zoom={DEFAULT_MAP_ZOOM} style={{ height: '100%', width: '100%' }}>
            {mapType === 'satellite' ? (
              <TileLayer
                key="satellite"
                attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
            ) : (
              <TileLayer
                key="street"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
            )}

            {selectedDevice && (() => {
              const color = deviceColors.get(selectedDevice.id) ?? brandColors.main;
              let points: [number, number][] = track.map((f) => [f.latitude, f.longitude]);
              // The paginated GPS history endpoint can lag behind the device's
              // status_gps.  Extend the polyline to the device's current reported
              // position so the track visually terminates at the badge pin.
              if (selectedDevice.latitude != null && selectedDevice.longitude != null) {
                const last = points[points.length - 1];
                if (!last || Math.abs(last[0] - selectedDevice.latitude) > 1e-5 || Math.abs(last[1] - selectedDevice.longitude) > 1e-5) {
                  points = [...points, [selectedDevice.latitude, selectedDevice.longitude]];
                }
              }
              if (points.length === 0) return null;
              const lastPoint = points[points.length - 1];
              return (
                <Fragment>
                  {points.length > 1 && (
                    <Polyline positions={points} pathOptions={{ color, weight: 3, opacity: 0.85 }} />
                  )}
                  <CircleMarker
                    center={lastPoint}
                    radius={5}
                    pathOptions={{ color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1 }}
                  />
                </Fragment>
              );
            })()}

            {groups.map((group) => {
              const single = group.devices.length === 1;
              const hasSelection = selectedDeviceId != null;
              const containsSelected = group.devices.some((d) => d.id === selectedDeviceId);
              let icon: DivIcon;
              let eventHandlers: { click: () => void };
              if (single) {
                const d = group.devices[0];
                const isSel = d.id === selectedDeviceId;
                const pinColor = deviceColors.get(d.id) ?? brandColors.main;
                icon = badgeIcon(tagName(d), pinColor, { emphasized: isSel, dimmed: hasSelection && !isSel });
                eventHandlers = { click: () => toggleSelect(d.id) };
              } else {
                icon = clusterIcon(group.devices.length, hasSelection && !containsSelected);
                // A cluster can't toggle one track unambiguously — zoom in to split
                // the co-located tags into individually-clickable pins instead.
                eventHandlers = {
                  click: () => {
                    const m = mapRef.current;
                    if (m) m.flyTo([group.latitude, group.longitude], Math.min(m.getZoom() + 2, 17));
                  },
                };
              }
              return <Marker key={group.key} position={[group.latitude, group.longitude]} icon={icon} eventHandlers={eventHandlers} />;
            })}

            <ZoomWatcher onZoom={setZoom} />
            <FitBounds points={fitPoints} />
            <MapResizeHandler isFullscreen={isFullscreen} />
          </MapContainer>
        </Box>
      </Paper>

      <TableContainer
        component={Paper}
        elevation={0}
        sx={{ mt: 2, border: '1px solid', borderColor: 'divider' }}
      >
        <Table size="small" aria-label="tracker devices">
          <TableHead>
            <TableRow>
              <TableCell>Tag</TableCell>
              <TableCell>Bird</TableCell>
              <TableCell>Last fix</TableCell>
              <TableCell>Battery</TableCell>
              <TableCell align="right">Track</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {locatedDevices.map((d) => {
              const isSel = d.id === selectedDeviceId;
              const color = deviceColors.get(d.id) ?? brandColors.main;
              const bird = birdLabel(d);
              return (
                <TableRow
                  key={d.id}
                  hover
                  selected={isSel}
                  onClick={() => toggleSelect(d.id)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Stack direction="row" alignItems="center" gap={1}>
                      <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {tagName(d)}
                      </Typography>
                      {d.description && (
                        <Typography variant="caption" color="text.secondary">
                          {d.description}
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>{bird ?? '—'}</TableCell>
                  <TableCell>
                    {d.gps_timestamp ? dayjs(d.gps_timestamp).format('MMM DD, YYYY HH:mm') : '—'}
                  </TableCell>
                  <TableCell>{d.battery_voltage != null ? `${d.battery_voltage} V` : '—'}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(d.id);
                      }}
                      sx={{ textTransform: 'none', minWidth: 64 }}
                    >
                      {isSel ? 'Hide' : 'Show'}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
