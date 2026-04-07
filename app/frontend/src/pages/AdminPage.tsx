import {
  Box,
  Typography,
  Paper,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  FormControlLabel,
  Switch,
  Autocomplete,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { Add, Delete, RestoreFromTrash, Edit, Lock, Download } from '@mui/icons-material';
import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  surveyorsAPI,
  surveyTypesAPI,
  locationsAPI,
  devicesAPI,
  exportAPI,
  type Surveyor,
  type SurveyType,
  type SurveyTypeWithDetails,
  type SurveyTypeCreate,
  type SurveyTypeUpdate,
  type SpeciesTypeRef,
  type Location,
  type LocationWithBoundary,
  type Device,
  type DeviceCreate,
  type DeviceUpdate,
  type DeviceType,
} from '../services/api';
import LocationMapPicker from '../components/surveys/LocationMapPicker';
import DeviceMap from '../components/admin/DeviceMap';
import { SurveyTypeColorSelector, SurveyTypeChip } from '../components/SurveyTypeColors';
import { brandColors } from '../theme';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

/**
 * AdminPage - Admin management interface
 *
 * Features:
 * - Surveyors: View, add, deactivate/reactivate surveyors
 * - Survey Types: View, add, edit, deactivate/reactivate survey type configurations
 */
export function AdminPage() {
  const { isAuthenticated, isLoading: authLoading, requireAuth } = useAuth();
  const [tabValue, setTabValue] = useState(0);

  // Surveyors state
  const [surveyors, setSurveyors] = useState<Surveyor[]>([]);
  const [surveyorsLoading, setSurveyorsLoading] = useState(true);
  const [surveyorsError, setSurveyorsError] = useState<string | null>(null);
  const [surveyorDialogOpen, setSurveyorDialogOpen] = useState(false);
  const [surveyorDialogMode, setSurveyorDialogMode] = useState<'add' | 'edit'>('add');
  const [editingSurveyor, setEditingSurveyor] = useState<Surveyor | null>(null);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [surveyorFormError, setSurveyorFormError] = useState<string | null>(null);
  const [savingSurveyor, setSavingSurveyor] = useState(false);
  const [deactivateSurveyorDialogOpen, setDeactivateSurveyorDialogOpen] = useState(false);
  const [surveyorToDeactivate, setSurveyorToDeactivate] = useState<Surveyor | null>(null);
  const [deactivatingSurveyor, setDeactivatingSurveyor] = useState(false);

  // Survey Types state
  const [surveyTypes, setSurveyTypes] = useState<SurveyType[]>([]);
  const [surveyTypesLoading, setSurveyTypesLoading] = useState(true);
  const [surveyTypesError, setSurveyTypesError] = useState<string | null>(null);
  const [allLocations, setAllLocations] = useState<Location[]>([]);
  const [allLocationsWithBoundaries, setAllLocationsWithBoundaries] = useState<LocationWithBoundary[]>([]);
  const [allSpeciesTypes, setAllSpeciesTypes] = useState<SpeciesTypeRef[]>([]);
  const [surveyTypeDialogOpen, setSurveyTypeDialogOpen] = useState(false);
  const [surveyTypeDialogMode, setSurveyTypeDialogMode] = useState<'add' | 'edit'>('add');
  const [editingSurveyType, setEditingSurveyType] = useState<SurveyTypeWithDetails | null>(null);
  const [surveyTypeFormError, setSurveyTypeFormError] = useState<string | null>(null);
  const [savingSurveyType, setSavingSurveyType] = useState(false);
  const [deactivateSurveyTypeDialogOpen, setDeactivateSurveyTypeDialogOpen] = useState(false);
  const [surveyTypeToDeactivate, setSurveyTypeToDeactivate] = useState<SurveyType | null>(null);
  const [deactivatingSurveyType, setDeactivatingSurveyType] = useState(false);

  // Survey Type form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formLocationAtSightingLevel, setFormLocationAtSightingLevel] = useState(false);
  const [formAllowGeolocation, setFormAllowGeolocation] = useState(true);
  const [formAllowSightingNotes, setFormAllowSightingNotes] = useState(true);
  const [formAllowAudioUpload, setFormAllowAudioUpload] = useState(false);
  const [formAllowImageUpload, setFormAllowImageUpload] = useState(false);
  const [formFetchWeather, setFormFetchWeather] = useState(false);
  const [formColor, setFormColor] = useState<string | null>(null);
  const [formSelectedLocations, setFormSelectedLocations] = useState<Location[]>([]);
  const [formSelectedSpeciesTypes, setFormSelectedSpeciesTypes] = useState<SpeciesTypeRef[]>([]);

  // Devices state
  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [deviceDialogOpen, setDeviceDialogOpen] = useState(false);
  const [deviceDialogMode, setDeviceDialogMode] = useState<'add' | 'edit'>('add');
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [deviceFormError, setDeviceFormError] = useState<string | null>(null);
  const [savingDevice, setSavingDevice] = useState(false);
  const [deactivateDeviceDialogOpen, setDeactivateDeviceDialogOpen] = useState(false);
  const [deviceToDeactivate, setDeviceToDeactivate] = useState<Device | null>(null);
  const [deactivatingDevice, setDeactivatingDevice] = useState(false);

  // Device form state
  const [formDeviceId, setFormDeviceId] = useState('');
  const [formDeviceName, setFormDeviceName] = useState('');
  const [formDeviceType, setFormDeviceType] = useState<DeviceType>('audio_recorder');
  const [formDeviceLatitude, setFormDeviceLatitude] = useState<number | undefined>(undefined);
  const [formDeviceLongitude, setFormDeviceLongitude] = useState<number | undefined>(undefined);
  const [formDeviceLocationId, setFormDeviceLocationId] = useState<number | null>(null);

  // Export state
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);

  // Load data
  useEffect(() => {
    loadSurveyors();
    loadSurveyTypes();
    loadDevices();
    loadReferenceData();
  }, []);

  const loadSurveyors = async () => {
    try {
      setSurveyorsLoading(true);
      setSurveyorsError(null);
      const data = await surveyorsAPI.getAll(true);
      setSurveyors(data);
    } catch (err) {
      setSurveyorsError(err instanceof Error ? err.message : 'Failed to load surveyors');
    } finally {
      setSurveyorsLoading(false);
    }
  };

  const loadSurveyTypes = async () => {
    try {
      setSurveyTypesLoading(true);
      setSurveyTypesError(null);
      const data = await surveyTypesAPI.getAll(true);
      setSurveyTypes(data);
    } catch (err) {
      setSurveyTypesError(err instanceof Error ? err.message : 'Failed to load survey types');
    } finally {
      setSurveyTypesLoading(false);
    }
  };

  const loadReferenceData = async () => {
    try {
      const [locations, locationsWithBoundaries, speciesTypes] = await Promise.all([
        locationsAPI.getAll(),
        locationsAPI.getAllWithBoundaries(),
        surveyTypesAPI.getSpeciesTypes(),
      ]);
      setAllLocations(locations);
      setAllLocationsWithBoundaries(locationsWithBoundaries);
      setAllSpeciesTypes(speciesTypes);
    } catch (err) {
      console.error('Failed to load reference data:', err);
    }
  };

  const handleExportSqlite = async () => {
    setExporting(true);
    setExportError(null);
    setExportSuccess(false);
    try {
      await exportAPI.downloadSqlite();
      setExportSuccess(true);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const loadDevices = async () => {
    try {
      setDevicesLoading(true);
      setDevicesError(null);
      const data = await devicesAPI.getAll(true);
      setDevices(data);
    } catch (err) {
      setDevicesError(err instanceof Error ? err.message : 'Failed to load devices');
    } finally {
      setDevicesLoading(false);
    }
  };

  // Surveyor handlers
  const handleOpenAddSurveyor = () => {
    setSurveyorDialogMode('add');
    setEditingSurveyor(null);
    setNewFirstName('');
    setNewLastName('');
    setSurveyorFormError(null);
    setSurveyorDialogOpen(true);
  };

  const handleOpenEditSurveyor = (surveyor: Surveyor) => {
    setSurveyorDialogMode('edit');
    setEditingSurveyor(surveyor);
    setNewFirstName(surveyor.first_name);
    setNewLastName(surveyor.last_name || '');
    setSurveyorFormError(null);
    setSurveyorDialogOpen(true);
  };

  const handleSaveSurveyor = async () => {
    if (!newFirstName.trim()) {
      setSurveyorFormError('First name is required');
      return;
    }
    try {
      setSavingSurveyor(true);
      setSurveyorFormError(null);
      const data = {
        first_name: newFirstName.trim(),
        last_name: newLastName.trim() || null
      };
      if (surveyorDialogMode === 'add') {
        await surveyorsAPI.create(data);
      } else if (editingSurveyor) {
        await surveyorsAPI.update(editingSurveyor.id, data);
      }
      setSurveyorDialogOpen(false);
      await loadSurveyors();
    } catch (err) {
      setSurveyorFormError(err instanceof Error ? err.message : 'Failed to save surveyor');
    } finally {
      setSavingSurveyor(false);
    }
  };

  const handleDeactivateSurveyor = async () => {
    if (!surveyorToDeactivate) return;
    try {
      setDeactivatingSurveyor(true);
      await surveyorsAPI.deactivate(surveyorToDeactivate.id);
      setDeactivateSurveyorDialogOpen(false);
      setSurveyorToDeactivate(null);
      await loadSurveyors();
    } catch (err) {
      setSurveyorsError(err instanceof Error ? err.message : 'Failed to deactivate surveyor');
    } finally {
      setDeactivatingSurveyor(false);
    }
  };

  const handleReactivateSurveyor = async (surveyor: Surveyor) => {
    try {
      setSurveyorsError(null);
      await surveyorsAPI.reactivate(surveyor.id);
      await loadSurveyors();
    } catch (err) {
      setSurveyorsError(err instanceof Error ? err.message : 'Failed to reactivate surveyor');
    }
  };

  // Survey Type handlers
  const handleOpenAddSurveyType = () => {
    setSurveyTypeDialogMode('add');
    setEditingSurveyType(null);
    resetSurveyTypeForm();
    setSurveyTypeDialogOpen(true);
  };

  const handleOpenEditSurveyType = async (surveyType: SurveyType) => {
    try {
      const details = await surveyTypesAPI.getById(surveyType.id);
      setSurveyTypeDialogMode('edit');
      setEditingSurveyType(details);
      setFormName(details.name);
      setFormDescription(details.description || '');
      setFormLocationAtSightingLevel(details.location_at_sighting_level);
      setFormAllowGeolocation(details.allow_geolocation);
      setFormAllowSightingNotes(details.allow_sighting_notes);
      setFormAllowAudioUpload(details.allow_audio_upload);
      setFormAllowImageUpload(details.allow_image_upload);
      setFormFetchWeather(details.fetch_weather);
      setFormColor(details.color);
      setFormSelectedLocations(details.locations);
      setFormSelectedSpeciesTypes(details.species_types);
      setSurveyTypeDialogOpen(true);
    } catch (err) {
      setSurveyTypesError(err instanceof Error ? err.message : 'Failed to load survey type details');
    }
  };

  const resetSurveyTypeForm = () => {
    setFormName('');
    setFormDescription('');
    setFormLocationAtSightingLevel(false);
    setFormAllowGeolocation(true);
    setFormAllowSightingNotes(true);
    setFormAllowAudioUpload(false);
    setFormAllowImageUpload(false);
    setFormFetchWeather(false);
    setFormColor(null);
    setFormSelectedLocations([]);
    setFormSelectedSpeciesTypes([]);
    setSurveyTypeFormError(null);
  };

  const handleSaveSurveyType = async () => {
    if (!formName.trim()) {
      setSurveyTypeFormError('Name is required');
      return;
    }
    if (formSelectedLocations.length === 0 && !formAllowImageUpload) {
      setSurveyTypeFormError('At least one location must be selected');
      return;
    }
    if (formSelectedSpeciesTypes.length === 0) {
      setSurveyTypeFormError('At least one species type must be selected');
      return;
    }

    try {
      setSavingSurveyType(true);
      setSurveyTypeFormError(null);

      const data = {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        location_at_sighting_level: formLocationAtSightingLevel,
        allow_geolocation: formAllowGeolocation,
        allow_sighting_notes: formAllowSightingNotes,
        allow_audio_upload: formAllowAudioUpload,
        allow_image_upload: formAllowImageUpload,
        fetch_weather: formFetchWeather,
        color: formColor || undefined,
        location_ids: formSelectedLocations.map((l) => l.id),
        species_type_ids: formSelectedSpeciesTypes.map((st) => st.id),
      };

      if (surveyTypeDialogMode === 'add') {
        await surveyTypesAPI.create(data as SurveyTypeCreate);
      } else if (editingSurveyType) {
        await surveyTypesAPI.update(editingSurveyType.id, data as SurveyTypeUpdate);
      }

      setSurveyTypeDialogOpen(false);
      resetSurveyTypeForm();
      await loadSurveyTypes();
    } catch (err) {
      setSurveyTypeFormError(err instanceof Error ? err.message : 'Failed to save survey type');
    } finally {
      setSavingSurveyType(false);
    }
  };

  const handleDeactivateSurveyType = async () => {
    if (!surveyTypeToDeactivate) return;
    try {
      setDeactivatingSurveyType(true);
      await surveyTypesAPI.delete(surveyTypeToDeactivate.id);
      setDeactivateSurveyTypeDialogOpen(false);
      setSurveyTypeToDeactivate(null);
      await loadSurveyTypes();
    } catch (err) {
      setSurveyTypesError(err instanceof Error ? err.message : 'Failed to deactivate survey type');
    } finally {
      setDeactivatingSurveyType(false);
    }
  };

  const handleReactivateSurveyType = async (surveyType: SurveyType) => {
    try {
      setSurveyTypesError(null);
      await surveyTypesAPI.reactivate(surveyType.id);
      await loadSurveyTypes();
    } catch (err) {
      setSurveyTypesError(err instanceof Error ? err.message : 'Failed to reactivate survey type');
    }
  };

  // Device handlers
  const handleOpenAddDevice = (lat?: number, lng?: number) => {
    setDeviceDialogMode('add');
    setEditingDevice(null);
    setFormDeviceId('');
    setFormDeviceName('');
    setFormDeviceType('audio_recorder');
    setFormDeviceLatitude(lat);
    setFormDeviceLongitude(lng);
    setFormDeviceLocationId(null);
    setDeviceFormError(null);
    setDeviceDialogOpen(true);
  };

  const handleOpenEditDevice = (device: Device) => {
    setDeviceDialogMode('edit');
    setEditingDevice(device);
    setFormDeviceId(device.device_id);
    setFormDeviceName(device.name || '');
    setFormDeviceType(device.device_type);
    setFormDeviceLatitude(device.latitude ?? undefined);
    setFormDeviceLongitude(device.longitude ?? undefined);
    setFormDeviceLocationId(device.location_id);
    setDeviceFormError(null);
    setDeviceDialogOpen(true);
  };

  const handleSaveDevice = async () => {
    if (!formDeviceId.trim()) {
      setDeviceFormError('Device ID is required');
      return;
    }
    try {
      setSavingDevice(true);
      setDeviceFormError(null);
      const data: DeviceCreate | DeviceUpdate = {
        device_id: formDeviceId.trim(),
        name: formDeviceName.trim() || undefined,
        device_type: formDeviceType,
        latitude: formDeviceLatitude,
        longitude: formDeviceLongitude,
        location_id: formDeviceLocationId ?? undefined,
      };
      if (deviceDialogMode === 'add') {
        await devicesAPI.create(data as DeviceCreate);
      } else if (editingDevice) {
        await devicesAPI.update(editingDevice.id, data as DeviceUpdate);
      }
      setDeviceDialogOpen(false);
      await loadDevices();
    } catch (err) {
      setDeviceFormError(err instanceof Error ? err.message : 'Failed to save device');
    } finally {
      setSavingDevice(false);
    }
  };

  const handleDeactivateDevice = async () => {
    if (!deviceToDeactivate) return;
    try {
      setDeactivatingDevice(true);
      await devicesAPI.deactivate(deviceToDeactivate.id);
      setDeactivateDeviceDialogOpen(false);
      setDeviceToDeactivate(null);
      await loadDevices();
    } catch (err) {
      setDevicesError(err instanceof Error ? err.message : 'Failed to deactivate device');
    } finally {
      setDeactivatingDevice(false);
    }
  };

  const handleReactivateDevice = async (device: Device) => {
    try {
      setDevicesError(null);
      await devicesAPI.reactivate(device.id);
      await loadDevices();
    } catch (err) {
      setDevicesError(err instanceof Error ? err.message : 'Failed to reactivate device');
    }
  };

  // Show auth gate if not authenticated
  if (authLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return (
      <Box sx={{ p: { xs: 2, sm: 3, md: 4 }, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
        <Lock sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
        <Typography variant="h6" sx={{ mb: 1 }}>
          Admin Access Required
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, textAlign: 'center' }}>
          You need to enter the admin password to access this page.
        </Typography>
        <Button
          variant="contained"
          onClick={() => requireAuth(() => {})}
          sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
        >
          Enter Password
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 3, md: 4 } }}>
      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
          <Tab label="Surveyors" />
          <Tab label="Survey Types" />
          <Tab label="Devices" />
          <Tab label="Data" />
        </Tabs>
      </Box>

      {/* Surveyors Tab */}
      <TabPanel value={tabValue} index={0}>
        <Box sx={{ mb: 3, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={handleOpenAddSurveyor}
            sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
          >
            Add Surveyor
          </Button>
        </Box>

        {surveyorsError && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setSurveyorsError(null)}>
            {surveyorsError}
          </Alert>
        )}

        <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {surveyorsLoading ? (
                <TableRow>
                  <TableCell colSpan={3} align="center" sx={{ py: 8 }}>
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : surveyors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} align="center" sx={{ py: 8, color: 'text.secondary' }}>
                    No surveyors found
                  </TableCell>
                </TableRow>
              ) : (
                surveyors.map((surveyor) => (
                  <TableRow key={surveyor.id} sx={{ '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.02)' } }}>
                    <TableCell>
                      <Typography variant="body1">
                        {surveyor.first_name}{surveyor.last_name ? ` ${surveyor.last_name}` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={surveyor.is_active ? 'Active' : 'Inactive'}
                        size="small"
                        color={surveyor.is_active ? 'success' : 'default'}
                        sx={{ minWidth: 70 }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        onClick={() => handleOpenEditSurveyor(surveyor)}
                        sx={{ color: 'primary.main', mr: 1 }}
                        title="Edit"
                      >
                        <Edit />
                      </IconButton>
                      {surveyor.is_active ? (
                        <IconButton
                          size="small"
                          onClick={() => {
                            setSurveyorToDeactivate(surveyor);
                            setDeactivateSurveyorDialogOpen(true);
                          }}
                          sx={{ color: 'error.main' }}
                          title="Deactivate"
                        >
                          <Delete />
                        </IconButton>
                      ) : (
                        <IconButton
                          size="small"
                          onClick={() => handleReactivateSurveyor(surveyor)}
                          sx={{ color: 'success.main' }}
                          title="Reactivate"
                        >
                          <RestoreFromTrash />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </TabPanel>

      {/* Survey Types Tab */}
      <TabPanel value={tabValue} index={1}>
        <Box sx={{ mb: 3, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={handleOpenAddSurveyType}
            sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
          >
            Add Survey Type
          </Button>
        </Box>

        {surveyTypesError && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setSurveyTypesError(null)}>
            {surveyTypesError}
          </Alert>
        )}

        <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Location Level</TableCell>
                <TableCell>Geolocation</TableCell>
                <TableCell>Sighting Notes</TableCell>
                <TableCell>Audio</TableCell>
                <TableCell>Images</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {surveyTypesLoading ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 8 }}>
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : surveyTypes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 8, color: 'text.secondary' }}>
                    No survey types found
                  </TableCell>
                </TableRow>
              ) : (
                surveyTypes.map((surveyType) => (
                  <TableRow key={surveyType.id} sx={{ '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.02)' } }}>
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={1.5}>
                        <SurveyTypeChip name={surveyType.name} color={surveyType.color} />
                        {surveyType.description && (
                          <Typography variant="body2" color="text.secondary">
                            {surveyType.description}
                          </Typography>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={surveyType.location_at_sighting_level ? 'Per Sighting' : 'Per Survey'}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={surveyType.allow_geolocation ? 'Enabled' : 'Disabled'}
                        size="small"
                        color={surveyType.allow_geolocation ? 'info' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={surveyType.allow_sighting_notes ? 'Enabled' : 'Disabled'}
                        size="small"
                        color={surveyType.allow_sighting_notes ? 'warning' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={surveyType.allow_audio_upload ? 'Enabled' : 'Disabled'}
                        size="small"
                        color={surveyType.allow_audio_upload ? 'secondary' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={surveyType.allow_image_upload ? 'Enabled' : 'Disabled'}
                        size="small"
                        color={surveyType.allow_image_upload ? 'primary' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={surveyType.is_active ? 'Active' : 'Inactive'}
                        size="small"
                        color={surveyType.is_active ? 'success' : 'default'}
                        sx={{ minWidth: 70 }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        onClick={() => handleOpenEditSurveyType(surveyType)}
                        sx={{ color: 'primary.main', mr: 1 }}
                        title="Edit"
                      >
                        <Edit />
                      </IconButton>
                      {surveyType.is_active ? (
                        <IconButton
                          size="small"
                          onClick={() => {
                            setSurveyTypeToDeactivate(surveyType);
                            setDeactivateSurveyTypeDialogOpen(true);
                          }}
                          sx={{ color: 'error.main' }}
                          title="Deactivate"
                        >
                          <Delete />
                        </IconButton>
                      ) : (
                        <IconButton
                          size="small"
                          onClick={() => handleReactivateSurveyType(surveyType)}
                          sx={{ color: 'success.main' }}
                          title="Reactivate"
                        >
                          <RestoreFromTrash />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </TabPanel>

      {/* Devices Tab */}
      <TabPanel value={tabValue} index={2}>
        {devicesError && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setDevicesError(null)}>
            {devicesError}
          </Alert>
        )}

        <DeviceMap
          devices={devices}
          locationsWithBoundaries={allLocationsWithBoundaries}
          loading={devicesLoading}
          onEditDevice={handleOpenEditDevice}
          onDeactivateDevice={(device) => {
            setDeviceToDeactivate(device);
            setDeactivateDeviceDialogOpen(true);
          }}
          onReactivateDevice={handleReactivateDevice}
          onAddDeviceAtLocation={handleOpenAddDevice}
        />

        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => handleOpenAddDevice()}
            sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
          >
            Add Device
          </Button>
        </Box>

        <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Device ID</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Coordinates</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {devicesLoading ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 8 }}>
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : devices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 8, color: 'text.secondary' }}>
                    No devices found
                  </TableCell>
                </TableRow>
              ) : (
                devices.map((device) => (
                  <TableRow key={device.id} sx={{ '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.02)' } }}>
                    <TableCell>
                      <Typography variant="body1" sx={{ fontFamily: 'monospace' }}>
                        {device.device_id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={device.device_type === 'camera_trap' ? 'Camera Trap' : 'Audio Recorder'}
                        size="small"
                        color={device.device_type === 'camera_trap' ? 'primary' : 'secondary'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body1">
                        {device.name || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {device.location_name || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {device.latitude && device.longitude ? (
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {device.latitude.toFixed(5)}, {device.longitude.toFixed(5)}
                        </Typography>
                      ) : (
                        <Typography variant="body2" color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={device.is_active ? 'Active' : 'Inactive'}
                        size="small"
                        color={device.is_active ? 'success' : 'default'}
                        sx={{ minWidth: 70 }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        onClick={() => handleOpenEditDevice(device)}
                        sx={{ color: 'primary.main', mr: 1 }}
                        title="Edit"
                      >
                        <Edit />
                      </IconButton>
                      {device.is_active ? (
                        <IconButton
                          size="small"
                          onClick={() => {
                            setDeviceToDeactivate(device);
                            setDeactivateDeviceDialogOpen(true);
                          }}
                          sx={{ color: 'error.main' }}
                          title="Deactivate"
                        >
                          <Delete />
                        </IconButton>
                      ) : (
                        <IconButton
                          size="small"
                          onClick={() => handleReactivateDevice(device)}
                          sx={{ color: 'success.main' }}
                          title="Reactivate"
                        >
                          <RestoreFromTrash />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </TabPanel>

      {/* Data Tab */}
      <TabPanel value={tabValue} index={3}>
        <Paper sx={{ p: 3, maxWidth: 600 }}>
          <Typography variant="h6" gutterBottom>
            Export Data
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Download a snapshot of all your organisation's data as a SQLite database file.
          </Typography>
          {exportError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {exportError}
            </Alert>
          )}
          {exportSuccess && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Export downloaded successfully.
            </Alert>
          )}
          <Button
            variant="contained"
            startIcon={exporting ? <CircularProgress size={20} color="inherit" /> : <Download />}
            onClick={handleExportSqlite}
            disabled={exporting}
            sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
          >
            {exporting ? 'Exporting...' : 'Download SQLite Database'}
          </Button>
        </Paper>
      </TabPanel>

      {/* Add/Edit Surveyor Dialog */}
      <Dialog open={surveyorDialogOpen} onClose={() => !savingSurveyor && setSurveyorDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{surveyorDialogMode === 'add' ? 'Add New Surveyor' : 'Edit Surveyor'}</DialogTitle>
        <DialogContent>
          {surveyorFormError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {surveyorFormError}
            </Alert>
          )}
          <TextField
            autoFocus
            margin="normal"
            label="First Name"
            fullWidth
            value={newFirstName}
            onChange={(e) => setNewFirstName(e.target.value)}
            disabled={savingSurveyor}
          />
          <TextField
            margin="normal"
            label="Last Name"
            fullWidth
            value={newLastName}
            onChange={(e) => setNewLastName(e.target.value)}
            disabled={savingSurveyor}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSurveyorDialogOpen(false)} disabled={savingSurveyor}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveSurveyor}
            variant="contained"
            disabled={savingSurveyor}
            sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
          >
            {savingSurveyor ? 'Saving...' : surveyorDialogMode === 'add' ? 'Add' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Deactivate Surveyor Dialog */}
      <Dialog
        open={deactivateSurveyorDialogOpen}
        onClose={() => !deactivatingSurveyor && setDeactivateSurveyorDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Deactivate Surveyor?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to deactivate{' '}
            <strong>
              {surveyorToDeactivate?.first_name}{surveyorToDeactivate?.last_name ? ` ${surveyorToDeactivate.last_name}` : ''}
            </strong>
            ?
          </Typography>
          <Typography sx={{ mt: 2, color: 'text.secondary' }}>
            They will no longer appear in the surveyor list for new surveys, but their historical survey data will be preserved.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeactivateSurveyorDialogOpen(false)} disabled={deactivatingSurveyor}>
            Cancel
          </Button>
          <Button onClick={handleDeactivateSurveyor} variant="contained" color="error" disabled={deactivatingSurveyor}>
            {deactivatingSurveyor ? 'Deactivating...' : 'Deactivate'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add/Edit Survey Type Dialog */}
      <Dialog
        open={surveyTypeDialogOpen}
        onClose={() => !savingSurveyType && setSurveyTypeDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{surveyTypeDialogMode === 'add' ? 'Add New Survey Type' : 'Edit Survey Type'}</DialogTitle>
        <DialogContent>
          {surveyTypeFormError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {surveyTypeFormError}
            </Alert>
          )}
          <TextField
            autoFocus
            margin="normal"
            label="Name"
            fullWidth
            required
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            disabled={savingSurveyType}
          />
          <TextField
            margin="normal"
            label="Description"
            fullWidth
            multiline
            rows={2}
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            disabled={savingSurveyType}
          />
          <Box sx={{ mt: 2 }}>
            <SurveyTypeColorSelector
              value={formColor}
              onChange={setFormColor}
            />
          </Box>
          <Box sx={{ mt: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={formLocationAtSightingLevel}
                  onChange={(e) => setFormLocationAtSightingLevel(e.target.checked)}
                  disabled={savingSurveyType}
                />
              }
              label="Location at sighting level"
            />
            <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -1 }}>
              {formLocationAtSightingLevel
                ? 'Each sighting can have its own location'
                : 'Location is set once for the entire survey'}
            </Typography>
          </Box>
          <Box sx={{ mt: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={formAllowGeolocation}
                  onChange={(e) => setFormAllowGeolocation(e.target.checked)}
                  disabled={savingSurveyType}
                />
              }
              label="Allow geolocation"
            />
            <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -1 }}>
              {formAllowGeolocation
                ? 'Users can add GPS coordinates to sightings'
                : 'GPS coordinates are disabled for this survey type'}
            </Typography>
          </Box>
          <Box sx={{ mt: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={formAllowSightingNotes}
                  onChange={(e) => setFormAllowSightingNotes(e.target.checked)}
                  disabled={savingSurveyType}
                />
              }
              label="Allow sighting notes"
            />
            <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -1 }}>
              {formAllowSightingNotes
                ? 'Users can add notes to individual sightings'
                : 'Sighting notes are disabled for this survey type'}
            </Typography>
          </Box>
          <Box sx={{ mt: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={formAllowAudioUpload}
                  onChange={(e) => setFormAllowAudioUpload(e.target.checked)}
                  disabled={savingSurveyType}
                />
              }
              label="Allow audio upload"
            />
            <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -1 }}>
              {formAllowAudioUpload
                ? 'Users can upload audio files for analysis'
                : 'Audio upload is disabled for this survey type'}
            </Typography>
          </Box>
          <Box sx={{ mt: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={formAllowImageUpload}
                  onChange={(e) => setFormAllowImageUpload(e.target.checked)}
                  disabled={savingSurveyType}
                />
              }
              label="Allow image upload"
            />
            <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -1 }}>
              {formAllowImageUpload
                ? 'Users can upload camera trap images for analysis'
                : 'Image upload is disabled for this survey type'}
            </Typography>
          </Box>
          <Box sx={{ mt: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={formFetchWeather}
                  onChange={(e) => setFormFetchWeather(e.target.checked)}
                  disabled={savingSurveyType}
                />
              }
              label="Fetch weather on creation"
            />
            <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -1 }}>
              {formFetchWeather
                ? 'Weather conditions will be recorded automatically from Open-Meteo'
                : 'No weather data will be captured for this survey type'}
            </Typography>
          </Box>
          {!formAllowImageUpload && (
            <Autocomplete
              multiple
              options={allLocations}
              getOptionLabel={(option) => option.name}
              value={formSelectedLocations}
              onChange={(_, newValue) => setFormSelectedLocations(newValue)}
              disabled={savingSurveyType}
              renderInput={(params) => (
                <TextField {...params} margin="normal" label="Available Locations" placeholder="Select locations" required />
              )}
              sx={{ mt: 2 }}
            />
          )}
          {formAllowImageUpload && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              Camera trap survey types use devices instead of locations. Devices can be managed in the Devices section below.
            </Typography>
          )}
          <Autocomplete
            multiple
            options={allSpeciesTypes}
            getOptionLabel={(option) => option.display_name}
            value={formSelectedSpeciesTypes}
            onChange={(_, newValue) => setFormSelectedSpeciesTypes(newValue)}
            disabled={savingSurveyType}
            renderInput={(params) => (
              <TextField {...params} margin="normal" label="Species Types" placeholder="Select species types" required />
            )}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSurveyTypeDialogOpen(false)} disabled={savingSurveyType}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveSurveyType}
            variant="contained"
            disabled={savingSurveyType}
            sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
          >
            {savingSurveyType ? 'Saving...' : surveyTypeDialogMode === 'add' ? 'Add' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Deactivate Survey Type Dialog */}
      <Dialog
        open={deactivateSurveyTypeDialogOpen}
        onClose={() => !deactivatingSurveyType && setDeactivateSurveyTypeDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Deactivate Survey Type?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to deactivate <strong>{surveyTypeToDeactivate?.name}</strong>?
          </Typography>
          <Typography sx={{ mt: 2, color: 'text.secondary' }}>
            It will no longer be available for new surveys, but existing surveys using this type will be preserved.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeactivateSurveyTypeDialogOpen(false)} disabled={deactivatingSurveyType}>
            Cancel
          </Button>
          <Button onClick={handleDeactivateSurveyType} variant="contained" color="error" disabled={deactivatingSurveyType}>
            {deactivatingSurveyType ? 'Deactivating...' : 'Deactivate'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add/Edit Device Dialog */}
      <Dialog
        open={deviceDialogOpen}
        onClose={() => !savingDevice && setDeviceDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>{deviceDialogMode === 'add' ? 'Add New Device' : 'Edit Device'}</DialogTitle>
        <DialogContent>
          {deviceFormError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {deviceFormError}
            </Alert>
          )}
          <TextField
            autoFocus
            margin="normal"
            label="Device ID"
            fullWidth
            required
            value={formDeviceId}
            onChange={(e) => setFormDeviceId(e.target.value)}
            disabled={savingDevice}
            helperText="Serial number from filenames (e.g., 2MM24020)"
            sx={{ fontFamily: 'monospace' }}
          />
          <FormControl fullWidth margin="normal">
            <InputLabel>Device Type</InputLabel>
            <Select
              value={formDeviceType}
              label="Device Type"
              onChange={(e) => setFormDeviceType(e.target.value as DeviceType)}
              disabled={savingDevice}
            >
              <MenuItem value="audio_recorder">Audio Recorder</MenuItem>
              <MenuItem value="camera_trap">Camera Trap</MenuItem>
            </Select>
          </FormControl>
          <TextField
            margin="normal"
            label="Name (optional)"
            fullWidth
            value={formDeviceName}
            onChange={(e) => setFormDeviceName(e.target.value)}
            disabled={savingDevice}
            helperText="Friendly name (e.g., North Field Recorder)"
          />
          <Autocomplete
            options={allLocations}
            getOptionLabel={(option) => option.name}
            value={allLocations.find((l) => l.id === formDeviceLocationId) || null}
            onChange={(_, newValue) => setFormDeviceLocationId(newValue?.id || null)}
            disabled={savingDevice}
            renderInput={(params) => (
              <TextField
                {...params}
                margin="normal"
                label="Associated Location (optional)"
                helperText="Link this device to a location area"
              />
            )}
            sx={{ mt: 1 }}
          />
          <Box sx={{ mt: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Device Position
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
              Click on the map to set the device's GPS position
            </Typography>
            <LocationMapPicker
              latitude={formDeviceLatitude}
              longitude={formDeviceLongitude}
              onChange={(lat, lng) => {
                setFormDeviceLatitude(lat ?? undefined);
                setFormDeviceLongitude(lng ?? undefined);
              }}
              locationBoundary={
                formDeviceLocationId
                  ? allLocationsWithBoundaries.find((l) => l.id === formDeviceLocationId) ?? null
                  : null
              }
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeviceDialogOpen(false)} disabled={savingDevice}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveDevice}
            variant="contained"
            disabled={savingDevice}
            sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
          >
            {savingDevice ? 'Saving...' : deviceDialogMode === 'add' ? 'Add' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Deactivate Device Dialog */}
      <Dialog
        open={deactivateDeviceDialogOpen}
        onClose={() => !deactivatingDevice && setDeactivateDeviceDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Deactivate Device?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to deactivate device <strong>{deviceToDeactivate?.device_id}</strong>
            {deviceToDeactivate?.name && ` (${deviceToDeactivate.name})`}?
          </Typography>
          <Typography sx={{ mt: 2, color: 'text.secondary' }}>
            The device will no longer appear in active lists, but historical data will be preserved.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeactivateDeviceDialogOpen(false)} disabled={deactivatingDevice}>
            Cancel
          </Button>
          <Button onClick={handleDeactivateDevice} variant="contained" color="error" disabled={deactivatingDevice}>
            {deactivatingDevice ? 'Deactivating...' : 'Deactivate'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
