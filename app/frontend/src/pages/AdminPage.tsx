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
  Divider,
} from '@mui/material';
import { Add, Delete, RestoreFromTrash, Edit, Download } from '@mui/icons-material';
import { useState, useEffect, type ReactNode, type Ref } from 'react';
import { useAuth, usePermissions } from '../context/AuthContext';
import { AccessNotice } from '../components/auth/AccessNotice';
import { UsersPanel } from '../components/admin/UsersPanel';
import { useToast } from '../context/ToastContext';
import SurveyTypeFilesManager from '../components/admin/SurveyTypeFilesManager';
import { SPACING } from '../config/responsive';
import { PageTitle } from '../components/layout/PageTitle';
import { useResponsive } from '../hooks/useResponsive';
import { useRowHighlight } from '../hooks';
import {
  surveyorsAPI,
  surveyTypesAPI,
  locationsAPI,
  exportAPI,
  locationDisplayName,
  type Surveyor,
  type SurveyType,
  type SurveyTypeWithDetails,
  type SurveyTypeCreate,
  type SurveyTypeUpdate,
  type SpeciesTypeRef,
  type Location,
  type DeviceType,
  type ScheduleCadence,
} from '../services/api';
import { orgHasGroups } from './groups/groupMeta';
import LocationsDevicesManager from '../components/admin/LocationsDevicesManager';
import RecordsExportPanel from '../components/admin/RecordsExportPanel';
import ScheduledSurveysPanel from '../components/admin/ScheduledSurveysPanel';
import EntityCard from '../components/admin/EntityCard';
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
      {value === index && <Box sx={{ pt: { xs: 2, md: 3 } }}>{children}</Box>}
    </div>
  );
}

