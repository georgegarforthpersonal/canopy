/**
 * Create or edit a location and its shape. The type (area / route / point / none)
 * drives whether the drawing map and which styling controls are shown.
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
  Slider,
  Alert,
  CircularProgress,
} from '@mui/material';
import CropFreeIcon from '@mui/icons-material/CropFree';
import TimelineIcon from '@mui/icons-material/Timeline';
import PlaceIcon from '@mui/icons-material/Place';
import BlockIcon from '@mui/icons-material/Block';

import { locationsAPI } from '../../services/api';
import type { LocationType, LocationWithBoundary, LocationInput } from '../../services/api';
import type { GeoJsonGeometry } from '../../utils/geometry';
import { brandColors } from '../../theme';
import LocationDrawMap, { type DrawableLocationType } from './LocationDrawMap';

const DEFAULT_STROKE = '#3388ff';
const DEFAULT_FILL = '#3388ff';
const DEFAULT_OPACITY = 0.2;

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
  onSaved: () => void;
}

/** A labelled native colour swatch. */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Box
        component="input"
        type="color"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        sx={{
          width: 48,
          height: 36,
          p: 0,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          cursor: 'pointer',
          bgcolor: 'transparent',
        }}
      />
    </Stack>
  );
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
  const [strokeColor, setStrokeColor] = useState(DEFAULT_STROKE);
  const [fillColor, setFillColor] = useState(DEFAULT_FILL);
  const [fillOpacity, setFillOpacity] = useState(DEFAULT_OPACITY);
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
      setStrokeColor(location.boundary_stroke_color ?? DEFAULT_STROKE);
      setFillColor(location.boundary_fill_color ?? DEFAULT_FILL);
      setFillOpacity(location.boundary_fill_opacity ?? DEFAULT_OPACITY);
    } else {
      setName('');
      setLocationType('none');
      setGeometry(null);
      setStrokeColor(DEFAULT_STROKE);
      setFillColor(DEFAULT_FILL);
      setFillOpacity(DEFAULT_OPACITY);
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
      boundary_stroke_color: strokeColor,
      boundary_fill_color: fillColor,
      boundary_fill_opacity: fillOpacity,
    };

    try {
      if (location) {
        await locationsAPI.update(location.id, payload);
      } else {
        await locationsAPI.create(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save location');
      setSaving(false);
    }
  };

  const showFill = locationType === 'area' || locationType === 'point';
  const showOpacity = locationType === 'area';

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
            <Box>
              <LocationDrawMap
                locationType={locationType as DrawableLocationType}
                value={geometry}
                onChange={setGeometry}
                referenceLocations={referenceForMap}
              />

              <Stack direction="row" spacing={3} alignItems="flex-start" sx={{ mt: 1 }}>
                <ColorField label="Outline" value={strokeColor} onChange={setStrokeColor} />
                {showFill && <ColorField label="Fill" value={fillColor} onChange={setFillColor} />}
                {showOpacity && (
                  <Box sx={{ flexGrow: 1, maxWidth: 220 }}>
                    <Typography variant="caption" color="text.secondary">
                      Fill opacity
                    </Typography>
                    <Slider
                      value={fillOpacity}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(_, v) => setFillOpacity(v as number)}
                      valueLabelDisplay="auto"
                      size="small"
                    />
                  </Box>
                )}
              </Stack>
            </Box>
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
