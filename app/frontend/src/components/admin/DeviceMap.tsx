import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  CircularProgress,
  IconButton,
  Tooltip,
  ToggleButtonGroup,
  ToggleButton,
  FormControlLabel,
  Switch,
  Button,
  Chip,
} from '@mui/material';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from 'react-leaflet';
import { LatLngBounds, LatLng } from 'leaflet';
import MapIcon from '@mui/icons-material/Map';
import SatelliteIcon from '@mui/icons-material/Satellite';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RestoreFromTrashIcon from '@mui/icons-material/RestoreFromTrash';
import 'leaflet/dist/leaflet.css';
import { stopMapAnimation } from '../../utils/stopMapAnimation';
import type { Device, LocationType, LocationWithBoundary } from '../../services/api';
import FieldBoundaryOverlay from '../surveys/FieldBoundaryOverlay';
import { useMapFullscreen, MapResizeHandler } from '../../hooks';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, LOCATION_TYPE_STYLE } from '../../config';
import { DEVICE_COLORS, DEVICE_SVG, DEVICE_TYPE_LABELS, DEVICE_CHIP_COLORS, getDeviceIcon } from '../../utils/deviceIcon';

interface DeviceMapProps {
  devices: Device[];
  locationsWithBoundaries: LocationWithBoundary[];
  loading?: boolean;
  /** Height of the map area (not fullscreen). Defaults to a fixed 500px. */
  height?: number | string;
  onEditDevice: (device: Device) => void;
  onDeactivateDevice: (device: Device) => void;
  onReactivateDevice: (device: Device) => void;
}

function FitBoundsToDevices({ devices }: { devices: Device[] }) {
  const map = useMap();
  const prevCount = useRef(0);

  useEffect(() => {
    const withCoords = devices.filter((d) => d.latitude && d.longitude);
    // Fit bounds on first load or when going from 0 to >0 devices (after CRUD)
    const shouldFit = withCoords.length > 0 && prevCount.current === 0;
    prevCount.current = withCoords.length;

    if (shouldFit) {
      const bounds = new LatLngBounds(
        withCoords.map((d) => new LatLng(d.latitude!, d.longitude!))
      );
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
    return () => { stopMapAnimation(map); };
  }, [devices, map]);

  return null;
}

const DEVICE_LEGEND: Device['device_type'][] = [
  'camera_trap',
  'audio_recorder',
  'refugia',
  'moth_light_trap',
];

const LOCATION_LEGEND: { type: Exclude<LocationType, 'none'>; label: string }[] = [
  { type: 'area', label: 'Area' },
  { type: 'route', label: 'Route' },
  { type: 'point', label: 'Point' },
];

function DeviceLegendIcon({ type }: { type: Device['device_type'] }) {
  return (
    <Box
      sx={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        bgcolor: DEVICE_COLORS[type],
        border: '1.5px solid #fff',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        '& svg': { width: 12, height: 12 },
      }}
      dangerouslySetInnerHTML={{ __html: DEVICE_SVG[type] }}
    />
  );
}

/** Legend swatch mirroring how each location type is drawn on the map. */
function LocationLegendIcon({ type }: { type: Exclude<LocationType, 'none'> }) {
  const style = LOCATION_TYPE_STYLE[type];
  if (type === 'route') {
    return (
      <Box sx={{ width: 18, height: 18, display: 'flex', alignItems: 'center' }}>
        <Box sx={{ width: '100%', borderTop: `3px solid ${style.stroke}`, borderRadius: 2 }} />
      </Box>
    );
  }
  return (
    <Box
      sx={{
        width: type === 'point' ? 14 : 16,
        height: type === 'point' ? 14 : 16,
        borderRadius: type === 'point' ? '50%' : '3px',
        border: `2px solid ${style.stroke}`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ position: 'absolute', inset: 0, bgcolor: style.fill, opacity: style.fillOpacity }} />
    </Box>
  );
}

