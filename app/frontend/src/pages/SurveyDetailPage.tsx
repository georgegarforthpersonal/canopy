import { useState, useEffect } from 'react';
import { Box, Typography, Paper, Stack, Button, Divider, CircularProgress, Alert, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Tooltip, ToggleButtonGroup, ToggleButton } from '@mui/material';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Edit, Delete, Save, Cancel, CalendarToday, Person, LocationOn, ViewList, Map as MapIcon, WbSunny } from '@mui/icons-material';
import dayjs, { Dayjs } from 'dayjs';
import { useAuth } from '../context/AuthContext';
import { surveysAPI, surveyorsAPI, locationsAPI, speciesAPI, surveyTypesAPI, imagesAPI } from '../services/api';
import type { SurveyDetail, Sighting, SightingAudioClip, Surveyor, Location, Species, Survey, BreedingStatusCode, LocationWithBoundary, SurveyType } from '../services/api';
import { SurveyFormFields } from '../components/surveys/SurveyFormFields';
import { SightingsEditor } from '../components/surveys/SightingsEditor';
import type { DraftSighting } from '../components/surveys/SightingsEditor';
import { AudioClipPlayer } from '../components/audio/AudioClipPlayer';
import { MapModeSightings } from '../components/surveys/MapModeSightings';
import { getSpeciesIcon } from '../config';
import { PageHeader } from '../components/layout/PageHeader';
import { getSurveyorName, formatDate } from '../utils/formatters';
import { ImageViewerModal, type ImageViewerItem } from '../components/ImageViewerModal';

/**
 * Small thumbnail component that lazily loads a presigned URL for a camera trap image
 */
function SightingImageThumbnail({ imageId }: { imageId: number }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    imagesAPI.getPreviewUrl(imageId).then((res) => {
      if (mounted) setUrl(res.preview_url);
    }).catch(() => { /* ignore */ });
    return () => { mounted = false; };
  }, [imageId]);

  if (!url) return <Box sx={{ width: 60, height: 45, bgcolor: 'grey.200', borderRadius: 0.5, flexShrink: 0 }} />;

  return (
    <Box
      component="img"
      src={url}
      alt=""
      sx={{ width: 60, height: 45, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }}
    />
  );
}

/**
 * SurveyDetailPage displays detailed information about a single survey
 * - Survey metadata (date, surveyors, location, notes)
 * - Sightings with card-based editing interface
 * - View/Edit mode toggle with action buttons
 *
 * Following DEVELOPMENT.md conventions:
 * - Built inline first (no premature component extraction)
 * - Uses MUI components with theme integration
 * - Connected to real API
 */
