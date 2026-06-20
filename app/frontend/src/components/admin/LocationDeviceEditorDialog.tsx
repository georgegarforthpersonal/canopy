/**
 * Unified create/edit dialog for the "Locations & Devices" admin tab.
 *
 * When adding, a Location / Device toggle at the top swaps between the two
 * forms. When editing, the kind is fixed by the record being edited and the
 * toggle is hidden. Saving routes to the matching API.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Stack,
  Box,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
} from '@mui/material';
import CropFreeIcon from '@mui/icons-material/CropFree';
import TimelineIcon from '@mui/icons-material/Timeline';
import PlaceIcon from '@mui/icons-material/Place';
import BlockIcon from '@mui/icons-material/Block';
import SensorsIcon from '@mui/icons-material/Sensors';

import { locationsAPI, devicesAPI } from '../../services/api';
import type {
  Location,
  LocationType,
  LocationWithBoundary,
  LocationInput,
  Device,
  DeviceType,
  DeviceCreate,
  DeviceUpdate,
} from '../../services/api';
import type { GeoJsonGeometry } from '../../utils/geometry';
import { DEVICE_TYPE_LABELS } from '../../utils/deviceIcon';
import { brandColors } from '../../theme';
import { useResponsive } from '../../hooks/useResponsive';
import LocationDrawMap, { type DrawableLocationType } from './LocationDrawMap';
import LocationMapPicker from '../surveys/LocationMapPicker';

export type EditorKind = 'location' | 'device';

const LOCATION_TYPE_OPTIONS: { value: LocationType; label: string; icon: React.ReactNode }[] = [
  { value: 'area', label: 'Area', icon: <CropFreeIcon fontSize="small" /> },
  { value: 'route', label: 'Route', icon: <TimelineIcon fontSize="small" /> },
  { value: 'point', label: 'Point', icon: <PlaceIcon fontSize="small" /> },
  { value: 'none', label: 'No coordinates', icon: <BlockIcon fontSize="small" /> },
];

const DEVICE_TYPE_OPTIONS: DeviceType[] = [
  'audio_recorder',
  'camera_trap',
  'refugia',
  'moth_light_trap',
];

interface LocationDeviceEditorDialogProps {
  open: boolean;
  mode: 'add' | 'edit';
  /** Which kind is being edited; ignored in add mode (user chooses). */
  editKind?: EditorKind;
  /** Location being edited (edit mode, kind === 'location'). */
  location?: LocationWithBoundary | null;
  /** Device being edited (edit mode, kind === 'device'). */
  device?: Device | null;
  /** Locations with geometry, shown faintly on both maps for context. */
  referenceLocations: LocationWithBoundary[];
  onClose: () => void;
  onSavedLocation: (saved: Location, created: boolean) => void;
  onSavedDevice: (saved: Device, created: boolean) => void;
}

