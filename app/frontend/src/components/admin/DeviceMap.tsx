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
import type { Device, LocationWithBoundary } from '../../services/api';
import FieldBoundaryOverlay from '../surveys/FieldBoundaryOverlay';
import { useMapFullscreen, MapResizeHandler } from '../../hooks';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../../config';
import { DEVICE_COLORS, DEVICE_SVG, getDeviceIcon } from '../../utils/deviceIcon';

interface DeviceMapProps {
  devices: Device[];
  locationsWithBoundaries: LocationWithBoundary[];
  loading?: boolean;
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