export default function DeviceMap({
  devices,
  locationsWithBoundaries,
  loading,
  height = 500,
  onEditDevice,
  onDeactivateDevice,
  onReactivateDevice,
}: DeviceMapProps) {
  const { isFullscreen, toggleFullscreen, fullscreenContainerSx, fullscreenMapSx } = useMapFullscreen();
  const [mapType, setMapType] = useState<'street' | 'satellite'>('satellite');
  const [showInactive, setShowInactive] = useState(false);

  const defaultCenter = DEFAULT_MAP_CENTER;
  const defaultZoom = DEFAULT_MAP_ZOOM;

  // Filter devices for display
  const visibleDevices = useMemo(() => {
    return devices.filter(
      (d) => d.latitude && d.longitude && (d.is_active || showInactive)
    );
  }, [devices, showInactive]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 3 }}>
      {/* Toolbar */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          mb: 2,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
          gap={1}
        >
          <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap" sx={{ rowGap: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Map
            </Typography>

            {/* Legend */}
            <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap" sx={{ rowGap: 0.5 }}>
              {DEVICE_LEGEND.map((type) => (
                <Stack key={type} direction="row" spacing={0.75} alignItems="center">
                  <DeviceLegendIcon type={type} />
                  <Typography variant="caption" color="text.secondary">
                    {DEVICE_TYPE_LABELS[type]}
                  </Typography>
                </Stack>
              ))}
              {LOCATION_LEGEND.map(({ type, label }) => (
                <Stack key={type} direction="row" spacing={0.75} alignItems="center">
                  <LocationLegendIcon type={type} />
                  <Typography variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Stack>

          <Stack direction="row" alignItems="center" gap={1}>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={showInactive}
                  onChange={(_, checked) => setShowInactive(checked)}
                />
              }
              label={<Typography variant="caption">Show inactive</Typography>}
              sx={{ mr: 1 }}
            />

            <ToggleButtonGroup
              value={mapType}
              exclusive
              onChange={(_, newValue) => newValue && setMapType(newValue)}
              size="small"
              sx={{ height: '32px' }}
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
          </Stack>
        </Stack>
      </Paper>

      {/* Map */}
      <Paper
        elevation={0}
        className="fullscreen-map-container"
        sx={{
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
          position: 'relative',
          ...fullscreenContainerSx,
        }}
      >
        {/* Map controls */}
        <Stack
          direction="row"
          spacing={0.5}
          sx={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 1000,
          }}
        >
          <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
            <IconButton
              size="small"
              onClick={toggleFullscreen}
              sx={{
                bgcolor: 'white',
                boxShadow: 2,
                '&:hover': { bgcolor: 'grey.100' },
              }}
            >
              {isFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Stack>

        <Box
          sx={{
            height,
            minHeight: 400,
            width: '100%',
            ...fullscreenMapSx,
          }}
        >
          <MapContainer
            center={defaultCenter}
            zoom={defaultZoom}
            style={{ height: '100%', width: '100%' }}
          >
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

            {/* Field boundaries */}
            {locationsWithBoundaries.length > 0 && (
              <FieldBoundaryOverlay locations={locationsWithBoundaries} />
            )}

            {/* Device markers */}
            {visibleDevices.map((device) => (
              <Marker
                key={device.id}
                position={[device.latitude!, device.longitude!]}
                icon={getDeviceIcon(device)}
              >
                <Popup>
                  <Box sx={{ minWidth: 'min(180px, calc(100vw - 112px))', p: 0.5 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      {device.name}
                    </Typography>
                    <Stack direction="row" spacing={0.5} sx={{ mb: 1 }}>
                      <Chip
                        label={DEVICE_TYPE_LABELS[device.device_type]}
                        size="small"
                        color={DEVICE_CHIP_COLORS[device.device_type]}
                        variant="outlined"
                        sx={{ height: 20, fontSize: '0.7rem' }}
                      />
                      <Chip
                        label={device.is_active ? 'Active' : 'Inactive'}
                        size="small"
                        color={device.is_active ? 'success' : 'default'}
                        sx={{ height: 20, fontSize: '0.7rem' }}
                      />
                    </Stack>
                    {device.location_name && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        {device.location_name}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace', mb: 1 }}>
                      {device.latitude!.toFixed(5)}, {device.longitude!.toFixed(5)}
                    </Typography>
                    <Stack direction="row" spacing={0.5}>
                      <Button
                        size="small"
                        startIcon={<EditIcon sx={{ fontSize: 14 }} />}
                        onClick={() => onEditDevice(device)}
                        sx={{ fontSize: '0.7rem', minWidth: 0, py: 0.25 }}
                      >
                        Edit
                      </Button>
                      {device.is_active ? (
                        <Button
                          size="small"
                          color="error"
                          startIcon={<DeleteIcon sx={{ fontSize: 14 }} />}
                          onClick={() => onDeactivateDevice(device)}
                          sx={{ fontSize: '0.7rem', minWidth: 0, py: 0.25 }}
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          color="success"
                          startIcon={<RestoreFromTrashIcon sx={{ fontSize: 14 }} />}
                          onClick={() => onReactivateDevice(device)}
                          sx={{ fontSize: '0.7rem', minWidth: 0, py: 0.25 }}
                        >
                          Reactivate
                        </Button>
                      )}
                    </Stack>
                  </Box>
                </Popup>
              </Marker>
            ))}

            <FitBoundsToDevices devices={devices} />
            <MapResizeHandler isFullscreen={isFullscreen} />
          </MapContainer>
        </Box>
      </Paper>
    </Box>
  );
}
