/**
 * Shared locations + devices view: a map (device markers over location
 * boundaries) or a filterable table listing both kinds, driven entirely by the
 * data passed in. Editing (add / edit / delete / (de)activate) is enabled with
 * `editable`; a read-only view (e.g. a survey space) omits all mutation UI while
 * keeping hover names on the map.
 *
 * Data loading lives in the caller; after a successful mutation this calls
 * `onReload` to refresh.
 */

import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  InputAdornment,
  ToggleButton,
  ToggleButtonGroup,
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
import { Add, Edit, Delete, RestoreFromTrash, Search } from '@mui/icons-material';
import PlaceIcon from '@mui/icons-material/Place';
import SensorsIcon from '@mui/icons-material/Sensors';

import { locationsAPI, devicesAPI } from '../../services/api';
import type { Location, LocationType, LocationWithBoundary, Device } from '../../services/api';
import { brandColors } from '../../theme';
import { useToast } from '../../context/ToastContext';
import { useRowHighlight } from '../../hooks';
import { DEVICE_TYPE_LABELS, DEVICE_CHIP_COLORS } from '../../utils/deviceIcon';
import DeviceMap from './DeviceMap';
import LocationDeviceEditorDialog, { type EditorKind } from './LocationDeviceEditorDialog';
import ViewModeToggle, { type ViewMode } from '../ViewModeToggle';

const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  area: 'Area',
  route: 'Route',
  point: 'Point',
  none: 'No coordinates',
  // Sectors are never shown as top-level locations, but the map must be total.
  sector: 'Sector',
};

const LOCATION_TYPE_COLORS: Record<LocationType, 'success' | 'info' | 'warning' | 'default'> = {
  area: 'success',
  route: 'info',
  point: 'warning',
  none: 'default',
  sector: 'info',
};

type EntityKind = 'location' | 'device';

type Row =
  | { kind: 'location'; sortName: string; location: Location }
  | { kind: 'device'; sortName: string; device: Device };

const LOCATION_DEFAULTS = { geometry: null, boundary_geometry: null };
const noop = async () => {};

interface LocationsDevicesViewProps {
  /** Top-level locations to list (Location or LocationWithBoundary). */
  locations: Location[];
  /** Locations with geometry, drawn on the map. */
  boundaries: LocationWithBoundary[];
  devices: Device[];
  loading: boolean;
  loadError?: string | null;
  /** Enable add / edit / delete / (de)activate. Read-only when false. */
  editable?: boolean;
  /** Called after a successful mutation so the caller can refresh its data. */
  onReload?: () => Promise<void> | void;
  /** Locations shown faintly on the editor maps for context; defaults to `boundaries`. */
  referenceLocations?: LocationWithBoundary[];
  /** Show the search box + kind filter. Defaults to `editable`. */
  showSearch?: boolean;
  mapHeight?: number | string;
  defaultView?: ViewMode;
}

