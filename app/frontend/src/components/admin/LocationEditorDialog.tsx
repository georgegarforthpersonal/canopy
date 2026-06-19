/**
 * Create or edit a location and its shape. The type (area / route / point / none)
 * drives whether the drawing map is shown; map colours are fixed per type.
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
  Alert,
  CircularProgress,
} from '@mui/material';
import CropFreeIcon from '@mui/icons-material/CropFree';
import TimelineIcon from '@mui/icons-material/Timeline';
import PlaceIcon from '@mui/icons-material/Place';
import BlockIcon from '@mui/icons-material/Block';

import { locationsAPI } from '../../services/api';
import type { Location, LocationType, LocationWithBoundary, LocationInput } from '../../services/api';
import type { GeoJsonGeometry } from '../../utils/geometry';
import { brandColors } from '../../theme';
import LocationDrawMap, { type DrawableLocationType } from './LocationDrawMap';

const TYPE_OPTIONS: { value: LocationType; label: string; icon: React.ReactNode }[] = [
  { value: 'area', label: 'Area', icon: <CropFreeIcon fontSize="small" /> },
  { value: 'route', label: 'Route', icon: <TimelineIcon fontSize="small" /> },
  { value: 'point', label: 'Point', icon: <PlaceIcon fontSize="small" /> },
  { value: 'none', label: 'No coordinates', icon: <BlockIcon fontSize="small" /> },
];

interface LocationEditorDialogProps {
  open: boolean;
  /** The location being edited, or null to create a new one. */
  location: LocationWithBoundary | null;
  /** Other locations, shown faintly on the map for context. */
  referenceLocations: LocationWithBoundary[];
  onClose: () => void;
  onSaved: (saved: Location, created: boolean) => void;
}

export default function LocationEditorDialog({
  open,
  location,
  referenceLocations,
  onClose,
  onSaved,
}: LocationEditorDialogProps) {
  const [name, setName] = useState('');
  const [locationType, setLocationType] = useState<LocationType>('none');
  const [geometry, setGeometry] = useState<GeoJsonGeometry | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialise form whenever the dialog opens or the target location changes.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    if (location) {
      setName(location.name);
      setLocationType(location.location_type ?? 'none');
      setGeometry(location.geometry ?? null);
    } else {
      setName('');
      setLocationType('none');
      setGeometry(null);
    }
  }, [open, location]);

  const handleTypeChange = (_: React.MouseEvent<HTMLElement>, next: LocationType | null) => {
    if (!next || next === locationType) return;
    setLocationType(next);
    // A shape drawn for one type can't carry over to another.
    setGeometry(null);
  };

  const referenceForMap = useMemo(
    () => referenceLocations.filter((l) => l.id !== location?.id),
    [referenceLocations, location?.id],
  );

  const handleSave = async () => {
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
      onSaved(saved, !location);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save location');
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{location ? 'Edit Location' : 'Add Location'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            autoFocus
            required
          />

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Type
            </Typography>
            <ToggleButtonGroup
              value={locationType}
              exclusive
              onChange={handleTypeChange}
              size="small"
              fullWidth
            >
              {TYPE_OPTIONS.map((opt) => (
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
              referenceLocations={referenceForMap}
            />
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
          {location ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
