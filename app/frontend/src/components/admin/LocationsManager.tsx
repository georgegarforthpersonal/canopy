/**
 * Admin tab for creating and managing locations. Lists locations and
 * orchestrates the editor and delete-confirmation dialogs.
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
import { Add, Edit, Delete } from '@mui/icons-material';

import { locationsAPI } from '../../services/api';
import type { Location, LocationType, LocationWithBoundary } from '../../services/api';
import { brandColors } from '../../theme';
import LocationEditorDialog from './LocationEditorDialog';

const TYPE_LABELS: Record<LocationType, string> = {
  area: 'Area',
  route: 'Route',
  point: 'Point',
  none: 'No coordinates',
};

const TYPE_COLORS: Record<LocationType, 'success' | 'info' | 'warning' | 'default'> = {
  area: 'success',
  route: 'info',
  point: 'warning',
  none: 'default',
};

const DEFAULTS = {
  geometry: null,
  boundary_geometry: null,
  boundary_fill_color: '#3388ff',
  boundary_stroke_color: '#3388ff',
  boundary_fill_opacity: 0.2,
};

export default function LocationsManager() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [boundariesById, setBoundariesById] = useState<Map<number, LocationWithBoundary>>(new Map());
  const [allBoundaries, setAllBoundaries] = useState<LocationWithBoundary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LocationWithBoundary | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, boundaries] = await Promise.all([
        locationsAPI.getAll(),
        locationsAPI.getAllWithBoundaries(),
      ]);
      setLocations(list);
      setAllBoundaries(boundaries);
      setBoundariesById(new Map(boundaries.map((b) => [b.id, b])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load locations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Build the full editor target, filling geometry/styling defaults when absent. */
  const toEditTarget = (location: Location): LocationWithBoundary => {
    const existing = boundariesById.get(location.id);
    if (existing) return existing;
    return {
      id: location.id,
      name: location.name,
      location_type: location.location_type ?? 'none',
      ...DEFAULTS,
    };
  };

  const handleAdd = () => {
    setEditTarget(null);
    setEditorOpen(true);
  };

  const handleEdit = (location: Location) => {
    setEditTarget(toEditTarget(location));
    setEditorOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await locationsAPI.delete(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete location');
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
          Add Location
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
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={3} align="center" sx={{ py: 8 }}>
                  <CircularProgress />
                </TableCell>
              </TableRow>
            ) : locations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} align="center" sx={{ py: 8, color: 'text.secondary' }}>
                  No locations yet
                </TableCell>
              </TableRow>
            ) : (
              locations.map((location) => {
                const type = location.location_type ?? 'none';
                return (
                  <TableRow key={location.id} sx={{ '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.02)' } }}>
                    <TableCell>
                      <Typography variant="body1">{location.name}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={TYPE_LABELS[type]} size="small" color={TYPE_COLORS[type]} sx={{ minWidth: 70 }} />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        onClick={() => handleEdit(location)}
                        sx={{ color: 'primary.main', mr: 1 }}
                        title="Edit"
                      >
                        <Edit />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => setDeleteTarget(location)}
                        sx={{ color: 'error.main' }}
                        title="Delete"
                      >
                        <Delete />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <LocationEditorDialog
        open={editorOpen}
        location={editTarget}
        referenceLocations={allBoundaries}
        onClose={() => setEditorOpen(false)}
        onSaved={load}
      />

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete location?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete &ldquo;{deleteTarget?.name}&rdquo;? This cannot be undone. Surveys and sightings linked
            to this location will keep their records but lose the association.
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
