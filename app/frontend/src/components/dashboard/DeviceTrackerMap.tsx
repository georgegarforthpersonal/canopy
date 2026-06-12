import { useEffect, useMemo, useState } from 'react';
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
  Button,
  Divider,
} from '@mui/material';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from 'react-leaflet';
import { DivIcon, LatLngBounds, LatLng } from 'leaflet';
import MapIcon from '@mui/icons-material/Map';
import SatelliteIcon from '@mui/icons-material/Satellite';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import CloseIcon from '@mui/icons-material/Close';
import dayjs from 'dayjs';
import 'leaflet/dist/leaflet.css';
import { ecotopiaAPI } from '../../services/api';
import type { EcotopiaDevice, EcotopiaGpsFix } from '../../services/api';
import { useMapFullscreen, MapResizeHandler } from '../../hooks';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../../config';
import { brandColors } from '../../theme';

// Group tags within ~100m (3 dp) into one marker, like co-located sightings.
const COLOCATION_DECIMALS = 3;

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

function groupByLocation(devices: EcotopiaDevice[]): DeviceGroup[] {
  const groups = new Map<string, DeviceGroup>();
  for (const d of devices) {
    if (d.latitude == null || d.longitude == null) continue;
    const key = `${d.latitude.toFixed(COLOCATION_DECIMALS)},${d.longitude.toFixed(COLOCATION_DECIMALS)}`;
    const existing = groups.get(key);
    if (existing) existing.devices.push(d);
    else groups.set(key, { key, latitude: d.latitude, longitude: d.longitude, devices: [d] });
  }
  return Array.from(groups.values());
}

function badgeIcon(text: string, bg: string, fontSize: number): DivIcon {
  const size = 34;
  return new DivIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:2px solid #fff;color:#fff;display:flex;align-items:center;justify-content:center;font-size:${fontSize}px;font-weight:700;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,0.35);">${text}</div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join('|');
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    map.fitBounds(new LatLngBounds(points.map((p) => new LatLng(p[0], p[1]))), { padding: [60, 60], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

function DeviceSummary({
  device,
  onShowTrack,
  isSelected,
}: {
  device: EcotopiaDevice;
  onShowTrack: (id: string) => void;
  isSelected: boolean;
}) {
  const bird = birdLabel(device);
  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {tagName(device)}
        {device.description ? ` — ${device.description}` : ''}
      </Typography>
      {bird && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {bird}
        </Typography>
      )}
      {device.gps_timestamp && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Last fix: {dayjs(device.gps_timestamp).format('MMM DD, YYYY HH:mm')}
        </Typography>
      )}
      {device.battery_voltage != null && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Battery: {device.battery_voltage} V
        </Typography>
      )}
      <Button size="small" onClick={() => onShowTrack(device.id)} sx={{ mt: 0.5, fontSize: '0.7rem', minWidth: 0, py: 0.25 }}>
        {isSelected ? 'Tracking…' : 'Show track'}
      </Button>
    </Box>
  );
}

/** Cannwood-only Devices tab: tracked tags at their latest GNSS location, with
 *  co-located tags clustered and an optional per-tag track polyline. */
