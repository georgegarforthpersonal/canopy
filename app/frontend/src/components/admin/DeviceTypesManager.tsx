/**
 * Admin tab for managing device types. Lists the built-in (system) types and the
 * organisation's custom types, and orchestrates the editor and delete dialogs.
 * System types are read-only; custom types can be edited, deactivated or deleted.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Typography,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import { Add, Edit, Delete, Block, RestoreFromTrash } from '@mui/icons-material';

import { deviceTypesAPI } from '../../services/api';
import type { DeviceTypeRecord } from '../../services/api';
import { getIconSvg } from '../../utils/deviceIcon';
import { brandColors } from '../../theme';
import { useToast } from '../../context/ToastContext';
import { useRowHighlight } from '../../hooks';
import DeviceTypeEditorDialog from './DeviceTypeEditorDialog';

interface DeviceTypesManagerProps {
  /** Called after any create/update/delete so the parent can refresh its copy. */
  onChanged?: () => void;
}

/** A circular swatch showing the type's colour and icon. */
function TypeSwatch({ color, iconKey }: { color: string; iconKey: string }) {
  return (
    <Box
      sx={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        bgcolor: color,
        border: '1.5px solid #fff',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        '& svg': { width: 14, height: 14 },
      }}
      dangerouslySetInnerHTML={{ __html: getIconSvg(iconKey) }}
    />
  );
}

export default function DeviceTypesManager({ onChanged }: DeviceTypesManagerProps) {
  const [deviceTypes, setDeviceTypes] = useState<DeviceTypeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DeviceTypeRecord | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DeviceTypeRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const toast = useToast();
  const { highlight, rowRef, rowSx } = useRowHighlight();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // include_inactive so admins can see and reactivate deactivated types.
      const list = await deviceTypesAPI.getAll(true);
      setDeviceTypes(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load device types');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = () => {
    setEditTarget(null);
    setEditorOpen(true);
  };

  const handleEdit = (deviceType: DeviceTypeRecord) => {
    setEditTarget(deviceType);
    setEditorOpen(true);
  };

  const handleSaved = async (saved: DeviceTypeRecord, created: boolean) => {
    toast.success(`Device type ${created ? 'created' : 'updated'} successfully`);
    await load();
    onChanged?.();
    highlight(saved.id);
  };

  const handleToggleActive = async (deviceType: DeviceTypeRecord) => {
    try {
      if (deviceType.is_active) {
        await deviceTypesAPI.deactivate(deviceType.id);
        toast.success(`${deviceType.display_name} deactivated`);
      } else {
        await deviceTypesAPI.reactivate(deviceType.id);
        toast.success(`${deviceType.display_name} reactivated`);
      }
      await load();
      onChanged?.();
      highlight(deviceType.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update device type');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deviceTypesAPI.delete(deleteTarget.id);
      setDeleteTarget(null);
      await load();
      onChanged?.();
      toast.error('Device type deleted successfully');
    } catch (err) {
      // 409 when the type is in use — surface the server message and keep the dialog open.
      toast.error(err instanceof Error ? err.message : 'Failed to delete device type');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={handleAdd}
          sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
        >
          Add Device Type
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>Origin</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 8 }}>
                  <CircularProgress />
                </TableCell>
              </TableRow>
            ) : deviceTypes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 8, color: 'text.secondary' }}>
                  No device types yet
                </TableCell>
              </TableRow>
            ) : (
              deviceTypes.map((dt) => (
                <TableRow
                  key={dt.id}
                  ref={rowRef(dt.id)}
                  sx={[{ '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.02)' } }, rowSx(dt.id)]}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <TypeSwatch color={dt.color} iconKey={dt.icon_key} />
                      <Typography variant="body1">{dt.display_name}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={dt.is_system ? 'Built-in' : 'Custom'}
                      size="small"
                      color={dt.is_system ? 'default' : 'primary'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={dt.is_active ? 'Active' : 'Inactive'}
                      size="small"
                      color={dt.is_active ? 'success' : 'default'}
                      sx={{ minWidth: 70 }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    {dt.is_system ? (
                      <Typography variant="caption" color="text.secondary">Read-only</Typography>
                    ) : (
                      <>
                        <IconButton
                          size="small"
                          onClick={() => handleEdit(dt)}
                          sx={{ color: 'primary.main', mr: 1 }}
                          title="Edit"
                        >
                          <Edit />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => handleToggleActive(dt)}
                          sx={{ color: dt.is_active ? 'warning.main' : 'success.main', mr: 1 }}
                          title={dt.is_active ? 'Deactivate' : 'Reactivate'}
                        >
                          {dt.is_active ? <Block /> : <RestoreFromTrash />}
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => setDeleteTarget(dt)}
                          sx={{ color: 'error.main' }}
                          title="Delete"
                        >
                          <Delete />
                        </IconButton>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <DeviceTypeEditorDialog
        open={editorOpen}
        deviceType={editTarget}
        onClose={() => setEditorOpen(false)}
        onSaved={handleSaved}
      />

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete device type?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete &ldquo;{deleteTarget?.display_name}&rdquo;? This cannot be undone. If any device or
            survey type still uses it, deletion is blocked &mdash; deactivate it instead.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleConfirmDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