export default function LocationsDevicesView({
  locations,
  boundaries,
  devices,
  loading,
  loadError = null,
  editable = false,
  onReload,
  referenceLocations,
  showSearch = editable,
  mapHeight = 'calc(100vh - 330px)',
  defaultView = 'list',
}: LocationsDevicesViewProps) {
  const reload = onReload ?? noop;
  const reference = referenceLocations ?? boundaries;

  const [viewMode, setViewMode] = useState<ViewMode>(defaultView);
  const [search, setSearch] = useState('');
  const [kinds, setKinds] = useState<EntityKind[]>(['location', 'device']);

  // Editor dialog
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'add' | 'edit'>('add');
  const [editorKind, setEditorKind] = useState<EditorKind>('location');
  const [editLocation, setEditLocation] = useState<LocationWithBoundary | null>(null);
  const [editDevice, setEditDevice] = useState<Device | null>(null);

  // Confirmation dialogs
  const [deleteLocationTarget, setDeleteLocationTarget] = useState<Location | null>(null);
  const [deletingLocation, setDeletingLocation] = useState(false);
  const [deactivateDeviceTarget, setDeactivateDeviceTarget] = useState<Device | null>(null);
  const [deactivatingDevice, setDeactivatingDevice] = useState(false);
  const [crudError, setCrudError] = useState<string | null>(null);

  const toast = useToast();
  const locationHighlight = useRowHighlight();
  const deviceHighlight = useRowHighlight();

  const boundariesById = useMemo(
    () => new Map(boundaries.map((b) => [b.id, b])),
    [boundaries],
  );

  /** Build the full location editor target, filling geometry defaults when absent. */
  const toLocationEditTarget = (location: Location): LocationWithBoundary => {
    const existing = boundariesById.get(location.id);
    if (existing) return existing;
    return {
      id: location.id,
      name: location.name,
      location_type: location.location_type ?? 'none',
      ...LOCATION_DEFAULTS,
    };
  };

  const handleAdd = () => {
    setEditorMode('add');
    setEditorKind('location');
    setEditLocation(null);
    setEditDevice(null);
    setEditorOpen(true);
  };

  const handleEditLocation = (location: Location) => {
    setEditorMode('edit');
    setEditorKind('location');
    setEditLocation(toLocationEditTarget(location));
    setEditDevice(null);
    setEditorOpen(true);
  };

  const handleEditDevice = (device: Device) => {
    setEditorMode('edit');
    setEditorKind('device');
    setEditDevice(device);
    setEditLocation(null);
    setEditorOpen(true);
  };

  const handleSavedLocation = async (saved: Location, created: boolean) => {
    toast.success(`Location ${created ? 'created' : 'updated'} successfully`);
    await reload();
    locationHighlight.highlight(saved.id);
  };

  const handleSavedDevice = async (saved: Device, created: boolean) => {
    toast.success(`Device ${created ? 'created' : 'updated'} successfully`);
    await reload();
    deviceHighlight.highlight(saved.id);
  };

  const handleConfirmDeleteLocation = async () => {
    if (!deleteLocationTarget) return;
    setDeletingLocation(true);
    try {
      await locationsAPI.delete(deleteLocationTarget.id);
      setDeleteLocationTarget(null);
      await reload();
      toast.error('Location deleted successfully');
    } catch (err) {
      setCrudError(err instanceof Error ? err.message : 'Failed to delete location');
    } finally {
      setDeletingLocation(false);
    }
  };

  const handleConfirmDeactivateDevice = async () => {
    if (!deactivateDeviceTarget) return;
    setDeactivatingDevice(true);
    try {
      await devicesAPI.deactivate(deactivateDeviceTarget.id);
      setDeactivateDeviceTarget(null);
      await reload();
      toast.error('Device deactivated');
    } catch (err) {
      setCrudError(err instanceof Error ? err.message : 'Failed to deactivate device');
    } finally {
      setDeactivatingDevice(false);
    }
  };

  const handleReactivateDevice = async (device: Device) => {
    try {
      await devicesAPI.reactivate(device.id);
      await reload();
      toast.success('Device reactivated');
      deviceHighlight.highlight(device.id);
    } catch (err) {
      setCrudError(err instanceof Error ? err.message : 'Failed to reactivate device');
    }
  };

  // The search + kind filter drive the map and the list together.
  const { rows, filteredDevices, filteredBoundaries } = useMemo(() => {
    const query = search.trim().toLowerCase();
    const showLocations = kinds.includes('location');
    const showDevices = kinds.includes('device');

    const fLocations = showLocations
      ? locations.filter((l) => !query || l.name.toLowerCase().includes(query))
      : [];
    const fDevices = showDevices
      ? devices.filter((d) => !query || d.name.toLowerCase().includes(query))
      : [];
    const fBoundaries = showLocations
      ? boundaries.filter((b) => !query || b.name.toLowerCase().includes(query))
      : [];

    const out: Row[] = [];
    for (const location of fLocations) {
      out.push({ kind: 'location', sortName: location.name.toLowerCase(), location });
    }
    for (const device of fDevices) {
      out.push({ kind: 'device', sortName: device.name.toLowerCase(), device });
    }
    out.sort((a, b) => a.sortName.localeCompare(b.sortName));

    return { rows: out, filteredDevices: fDevices, filteredBoundaries: fBoundaries };
  }, [locations, devices, boundaries, search, kinds]);

  const error = loadError ?? crudError;
  const colSpan = editable ? 5 : 4;

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setCrudError(null)}>
          {error}
        </Alert>
      )}

      {/* Filter toolbar — drives both the map and the list below */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
        gap={1.5}
        sx={{ mb: 2 }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} gap={1.5}>
          {showSearch && (
            <>
              <TextField
                size="small"
                placeholder="Search by name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <Search fontSize="small" />
                      </InputAdornment>
                    ),
                  },
                }}
                sx={{ minWidth: { sm: 260 } }}
              />
              <ToggleButtonGroup
                value={kinds}
                onChange={(_, next: EntityKind[]) => setKinds(next)}
                size="small"
                aria-label="filter by kind"
              >
                <ToggleButton value="location">Locations</ToggleButton>
                <ToggleButton value="device">Devices</ToggleButton>
              </ToggleButtonGroup>
            </>
          )}
        </Stack>

        <Stack direction="row" alignItems="center" justifyContent="flex-end" gap={1.5}>
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          {editable && (
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={handleAdd}
              sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
            >
              Add
            </Button>
          )}
        </Stack>
      </Stack>

      {viewMode === 'map' ? (
        <DeviceMap
          devices={filteredDevices}
          locationsWithBoundaries={filteredBoundaries}
          loading={loading}
          height={mapHeight}
          readOnly={!editable}
          onEditDevice={handleEditDevice}
          onDeactivateDevice={(device) => setDeactivateDeviceTarget(device)}
          onReactivateDevice={handleReactivateDevice}
          onEditLocation={handleEditLocation}
          onDeleteLocation={(loc) => setDeleteLocationTarget(loc)}
        />
      ) : (
        <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
          <Table sx={{ minWidth: 640 }}>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Kind</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Status</TableCell>
                {editable && <TableCell align="right">Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={colSpan} align="center" sx={{ py: 8 }}>
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colSpan} align="center" sx={{ py: 8, color: 'text.secondary' }}>
                    {search || kinds.length < 2 ? 'No matches' : 'No locations or devices yet'}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) =>
                  row.kind === 'location' ? (
                    <TableRow
                      key={`location-${row.location.id}`}
                      ref={locationHighlight.rowRef(row.location.id)}
                      sx={[
                        { '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.02)' } },
                        locationHighlight.rowSx(row.location.id),
                      ]}
                    >
                      <TableCell>
                        <Typography variant="body1">{row.location.name}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          icon={<PlaceIcon />}
                          label="Location"
                          size="small"
                          variant="outlined"
                          sx={{ minWidth: 96 }}
                        />
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const type = row.location.location_type ?? 'none';
                          return (
                            <Chip
                              label={LOCATION_TYPE_LABELS[type]}
                              size="small"
                              color={LOCATION_TYPE_COLORS[type]}
                              sx={{ minWidth: 70 }}
                            />
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          —
                        </Typography>
                      </TableCell>
                      {editable && (
                        <TableCell align="right">
                          <IconButton
                            size="small"
                            onClick={() => handleEditLocation(row.location)}
                            sx={{ color: 'primary.main', mr: 1 }}
                            title="Edit"
                          >
                            <Edit />
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => setDeleteLocationTarget(row.location)}
                            sx={{ color: 'error.main' }}
                            title="Delete"
                          >
                            <Delete />
                          </IconButton>
                        </TableCell>
                      )}
                    </TableRow>
                  ) : (
                    <TableRow
                      key={`device-${row.device.id}`}
                      ref={deviceHighlight.rowRef(row.device.id)}
                      sx={[
                        { '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.02)' } },
                        deviceHighlight.rowSx(row.device.id),
                      ]}
                    >
                      <TableCell>
                        <Typography variant="body1">{row.device.name}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          icon={<SensorsIcon />}
                          label="Device"
                          size="small"
                          variant="outlined"
                          sx={{ minWidth: 96 }}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={DEVICE_TYPE_LABELS[row.device.device_type]}
                          size="small"
                          color={DEVICE_CHIP_COLORS[row.device.device_type]}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={row.device.is_active ? 'Active' : 'Inactive'}
                          size="small"
                          color={row.device.is_active ? 'success' : 'default'}
                          sx={{ minWidth: 70 }}
                        />
                      </TableCell>
                      {editable && (
                        <TableCell align="right">
                          <IconButton
                            size="small"
                            onClick={() => handleEditDevice(row.device)}
                            sx={{ color: 'primary.main', mr: 1 }}
                            title="Edit"
                          >
                            <Edit />
                          </IconButton>
                          {row.device.is_active ? (
                            <IconButton
                              size="small"
                              onClick={() => setDeactivateDeviceTarget(row.device)}
                              sx={{ color: 'error.main' }}
                              title="Deactivate"
                            >
                              <Delete />
                            </IconButton>
                          ) : (
                            <IconButton
                              size="small"
                              onClick={() => handleReactivateDevice(row.device)}
                              sx={{ color: 'success.main' }}
                              title="Reactivate"
                            >
                              <RestoreFromTrash />
                            </IconButton>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ),
                )
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {editable && (
        <>
          <LocationDeviceEditorDialog
            open={editorOpen}
            mode={editorMode}
            editKind={editorKind}
            location={editLocation}
            device={editDevice}
            referenceLocations={reference}
            onClose={() => setEditorOpen(false)}
            onSavedLocation={handleSavedLocation}
            onSavedDevice={handleSavedDevice}
          />

          <Dialog open={deleteLocationTarget !== null} onClose={() => setDeleteLocationTarget(null)}>
            <DialogTitle>Delete location?</DialogTitle>
            <DialogContent>
              <DialogContentText>
                Delete &ldquo;{deleteLocationTarget?.name}&rdquo;? This cannot be undone. Surveys and sightings
                linked to this location will keep their records but lose the association.
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeleteLocationTarget(null)} disabled={deletingLocation}>
                Cancel
              </Button>
              <Button
                color="error"
                variant="contained"
                onClick={handleConfirmDeleteLocation}
                disabled={deletingLocation}
              >
                {deletingLocation ? 'Deleting…' : 'Delete'}
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog open={deactivateDeviceTarget !== null} onClose={() => setDeactivateDeviceTarget(null)}>
            <DialogTitle>Deactivate device?</DialogTitle>
            <DialogContent>
              <DialogContentText>
                Deactivate <strong>{deactivateDeviceTarget?.name}</strong>? It will no longer appear in
                active lists, but historical data is preserved.
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeactivateDeviceTarget(null)} disabled={deactivatingDevice}>
                Cancel
              </Button>
              <Button
                color="error"
                variant="contained"
                onClick={handleConfirmDeactivateDevice}
                disabled={deactivatingDevice}
              >
                {deactivatingDevice ? 'Deactivating…' : 'Deactivate'}
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Box>
  );
}
