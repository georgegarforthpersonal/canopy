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
import { LatLngBounds, LatLng, DivIcon } from 'leaflet';
import MapIcon from '@mui/icons-material/Map';
import SatelliteIcon from '@mui/icons-material/Satellite';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RestoreFromTrashIcon from '@mui/icons-material/RestoreFromTrash';
import 'leaflet/dist/leaflet.css';
import type { Device, LocationWithBoundary } from '../../services/api';
import FieldBoundaryOverlay from '../surveys/FieldBoundaryOverlay';
import { useMapFullscreen, MapResizeHandler } from '../../hooks';
import { notionColors } from '../../theme';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../../config';

interface DeviceMapProps {
  devices: Device[];
  locationsWithBoundaries: LocationWithBoundary[];
  loading?: boolean;
  onEditDevice: (device: Device) => void;
  onDeactivateDevice: (device: Device) => void;
  onReactivateDevice: (device: Device) => void;
}

// Colours for device types (notion palette, refugia overridden for clarity)
const DEVICE_COLORS: Record<Device['device_type'], string> = {
  camera_trap: notionColors.blue.text,
  audio_recorder: notionColors.orange.text,
  refugia: '#2E7D32',
};

// Inline SVG paths for marker icons (stroke-based, no fill)
const DEVICE_SVG: Record<Device['device_type'], string> = {
  camera_trap: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16C13.6569 16 15 14.6569 15 13C15 11.3431 13.6569 10 12 10C10.3431 10 9 11.3431 9 13C9 14.6569 10.3431 16 12 16Z"/><path d="M3 16.8V9.2C3 8.0799 3 7.51984 3.21799 7.09202C3.40973 6.71569 3.71569 6.40973 4.09202 6.21799C4.51984 6 5.0799 6 6.2 6H7.25464C7.37758 6 7.43905 6 7.49576 5.9935C7.79166 5.95961 8.05705 5.79559 8.21969 5.54609C8.25086 5.49827 8.27836 5.44328 8.33333 5.33333C8.44329 5.11342 8.49827 5.00346 8.56062 4.90782C8.8859 4.40882 9.41668 4.08078 10.0085 4.01299C10.1219 4 10.2448 4 10.4907 4H13.5093C13.7552 4 13.8781 4 13.9915 4.01299C14.5833 4.08078 15.1141 4.40882 15.4394 4.90782C15.5017 5.00345 15.5567 5.11345 15.6667 5.33333C15.7216 5.44329 15.7491 5.49827 15.7803 5.54609C15.943 5.79559 16.2083 5.95961 16.5042 5.9935C16.561 6 16.6224 6 16.7454 6H17.8C18.9201 6 19.4802 6 19.908 6.21799C20.2843 6.40973 20.5903 6.71569 20.782 7.09202C21 7.51984 21 8.0799 21 9.2V16.8C21 17.9201 21 18.4802 20.782 18.908C20.5903 19.2843 20.2843 19.5903 19.908 19.782C19.4802 20 18.9201 20 17.8 20H6.2C5.0799 20 4.51984 20 4.09202 19.782C3.71569 19.5903 3.40973 19.2843 3.21799 18.908C3 18.4802 3 17.9201 3 16.8Z"/></svg>`,
  audio_recorder: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 10V12C19 15.866 15.866 19 12 19M5 10V12C5 15.866 8.13401 19 12 19M12 19V22M8 22H16M12 15C10.3431 15 9 13.6569 9 12V5C9 3.34315 10.3431 2 12 2C13.6569 2 15 3.34315 15 5V12C15 13.6569 13.6569 15 12 15Z"/></svg>`,
  refugia: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10L12 3L21 10V20C21 20.5523 20.5523 21 20 21H15V14H9V21H4C3.44772 21 3 20.5523 3 20V10Z"/></svg>`,
};

const deviceIconCache = new Map<string, DivIcon>();

function getDeviceIcon(device: Device): DivIcon {
  const key = `${device.device_type}-${device.is_active}`;
  let icon = deviceIconCache.get(key);
  if (!icon) {
    const color = device.is_active
      ? DEVICE_COLORS[device.device_type]
      : '#9e9e9e';
    const svg = DEVICE_SVG[device.device_type];
    const opacity = device.is_active ? 1 : 0.4;
    const size = 32;

    icon = new DivIcon({
      html: `<div style="
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background-color: ${color};
        border: 2px solid #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        opacity: ${opacity};
        cursor: pointer;
      ">${svg}</div>`,
      className: '',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    deviceIconCache.set(key, icon);
  }
  return icon;
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
  }, [devices, map]);

  return null;
}

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

export default function DeviceMap({
  devices,
  locationsWithBoundaries,
  loading,
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
          <Stack direction="row" alignItems="center" gap={2}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Device Map
            </Typography>

            {/* Legend */}
            <Stack direction="row" spacing={2}>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <DeviceLegendIcon type="camera_trap" />
                <Typography variant="caption" color="text.secondary">Camera Trap</Typography>
              </Stack>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <DeviceLegendIcon type="audio_recorder" />
                <Typography variant="caption" color="text.secondary">Audio Recorder</Typography>
              </Stack>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <DeviceLegendIcon type="refugia" />
                <Typography variant="caption" color="text.secondary">Refugia</Typography>
              </Stack>
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
            height: 500,
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
                  <Box sx={{ minWidth: 180, p: 0.5 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      {device.name || device.device_id}
                    </Typography>
                    {device.name && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', display: 'block', mb: 0.5 }}>
                        {device.device_id}
                      </Typography>
                    )}
                    <Stack direction="row" spacing={0.5} sx={{ mb: 1 }}>
                      <Chip
                        label={
                          device.device_type === 'camera_trap' ? 'Camera Trap'
                          : device.device_type === 'refugia' ? 'Refugia'
                          : 'Audio Recorder'
                        }
                        size="small"
                        color={
                          device.device_type === 'camera_trap' ? 'primary'
                          : device.device_type === 'refugia' ? 'success'
                          : 'secondary'
                        }
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