export default function LocationDeviceEditorDialog({
  open,
  mode,
  editKind,
  location,
  device,
  referenceLocations,
  onClose,
  onSavedLocation,
  onSavedDevice,
}: LocationDeviceEditorDialogProps) {
  const { isMobile } = useResponsive();

  const [kind, setKind] = useState<EditorKind>('location');

  // Location form
  const [name, setName] = useState('');
  const [locationType, setLocationType] = useState<LocationType>('none');
  const [geometry, setGeometry] = useState<GeoJsonGeometry | null>(null);

  // Device form
  const [deviceName, setDeviceName] = useState('');
  const [deviceType, setDeviceType] = useState<DeviceType>('audio_recorder');
  const [latitude, setLatitude] = useState<number | undefined>(undefined);
  const [longitude, setLongitude] = useState<number | undefined>(undefined);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // (Re)initialise the form whenever the dialog opens or its target changes.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setKind(mode === 'edit' ? editKind ?? 'location' : 'location');

    if (location) {
      setName(location.name);
      setLocationType(location.location_type ?? 'none');
      setGeometry(location.geometry ?? null);
    } else {
      setName('');
      setLocationType('none');
      setGeometry(null);
    }

    if (device) {
      setDeviceName(device.name || '');
      setDeviceType(device.device_type);
      setLatitude(device.latitude ?? undefined);
      setLongitude(device.longitude ?? undefined);
    } else {
      setDeviceName('');
      setDeviceType('audio_recorder');
      setLatitude(undefined);
      setLongitude(undefined);
    }
  }, [open, mode, editKind, location, device]);

  const handleLocationTypeChange = (_: React.MouseEvent<HTMLElement>, next: LocationType | null) => {
    if (!next || next === locationType) return;
    setLocationType(next);
    // A shape drawn for one type can't carry over to another.
    setGeometry(null);
  };

  // Don't show the location being edited as a faint reference on its own map.
  const locationReferenceForMap = useMemo(
    () => referenceLocations.filter((l) => l.id !== location?.id),
    [referenceLocations, location?.id],
  );

  const handleSaveLocation = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);

    const isDrawable = locationType !== 'none';
    const payload: LocationInput = {
      name: name.trim(),
      location_type: locationType,
      // Always send geometry so edits (including removals) persist; null for 'none'.
      geometry: isDrawable ? geometry : null,
    };

    try {
      const saved = location
        ? await locationsAPI.update(location.id, payload)
        : await locationsAPI.create(payload);
      onSavedLocation(saved, !location);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save location');
      setSaving(false);
    }
  };

  const handleSaveDevice = async () => {
    if (!deviceName.trim()) {
      setError('Device name is required');
      return;
    }
    if (mode === 'add' && (latitude === undefined || longitude === undefined)) {
      setError('Set the device position on the map');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      let saved: Device;
      if (device) {
        const payload: DeviceUpdate = {
          name: deviceName.trim(),
          device_type: deviceType,
          latitude,
          longitude,
        };
        saved = await devicesAPI.update(device.id, payload);
      } else {
        const payload: DeviceCreate = {
          name: deviceName.trim(),
          device_type: deviceType,
          latitude: latitude!,
          longitude: longitude!,
        };
        saved = await devicesAPI.create(payload);
      }
      onSavedDevice(saved, !device);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save device');
      setSaving(false);
    }
  };

  const handleSave = kind === 'location' ? handleSaveLocation : handleSaveDevice;

  const title = `${mode === 'add' ? 'Add' : 'Edit'} ${kind === 'location' ? 'Location' : 'Device'}`;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" fullScreen={isMobile}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {mode === 'add' && (
            <ToggleButtonGroup
              value={kind}
              exclusive
              onChange={(_, next) => next && setKind(next)}
              size="small"
              fullWidth
              disabled={saving}
            >
              <ToggleButton value="location" sx={{ gap: 0.5 }}>
                <PlaceIcon fontSize="small" />
                Location
              </ToggleButton>
              <ToggleButton value="device" sx={{ gap: 0.5 }}>
                <SensorsIcon fontSize="small" />
                Device
              </ToggleButton>
            </ToggleButtonGroup>
          )}

          {kind === 'location' ? (
            <>
              <TextField
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                fullWidth
                autoFocus
                required
                disabled={saving}
              />

              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Type
                </Typography>
                <ToggleButtonGroup
                  value={locationType}
                  exclusive
                  onChange={handleLocationTypeChange}
                  size="small"
                  fullWidth
                  disabled={saving}
                >
                  {LOCATION_TYPE_OPTIONS.map((opt) => (
                    <ToggleButton key={opt.value} value={opt.value} sx={{ gap: 0.5 }}>
                      {opt.icon}
                      {opt.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Box>

              {locationType === 'none' ? (
                <Typography variant="body2" color="text.secondary">
                  This location has no coordinates set. It can still be selected for surveys and sightings.
                </Typography>
              ) : (
                <LocationDrawMap
                  locationType={locationType as DrawableLocationType}
                  value={geometry}
                  onChange={setGeometry}
                  referenceLocations={locationReferenceForMap}
                />
              )}
            </>
          ) : (
            <>
              <FormControl fullWidth>
                <InputLabel>Device Type</InputLabel>
                <Select
                  value={deviceType}
                  label="Device Type"
                  onChange={(e) => setDeviceType(e.target.value as DeviceType)}
                  disabled={saving}
                >
                  {DEVICE_TYPE_OPTIONS.map((type) => (
                    <MenuItem key={type} value={type}>
                      {DEVICE_TYPE_LABELS[type]}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                label="Name"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                fullWidth
                autoFocus
                required
                disabled={saving}
                helperText="Friendly name (e.g., North Field Recorder)"
              />

              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Device Position
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                  Click on the map to set the device's GPS position
                </Typography>
                <LocationMapPicker
                  latitude={latitude}
                  longitude={longitude}
                  onChange={(lat, lng) => {
                    setLatitude(lat ?? undefined);
                    setLongitude(lng ?? undefined);
                  }}
                  locationBoundaries={referenceLocations}
                />
              </Box>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
        >
          {mode === 'add' ? 'Create' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