/** Labelled group of related fields inside the survey type dialog. */
function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ mt: 3, '&:first-of-type': { mt: 1 } }}>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ letterSpacing: 1, lineHeight: 2 }}
      >
        {title}
      </Typography>
      <Divider sx={{ mb: 1 }} />
      {children}
    </Box>
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
  const { isLoading: authLoading } = useAuth();
  const { canAccessAdmin } = usePermissions();
  const { isMobile } = useResponsive();
  const toast = useToast();
  const surveyorHighlight = useRowHighlight();
  const surveyTypeHighlight = useRowHighlight();
  // Survey scheduling follows the Groups beta gate — scheduled surveys
  // surface on the Groups tab, so the orgs match (see BETA_GROUPS in groupMeta).
  const showScheduling = orgHasGroups();
  const [tabValue, setTabValue] = useState(0);
  // Panels look their index up by key, so the conditional Scheduled tab
  // can't silently shift the ones after it.
  const adminTabs = [
    { key: 'users', label: 'Users' },
    { key: 'survey-types', label: 'Survey Types' },
    ...(showScheduling ? [{ key: 'scheduled', label: 'Scheduled' }] : []),
    { key: 'locations', label: 'Locations & Devices' },
    { key: 'surveyors', label: 'Surveyors' },
    { key: 'data', label: 'Data' },
  ];
  const tabIndex = (key: string) => adminTabs.findIndex((t) => t.key === key);

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
  const [formAllowSightingPhotoUpload, setFormAllowSightingPhotoUpload] = useState(false);
  const [formAllowStartEndTime, setFormAllowStartEndTime] = useState(false);
  const [formAllowSunPercentage, setFormAllowSunPercentage] = useState(false);
  const [formAllowTemperature, setFormAllowTemperature] = useState(false);
  const [formAllowShowDescription, setFormAllowShowDescription] = useState(false);
  const [formAllowSightingDeviceSelection, setFormAllowSightingDeviceSelection] = useState(false);
  const [formSightingDeviceType, setFormSightingDeviceType] = useState<DeviceType | null>(null);
  const [formScheduleCadence, setFormScheduleCadence] = useState<ScheduleCadence>('date');
  const [formColor, setFormColor] = useState<string | null>(null);
  const [formSelectedLocations, setFormSelectedLocations] = useState<Location[]>([]);
  const [formSelectedSpeciesTypes, setFormSelectedSpeciesTypes] = useState<SpeciesTypeRef[]>([]);

  // Export state
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);

  // Load data
  useEffect(() => {
    loadSurveyors();
    loadSurveyTypes();
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
      const [locations, speciesTypes] = await Promise.all([
        locationsAPI.getAll(),
        surveyTypesAPI.getSpeciesTypes(),
      ]);
      setAllLocations(locations);
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
      let savedId: number | null = null;
      if (surveyorDialogMode === 'add') {
        savedId = (await surveyorsAPI.create(data)).id;
      } else if (editingSurveyor) {
        await surveyorsAPI.update(editingSurveyor.id, data);
        savedId = editingSurveyor.id;
      }
      setSurveyorDialogOpen(false);
      await loadSurveyors();
      if (savedId !== null) {
        toast.success(`Surveyor ${surveyorDialogMode === 'add' ? 'created' : 'updated'} successfully`);
        surveyorHighlight.highlight(savedId);
      }
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
      toast.error('Surveyor deactivated');
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
      toast.success('Surveyor reactivated');
      surveyorHighlight.highlight(surveyor.id);
    } catch (err) {
      setSurveyorsError(err instanceof Error ? err.message : 'Failed to reactivate surveyor');
    }
  };

  // Survey Type handlers
  const handleOpenAddSurveyType = () => {
    // Refresh locations/species so newly added ones (created in other tabs)
    // are immediately selectable without a full-page reload.
    loadReferenceData();
    setSurveyTypeDialogMode('add');
    setEditingSurveyType(null);
    resetSurveyTypeForm();
    setSurveyTypeDialogOpen(true);
  };

  const handleOpenEditSurveyType = async (surveyType: SurveyType) => {
    try {
      // Refresh reference data so the dropdowns reflect items added elsewhere.
      loadReferenceData();
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
      setFormAllowSightingPhotoUpload(details.allow_sighting_photo_upload);
      setFormAllowStartEndTime(details.allow_start_end_time);
      setFormAllowSunPercentage(details.allow_sun_percentage);
      setFormAllowTemperature(details.allow_temperature);
      setFormAllowShowDescription(details.allow_show_description);
      setFormAllowSightingDeviceSelection(details.allow_sighting_device_selection);
      setFormSightingDeviceType(details.sighting_device_type);
      setFormScheduleCadence(details.schedule_cadence);
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
    setFormAllowSightingPhotoUpload(false);
    setFormAllowStartEndTime(false);
    setFormAllowSunPercentage(false);
    setFormAllowTemperature(false);
    setFormAllowShowDescription(false);
    setFormAllowSightingDeviceSelection(false);
    setFormSightingDeviceType(null);
    setFormScheduleCadence('date');
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
    if (formSelectedSpeciesTypes.length === 0) {
      setSurveyTypeFormError('At least one species type must be selected');
      return;
    }

    try {
      setSavingSurveyType(true);
      setSurveyTypeFormError(null);

      if (formAllowSightingDeviceSelection && !formSightingDeviceType) {
        setSurveyTypeFormError('Device type is required when "Attach device to sighting" is enabled');
        setSavingSurveyType(false);
        return;
      }

      const data = {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        location_at_sighting_level: formLocationAtSightingLevel,
        allow_geolocation: formAllowGeolocation,
        allow_sighting_notes: formAllowSightingNotes,
        allow_audio_upload: formAllowAudioUpload,
        allow_image_upload: formAllowImageUpload,
        allow_sighting_photo_upload: formAllowSightingPhotoUpload,
        allow_start_end_time: formAllowStartEndTime,
        allow_sun_percentage: formAllowSunPercentage,
        allow_temperature: formAllowTemperature,
        allow_show_description: formAllowShowDescription,
        allow_sighting_device_selection: formAllowSightingDeviceSelection,
        sighting_device_type: formAllowSightingDeviceSelection ? formSightingDeviceType : null,
        schedule_cadence: formScheduleCadence,
        color: formColor || undefined,
        location_ids: formSelectedLocations.map((l) => l.id),
        species_type_ids: formSelectedSpeciesTypes.map((st) => st.id),
      };

      let savedId: number | null = null;
      if (surveyTypeDialogMode === 'add') {
        savedId = (await surveyTypesAPI.create(data as SurveyTypeCreate)).id;
      } else if (editingSurveyType) {
        await surveyTypesAPI.update(editingSurveyType.id, data as SurveyTypeUpdate);
        savedId = editingSurveyType.id;
      }

      setSurveyTypeDialogOpen(false);
      resetSurveyTypeForm();
      await loadSurveyTypes();
      if (savedId !== null) {
        toast.success(`Survey type ${surveyTypeDialogMode === 'add' ? 'created' : 'updated'} successfully`);
        surveyTypeHighlight.highlight(savedId);
      }
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
      toast.error('Survey type deactivated');
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
      toast.success('Survey type reactivated');
      surveyTypeHighlight.highlight(surveyType.id);
    } catch (err) {
      setSurveyTypesError(err instanceof Error ? err.message : 'Failed to reactivate survey type');
    }
  };

  // Rendering helpers shared between the desktop tables and mobile card lists
  const statusChip = (isActive: boolean) => (
    <Chip
      label={isActive ? 'Active' : 'Inactive'}
      size="small"
      color={isActive ? 'success' : 'default'}
      sx={{ minWidth: 70 }}
    />
  );

  const accountChip = (surveyor: Surveyor) =>
    surveyor.user_id != null ? (
      <Chip label="Account" size="small" variant="outlined" title="Linked to a user account" />
    ) : null;

  const surveyorActions = (surveyor: Surveyor) => (
    <>
      <IconButton
        size="small"
        onClick={() => handleOpenEditSurveyor(surveyor)}
        sx={{ color: 'primary.main' }}
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
    </>
  );

  const surveyTypeActions = (surveyType: SurveyType) => (
    <>
      <IconButton
        size="small"
        onClick={() => handleOpenEditSurveyType(surveyType)}
        sx={{ color: 'primary.main' }}
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
    </>
  );

  /** Chips for the optional features a survey type has enabled (shown instead of six Enabled/Disabled columns). */
  const surveyTypeFeatureChips = (surveyType: SurveyType) => {
    const enabled = [
      surveyType.allow_geolocation && 'GPS',
      surveyType.allow_sighting_notes && 'Notes',
      surveyType.allow_audio_upload && 'Audio',
      surveyType.allow_image_upload && 'Images',
    ].filter((label): label is string => Boolean(label));
    if (enabled.length === 0) {
      return (
        <Typography variant="body2" color="text.secondary">
          —
        </Typography>
      );
    }
    return enabled.map((label) => <Chip key={label} label={label} size="small" variant="outlined" />);
  };

  const listLoading = (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress />
    </Box>
  );

  const listEmpty = (message: string) => (
    <Paper variant="outlined" sx={{ py: 6, px: 2, textAlign: 'center', color: 'text.secondary' }}>
      {message}
    </Paper>
  );

  // Show auth gate if not authenticated
  if (authLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!canAccessAdmin) {
    return <AccessNotice message="The admin page needs admin access." />;
  }

  return (
    <Box sx={{ p: SPACING.PAGE_PADDING }}>
      <PageTitle title="Admin" />
      {/* Tabs — scrollable on mobile so they all fit without clipping */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={tabValue}
          onChange={(_, newValue) => setTabValue(newValue)}
          variant={isMobile ? 'scrollable' : 'standard'}
          allowScrollButtonsMobile
        >
          {adminTabs.map((tab) => (
            <Tab key={tab.key} label={tab.label} />
          ))}
        </Tabs>
      </Box>

      {/* Surveyors Tab */}
      <TabPanel value={tabValue} index={tabIndex('surveyors')}>
        <Box sx={{ mb: { xs: 2, md: 3 }, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            fullWidth={isMobile}
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

        {isMobile ? (
          surveyorsLoading ? (
            listLoading
          ) : surveyors.length === 0 ? (
            listEmpty('No surveyors found')
          ) : (
            <Stack spacing={1.5}>
              {surveyors.map((surveyor) => (
                <EntityCard
                  key={surveyor.id}
                  ref={surveyorHighlight.rowRef(surveyor.id) as Ref<HTMLDivElement>}
                  sx={surveyorHighlight.rowSx(surveyor.id)}
                  title={
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                      {surveyor.first_name}{surveyor.last_name ? ` ${surveyor.last_name}` : ''}
                    </Typography>
                  }
                  chips={<>{statusChip(surveyor.is_active)}{accountChip(surveyor)}</>}
                  actions={surveyorActions(surveyor)}
                />
              ))}
            </Stack>
          )
        ) : (
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
                    <TableRow
                      key={surveyor.id}
                      ref={surveyorHighlight.rowRef(surveyor.id)}
                      sx={[{ '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.02)' } }, surveyorHighlight.rowSx(surveyor.id)]}
                    >
                      <TableCell>
                        <Typography variant="body1">
                          {surveyor.first_name}{surveyor.last_name ? ` ${surveyor.last_name}` : ''}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1}>
                          {statusChip(surveyor.is_active)}
                          {accountChip(surveyor)}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          {surveyorActions(surveyor)}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </TabPanel>

      {/* Survey Types Tab */}
      <TabPanel value={tabValue} index={tabIndex('survey-types')}>
        <Box sx={{ mb: { xs: 2, md: 3 }, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            fullWidth={isMobile}
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

        {isMobile ? (
          surveyTypesLoading ? (
            listLoading
          ) : surveyTypes.length === 0 ? (
            listEmpty('No survey types found')
          ) : (
            <Stack spacing={1.5}>
              {surveyTypes.map((surveyType) => (
                <EntityCard
                  key={surveyType.id}
                  ref={surveyTypeHighlight.rowRef(surveyType.id) as Ref<HTMLDivElement>}
                  sx={surveyTypeHighlight.rowSx(surveyType.id)}
                  title={<SurveyTypeChip name={surveyType.name} color={surveyType.color} />}
                  subtitle={
                    surveyType.description ? (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                        {surveyType.description}
                      </Typography>
                    ) : undefined
                  }
                  chips={
                    <>
                      {statusChip(surveyType.is_active)}
                      <Chip
                        label={surveyType.location_at_sighting_level ? 'Per Sighting' : 'Per Survey'}
                        size="small"
                        variant="outlined"
                      />
                      {surveyTypeFeatureChips(surveyType)}
                    </>
                  }
                  actions={surveyTypeActions(surveyType)}
                />
              ))}
            </Stack>
          )
        ) : (
          <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
            <Table sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Location Level</TableCell>
                  <TableCell>Features</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {surveyTypesLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 8 }}>
                      <CircularProgress />
                    </TableCell>
                  </TableRow>
                ) : surveyTypes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 8, color: 'text.secondary' }}>
                      No survey types found
                    </TableCell>
                  </TableRow>
                ) : (
                  surveyTypes.map((surveyType) => (
                    <TableRow
                      key={surveyType.id}
                      ref={surveyTypeHighlight.rowRef(surveyType.id)}
                      sx={[{ '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.02)' } }, surveyTypeHighlight.rowSx(surveyType.id)]}
                    >
                      <TableCell>
                        <SurveyTypeChip name={surveyType.name} color={surveyType.color} />
                        {surveyType.description && (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {surveyType.description}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={surveyType.location_at_sighting_level ? 'Per Sighting' : 'Per Survey'}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" flexWrap="wrap" gap={0.75}>
                          {surveyTypeFeatureChips(surveyType)}
                        </Stack>
                      </TableCell>
                      <TableCell>{statusChip(surveyType.is_active)}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          {surveyTypeActions(surveyType)}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </TabPanel>

      {/* Locations & Devices Tab */}
      <TabPanel value={tabValue} index={tabIndex('locations')}>
        <LocationsDevicesManager />
      </TabPanel>

      {/* Data Tab — export sections stacked instead of a second row of nested tabs */}
      <TabPanel value={tabValue} index={tabIndex('data')}>
        <Stack spacing={{ xs: 2, md: 3 }} sx={{ maxWidth: 600 }}>
          <RecordsExportPanel />

          <Paper sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="h6" gutterBottom>
              Database snapshot
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
              fullWidth={isMobile}
              startIcon={exporting ? <CircularProgress size={20} color="inherit" /> : <Download />}
              onClick={handleExportSqlite}
              disabled={exporting}
              sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
            >
              {exporting ? 'Exporting...' : 'Download SQLite Database'}
            </Button>
          </Paper>
        </Stack>
      </TabPanel>

      {/* Scheduled Tab (Heal-only) */}
      {showScheduling && (
        <TabPanel value={tabValue} index={tabIndex('scheduled')}>
          <ScheduledSurveysPanel surveyors={surveyors} surveyTypes={surveyTypes} />
        </TabPanel>
      )}

      {/* Users Tab — accounts, roles and invites */}
      <TabPanel value={tabValue} index={tabIndex('users')}>
        <UsersPanel />
      </TabPanel>

      {/* Add/Edit Surveyor Dialog */}
      <Dialog
        open={surveyorDialogOpen}
        onClose={() => !savingSurveyor && setSurveyorDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
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
        fullScreen={isMobile}
      >
        <DialogTitle>{surveyTypeDialogMode === 'add' ? 'Add New Survey Type' : 'Edit Survey Type'}</DialogTitle>
        <DialogContent>
          {surveyTypeFormError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {surveyTypeFormError}
            </Alert>
          )}
          <FormSection title="Basics">
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
            <Box sx={{ mt: 1 }}>
              <SurveyTypeColorSelector value={formColor} onChange={setFormColor} />
            </Box>
          </FormSection>
          <FormSection title="Location & devices">
            <Box sx={{ mt: 1 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formLocationAtSightingLevel}
                    onChange={(e) => setFormLocationAtSightingLevel(e.target.checked)}
                    disabled={savingSurveyType || formAllowSightingDeviceSelection}
                  />
                }
                label="Location at sighting level"
              />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -1 }}>
                {formAllowSightingDeviceSelection
                  ? 'Disabled — the device supplies the location for each sighting'
                  : formLocationAtSightingLevel
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
                    disabled={savingSurveyType || formAllowSightingDeviceSelection}
                  />
                }
                label="Allow geolocation"
              />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -1 }}>
                {formAllowSightingDeviceSelection
                  ? 'Disabled — the device supplies the location for each sighting'
                  : formAllowGeolocation
                  ? 'Users can add GPS coordinates to sightings'
                  : 'GPS coordinates are disabled for this survey type'}
              </Typography>
            </Box>
            <Box sx={{ mt: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formAllowSightingDeviceSelection}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setFormAllowSightingDeviceSelection(enabled);
                      if (enabled) {
                        setFormLocationAtSightingLevel(false);
                        setFormAllowGeolocation(false);
                      } else {
                        setFormSightingDeviceType(null);
                      }
                    }}
                    disabled={savingSurveyType}
                  />
                }
                label="Attach device to sighting"
              />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -1 }}>
                {formAllowSightingDeviceSelection
                  ? 'Each sighting is attached to a device and inherits its location'
                  : 'Sightings are not attached to a specific device'}
              </Typography>
              {formAllowSightingDeviceSelection && (
                <FormControl fullWidth margin="normal" sx={{ ml: 4, width: 'calc(100% - 32px)' }} size="small">
                  <InputLabel>Device Type</InputLabel>
                  <Select
                    value={formSightingDeviceType ?? ''}
                    label="Device Type"
                    onChange={(e) => setFormSightingDeviceType((e.target.value || null) as DeviceType | null)}
                    disabled={savingSurveyType}
                  >
                    <MenuItem value="audio_recorder">Audio Recorder</MenuItem>
                    <MenuItem value="camera_trap">Camera Trap</MenuItem>
                    <MenuItem value="refugia">Refugia</MenuItem>
                    <MenuItem value="moth_light_trap">Moth Light Trap</MenuItem>
                  </Select>
                </FormControl>
              )}
            </Box>
          </FormSection>
          <FormSection title="Sightings">
            <Box sx={{ mt: 1 }}>
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
                    checked={formAllowSightingPhotoUpload}
                    onChange={(e) => setFormAllowSightingPhotoUpload(e.target.checked)}
                    disabled={savingSurveyType || formAllowImageUpload}
                  />
                }
                label="Allow sighting photo upload"
              />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -1 }}>
                {formAllowImageUpload
                  ? 'Not available for camera trap survey types'
                  : formAllowSightingPhotoUpload
                  ? 'Users can attach photos to individual sightings for documentation'
                  : 'Sighting photo upload is disabled for this survey type'}
              </Typography>
            </Box>
          </FormSection>
          <FormSection title="Survey fields">
            <Box sx={{ mt: 1 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formAllowStartEndTime}
                    onChange={(e) => setFormAllowStartEndTime(e.target.checked)}
                    disabled={savingSurveyType}
                  />
                }
                label="Allow start/end time"
              />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -1 }}>
                {formAllowStartEndTime
                  ? 'Surveyors can record start and end times'
                  : 'Start/end time fields are hidden for this survey type'}
              </Typography>
            </Box>
            <Box sx={{ mt: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formAllowSunPercentage}
                    onChange={(e) => setFormAllowSunPercentage(e.target.checked)}
                    disabled={savingSurveyType}
                  />
                }
                label="Allow sun percentage"
              />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -1 }}>
                {formAllowSunPercentage
                  ? 'Surveyors can record sun percentage conditions'
                  : 'Sun percentage field is hidden for this survey type'}
              </Typography>
            </Box>
            <Box sx={{ mt: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formAllowTemperature}
                    onChange={(e) => setFormAllowTemperature(e.target.checked)}
                    disabled={savingSurveyType}
                  />
                }
                label="Allow temperature"
              />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -1 }}>
                {formAllowTemperature
                  ? 'Surveyors can record temperature in Celsius'
                  : 'Temperature field is hidden for this survey type'}
              </Typography>
            </Box>
            <Box sx={{ mt: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formAllowShowDescription}
                    onChange={(e) => setFormAllowShowDescription(e.target.checked)}
                    disabled={savingSurveyType}
                  />
                }
                label="Show description to surveyors"
              />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4, mt: -1 }}>
                {formAllowShowDescription
                  ? 'Survey type description is displayed at the top of the survey form'
                  : 'Description is only visible in admin settings'}
              </Typography>
            </Box>
          </FormSection>
          <FormSection title="Scheduling">
            <Box sx={{ mt: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel id="schedule-cadence-label">Scheduling cadence</InputLabel>
                <Select
                  labelId="schedule-cadence-label"
                  label="Scheduling cadence"
                  value={formScheduleCadence}
                  onChange={(e) => setFormScheduleCadence(e.target.value as ScheduleCadence)}
                  disabled={savingSurveyType}
                >
                  <MenuItem value="date">Specific day</MenuItem>
                  <MenuItem value="weekly">Weekly</MenuItem>
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                {formScheduleCadence === 'weekly'
                  ? 'Surveys are scheduled for a whole week and can be carried out on any day within it'
                  : 'Surveys are scheduled for a specific day'}
              </Typography>
            </Box>
          </FormSection>
          <FormSection title="Availability">
            {!formAllowImageUpload && (
              <Autocomplete
                multiple
                options={allLocations}
                getOptionLabel={locationDisplayName}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                value={formSelectedLocations}
                onChange={(_, newValue) => setFormSelectedLocations(newValue)}
                disabled={savingSurveyType}
                renderInput={(params) => (
                  <TextField {...params} margin="normal" label="Available Locations" placeholder="Select locations (leave empty to omit the location field from surveys)" />
                )}
                sx={{ mt: 1 }}
              />
            )}
            {formAllowImageUpload && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Camera trap survey types use devices instead of locations. Devices can be managed in the Locations &amp; Devices tab.
              </Typography>
            )}
            <Autocomplete
              multiple
              options={allSpeciesTypes}
              getOptionLabel={(option) => option.display_name}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              value={formSelectedSpeciesTypes}
              onChange={(_, newValue) => setFormSelectedSpeciesTypes(newValue)}
              disabled={savingSurveyType}
              renderInput={(params) => (
                <TextField {...params} margin="normal" label="Species Types" placeholder="Select species types" required />
              )}
              sx={{ mt: 2 }}
            />
          </FormSection>
          {surveyTypeDialogMode === 'edit' && editingSurveyType && (
            <SurveyTypeFilesManager surveyTypeId={editingSurveyType.id} />
          )}
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

    </Box>
  );
}
