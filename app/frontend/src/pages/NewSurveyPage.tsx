import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Stack,
  Button,
  Alert,
  CircularProgress,
  Autocomplete,
  TextField,
} from '@mui/material';
import { Save, Cancel, CloudUpload, Delete, PhotoCamera } from '@mui/icons-material';
import dayjs, { Dayjs } from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, usePermissions } from '../context/AuthContext';
import { AccessNotice } from '../components/auth/AccessNotice';
import {
  surveysAPI,
  scheduledSurveysAPI,
  surveyorsAPI,
  locationsAPI,
  speciesAPI,
  surveyTypesAPI,
  imagesAPI,
  devicesAPI,
} from '../services/api';
import type {
  Survey,
  ScheduledSurvey,
  Location,
  Surveyor,
  Species,
  BreedingStatusCode,
  LocationWithBoundary,
  SurveyType,
  Device,
} from '../services/api';
import { formatSurveyDate } from './groups/surveyState';
import { SurveyFormFields, hasTimeValidationError } from '../components/surveys/SurveyFormFields';
import { SightingsEditor } from '../components/surveys/SightingsEditor';
import type { DraftSighting } from '../components/surveys/SightingsEditor';
import { PageHeader } from '../components/layout/PageHeader';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { scopeBoundariesToLocations } from '../utils/scopeBoundaries';
import { SPACING } from '../config/responsive';

/**
 * Progress from a failed save attempt. Lets a retry resume where it left off
 * instead of creating a duplicate survey and re-uploading photos.
 */
interface SaveResumeState {
  /** Serialised save inputs; a mismatch means inputs changed, so start fresh */
  fingerprint: string;
  surveyId: number | null;
  /** sighting tempId -> uploaded photo image ids */
  sightingPhotoIds: Map<string, number[]>;
  /** tempIds of sightings already created */
  createdSightingTempIds: Set<string>;
  surveyImagesUploaded: boolean;
}

function emptySaveResumeState(): SaveResumeState {
  return {
    fingerprint: '',
    surveyId: null,
    sightingPhotoIds: new Map(),
    createdSightingTempIds: new Set(),
    surveyImagesUploaded: false,
  };
}

/** Stable identity for a File across renders (Files aren't JSON-serialisable) */
const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

/**
 * NewSurveyPage - Full-page form for creating surveys with inline sightings
 *
 * Features:
 * - Survey type selection filters available locations and species
 * - Complete survey creation in one place
 * - Inline sightings editor (add multiple sightings before saving)
 * - Single transaction saves survey + all sightings
 * - Supports location at sighting level when configured
 */