export function SurveyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { requireAuth } = useAuth();

  // Check if we should start in edit mode (from URL param)
  const startInEditMode = searchParams.get('edit') === 'true';
  const [isEditMode, setIsEditMode] = useState(startInEditMode);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');

  // ============================================================================
  // State Management
  // ============================================================================

  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [surveyType, setSurveyType] = useState<SurveyType | null>(null);
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [surveyors, setSurveyors] = useState<Surveyor[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [species, setSpecies] = useState<Species[]>([]);
  const [breedingCodes, setBreedingCodes] = useState<BreedingStatusCode[]>([]);
  const [locationsWithBoundaries, setLocationsWithBoundaries] = useState<LocationWithBoundary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Sighting image viewer state
  const [sightingViewerImages, setSightingViewerImages] = useState<ImageViewerItem[]>([]);
  const [sightingViewerOpen, setSightingViewerOpen] = useState(false);
  const [sightingViewerInitialIdx, setSightingViewerInitialIdx] = useState(0);

  const openSightingImageViewer = async (imageIds: number[], clickedIndex: number) => {
    // Fetch preview URLs for all images in parallel
    const urls = await Promise.all(
      imageIds.map(async (imgId) => {
        try {
          const res = await imagesAPI.getPreviewUrl(imgId);
          return { src: res.preview_url, alt: `Image ${imgId}` };
        } catch {
          return { src: '', alt: `Image ${imgId}` };
        }
      })
    );
    setSightingViewerImages(urls.filter((u) => u.src));
    setSightingViewerInitialIdx(clickedIndex);
    setSightingViewerOpen(true);
  };



  // ============================================================================
  // Edit Mode State
  // ============================================================================

  const [editDate, setEditDate] = useState<Dayjs | null>(null);
  const [editLocationId, setEditLocationId] = useState<number | null>(null);
  const [editSelectedSurveyors, setEditSelectedSurveyors] = useState<Surveyor[]>([]);
  const [editNotes, setEditNotes] = useState<string>('');
  const [editDraftSightings, setEditDraftSightings] = useState<DraftSighting[]>([]);

  const [validationErrors, setValidationErrors] = useState<{
    date?: string;
    location?: string;
    surveyors?: string;
    sightings?: string;
  }>({});

  // ============================================================================
  // Data Fetching
  // ============================================================================

  useEffect(() => {
    const fetchData = async () => {
      if (!id) {
        setError('No survey ID provided');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // First fetch survey to get its survey_type_id
        const surveyData = await surveysAPI.getById(Number(id));

        // Fetch remaining data in parallel, using survey_type_id for species filtering
        const [sightingsData, surveyorsData, locationsData, speciesData, breedingCodesData, boundariesData, surveyTypeData] = await Promise.all([
          surveysAPI.getSightings(Number(id)),
          surveyorsAPI.getAll(),
          // Filter locations by survey type if available, otherwise get all
          surveyData.survey_type_id
            ? locationsAPI.getBySurveyType(surveyData.survey_type_id)
            : locationsAPI.getAll(),
          // Filter species by survey type if available, otherwise get all
          surveyData.survey_type_id
            ? speciesAPI.getBySurveyType(surveyData.survey_type_id)
            : speciesAPI.getAll(),
          surveysAPI.getBreedingCodes(),
          locationsAPI.getAllWithBoundaries(),
          // Fetch survey type configuration
          surveyData.survey_type_id
            ? surveyTypesAPI.getById(surveyData.survey_type_id)
            : Promise.resolve(null),
        ]);

        setSurvey(surveyData);
        setSurveyType(surveyTypeData);
        setSightings(sightingsData);
        setSurveyors(surveyorsData);
        setLocations(locationsData);
        setSpecies(speciesData);
        setBreedingCodes(breedingCodesData);
        setLocationsWithBoundaries(boundariesData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load survey details');
        console.error('Error fetching survey:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Get location name from ID
   */
  const getLocationName = (id: number | null): string => {
    if (id === null) return 'Unknown';
    const location = locations.find(l => l.id === id);
    return location?.name || 'Unknown';
  };

  /**
   * Get species display name from ID
   */
  const getSpeciesName = (id: number): string => {
    const speciesItem = species.find(s => s.id === id);
    if (!speciesItem) return 'Unknown';
    if (speciesItem.name) {
      return `${speciesItem.name}${speciesItem.scientific_name ? ' ' + speciesItem.scientific_name : ''}`;
    }
    return speciesItem.scientific_name || 'Unknown';
  };

  // ============================================================================
  // Loading and Error States
  // ============================================================================

  // Show loading state
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  // Show error state or survey not found
  if (error || !survey) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || 'Survey not found'}
        </Alert>
        <Button variant="contained" onClick={() => navigate('/surveys')}>
          Back to Surveys
        </Button>
      </Box>
    );
  }

  // ============================================================================
  // Computed Values - Survey Type Configuration
  // ============================================================================

  const locationAtSightingLevel = surveyType?.location_at_sighting_level ?? false;
  const allowGeolocation = surveyType?.allow_geolocation ?? true;
  const allowSightingNotes = surveyType?.allow_sighting_notes ?? true;


  // ============================================================================
  // Validation
  // ============================================================================

  const validate = (): boolean => {
    const errors: typeof validationErrors = {};

    if (!editDate) {
      errors.date = 'Date is required';
    }

    if (editSelectedSurveyors.length === 0) {
      errors.surveyors = 'At least one surveyor is required';
    }

    // If location at sighting level, check that each sighting has a location
    const validSightings = editDraftSightings.filter(
      (s) => s.species_id !== null && s.count > 0
    );
    if (locationAtSightingLevel) {
      const sightingsWithoutLocation = validSightings.filter((s) => !s.location_id);
      if (sightingsWithoutLocation.length > 0) {
        errors.sightings = 'Each sighting must have a location selected';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleEditClick = () => {
    if (!survey) return;

    // Populate edit state with current survey data
    setEditDate(dayjs(survey.date));
    setEditLocationId(survey.location_id);
    setEditSelectedSurveyors(
      surveyors.filter((s) => survey.surveyor_ids.includes(s.id))
    );
    setEditNotes(survey.notes || '');

    // Convert existing sightings to DraftSighting format
    // Note: sightings may include individuals array from API (SightingWithIndividuals)
    const draftSightings: DraftSighting[] = sightings.map((sighting: any) => ({
      tempId: `existing-${sighting.id}`,
      species_id: sighting.species_id,
      count: sighting.count,
      id: sighting.id, // Keep the real ID for updates/deletes
      // Include location_id for sighting-level location
      location_id: sighting.location_id,
      // Include notes for this sighting
      notes: sighting.notes,
      // Include individuals if present (from SightingWithIndividuals)
      individuals: sighting.individuals?.map((ind: any) => ({
        ...ind,
        tempId: `existing-ind-${ind.id}`,
      })),
    }));

    // Add one empty row at the end
    draftSightings.push({
      tempId: `temp-${Date.now()}`,
      species_id: null,
      count: 1,
    });

    setEditDraftSightings(draftSightings);
    setValidationErrors({});
    setIsEditMode(true);
  };

  const handleSave = async () => {
    // Validate survey fields
    if (!validate()) {
      setError('Please fill in all required fields');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Step 1: Update survey
      const surveyData: Partial<Survey> = {
        date: editDate!.format('YYYY-MM-DD'),
        surveyor_ids: editSelectedSurveyors.map((s) => s.id),
        notes: editNotes.trim() || null,
      };

      // Only include location_id if NOT at sighting level
      if (!locationAtSightingLevel) {
        surveyData.location_id = editLocationId ?? undefined;
      }

      await surveysAPI.update(Number(id), surveyData);

      // Step 2: Handle sightings changes
      // Get valid sightings (non-empty rows)
      const validSightings = editDraftSightings.filter(
        (s) => s.species_id !== null && s.count > 0
      );

      // Identify which sightings to delete (existing sightings not in the new list)
      const existingSightingIds = sightings.map((s) => s.id);
      const keptSightingIds = validSightings
        .filter((s) => s.id)
        .map((s) => s.id!);
      const sightingsToDelete = existingSightingIds.filter(
        (id) => !keptSightingIds.includes(id)
      );

      // Delete removed sightings
      await Promise.all(
        sightingsToDelete.map((sightingId) =>
          surveysAPI.deleteSighting(Number(id), sightingId)
        )
      );

      // Update existing sightings and add new ones
      for (const sighting of validSightings) {
        if (sighting.id) {
          // Update existing sighting
          await surveysAPI.updateSighting(Number(id), sighting.id, {
            species_id: sighting.species_id!,
            count: sighting.count,
            location_id: locationAtSightingLevel ? sighting.location_id : undefined,
            notes: sighting.notes,
          });

          // Sync individual locations for this existing sighting
          // Find the original sighting to compare individuals
          const originalSighting = sightings.find((s: any) => s.id === sighting.id);
          const originalIndividuals = originalSighting?.individuals || [];
          const currentIndividuals = sighting.individuals || [];

          // Find individuals to delete (in original but not in current)
          const currentIndividualIds = currentIndividuals
            .filter((ind) => ind.id)
            .map((ind) => ind.id);
          const individualsToDelete = originalIndividuals.filter(
            (ind: any) => ind.id && !currentIndividualIds.includes(ind.id)
          );

          // Delete removed individuals
          await Promise.all(
            individualsToDelete.map((ind: any) =>
              surveysAPI.deleteIndividualLocation(Number(id), sighting.id!, ind.id)
            )
          );

          // Update existing individuals (those with id that are still in the list)
          const existingIndividuals = currentIndividuals.filter((ind) => ind.id);
          await Promise.all(
            existingIndividuals.map((ind) =>
              surveysAPI.updateIndividualLocation(Number(id), sighting.id!, ind.id!, {
                latitude: ind.latitude,
                longitude: ind.longitude,
                count: ind.count,
                breeding_status_code: ind.breeding_status_code,
                notes: ind.notes,
              })
            )
          );

          // Add new individuals (those without id)
          const newIndividuals = currentIndividuals.filter((ind) => !ind.id);
          await Promise.all(
            newIndividuals.map((ind) =>
              surveysAPI.addIndividualLocation(Number(id), sighting.id!, {
                latitude: ind.latitude,
                longitude: ind.longitude,
                count: ind.count,
                breeding_status_code: ind.breeding_status_code,
                notes: ind.notes,
              })
            )
          );
        } else {
          // Add new sighting with individual locations
          await surveysAPI.addSighting(Number(id), {
            species_id: sighting.species_id!,
            count: sighting.count,
            location_id: locationAtSightingLevel ? sighting.location_id : undefined,
            notes: sighting.notes,
            individuals: sighting.individuals?.map((ind) => ({
              latitude: ind.latitude,
              longitude: ind.longitude,
              count: ind.count,
              breeding_status_code: ind.breeding_status_code,
              notes: ind.notes,
            })),
          });
        }
      }

      // Success - navigate back to surveys list with edited parameter
      navigate(`/surveys?edited=${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update survey');
      console.error('Error updating survey:', err);
      setSaving(false);
    }
  };

  const handleCancel = () => {
    // Clear edit state and validation errors
    setEditDate(null);
    setEditLocationId(null);
    setEditSelectedSurveyors([]);
    setEditNotes('');
    setEditDraftSightings([]);
    setValidationErrors({});
    setError(null);
    setIsEditMode(false);
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  const handleDeleteConfirm = async () => {
    if (!id) return;

    setDeleting(true);
    setError(null);

    try {
      await surveysAPI.delete(Number(id));

      // Success - navigate back to surveys list with deleted parameter
      navigate(`/surveys?deleted=${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete survey');
      console.error('Error deleting survey:', err);
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleSightingsChange = (newSightings: DraftSighting[]) => {
    setEditDraftSightings(newSightings);

    // Clear sightings validation error when user changes sightings
    if (validationErrors.sightings) {
      setValidationErrors({ ...validationErrors, sightings: undefined });
    }
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <Box sx={{ p: { xs: 2, sm: 3, md: 4 } }}>
      {/* Page Header */}
      <PageHeader
        backButton={{ href: '/surveys' }}
        actions={
          <>
            {isEditMode ? (
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  startIcon={<Cancel />}
                  onClick={handleCancel}
                  disabled={saving}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 600,
                    boxShadow: 'none',
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  startIcon={saving ? undefined : <Save />}
                  onClick={handleSave}
                  disabled={
                    saving ||
                    !editDate ||
                    editSelectedSurveyors.length === 0
                  }
                  sx={{
                    textTransform: 'none',
                    fontWeight: 600,
                    boxShadow: 'none',
                    '&:hover': { boxShadow: 'none' },
                    minWidth: 140,
                  }}
                >
                  {saving ? (
                    <>
                      <CircularProgress size={20} sx={{ mr: 1 }} />
                      Saving...
                    </>
                  ) : (
                    'Save Survey'
                  )}
                </Button>
              </Stack>
            ) : (
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  startIcon={<Edit />}
                  onClick={() => requireAuth(handleEditClick)}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 600,
                    boxShadow: 'none',
                    '&:hover': { boxShadow: 'none' },
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<Delete />}
                  onClick={() => requireAuth(handleDeleteClick)}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 600,
                    boxShadow: 'none',
                  }}
                >
                  Delete
                </Button>
              </Stack>
            )}
          </>
        }
      />

      {/* Error Alert */}
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

        {/* Survey Metadata Card */}
        <Paper
          sx={{
            p: { xs: 2, sm: 2.5, md: 3 },
            mb: { xs: 2, md: 3 },
            boxShadow: 'none',
            border: '1px solid',
            borderColor: 'divider'
          }}
        >
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            {isEditMode ? 'Survey Details' : 'Survey Information'}
          </Typography>

          {isEditMode ? (
            <SurveyFormFields
              date={editDate}
              locationId={editLocationId}
              selectedSurveyors={editSelectedSurveyors}
              notes={editNotes}
              locations={locations}
              surveyors={surveyors}
              onDateChange={setEditDate}
              onLocationChange={setEditLocationId}
              onSurveyorsChange={setEditSelectedSurveyors}
              onNotesChange={setEditNotes}
              validationErrors={validationErrors}
              hideLocation={locationAtSightingLevel}
            />
          ) : (
            <Stack spacing={2}>
              {/* Date */}
              <Box>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <CalendarToday sx={{ fontSize: 18, color: 'text.secondary' }} />
                  <Typography variant="body2" color="text.secondary" fontWeight={500}>
                    Date
                  </Typography>
                </Stack>
                <Typography variant="body1">{formatDate(survey.date)}</Typography>
              </Box>

              <Divider />

              {/* Surveyors */}
              <Box>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <Person sx={{ fontSize: 18, color: 'text.secondary' }} />
                  <Typography variant="body2" color="text.secondary" fontWeight={500}>
                    Surveyors
                  </Typography>
                </Stack>
                <Typography variant="body1">{survey.surveyor_ids.map(id => getSurveyorName(id, surveyors)).join(', ')}</Typography>
              </Box>

              {/* Location - only show if NOT at sighting level */}
              {!locationAtSightingLevel && (
                <>
                  <Divider />

                  <Box>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                      <LocationOn sx={{ fontSize: 18, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary" fontWeight={500}>
                        Location
                      </Typography>
                    </Stack>
                    <Typography variant="body1">{getLocationName(survey.location_id)}</Typography>
                  </Box>
                </>
              )}

              {/* Notes */}
              {survey.notes && (
                <>
                  <Divider />
                  <Box>
                    <Typography variant="body2" color="text.secondary" fontWeight={500} sx={{ mb: 0.5 }}>
                      Notes
                    </Typography>
                    <Typography variant="body1">{survey.notes}</Typography>
                  </Box>
                </>
              )}
            </Stack>
          )}
        </Paper>

        {/* Weather Snapshot Card */}
        {!isEditMode && survey.weather_snapshot && (
          <Paper
            sx={{
              p: { xs: 2, sm: 2.5, md: 3 },
              mb: { xs: 2, md: 3 },
              boxShadow: 'none',
              border: '1px solid',
              borderColor: 'divider'
            }}
          >
            <Typography variant="overline" sx={{ mb: 1.5, display: 'block', fontWeight: 600 }}>
              Weather at Survey Time
            </Typography>

            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
              <WbSunny sx={{ fontSize: 20, color: 'text.secondary' }} />
              <Typography variant="body1" fontWeight={500}>
                {survey.weather_snapshot.weather_description}
              </Typography>
            </Stack>

            <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
              <Box sx={{ flex: 1, p: 1.5, bgcolor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary" display="block">Temp</Typography>
                <Typography variant="body1" fontWeight={600}>
                  {survey.weather_snapshot.temperature_c}<Typography component="span" variant="body2" color="text.secondary">&deg;C</Typography>
                </Typography>
              </Box>
              <Box sx={{ flex: 1, p: 1.5, bgcolor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary" display="block">Precip</Typography>
                <Typography variant="body1" fontWeight={600}>
                  {survey.weather_snapshot.precipitation_mm}<Typography component="span" variant="body2" color="text.secondary">mm</Typography>
                </Typography>
              </Box>
              <Box sx={{ flex: 1, p: 1.5, bgcolor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary" display="block">Wind</Typography>
                <Typography variant="body1" fontWeight={600}>
                  {survey.weather_snapshot.wind_speed_kmh}<Typography component="span" variant="body2" color="text.secondary">km/h</Typography>
                </Typography>
              </Box>
              <Box sx={{ flex: 1, p: 1.5, bgcolor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary" display="block">Cloud</Typography>
                <Typography variant="body1" fontWeight={600}>
                  {survey.weather_snapshot.cloud_cover_percent}<Typography component="span" variant="body2" color="text.secondary">%</Typography>
                </Typography>
              </Box>
            </Stack>

            <Typography variant="caption" color="text.secondary">
              Fetched from Open-Meteo at survey start &middot; {Math.abs(survey.weather_snapshot.latitude).toFixed(3)}&deg;{survey.weather_snapshot.latitude >= 0 ? 'N' : 'S'}, {Math.abs(survey.weather_snapshot.longitude).toFixed(3)}&deg;{survey.weather_snapshot.longitude >= 0 ? 'E' : 'W'}
            </Typography>
          </Paper>
        )}

        {/* Sightings Section */}
        <Paper
          sx={{
            p: { xs: 2, sm: 2.5, md: 3 },
            boxShadow: 'none',
            border: '1px solid',
            borderColor: 'divider'
          }}
        >
          {isEditMode ? (
            <SightingsEditor
              sightings={editDraftSightings}
              species={species}
              breedingCodes={breedingCodes}
              onSightingsChange={handleSightingsChange}
              validationError={validationErrors.sightings}
              locationsWithBoundaries={locationsWithBoundaries}
              locationAtSightingLevel={locationAtSightingLevel}
              locations={locations}
              allowGeolocation={allowGeolocation}
              allowSightingNotes={allowSightingNotes}
              surveyLocationId={editLocationId}
            />
          ) : (
            <>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Sightings ({sightings.length})
                </Typography>
                {allowGeolocation && (
                  <ToggleButtonGroup
                    value={viewMode}
                    exclusive
                    onChange={(_, newValue) => newValue && setViewMode(newValue)}
                    size="small"
                    sx={{ height: 32 }}
                  >
                    <ToggleButton value="list" aria-label="list mode">
                      <Tooltip title="List Mode">
                        <ViewList fontSize="small" />
                      </Tooltip>
                    </ToggleButton>
                    <ToggleButton value="map" aria-label="map mode">
                      <Tooltip title="Map Mode">
                        <MapIcon fontSize="small" />
                      </Tooltip>
                    </ToggleButton>
                  </ToggleButtonGroup>
                )}
              </Stack>

              {/* Map Mode View */}
              {viewMode === 'map' && allowGeolocation ? (
                <MapModeSightings
                  sightings={sightings.map((s: any) => ({
                    tempId: `view-${s.id}`,
                    species_id: s.species_id,
                    count: s.count,
                    id: s.id,
                    individuals: s.individuals?.map((ind: any) => ({
                      ...ind,
                      tempId: `view-ind-${ind.id}`,
                    })),
                  }))}
                  species={species}
                  breedingCodes={breedingCodes}
                  locationsWithBoundaries={locationsWithBoundaries}
                  readOnly
                  surveyLocationId={survey.location_id}
                />
              ) : (
              /* Sightings Table */
              (() => {
                // Build grid columns dynamically to match edit mode
                const getGridColumns = () => {
                  const cols: string[] = [];
                  // Species column - flexible
                  cols.push(locationAtSightingLevel ? '2fr' : '2.5fr');
                  // Location column (if at sighting level)
                  if (locationAtSightingLevel) {
                    cols.push('1.2fr');
                  }
                  // GPS column (if allowed) or spacer (if no location and no GPS)
                  if (allowGeolocation) {
                    cols.push('70px');
                  } else if (!locationAtSightingLevel) {
                    cols.push('70px'); // spacer
                  }
                  // Count column - fixed small width
                  cols.push('60px');
                  // Notes column (if allowed) - flexible
                  if (allowSightingNotes) {
                    cols.push('2fr');
                  }
                  return cols.join(' ');
                };
                const gridColumns = getGridColumns();

                return sightings.length > 0 ? (
                <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                  {/* Table Header */}
                  <Box
                    sx={{
                      display: { xs: 'none', sm: 'grid' },
                      gridTemplateColumns: gridColumns,
                      gap: 2,
                      p: 1.5,
                      bgcolor: 'grey.50',
                      borderBottom: '1px solid',
                      borderColor: 'divider'
                    }}
                  >
                    <Typography variant="body2" fontWeight={600} color="text.secondary">
                      SPECIES
                    </Typography>
                    {locationAtSightingLevel && (
                      <Typography variant="body2" fontWeight={600} color="text.secondary">
                        LOCATION
                      </Typography>
                    )}
                    {allowGeolocation && (
                      <Typography variant="body2" fontWeight={600} color="text.secondary" textAlign="center">
                        GPS
                      </Typography>
                    )}
                    {!allowGeolocation && !locationAtSightingLevel && (
                      <Box /> // Empty spacer
                    )}
                    <Typography variant="body2" fontWeight={600} color="text.secondary">
                      COUNT
                    </Typography>
                    {allowSightingNotes && (
                      <Typography variant="body2" fontWeight={600} color="text.secondary">
                        NOTES
                      </Typography>
                    )}
                  </Box>

                  {/* Table Rows - Grouped by Species Type */}
                  {(() => {
                    // Group sightings by species type
                    const grouped = sightings.reduce((acc, sighting) => {
                      const speciesItem = species.find(s => s.id === sighting.species_id);
                      const type = speciesItem?.type || 'unknown';
                      if (!acc[type]) acc[type] = [];
                      acc[type].push(sighting);
                      return acc;
                    }, {} as Record<string, typeof sightings>);

                    // Sort groups alphabetically by type name
                    const sortedGroups = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

                    // Format type name for display
                    const formatTypeName = (type: string) =>
                      type.charAt(0).toUpperCase() + type.slice(1);

                    return sortedGroups.map(([type, groupSightings], groupIndex) => {
                      const SpeciesIcon = getSpeciesIcon(type);

                      return (
                        <Box key={type}>
                          {/* Group Divider and Label */}
                          <Box
                            sx={{
                              borderTop: groupIndex > 0 ? '1px solid' : 'none',
                              borderColor: 'divider',
                              bgcolor: 'grey.50',
                              px: 1.5,
                              py: 1,
                              mt: groupIndex > 0 ? 2 : 0
                            }}
                          >
                            <Stack direction="row" alignItems="center" spacing={0.75}>
                              <SpeciesIcon sx={{ fontSize: '16px', color: 'text.secondary' }} />
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                fontWeight={600}
                                sx={{ fontSize: '0.75rem', letterSpacing: '0.05em' }}
                              >
                                {formatTypeName(type)} · {groupSightings.length}
                              </Typography>
                            </Stack>
                          </Box>

                        {/* Group Rows */}
                        {groupSightings.map((sighting: any) => {
                          // Check for individual locations (GPS points)
                          const individualsWithLocation = sighting.individuals?.filter(
                            (ind: any) => ind.latitude !== null && ind.latitude !== undefined &&
                                          ind.longitude !== null && ind.longitude !== undefined
                          ) || [];
                          const hasIndividualLocations = individualsWithLocation.length > 0;
                          const individualCount = individualsWithLocation.reduce((sum: number, ind: any) => sum + (ind.count || 1), 0);
                          const locationCount = individualsWithLocation.length;

                          const locationTooltip = hasIndividualLocations
                            ? `${individualCount} of ${sighting.count} individual${sighting.count > 1 ? 's' : ''} across ${locationCount} location${locationCount > 1 ? 's' : ''}`
                            : 'No location recorded';

                          // Collect camera trap image IDs (prefer junction table, fall back to individuals)
                          const imageIds: number[] = sighting.image_ids?.length
                            ? sighting.image_ids
                            : (sighting.individuals || [])
                                .map((ind: { camera_trap_image_id?: number | null }) => ind.camera_trap_image_id)
                                .filter((id: number | null | undefined): id is number => id != null);

                          return (
                            <Box key={sighting.id} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                            <Box
                              sx={{
                                display: 'grid',
                                gridTemplateColumns: gridColumns,
                                gap: 2,
                                p: 1.5,
                                alignItems: 'center',
                                '&:hover': { bgcolor: 'grey.50' }
                              }}
                            >
                              {/* Species Column */}
                              <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                                {sighting.species_name ? (
                                  <>
                                    {sighting.species_name}
                                    {sighting.species_scientific_name && (
                                      <i style={{ color: '#666', marginLeft: '0.25rem' }}> {sighting.species_scientific_name}</i>
                                    )}
                                  </>
                                ) : (
                                  <i style={{ color: '#666' }}>{sighting.species_scientific_name || getSpeciesName(sighting.species_id)}</i>
                                )}
                              </Typography>

                              {/* Location Column - when location is at sighting level */}
                              {locationAtSightingLevel && (
                                <Typography variant="body2" sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
                                  {sighting.location_name || '-'}
                                </Typography>
                              )}

                              {/* GPS Column - for individual geolocation */}
                              {allowGeolocation && (
                                <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                                  {hasIndividualLocations ? (
                                    <Tooltip title={locationTooltip} arrow>
                                      <LocationOn sx={{ fontSize: 24, color: 'primary.main' }} />
                                    </Tooltip>
                                  ) : (
                                    <Typography variant="body2" color="text.disabled">-</Typography>
                                  )}
                                </Box>
                              )}
                              {!allowGeolocation && !locationAtSightingLevel && (
                                <Box /> // Empty spacer
                              )}

                              {/* Count Column */}
                              <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.875rem' }}>
                                {sighting.count}
                              </Typography>

                              {/* Notes Column */}
                              {allowSightingNotes && (
                                <Typography
                                  variant="body2"
                                  sx={{
                                    fontSize: '0.875rem',
                                    color: sighting.notes ? 'text.secondary' : 'text.disabled',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {sighting.notes || '-'}
                                </Typography>
                              )}
                            </Box>

                            {/* Camera Trap Image Thumbnails — click to view */}
                            {imageIds.length > 0 && (
                              <Box sx={{ display: 'flex', gap: 0.5, px: 1.5, pb: 1.5, flexWrap: 'wrap' }}>
                                {imageIds.map((imgId: number, imgIdx: number) => (
                                  <Box
                                    key={imgId}
                                    onClick={() => openSightingImageViewer(imageIds, imgIdx)}
                                    sx={{ cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
                                  >
                                    <SightingImageThumbnail imageId={imgId} />
                                  </Box>
                                ))}
                              </Box>
                            )}

                            {/* Audio Detection Clips */}
                            {sighting.audio_clips && sighting.audio_clips.length > 0 && (
                              <Stack direction="row" spacing={1} sx={{ px: 1.5, pb: 1.5 }}>
                                {sighting.audio_clips.map((clip: SightingAudioClip, clipIdx: number) => (
                                  <AudioClipPlayer
                                    key={clipIdx}
                                    audioRecordingId={clip.audio_recording_id}
                                    startTime={clip.start_time}
                                    endTime={clip.end_time}
                                    confidence={clip.confidence}
                                  />
                                ))}
                              </Stack>
                            )}
                            </Box>
                          );
                        })}
                        </Box>
                      );
                    })
                  })()}
                </Box>
              ) : (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                  No sightings recorded yet.
                </Typography>
              );
              })())}
            </>
          )}
        </Paper>



        {/* Delete Confirmation Dialog */}
        <Dialog
          open={showDeleteConfirm}
          onClose={handleDeleteCancel}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Delete Survey?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              Are you sure you want to delete this survey from {formatDate(survey.date)} at {getLocationName(survey.location_id)}?
              <br /><br />
              This action cannot be undone. All sightings associated with this survey will also be deleted.
            </DialogContentText>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button
              onClick={handleDeleteCancel}
              disabled={deleting}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteConfirm}
              color="error"
              variant="contained"
              disabled={deleting}
              sx={{ textTransform: 'none', fontWeight: 600, boxShadow: 'none' }}
            >
              {deleting ? (
                <>
                  <CircularProgress size={20} sx={{ mr: 1 }} />
                  Deleting...
                </>
              ) : (
                'Delete Survey'
              )}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Sighting image viewer modal */}
        <ImageViewerModal
          open={sightingViewerOpen}
          onClose={() => setSightingViewerOpen(false)}
          images={sightingViewerImages}
          initialIndex={sightingViewerInitialIdx}
        />
    </Box>
  );
}
