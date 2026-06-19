/**
 * Create or edit a custom device type: a display name, a marker icon (from a
 * curated set) and a colour. Shows a live preview of the resulting map marker.
 */

import { useEffect, useState } from 'react';
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
  Alert,
  CircularProgress,
} from '@mui/material';

import { deviceTypesAPI } from '../../services/api';
import type { DeviceTypeRecord } from '../../services/api';
import { ICON_KEYS, getIconSvg } from '../../utils/deviceIcon';
import { brandColors } from '../../theme';

// A small palette of distinct marker colours (Notion text colours).
const COLOR_PALETTE = [
  '#D9730D', '#DFAB01', '#4D6461', '#2B5F86',
  '#6940A5', '#AD5E99', '#E03E3E', '#64473A', '#787774',
];

const DEFAULT_COLOR = COLOR_PALETTE[3];
const DEFAULT_ICON = ICON_KEYS[0].key;

interface DeviceTypeEditorDialogProps {
  open: boolean;
  /** The device type being edited, or null to create a new one. */
  deviceType: DeviceTypeRecord | null;
  onClose: () => void;
  onSaved: (saved: DeviceTypeRecord, created: boolean) => void;
}

/** A circular marker preview matching the map marker styling. */
function MarkerPreview({ color, iconKey, size = 40 }: { color: string; iconKey: string; size?: number }) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        bgcolor: color,
        border: '2px solid #fff',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        '& svg': { width: size * 0.5, height: size * 0.5 },
      }}
      dangerouslySetInnerHTML={{ __html: getIconSvg(iconKey) }}
    />
  );
}

export default function DeviceTypeEditorDialog({
  open,
  deviceType,
  onClose,
  onSaved,
}: DeviceTypeEditorDialogProps) {
  const [displayName, setDisplayName] = useState('');
  const [iconKey, setIconKey] = useState(DEFAULT_ICON);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    if (deviceType) {
      setDisplayName(deviceType.display_name);
      setIconKey(deviceType.icon_key);
      setColor(deviceType.color);
    } else {
      setDisplayName('');
      setIconKey(DEFAULT_ICON);
      setColor(DEFAULT_COLOR);
    }
  }, [open, deviceType]);

  const handleSave = async () => {
    if (!displayName.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = deviceType
        ? await deviceTypesAPI.update(deviceType.id, { display_name: displayName.trim(), icon_key: iconKey, color })
        : await deviceTypesAPI.create({ display_name: displayName.trim(), icon_key: iconKey, color });
      onSaved(saved, !deviceType);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save device type');
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{deviceType ? 'Edit Device Type' : 'Add Device Type'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Stack direction="row" spacing={2} alignItems="center">
            <MarkerPreview color={color} iconKey={iconKey} />
            <TextField
              label="Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              fullWidth
              autoFocus
              required
            />
          </Stack>

          <Box>
            <Typography variant="subtitle2" gutterBottom>Icon</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {ICON_KEYS.map((opt) => (
                <Box
                  key={opt.key}
                  onClick={() => setIconKey(opt.key)}
                  title={opt.label}
                  sx={{
                    cursor: 'pointer',
                    p: 0.5,
                    borderRadius: 1,
                    border: '2px solid',
                    borderColor: iconKey === opt.key ? brandColors.main : 'transparent',
                  }}
                >
                  <MarkerPreview color={color} iconKey={opt.key} size={32} />
                </Box>
              ))}
            </Box>
          </Box>

          <Box>
            <Typography variant="subtitle2" gutterBottom>Colour</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
              {COLOR_PALETTE.map((c) => (
                <Box
                  key={c}
                  onClick={() => setColor(c)}
                  sx={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    bgcolor: c,
                    cursor: 'pointer',
                    border: '2px solid',
                    borderColor: color.toLowerCase() === c.toLowerCase() ? '#000' : '#fff',
                    boxShadow: '0 0 0 1px rgba(0,0,0,0.15)',
                  }}
                />
              ))}
              <Box
                component="input"
                type="color"
                value={color}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setColor(e.target.value)}
                sx={{
                  width: 32,
                  height: 32,
                  p: 0,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  cursor: 'pointer',
                  bgcolor: 'transparent',
                }}
                title="Custom colour"
              />
            </Box>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
        >
          {deviceType ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