export function NewSurveyPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isLoading: authLoading } = useAuth();
  const { canEditSurveys } = usePermissions();

  // Record flow: ?scheduled_survey_id=N prefills the form from the slot (type
  // locked, location and sign-ups carried over, date clamped into the window)
  // and links the created survey to it.
  const scheduledSurveyIdParam = searchParams.get('scheduled_survey_id');
  const [recordingSlot, setRecordingSlot] = useState<ScheduledSurvey | null>(null);

  // Group record flow: ?survey_type_id=N preselects the type (still
  // changeable, unlike a slot's locked type). Media types never link here —
  // their record CTAs go straight to the wizards — so they're ignored rather
  // than re-dispatched.
  const presetTypeIdParam = searchParams.get('survey_type_id');

  // ============================================================================
  // Form State - Survey Type
  // ============================================================================

  const [surveyTypes, setSurveyTypes] = useState<SurveyType[]>([]);
  const [selectedSurveyType, setSelectedSurveyType] = useState<SurveyType | null>(null);
  const [surveyTypesLoading, setSurveyTypesLoading] = useState(true);

  // ============================================================================
  // Form State - Survey Fields
  // ============================================================================

  const [date, setDate] = useState<Dayjs | null>(dayjs());
  const [locationId, setLocationId] = useState<number | null>(null);
  const [selectedSurveyors, setSelectedSurveyors] = useState<Surveyor[]>([]);
  const [notes, setNotes] = useState<string>('');
  const [startTime, setStartTime] = useState<Dayjs | null>(null);
  const [endTime, setEndTime] = useState<Dayjs | null>(null);
  const [sunPercentage, setSunPercentage] = useState<string>('');
  const [temperatureCelsius, setTemperatureCelsius] = useState<string>('');

  // ============================================================================
  // Form State - Sightings
  // ============================================================================

  // Start with one empty row for desktop inline editing
  const [draftSightings, setDraftSightings] = useState<DraftSighting[]>([
    {
      tempId: `temp-${Date.now()}`,
      species_id: null,
      count: 1,
    },
  ]);

  // ============================================================================
  // Form State - Image Files (for camera trap survey type)
  // ============================================================================

  const [pendingImageFiles, setPendingImageFiles] = useState<File[]>([]);

  // ============================================================================
  // Data State
  // ============================================================================

  const [locations, setLocations] = useState<Location[]>([]);
  const [surveyors, setSurveyors] = useState<Surveyor[]>([]);
  const [species, setSpecies] = useState<Species[]>([]);
  const [breedingCodes, setBreedingCodes] = useState<BreedingStatusCode[]>([]);
  const [locationsWithBoundaries, setLocationsWithBoundaries] = useState<LocationWithBoundary[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Survives across save attempts so retrying resumes instead of restarting
  const saveResumeRef = useRef<SaveResumeState>(emptySaveResumeState());

  // ============================================================================
  // Validation State
  // ============================================================================

  const [validationErrors, setValidationErrors] = useState<{
    surveyType?: string;
    date?: string;
    location?: string;
    surveyors?: string;
    sightings?: string;
    endTime?: string;
  }>({});

  // ============================================================================
  // Unsaved Changes Guard
  // ============================================================================

  // Flipped synchronously just before the post-save navigation so the
  // unsaved-changes guard does not block it (state would be one render stale).
  const saveCompleteRef = useRef(false);

  // Location preselected because the survey type has exactly one — not a user
  // edit, so it alone must not make the unsaved-changes guard fire.
  const autoLocationIdRef = useRef<number | null>(null);

  // Surveyors prefilled from a slot's sign-ups (record flow) — also not a
  // user edit, so the baseline for the dirty check, not part of it.
  const prefilledSurveyorIdsRef = useRef<number[]>([]);

  // Dirty once the user has entered anything beyond the defaults, until the
  // survey is saved. Blocks Cancel, the back link, and browser back; the
  // confirmation dialog below lets the user proceed or stay.
  const blocker = useUnsavedChangesGuard(
    () =>
      !saveCompleteRef.current &&
      (notes.trim() !== '' ||
        pendingImageFiles.length > 0 ||
        (locationId !== null && locationId !== autoLocationIdRef.current) ||
        selectedSurveyors.map((s) => s.id).sort().join(',') !==
          [...prefilledSurveyorIdsRef.current].sort().join(',') ||
        draftSightings.some((s) => s.species_id !== null)),
  );

  // ============================================================================
  // Data Fetching - Initial Load
  // ============================================================================

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setLoading(true);
        setSurveyTypesLoading(true);
        setError(null);

        // Fetch survey types and other base data in parallel
        const [surveyTypesData, surveyorsData, breedingCodesData, boundariesData, slot] = await Promise.all([
          surveyTypesAPI.getAll(),
          surveyorsAPI.getAll(),
          surveysAPI.getBreedingCodes(),
          locationsAPI.getAllWithBoundaries(),
          scheduledSurveyIdParam
            ? scheduledSurveysAPI.getById(Number(scheduledSurveyIdParam)).catch(() => null)
            : Promise.resolve(null),
        ]);

        setSurveyTypes(surveyTypesData);
        setSurveyors(surveyorsData);
        setBreedingCodes(breedingCodesData);
        setLocationsWithBoundaries(boundariesData);

        // Record flow: prefill from the slot. The type is locked to the
        // slot's; the date defaults to today clamped into the slot's window
        // (recording late lands on the window's last day, never outside it);
        // the slot's sign-ups become the participant baseline; the slot's
        // location survives the type-change reset via the auto-location ref.
        if (slot) {
          setRecordingSlot(slot);
          const slotType = surveyTypesData.find((t) => t.id === slot.survey_type_id) ?? null;
          setSelectedSurveyType(slotType);
          const today = dayjs().format('YYYY-MM-DD');
          const clamped = today < slot.window_start
            ? slot.window_start
            : today > slot.window_end
              ? slot.window_end
              : today;
          setDate(dayjs(clamped));
          if (slot.location_id != null) {
            autoLocationIdRef.current = slot.location_id;
            setLocationId(slot.location_id);
          }
          const preassigned = surveyorsData.filter((s) => slot.surveyor_ids.includes(s.id));
          prefilledSurveyorIdsRef.current = preassigned.map((s) => s.id);
          setSelectedSurveyors(preassigned);
        } else {
          // No slot (plain new survey, or the record link's slot failed to
          // load). The component survives in-app navigation between
          // /surveys/new?scheduled_survey_id=N and /surveys/new, so the
          // record-flow prefill must be unwound, not just skipped.
          setRecordingSlot(null);
          const preset = presetTypeIdParam
            ? surveyTypesData.find(
                (t) =>
                  t.id === Number(presetTypeIdParam) &&
                  !t.allow_image_upload &&
                  !t.allow_audio_upload,
              ) ?? null
            : null;
          setSelectedSurveyType(preset);
          setDate(dayjs());
          setLocationId(null);
          autoLocationIdRef.current = null;
          setSelectedSurveyors([]);
          prefilledSurveyorIdsRef.current = [];
          if (scheduledSurveyIdParam) {
            setError(
              'The scheduled survey could not be loaded — saving will create a survey that is not linked to it.',
            );
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load form data');
        console.error('Error fetching data:', err);
      } finally {
        setLoading(false);
        setSurveyTypesLoading(false);
      }
    };

    fetchInitialData();
  }, [scheduledSurveyIdParam, presetTypeIdParam]);

  // ============================================================================
  // Data Fetching - When Survey Type Changes
  // ============================================================================

  useEffect(() => {
    if (!selectedSurveyType) {
      setLocations([]);
      setSpecies([]);
      setDevices([]);
      return;
    }

    const fetchFilteredData = async () => {
      try {
        const [locationsData, speciesData, devicesData] = await Promise.all([
          locationsAPI.getBySurveyType(selectedSurveyType.id),
          speciesAPI.getBySurveyType(selectedSurveyType.id),
          selectedSurveyType.allow_sighting_device_selection && selectedSurveyType.sighting_device_type
            ? devicesAPI.getAll(false, selectedSurveyType.sighting_device_type)
            : Promise.resolve<Device[]>([]),
        ]);

        setLocations(locationsData);
        setSpecies(speciesData);
        setDevices(devicesData);

        // Clear location if it's no longer in the available list; when the
        // survey type has exactly one location, preselect it
        setLocationId((prev) => {
          const valid = prev !== null && locationsData.some((l) => l.id === prev) ? prev : null;
          if (valid === null && locationsData.length === 1) {
            autoLocationIdRef.current = locationsData[0].id;
            return locationsData[0].id;
          }
          return valid;
        });

        // Clear sightings with species no longer available
        const validSpeciesIds = new Set(speciesData.map((s) => s.id));
        setDraftSightings((prev) =>
          prev.map((s) => ({
            ...s,
            species_id: s.species_id && validSpeciesIds.has(s.species_id) ? s.species_id : null,
          }))
        );
      } catch (err) {
        console.error('Error fetching filtered data:', err);
      }
    };

    fetchFilteredData();
  }, [selectedSurveyType]);

  // The sightings map shows only the survey type's Available Locations,
  // matching the location dropdown (`locations` is the by-survey-type list).
  const scopedBoundaries = useMemo(
    () => scopeBoundariesToLocations(locationsWithBoundaries, locations),
    [locationsWithBoundaries, locations]
  );

  // ============================================================================
  // Validation
  // ============================================================================

  const validate = (): boolean => {
    const errors: typeof validationErrors = {};

    if (!selectedSurveyType) {
      errors.surveyType = 'Survey type is required';
    }

    if (!date) {
      errors.date = 'Date is required';
    }

    if (selectedSurveyors.length === 0) {
      errors.surveyors = 'At least one surveyor is required';
    }

    // If location at sighting level, check that each sighting has a location
    const validSightings = draftSightings.filter(
      (s) => s.species_id !== null && s.count > 0
    );
    if (selectedSurveyType?.allow_sighting_device_selection) {
      const sightingsWithoutDevice = validSightings.filter((s) => !s.device_id);
      if (sightingsWithoutDevice.length > 0) {
        errors.sightings = 'Each sighting must have a device selected';
      }
    } else if (selectedSurveyType?.location_at_sighting_level) {
      const sightingsWithoutLocation = validSightings.filter((s) => !s.location_id);
      if (sightingsWithoutLocation.length > 0) {
        errors.sightings = 'Each sighting must have a location selected';
      }
    }

    if (hasTimeValidationError(startTime, endTime)) {
      errors.endTime = 'End time must be after start time';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ============================================================================
  // Sightings Change Handler
  // ============================================================================

  const handleSightingsChange = (newSightings: DraftSighting[]) => {
    setDraftSightings(newSightings);

    // Clear sightings validation error when user changes sightings
    if (validationErrors.sightings) {
      setValidationErrors({ ...validationErrors, sightings: undefined });
    }
  };

  // ============================================================================
  // Audio File Handlers
  // ============================================================================

  // ============================================================================
  // Image File Handlers
  // ============================================================================

  const handleImageFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Filter to only image files
    const validExtensions = ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp'];
    const validFiles = Array.from(files).filter((f) => {
      const ext = f.name.toLowerCase().substring(f.name.lastIndexOf('.'));
      return validExtensions.includes(ext);
    });

    setPendingImageFiles((prev) => [...prev, ...validFiles]);

    // Reset input so the same file can be selected again
    event.target.value = '';
  };

  const handleRemoveImageFile = (index: number) => {
    setPendingImageFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // ============================================================================
  // Form Submission
  // ============================================================================

  const handleSave = async () => {
    // Validate survey fields
    if (!validate()) {
      setError('Please fill in all required fields');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const surveyData: Partial<Survey> & { survey_type_id?: number } = {
        date: date!.format('YYYY-MM-DD'),
        surveyor_ids: selectedSurveyors.map((s) => s.id),
        notes: notes.trim() || null,
        survey_type_id: selectedSurveyType?.id,
        scheduled_survey_id: recordingSlot?.id ?? null,
        start_time: startTime?.isValid() ? startTime.format('HH:mm:ss') : null,
        end_time: endTime?.isValid() ? endTime.format('HH:mm:ss') : null,
        sun_percentage: sunPercentage !== '' ? Number(sunPercentage) : null,
        temperature_celsius: temperatureCelsius !== '' ? temperatureCelsius : null,
      };

      // Only include location_id if NOT at sighting level
      if (!selectedSurveyType?.location_at_sighting_level) {
        surveyData.location_id = locationId ?? undefined;
      }

      const validSightings = draftSightings.filter(
        (s) => s.species_id !== null && s.count > 0
      );

      // Resume a previous failed attempt only if the save inputs are
      // unchanged; otherwise start fresh.
      const fingerprint = JSON.stringify({
        surveyData,
        sightings: validSightings.map((s) => ({
          ...s,
          pendingPhotos: s.pendingPhotos?.map(fileKey),
        })),
        images: pendingImageFiles.map(fileKey),
      });
      if (saveResumeRef.current.fingerprint !== fingerprint) {
        saveResumeRef.current = { ...emptySaveResumeState(), fingerprint };
      }
      const resume = saveResumeRef.current;

      // Step 1: Create survey (skipped on retry if it already succeeded)
      const surveyId = resume.surveyId ?? (await surveysAPI.create(surveyData)).id;
      resume.surveyId = surveyId;

      // Step 2: Upload sighting photos if any (for sighting photo upload
      // survey types). Photos uploaded by a previous failed attempt are
      // skipped — their image ids are already in resume.sightingPhotoIds.
      const sightingPhotoMap = resume.sightingPhotoIds;
      if (allowSightingPhotoUpload) {
        await Promise.all(
          validSightings
            .filter((s) => s.pendingPhotos && s.pendingPhotos.length > 0 && !sightingPhotoMap.has(s.tempId))
            .map(async (sighting) => {
              const uploaded = await imagesAPI.uploadFilesWithMetadata(
                surveyId,
                sighting.pendingPhotos!,
                undefined,
                true // skipProcessing
              );
              sightingPhotoMap.set(sighting.tempId, uploaded.map((img) => img.id));
            })
        );
      }

      // Step 3: Add sightings (with individual locations if provided),
      // skipping any already created by a previous failed attempt
      await Promise.all(
        validSightings
          .filter((sighting) => !resume.createdSightingTempIds.has(sighting.tempId))
          .map((sighting) =>
            surveysAPI.addSighting(surveyId, {
              species_id: sighting.species_id!,
              count: sighting.count,
              location_id: locationAtSightingLevel ? sighting.location_id : undefined,
              device_id: allowSightingDeviceSelection ? sighting.device_id : undefined,
              notes: sighting.notes,
              // Include individual locations with count and breeding status codes
              individuals: sighting.individuals?.map((ind) => ({
                latitude: ind.latitude,
                longitude: ind.longitude,
                count: ind.count,
                breeding_status_code: ind.breeding_status_code,
                notes: ind.notes,
              })),
              image_ids: sightingPhotoMap.get(sighting.tempId),
            }).then(() => {
              resume.createdSightingTempIds.add(sighting.tempId);
            })
          )
      );

      // Step 4: Upload image files if any (for camera trap surveys)
      if (pendingImageFiles.length > 0 && !resume.surveyImagesUploaded) {
        await imagesAPI.uploadFiles(surveyId, pendingImageFiles);
        resume.surveyImagesUploaded = true;
      }

      // Success - navigate to survey detail page or surveys list
      saveCompleteRef.current = true;
      saveResumeRef.current = emptySaveResumeState();
      if (allowImageUpload && pendingImageFiles.length > 0) {
        navigate(`/surveys/${surveyId}`);
      } else {
        navigate(`/surveys?created=${surveyId}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create survey';
      setError(
        saveResumeRef.current.surveyId != null
          ? `${message} — click "Save Survey" again to retry; it will resume where it left off.`
          : message
      );
      console.error('Error creating survey:', err);
      setSaving(false);
    }
  };

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleCancel = () => {
    navigate('/surveys');
  };

  const handleSurveyTypeChange = (surveyType: SurveyType | null) => {
    // Redirect to camera trap wizard for image upload survey types
    if (surveyType?.allow_image_upload) {
      navigate(`/surveys/new/camera-trap?type=${surveyType.id}`);
      return;
    }
    // Redirect to audio wizard for audio upload survey types
    if (surveyType?.allow_audio_upload) {
      navigate(`/surveys/new/audio?type=${surveyType.id}`);
      return;
    }

    setSelectedSurveyType(surveyType);
    // Clear location when survey type changes
    setLocationId(null);
    // Clear pending image files when switching to a survey type that doesn't allow images
    if (!surveyType?.allow_image_upload) {
      setPendingImageFiles([]);
    }
    // Clear validation error
    if (validationErrors.surveyType) {
      setValidationErrors({ ...validationErrors, surveyType: undefined });
    }
  };

  // ============================================================================
  // Loading State
  // ============================================================================

  // Auth gate
  if (authLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!canEditSurveys) {
    return <AccessNotice message="Creating surveys needs editor access." />;
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <CircularProgress />
      </Box>
    );
  }

  // ============================================================================
  // Computed Values
  // ============================================================================

  const allowSightingDeviceSelection = selectedSurveyType?.allow_sighting_device_selection ?? false;
  const locationAtSightingLevel = !allowSightingDeviceSelection && (selectedSurveyType?.location_at_sighting_level ?? false);
  const allowGeolocation = !allowSightingDeviceSelection && (selectedSurveyType?.allow_geolocation ?? true);
  const allowCoordinateEntry = allowGeolocation && (selectedSurveyType?.allow_coordinate_entry ?? false);
  const allowSightingNotes = selectedSurveyType?.allow_sighting_notes ?? true;
  const allowImageUpload = selectedSurveyType?.allow_image_upload ?? false;
  const allowSightingPhotoUpload = selectedSurveyType?.allow_sighting_photo_upload ?? false;
  const showStartEndTime = selectedSurveyType?.allow_start_end_time ?? false;
  const showSunPercentage = selectedSurveyType?.allow_sun_percentage ?? false;
  const showTemperature = selectedSurveyType?.allow_temperature ?? false;
  const showDescription = selectedSurveyType?.allow_show_description && selectedSurveyType?.description;

  // Determine if save button should be disabled
  const saveDisabled =
    saving ||
    !selectedSurveyType ||
    !date ||
    selectedSurveyors.length === 0;

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <Box sx={{ p: SPACING.PAGE_PADDING }}>
      {/* Page Header */}
      <PageHeader
        backButton={{ href: '/surveys' }}
        actions={
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
              disabled={saveDisabled}
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
        }
      />
      {/* Error Alert */}
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Survey Type Selection Card */}
      <Paper
        sx={{
          p: 3,
          mb: 3,
          boxShadow: 'none',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
          Survey Type
        </Typography>
        <Autocomplete
          options={surveyTypes}
          getOptionLabel={(option) => option.name}
          value={selectedSurveyType}
          onChange={(_, newValue) => handleSurveyTypeChange(newValue)}
          loading={surveyTypesLoading}
          disabled={recordingSlot !== null}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Survey Type"
              required
              error={!!validationErrors.surveyType}
              helperText={validationErrors.surveyType}
            />
          )}
          isOptionEqualToValue={(option, value) => option.id === value.id}
        />
      </Paper>

      {/* Record flow: say which planned week/day this survey records */}
      {recordingSlot && (
        <Alert severity="info" sx={{ mb: 3 }}>
          Recording the scheduled survey for {formatSurveyDate(recordingSlot)}.
        </Alert>
      )}

      {/* Survey Type Description Banner */}
      {showDescription && (
        <Alert severity="info" sx={{ mb: 3 }}>
          {selectedSurveyType!.description}
        </Alert>
      )}

      {/* Survey Details Card - Only show when survey type is selected */}
      {selectedSurveyType && (
        <Paper
          sx={{
            p: 3,
            mb: 3,
            boxShadow: 'none',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            Survey Details
          </Typography>

          <SurveyFormFields
            date={date}
            locationId={locationId}
            selectedSurveyors={selectedSurveyors}
            notes={notes}
            startTime={startTime}
            endTime={endTime}
            sunPercentage={sunPercentage}
            temperatureCelsius={temperatureCelsius}
            locations={locations}
            surveyors={surveyors}
            onDateChange={setDate}
            onLocationChange={setLocationId}
            onSurveyorsChange={setSelectedSurveyors}
            onNotesChange={setNotes}
            onStartTimeChange={setStartTime}
            onEndTimeChange={setEndTime}
            onSunPercentageChange={setSunPercentage}
            onTemperatureCelsiusChange={setTemperatureCelsius}
            validationErrors={validationErrors}
            hideLocation={locationAtSightingLevel || locations.length === 0}
            showStartEndTime={showStartEndTime}
            showSunPercentage={showSunPercentage}
            showTemperature={showTemperature}
          />
        </Paper>
      )}

      {/* Image Upload Section - Only for camera trap surveys */}
      {allowImageUpload && (
        <Paper
          sx={{
            p: 3,
            mb: 3,
            boxShadow: 'none',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Camera Trap Images ({pendingImageFiles.length})
            </Typography>
            <Button
              component="label"
              variant="contained"
              startIcon={<CloudUpload />}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                boxShadow: 'none',
                '&:hover': { boxShadow: 'none' },
              }}
            >
              Add Images
              <input
                type="file"
                hidden
                multiple
                accept=".jpg,.jpeg,.png,.tiff,.tif,.bmp"
                onChange={handleImageFileSelect}
              />
            </Button>
          </Stack>

          {pendingImageFiles.length > 0 ? (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              {pendingImageFiles.map((file, index) => (
                <Box
                  key={`${file.name}-${index}`}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    p: 1.5,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    '&:last-child': { borderBottom: 'none' },
                    '&:hover': { bgcolor: 'grey.50' },
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <PhotoCamera sx={{ fontSize: 20, color: 'text.secondary' }} />
                    <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                      {file.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                      ({(file.size / 1024 / 1024).toFixed(1)} MB)
                    </Typography>
                  </Stack>
                  <Button
                    size="small"
                    color="error"
                    onClick={() => handleRemoveImageFile(index)}
                    sx={{ minWidth: 'auto', p: 0.5 }}
                  >
                    <Delete fontSize="small" />
                  </Button>
                </Box>
              ))}
            </Box>
          ) : (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <PhotoCamera sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
              <Typography color="text.secondary">
                Add camera trap images to upload with this survey.
              </Typography>
            </Box>
          )}
        </Paper>
      )}

      {/* Sightings Card - Only show when survey type is selected */}
      {selectedSurveyType && (
        <Paper
          sx={{
            p: 3,
            boxShadow: 'none',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <SightingsEditor
            sightings={draftSightings}
            species={species}
            breedingCodes={breedingCodes}
            onSightingsChange={handleSightingsChange}
            validationError={validationErrors.sightings}
            locationsWithBoundaries={scopedBoundaries}
            locationAtSightingLevel={locationAtSightingLevel}
            locations={locations}
            allowGeolocation={allowGeolocation}
            allowCoordinateEntry={allowCoordinateEntry}
            allowSightingNotes={allowSightingNotes}
            allowSightingPhotoUpload={allowSightingPhotoUpload}
            allowSightingDeviceSelection={allowSightingDeviceSelection}
            devices={devices}
            surveyLocationId={locationId}
          />
        </Paper>
      )}

      <UnsavedChangesDialog
        open={blocker.state === 'blocked'}
        onKeepWorking={() => blocker.reset?.()}
        onDiscard={() => blocker.proceed?.()}
      />
    </Box>
  );
}