export function DeviceTrackerMap() {
  const { isFullscreen, toggleFullscreen, fullscreenContainerSx, fullscreenMapSx } = useMapFullscreen();
  const [mapType, setMapType] = useState<'street' | 'satellite'>('satellite');

  const [devices, setDevices] = useState<EcotopiaDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trackDays, setTrackDays] = useState(7);
  const [track, setTrack] = useState<EcotopiaGpsFix[]>([]);
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);

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
    if (!selectedId) {
      setTrack([]);
      return;
    }
    let cancelled = false;
    setTrackLoading(true);
    setTrackError(null);
    ecotopiaAPI
      .getGpsHistory(selectedId, trackDays)
      .then((data) => !cancelled && setTrack(data))
      .catch((err) => !cancelled && setTrackError(err instanceof Error ? err.message : 'Failed to load track'))
      .finally(() => !cancelled && setTrackLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedId, trackDays]);

  const groups = useMemo(() => groupByLocation(devices), [devices]);
  const locatedCount = useMemo(() => devices.filter((d) => d.latitude != null && d.longitude != null).length, [devices]);
  const selectedDevice = devices.find((d) => d.id === selectedId) || null;
  const trackPoints = useMemo<[number, number][]>(() => track.map((f) => [f.latitude, f.longitude]), [track]);
  const fitPoints = useMemo<[number, number][]>(
    () => (trackPoints.length > 0 ? trackPoints : groups.map((g) => [g.latitude, g.longitude])),
    [trackPoints, groups],
  );

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
              {locatedCount} tag{locatedCount === 1 ? '' : 's'} with a recent fix
            </Typography>
          </Stack>
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

        {selectedDevice && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
              <Typography variant="body2">
                Track: <strong>{tagName(selectedDevice)}</strong>
                {trackLoading ? ' — loading…' : ` — ${track.length} fixes / ${trackDays}d`}
                {trackError ? ` — ${trackError}` : ''}
              </Typography>
              <Stack direction="row" alignItems="center" gap={1}>
                <ToggleButtonGroup value={trackDays} exclusive onChange={(_, v) => v && setTrackDays(v)} size="small" sx={{ height: '28px' }}>
                  <ToggleButton value={7}>7d</ToggleButton>
                  <ToggleButton value={30}>30d</ToggleButton>
                </ToggleButtonGroup>
                <Button size="small" startIcon={<CloseIcon sx={{ fontSize: 16 }} />} onClick={() => setSelectedId(null)}>
                  Clear
                </Button>
              </Stack>
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
          <MapContainer center={DEFAULT_MAP_CENTER} zoom={DEFAULT_MAP_ZOOM} style={{ height: '100%', width: '100%' }}>
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

            {trackPoints.length > 1 && (
              <Polyline positions={trackPoints} pathOptions={{ color: brandColors.main, weight: 3, opacity: 0.85 }} />
            )}
            {trackPoints.map((p, i) => {
              const last = i === trackPoints.length - 1;
              return (
                <CircleMarker
                  key={`track-${i}`}
                  center={p}
                  radius={last ? 6 : 4}
                  pathOptions={{ color: '#fff', weight: 1.5, fillColor: last ? '#e53935' : brandColors.main, fillOpacity: 0.9 }}
                >
                  <Popup>
                    <Typography variant="caption">{dayjs(track[i].timestamp).format('MMM DD, YYYY HH:mm')}</Typography>
                  </Popup>
                </CircleMarker>
              );
            })}

            {groups.map((group) => {
              const single = group.devices.length === 1;
              const highlighted = group.devices.some((d) => d.id === selectedId);
              const icon = single
                ? badgeIcon(tagName(group.devices[0]), highlighted ? brandColors.hover : brandColors.main, 11)
                : badgeIcon(String(group.devices.length), brandColors.main, 13);
              return (
                <Marker key={group.key} position={[group.latitude, group.longitude]} icon={icon}>
                  <Popup>
                    <Box sx={{ minWidth: 'min(190px, calc(100vw - 112px))', maxHeight: 240, overflowY: 'auto', p: 0.5 }}>
                      {!single && (
                        <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
                          {group.devices.length} tags at this location
                        </Typography>
                      )}
                      {group.devices.map((d) => (
                        <DeviceSummary key={d.id} device={d} onShowTrack={setSelectedId} isSelected={d.id === selectedId} />
                      ))}
                    </Box>
                  </Popup>
                </Marker>
              );
            })}

            <FitBounds points={fitPoints} />
            <MapResizeHandler isFullscreen={isFullscreen} />
          </MapContainer>
        </Box>
      </Paper>
    </Box>
  );
}
