import { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Typography, Paper, Stack, Button, Divider, CircularProgress, Alert, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Tooltip } from '@mui/material';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { Add, Edit, Delete, Save, Cancel, CalendarToday, Person, LocationOn, AccessTime, Thermostat, WbSunny } from '@mui/icons-material';
import dayjs, { Dayjs } from 'dayjs';
import { usePermissions } from '../context/AuthContext';
import { surveysAPI, surveyorsAPI, locationsAPI, speciesAPI, surveyTypesAPI, imagesAPI, devicesAPI, ApiError, isRetryableError } from '../services/api';
import type { SurveyDetail, Sighting, SightingAudioClip, Surveyor, Location, Species, Survey, BreedingStatusCode, LocationWithBoundary, SurveyType, Device } from '../services/api';
import { SurveyFormFields, hasTimeValidationError } from '../components/surveys/SurveyFormFields';
import { SightingsEditor } from '../components/surveys/SightingsEditor';
import type { DraftSighting } from '../components/surveys/SightingsEditor';
import { ResumeDraftDialog } from '../components/surveys/ResumeDraftDialog';
import { SyncStatusBanner } from '../components/surveys/SyncStatusBanner';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { useDraftAutosave, useOnlineStatus, useSyncRetry } from '../hooks';
import { loadSurveyDraft, deleteSurveyDraft, saveSurveyDraft, surveyDraftKey } from '../services/draftStore';
import type { SurveyDraftForm, SurveyDraftRecord } from '../services/draftStore';
import { draftFingerprint, ensureClientUuids, adoptServerIds } from '../utils/surveyDraftSync';
import { AudioClipPlayer } from '../components/audio/AudioClipPlayer';
import { MapModeSightings } from '../components/surveys/MapModeSightings';
import { getSightingsGridConfig } from '../components/surveys/sightingsGridConfig';
import { getSpeciesIcon } from '../config';
import { PageHeader } from '../components/layout/PageHeader';
import { getSurveyorName, formatDate } from '../utils/formatters';
import { ImageViewerModal, type ImageViewerItem } from '../components/ImageViewerModal';
import ViewModeToggle from '../components/ViewModeToggle';
import { SPACING } from '../config/responsive';
import { useToast } from '../context/ToastContext';
import { readReturnTo, returnAfterAction, returnToHref } from '../utils/returnTo';

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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { canEditSurveys } = usePermissions();
  const toast = useToast();

  // Where the back button and post-save/delete navigation should return to.
  // Defaults to the main surveys list when reached via a deep link.
  const returnTo = readReturnTo(location);

  // Two ways into the form, with different save semantics: ?record=true is
  // the "Record survey" flow (saving marks a scheduled survey completed),
  // ?edit=true is a plain edit (saving never changes the lifecycle status).
  const startInRecordMode = searchParams.get('record') === 'true';
  const startInEditMode = searchParams.get('edit') === 'true' || startInRecordMode;
  const [isEditMode, setIsEditMode] = useState(startInEditMode);
  const [isRecordMode, setIsRecordMode] = useState(startInRecordMode);
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
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Recording only means something on a scheduled survey; a stale
  // ?record=true link to an already-completed one degrades to a plain edit.
  const isRecording = isRecordMode && survey?.status === 'scheduled';
  // Plain edits of a scheduled survey are plan fixes — they may leave the
  // sign-up sheet empty. Recording (and editing a completed survey) needs
  // at least one surveyor: someone did the survey.
  const requiresSurveyors = isRecording || survey?.status !== 'scheduled';

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
  const [editStartTime, setEditStartTime] = useState<Dayjs | null>(null);
  const [editEndTime, setEditEndTime] = useState<Dayjs | null>(null);
  const [editSunPercentage, setEditSunPercentage] = useState<string>('');
  const [editTemperatureCelsius, setEditTemperatureCelsius] = useState<string>('');
  const [editDraftSightings, setEditDraftSightings] = useState<DraftSighting[]>([]);

  const [validationErrors, setValidationErrors] = useState<{
    date?: string;
    location?: string;
    surveyors?: string;
    sightings?: string;
    endTime?: string;
  }>({});

  // ============================================================================
  // Field resilience: local draft backup, unsaved-changes guard, retryable save
  // ============================================================================

  // Set when a save failed on connectivity: entries are safe on this device
  // and the save re-runs automatically when the connection returns.
  const [pendingSync, setPendingSync] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  // A stored draft found on load, awaiting the user's resume/discard choice.
  const [resumeDraft, setResumeDraft] = useState<SurveyDraftRecord | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const online = useOnlineStatus();

  // Flipped synchronously before the post-save navigation so neither the
  // guard nor the autosave fire on the way out.
  const saveCompleteRef = useRef(false);
  // Fingerprint of the server state the edit session started from; edit state
  // matching it is clean (no draft, no guard).
  const baselineFingerprintRef = useRef<string>('');
  const savingRef = useRef(false);
  savingRef.current = saving;
  const handleSaveRef = useRef<() => void>(() => {});

  const draftKey = id ? surveyDraftKey(id) : null;

  const currentDraftForm: SurveyDraftForm = {
    date: editDate?.isValid() ? editDate.format('YYYY-MM-DD') : null,
    locationId: editLocationId,
    surveyorIds: editSelectedSurveyors.map((s) => s.id),
    notes: editNotes,
    startTime: editStartTime?.isValid() ? editStartTime.format('HH:mm:ss') : null,
    endTime: editEndTime?.isValid() ? editEndTime.format('HH:mm:ss') : null,
    sunPercentage: editSunPercentage,
    temperatureCelsius: editTemperatureCelsius,
  };
  // Dirty only once the survey is loaded AND populateEditState recorded a
  // baseline: with ?record=true isEditMode is already true during the initial
  // fetch, and without these guards the empty pre-fetch form would count as
  // dirty and autosave a bogus empty draft.
  const isDirty =
    isEditMode &&
    survey !== null &&
    baselineFingerprintRef.current !== '' &&
    !saveCompleteRef.current &&
    draftFingerprint(currentDraftForm, editDraftSightings) !== baselineFingerprintRef.current;
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;

  const activeDraft: SurveyDraftRecord | null =
    draftKey && isDirty
      ? {
          key: draftKey,
          savedAt: 0,
          mode: isRecording ? 'record' : 'edit',
          form: currentDraftForm,
          sightings: editDraftSightings,
        }
      : null;
  const { clearDraft } = useDraftAutosave(activeDraft, setDraftSavedAt);

  /** Delete the stored draft and stop autosaving for this edit session. */
  const removeDraft = () => {
    clearDraft();
    if (draftKey) deleteSurveyDraft(draftKey).catch(() => {});
  };

  const blocker = useUnsavedChangesGuard(() => isDirtyRef.current);
  // No Background Sync on iOS: retries happen in the foreground, when the
  // connection returns or the app becomes visible (plus the Sync now button).
  useSyncRetry(pendingSync, () => {
    if (!savingRef.current) handleSaveRef.current();
  });

  // Devices surfaced to the picker and map: active devices plus any inactive device
  // already referenced by a sighting (so historical rows stay editable/mappable).
  // Declared up here to keep hook order stable with the loading/error early returns below.
  const visibleDevices = useMemo(() => {
    if (!surveyType?.allow_sighting_device_selection) return [];
    const referencedIds = new Set(
      sightings
        .map((s: any) => s.device_id)
        .filter((id: number | null | undefined): id is number => id != null)
    );
    return devices.filter((d) => d.is_active || referencedIds.has(d.id));
  }, [surveyType?.allow_sighting_device_selection, devices, sightings]);


  /**
   * Populate the edit form from a survey and enter edit mode. Takes the data
   * explicitly (rather than reading component state) so it can also run
   * straight after the initial fetch when the page is opened with ?edit=true.
   *
   * Declared before the fetch effect that calls it: the first render bails at
   * the loading early-return below, so a declaration placed after that return
   * would still be uninitialized (TDZ) when the effect's fetch completes.
   */
  const populateEditState = (
    surveyData: SurveyDetail,
    sightingsData: Sighting[],
    surveyorList: Surveyor[],
  ) => {
    setEditDate(dayjs(surveyData.date));
    setEditLocationId(surveyData.location_id);
    setEditSelectedSurveyors(
      surveyorList.filter((s) => surveyData.surveyor_ids.includes(s.id))
    );
    setEditNotes(surveyData.notes || '');
    setEditStartTime(surveyData.start_time ? dayjs(surveyData.start_time, 'HH:mm:ss') : null);
    setEditEndTime(surveyData.end_time ? dayjs(surveyData.end_time, 'HH:mm:ss') : null);
    setEditSunPercentage(surveyData.sun_percentage != null ? String(surveyData.sun_percentage) : '');
    setEditTemperatureCelsius(surveyData.temperature_celsius != null ? String(surveyData.temperature_celsius) : '');

    // Convert existing sightings to DraftSighting format
    // Note: sightings may include individuals array from API (SightingWithIndividuals)
    const draftSightings: DraftSighting[] = sightingsData.map((sighting: any) => ({
      tempId: `existing-${sighting.id}`,
      species_id: sighting.species_id,
      count: sighting.count,
      id: sighting.id, // Keep the real ID for updates/deletes
      // Include location_id for sighting-level location
      location_id: sighting.location_id,
      // Include device_id for device-attached sightings
      device_id: sighting.device_id,
      // Include notes for this sighting
      notes: sighting.notes,
      // Include individuals if present (from SightingWithIndividuals)
      individuals: sighting.individuals?.map((ind: any) => ({
        ...ind,
        tempId: `existing-ind-${ind.id}`,
      })),
      // Include existing image IDs for photo management
      existingImageIds: sighting.image_ids || [],
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

    // Record what "unchanged" looks like, mirroring how currentDraftForm is
    // built from the states set above, so the dirty check starts clean.
    baselineFingerprintRef.current = draftFingerprint(
      {
        date: surveyData.date ?? null,
        locationId: surveyData.location_id,
        surveyorIds: surveyorList
          .filter((s) => surveyData.surveyor_ids.includes(s.id))
          .map((s) => s.id),
        notes: surveyData.notes || '',
        startTime: surveyData.start_time,
        endTime: surveyData.end_time,
        sunPercentage: surveyData.sun_percentage != null ? String(surveyData.sun_percentage) : '',
        temperatureCelsius:
          surveyData.temperature_celsius != null ? String(surveyData.temperature_celsius) : '',
      } satisfies SurveyDraftForm,
      draftSightings
    );
  };

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

        // If this survey type attaches sightings to devices, fetch those devices so the
        // map can plot sightings at their device's coordinates. Include inactive so
        // historical sightings whose device has since been deactivated still plot.
        if (surveyTypeData?.allow_sighting_device_selection && surveyTypeData.sighting_device_type) {
          try {
            const devicesData = await devicesAPI.getAll(true, surveyTypeData.sighting_device_type);
            setDevices(devicesData);
          } catch (e) {
            console.error('Error fetching devices:', e);
          }
        } else {
          setDevices([]);
        }

        // Landing with ?record=true ("Record survey" from a Group page) or
        // ?edit=true drops straight into the populated form.
        if (startInEditMode) {
          populateEditState(surveyData, sightingsData, surveyorsData);
        }

        // A stored draft means entries were made on this device and never
        // uploaded (tab killed mid-recording, failed save, session expiry).
        // Offer to resume them over the server state.
        try {
          const storedDraft = await loadSurveyDraft(surveyDraftKey(id));
          if (storedDraft) setResumeDraft(storedDraft);
        } catch {
          // Local storage unavailable (e.g. private browsing) — nothing to resume.
        }
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

  // Show error state when the survey itself failed to load. Errors that occur
  // while the survey is on screen (e.g. a failed save) render inline instead,
  // so the user keeps their edit state and can retry.
  if (!survey) {
    return (
      <Box sx={{ p: SPACING.PAGE_PADDING }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || 'Survey not found'}
        </Alert>
        <Button variant="contained" onClick={() => navigate(returnToHref(returnTo))}>
          Back to {returnTo.label}
        </Button>
      </Box>
    );
  }

  // ============================================================================
  // Computed Values - Survey Type Configuration
  // ============================================================================

  const allowSightingDeviceSelection = surveyType?.allow_sighting_device_selection ?? false;
  const locationAtSightingLevel = !allowSightingDeviceSelection && (surveyType?.location_at_sighting_level ?? false);
  const allowGeolocation = !allowSightingDeviceSelection && (surveyType?.allow_geolocation ?? true);
  const canShowSightingsMap = allowGeolocation || allowSightingDeviceSelection;
  const allowSightingNotes = surveyType?.allow_sighting_notes ?? true;
  const allowSightingPhotoUpload = surveyType?.allow_sighting_photo_upload ?? false;
  const showStartEndTime = surveyType?.allow_start_end_time ?? false;
  const showSunPercentage = surveyType?.allow_sun_percentage ?? false;
  const showTemperature = surveyType?.allow_temperature ?? false;
  const showDescription = surveyType?.allow_show_description && surveyType?.description;


  // ============================================================================
  // Validation
  // ============================================================================

  const validate = (): boolean => {
    const errors: typeof validationErrors = {};

    if (!editDate) {
      errors.date = 'Date is required';
    }

    if (requiresSurveyors && editSelectedSurveyors.length === 0) {
      errors.surveyors = 'At least one surveyor is required';
    }

    // If location at sighting level, check that each sighting has a location
    const validSightings = editDraftSightings.filter(
      (s) => s.species_id !== null && s.count > 0
    );
    if (allowSightingDeviceSelection) {
      const sightingsWithoutDevice = validSightings.filter((s) => !s.device_id);
      if (sightingsWithoutDevice.length > 0) {
        errors.sightings = 'Each sighting must have a device selected';
      }
    } else if (locationAtSightingLevel) {
      const sightingsWithoutLocation = validSightings.filter((s) => !s.location_id);
      if (sightingsWithoutLocation.length > 0) {
        errors.sightings = 'Each sighting must have a location selected';
      }
    }

    if (hasTimeValidationError(editStartTime, editEndTime)) {
      errors.endTime = 'End time must be after start time';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleEditClick = () => {
    if (!survey) return;
    setIsRecordMode(false);
    populateEditState(survey, sightings, surveyors);
  };

  const handleRecordClick = () => {
    if (!survey) return;
    setIsRecordMode(true);
    populateEditState(survey, sightings, surveyors);
  };

  const handleResumeDraft = () => {
    if (!resumeDraft || !survey) return;
    // Establish the server baseline (and enter edit mode), then lay the
    // draft's values over it.
    populateEditState(survey, sightings, surveyors);
    const d = resumeDraft;
    setEditDate(d.form.date ? dayjs(d.form.date) : null);
    setEditLocationId(d.form.locationId);
    setEditSelectedSurveyors(surveyors.filter((s) => d.form.surveyorIds.includes(s.id)));
    setEditNotes(d.form.notes);
    setEditStartTime(d.form.startTime ? dayjs(d.form.startTime, 'HH:mm:ss') : null);
    setEditEndTime(d.form.endTime ? dayjs(d.form.endTime, 'HH:mm:ss') : null);
    setEditSunPercentage(d.form.sunPercentage);
    setEditTemperatureCelsius(d.form.temperatureCelsius);
    setEditDraftSightings(d.sightings);
    // A record-mode draft only means "record" while the survey is still
    // scheduled; isRecording degrades it to a plain edit otherwise.
    setIsRecordMode(d.mode === 'record');
    setResumeDraft(null);
  };

  const handleDiscardDraft = () => {
    if (draftKey) deleteSurveyDraft(draftKey).catch(() => {});
    setResumeDraft(null);
  };

  const handleSave = async () => {
    // Validate survey fields
    if (!validate()) {
      setError('Please fill in all required fields');
      return;
    }

    setSaving(true);
    setError(null);

    // Every to-be-created sighting/individual gets a client-minted uuid the
    // server dedupes on, then the whole plan is flushed to the local draft
    // BEFORE any request: if the app dies mid-save, the retry (even after a
    // reload) reuses the same uuids and can never create duplicates.
    const sightingsWithUuids = ensureClientUuids(editDraftSightings);
    setEditDraftSightings(sightingsWithUuids);
    if (draftKey) {
      await saveSurveyDraft({
        key: draftKey,
        savedAt: Date.now(),
        mode: isRecording ? 'record' : 'edit',
        form: currentDraftForm,
        sightings: sightingsWithUuids,
      }).catch(() => {});
    }

    // Saving is a chain of individual API calls, not an atomic operation. Work
    // against mutable copies of the draft and the server baseline, recording
    // each completed operation as it happens. If a call fails partway through,
    // the catch path persists this reconciled state back into React state so
    // pressing Save again only retries what actually failed (no duplicate
    // sightings/photos, no deletes of already-deleted rows), and Cancel shows
    // the server's current state rather than the stale pre-edit snapshot.
    const workingDraft: DraftSighting[] = sightingsWithUuids.map((s) => ({
      ...s,
      individuals: s.individuals?.map((ind) => ({ ...ind })),
      pendingPhotos: s.pendingPhotos ? [...s.pendingPhotos] : undefined,
      existingImageIds: s.existingImageIds ? [...s.existingImageIds] : undefined,
      removedImageIds: s.removedImageIds ? [...s.removedImageIds] : undefined,
    }));
    let workingBaseline: Sighting[] = sightings;

    // Treat 404 on delete as success: the row is already gone server-side
    // (e.g. deleted during a previous partially-failed save attempt).
    const isNotFound = (err: unknown): boolean =>
      err instanceof ApiError && err.status === 404;

    try {
      // Step 1: Update survey
      const surveyData: Partial<Survey> = {
        date: editDate!.format('YYYY-MM-DD'),
        surveyor_ids: editSelectedSurveyors.map((s) => s.id),
        notes: editNotes.trim() || null,
        start_time: editStartTime?.isValid() ? editStartTime.format('HH:mm:ss') : null,
        end_time: editEndTime?.isValid() ? editEndTime.format('HH:mm:ss') : null,
        sun_percentage: editSunPercentage !== '' ? Number(editSunPercentage) : null,
        temperature_celsius: editTemperatureCelsius !== '' ? editTemperatureCelsius : null,
      };

      // Only include location_id if NOT at sighting level
      if (!locationAtSightingLevel) {
        surveyData.location_id = editLocationId ?? undefined;
      }

      // The lifecycle transition is explicit: only the record flow marks a
      // scheduled survey completed. A plain edit sends no status at all.
      if (isRecording) {
        surveyData.status = 'completed';
      }

      await surveysAPI.update(Number(id), surveyData);

      // Step 2: Handle sightings changes
      // Get valid sightings (non-empty rows)
      const validSightings = workingDraft.filter(
        (s) => s.species_id !== null && s.count > 0
      );

      // Identify which sightings to delete (existing sightings not in the new list)
      const keptSightingIds = validSightings
        .filter((s) => s.id)
        .map((s) => s.id!);
      const sightingsToDelete = workingBaseline
        .map((s) => s.id)
        .filter((sightingId) => !keptSightingIds.includes(sightingId));

      // Delete removed sightings. Use allSettled so successful deletes are
      // recorded in the baseline even when a sibling delete fails.
      const deleteResults = await Promise.allSettled(
        sightingsToDelete.map(async (sightingId) => {
          try {
            await surveysAPI.deleteSighting(Number(id), sightingId);
          } catch (err) {
            if (!isNotFound(err)) throw err;
          }
          return sightingId;
        })
      );
      const deletedIds = new Set<number>();
      let firstDeleteError: unknown = null;
      for (const result of deleteResults) {
        if (result.status === 'fulfilled') {
          deletedIds.add(result.value);
        } else if (firstDeleteError === null) {
          firstDeleteError = result.reason;
        }
      }
      workingBaseline = workingBaseline.filter((s) => !deletedIds.has(s.id));
      if (firstDeleteError !== null) {
        throw firstDeleteError;
      }

      // Update existing sightings and add new ones
      for (const sighting of validSightings) {
        // Upload any pending photos for this sighting. The duplicate-recovery
        // variant converges when a previous attempt uploaded some files but
        // the response was lost.
        if (allowSightingPhotoUpload && sighting.pendingPhotos && sighting.pendingPhotos.length > 0) {
          const uploaded = await imagesAPI.uploadFilesRecoveringDuplicates(
            Number(id),
            sighting.pendingPhotos,
            undefined,
            true // skipProcessing
          );
          // Photos now exist server-side: fold them into existingImageIds and
          // clear pendingPhotos so a retry never re-uploads them. They are
          // attached to the sighting by the update/add call below.
          sighting.existingImageIds = [
            ...(sighting.existingImageIds || []),
            ...uploaded.map((img) => img.id),
          ];
          sighting.pendingPhotos = [];
        }

        // Compute final image_ids (existing + already-uploaded new, minus removed)
        const finalImageIds = allowSightingPhotoUpload
          ? (sighting.existingImageIds || []).filter(
              (imgId) => !(sighting.removedImageIds || []).includes(imgId)
            )
          : undefined;

        if (sighting.id) {
          // Update existing sighting
          await surveysAPI.updateSighting(Number(id), sighting.id, {
            species_id: sighting.species_id!,
            count: sighting.count,
            location_id: locationAtSightingLevel ? sighting.location_id : undefined,
            device_id: allowSightingDeviceSelection ? sighting.device_id : undefined,
            notes: sighting.notes,
            image_ids: finalImageIds,
          });

          // Image links are now committed server-side
          if (finalImageIds) {
            sighting.existingImageIds = finalImageIds;
            sighting.removedImageIds = [];
          }

          // Sync individual locations for this existing sighting
          // Find the original sighting to compare individuals
          const originalSighting = workingBaseline.find((s: any) => s.id === sighting.id);
          const originalIndividuals = originalSighting?.individuals || [];
          const currentIndividuals = sighting.individuals || [];

          // Find individuals to delete (in original but not in current)
          const currentIndividualIds = currentIndividuals
            .filter((ind) => ind.id)
            .map((ind) => ind.id);
          const individualsToDelete = originalIndividuals.filter(
            (ind: any) => ind.id && !currentIndividualIds.includes(ind.id)
          );

          // Delete removed individuals (tolerating already-deleted rows)
          await Promise.all(
            individualsToDelete.map(async (ind: any) => {
              try {
                await surveysAPI.deleteIndividualLocation(Number(id), sighting.id!, ind.id);
              } catch (err) {
                if (!isNotFound(err)) throw err;
              }
            })
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

          // Add new individuals (those without id). Use allSettled and assign
          // server ids to the ones that succeeded so a retry updates them
          // instead of re-adding duplicates.
          const newIndividuals = currentIndividuals.filter((ind) => !ind.id);
          const addIndividualResults = await Promise.allSettled(
            newIndividuals.map((ind) =>
              surveysAPI.addIndividualLocation(Number(id), sighting.id!, {
                latitude: ind.latitude,
                longitude: ind.longitude,
                count: ind.count,
                breeding_status_code: ind.breeding_status_code,
                notes: ind.notes,
                client_uuid: ind.client_uuid,
              })
            )
          );
          let firstAddIndividualError: unknown = null;
          addIndividualResults.forEach((result, idx) => {
            if (result.status === 'fulfilled') {
              newIndividuals[idx].id = result.value.id;
            } else if (firstAddIndividualError === null) {
              firstAddIndividualError = result.reason;
            }
          });
          if (firstAddIndividualError !== null) {
            throw firstAddIndividualError;
          }
        } else {
          // Add new sighting with individual locations. The client_uuid makes
          // a retried create return the existing row instead of duplicating.
          const created = await surveysAPI.addSighting(Number(id), {
            species_id: sighting.species_id!,
            count: sighting.count,
            location_id: locationAtSightingLevel ? sighting.location_id : undefined,
            device_id: allowSightingDeviceSelection ? sighting.device_id : undefined,
            notes: sighting.notes,
            client_uuid: sighting.client_uuid,
            individuals: sighting.individuals?.map((ind) => ({
              latitude: ind.latitude,
              longitude: ind.longitude,
              count: ind.count,
              breeding_status_code: ind.breeding_status_code,
              notes: ind.notes,
              client_uuid: ind.client_uuid,
            })),
            image_ids: finalImageIds,
          });

          // Record the server id (and individual ids) so a retry after a later
          // failure updates this sighting instead of creating a duplicate.
          sighting.id = created.id;
          if (sighting.individuals && created.individuals) {
            sighting.individuals.forEach((ind, idx) => {
              const serverInd = created.individuals[idx];
              if (serverInd?.id != null) {
                ind.id = serverInd.id;
              }
            });
          }
          if (finalImageIds) {
            sighting.existingImageIds = finalImageIds;
            sighting.removedImageIds = [];
          }
        }
      }

      // Success - return to the origin (surveys list, or the space we came from)
      saveCompleteRef.current = true;
      removeDraft();
      setPendingSync(false);
      const { to, toastHere } = returnAfterAction(returnTo, 'edited', Number(id));
      if (toastHere) toast.success('Survey updated successfully');
      navigate(to);
    } catch (err) {
      // Persist the reconciled draft: sightings created before the failure now
      // carry their server ids, uploaded photos are no longer pending, etc.
      setEditDraftSightings(workingDraft);

      // Refresh the baseline from the server so a retry diffs against what was
      // actually committed, and so Cancel shows the real current state.
      try {
        const [freshSurvey, freshSightings] = await Promise.all([
          surveysAPI.getById(Number(id)),
          surveysAPI.getSightings(Number(id)),
        ]);
        setSurvey(freshSurvey);
        setSightings(freshSightings);
        // Creates whose responses were lost still reached the server; the
        // fresh baseline carries their client_uuids, so adopt the server ids
        // and the retry updates those rows instead of re-creating them.
        setEditDraftSightings(adoptServerIds(workingDraft, freshSightings));
      } catch {
        // Re-fetch failed (likely the same outage). Fall back to the locally
        // reconciled baseline; 404-tolerant deletes cover any remaining drift.
        setSightings(workingBaseline);
      }

      if (isRetryableError(err)) {
        // Connectivity, not a real rejection: the draft is safe on this
        // device and the sync banner explains what happens next.
        setPendingSync(true);
        setError(null);
      } else {
        setPendingSync(false);
        setError(err instanceof Error ? err.message : 'Failed to update survey');
      }
      console.error('Error updating survey:', err);
      setSaving(false);
    }
  };
  handleSaveRef.current = handleSave;

  const discardEdits = () => {
    // Clear edit state and validation errors
    setShowCancelConfirm(false);
    removeDraft();
    setPendingSync(false);
    setEditDate(null);
    setEditLocationId(null);
    setEditSelectedSurveyors([]);
    setEditNotes('');
    setEditDraftSightings([]);
    setValidationErrors({});
    setError(null);
    setIsEditMode(false);
    setIsRecordMode(false);
  };

  const handleCancel = () => {
    // Cancelling dirty work needs a confirmation — on a phone in the field a
    // stray tap must not throw away recorded sightings.
    if (isDirty) setShowCancelConfirm(true);
    else discardEdits();
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

      // Success - return to the origin (surveys list, or the space we came from)
      const { to, toastHere } = returnAfterAction(returnTo, 'deleted', Number(id));
      if (toastHere) toast.error('Survey deleted successfully');
      navigate(to);
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
    <Box sx={{ p: SPACING.PAGE_PADDING }}>
      {/* Page Header */}
      <PageHeader
        backButton={{ label: `Back to ${returnTo.label}`, href: returnToHref(returnTo) }}
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
                    (requiresSurveyors && editSelectedSurveyors.length === 0)
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
                  ) : isRecording ? (
                    'Save & mark recorded'
                  ) : (
                    'Save Survey'
                  )}
                </Button>
              </Stack>
            ) : canEditSurveys ? (
              <Stack direction="row" spacing={1}>
                {survey?.status === 'scheduled' && (
                  <Button
                    variant="contained"
                    startIcon={<Add />}
                    onClick={handleRecordClick}
                    sx={{
                      textTransform: 'none',
                      fontWeight: 600,
                      boxShadow: 'none',
                      '&:hover': { boxShadow: 'none' },
                    }}
                  >
                    Record survey
                  </Button>
                )}
                <Button
                  variant={survey?.status === 'scheduled' ? 'outlined' : 'contained'}
                  startIcon={<Edit />}
                  onClick={handleEditClick}
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
                  onClick={handleDeleteClick}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 600,
                    boxShadow: 'none',
                  }}
                >
                  Delete
                </Button>
              </Stack>
            ) : null}
          </>
        }
      />

      {/* Error Alert */}
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Field-entry sync status: offline notice, pending upload, local backup */}
      {isEditMode && (
        <SyncStatusBanner
          online={online}
          pendingSync={pendingSync}
          saving={saving}
          draftSavedAt={isDirty ? draftSavedAt : null}
          onSyncNow={handleSave}
        />
      )}

      {/* Survey Type Description Banner */}
      {showDescription && (
        <Alert severity="info" sx={{ mb: 3 }}>
          {surveyType!.description}
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
            {isRecording ? 'Record Survey' : isEditMode ? 'Survey Details' : 'Survey Information'}
          </Typography>

          {isEditMode ? (
            <SurveyFormFields
              date={editDate}
              locationId={editLocationId}
              selectedSurveyors={editSelectedSurveyors}
              notes={editNotes}
              startTime={editStartTime}
              endTime={editEndTime}
              sunPercentage={editSunPercentage}
              temperatureCelsius={editTemperatureCelsius}
              locations={locations}
              surveyors={surveyors}
              onDateChange={setEditDate}
              onLocationChange={setEditLocationId}
              onSurveyorsChange={setEditSelectedSurveyors}
              onNotesChange={setEditNotes}
              onStartTimeChange={setEditStartTime}
              onEndTimeChange={setEditEndTime}
              onSunPercentageChange={setEditSunPercentage}
              onTemperatureCelsiusChange={setEditTemperatureCelsius}
              validationErrors={validationErrors}
              hideLocation={locationAtSightingLevel || locations.length === 0}
              showStartEndTime={showStartEndTime}
              showSunPercentage={showSunPercentage}
              showTemperature={showTemperature}
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

              {/* Location - only show if NOT at sighting level and a location was saved */}
              {!locationAtSightingLevel && survey.location_id != null && (
                <>
                  <Divider />

                  <Box>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                      <LocationOn sx={{ fontSize: 18, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary" fontWeight={500}>
                        Location
                      </Typography>
                    </Stack>
                    <Typography variant="body1">{survey.location_name ?? 'Unknown'}</Typography>
                  </Box>
                </>
              )}

              {/* Start/End Time */}
              {showStartEndTime && (survey.start_time || survey.end_time) && (
                <>
                  <Divider />
                  <Box>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                      <AccessTime sx={{ fontSize: 18, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary" fontWeight={500}>
                        Time
                      </Typography>
                    </Stack>
                    <Typography variant="body1">
                      {survey.start_time ? dayjs(survey.start_time, 'HH:mm:ss').format('HH:mm') : '—'}
                      {' — '}
                      {survey.end_time ? dayjs(survey.end_time, 'HH:mm:ss').format('HH:mm') : '—'}
                    </Typography>
                  </Box>
                </>
              )}

              {/* Temperature */}
              {showTemperature && survey.temperature_celsius != null && (
                <>
                  <Divider />
                  <Box>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                      <Thermostat sx={{ fontSize: 18, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary" fontWeight={500}>
                        Temperature
                      </Typography>
                    </Stack>
                    <Typography variant="body1">{survey.temperature_celsius}{'\u00B0C'}</Typography>
                  </Box>
                </>
              )}

              {/* Sun Percentage */}
              {showSunPercentage && survey.sun_percentage != null && (
                <>
                  <Divider />
                  <Box>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                      <WbSunny sx={{ fontSize: 18, color: 'text.secondary' }} />
                      <Typography variant="body2" color="text.secondary" fontWeight={500}>
                        Sun
                      </Typography>
                    </Stack>
                    <Typography variant="body1">{survey.sun_percentage}%</Typography>
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

        {/* Sightings Section — a scheduled survey has no sightings, so the
            section only appears when recording it (or once it's completed).
            Entering sightings IS recording; a plain edit of a scheduled
            survey is for fixing the plan, not writing up results. */}
        {(isRecording || survey.status !== 'scheduled') && (
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
              allowSightingPhotoUpload={allowSightingPhotoUpload}
              allowSightingDeviceSelection={allowSightingDeviceSelection}
              devices={visibleDevices}
              surveyLocationId={editLocationId}
            />
          ) : (
            <>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Sightings ({sightings.length})
                </Typography>
                {canShowSightingsMap && (
                  <ViewModeToggle value={viewMode} onChange={setViewMode} />
                )}
              </Stack>

              {/* Map Mode View */}
              {viewMode === 'map' && canShowSightingsMap ? (
                <MapModeSightings
                  sightings={sightings.map((s: any) => ({
                    tempId: `view-${s.id}`,
                    species_id: s.species_id,
                    count: s.count,
                    id: s.id,
                    device_id: s.device_id,
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
                  devices={visibleDevices}
                  allowSightingDeviceSelection={allowSightingDeviceSelection}
                />
              ) : (
              /* Sightings Table */
              (() => {
                // In view mode, only show the notes column if at least one sighting
                // actually has notes — an empty column for a survey type that allows
                // notes but has none recorded is just dead space.
                const showNotesColumn = allowSightingNotes && sightings.some(
                  (s: any) => s.notes && String(s.notes).trim() !== ''
                );

                const gridConfig = getSightingsGridConfig({
                  locationAtSightingLevel,
                  allowGeolocation,
                  allowSightingDeviceSelection,
                  showNotesColumn,
                  includeDeleteColumn: false,
                });
                const { gridColumns } = gridConfig;

                const getDeviceLabel = (deviceId: number | null | undefined): string => {
                  if (deviceId == null) return '-';
                  const d = devices.find((x) => x.id === deviceId);
                  return d ? d.name : '-';
                };

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
                    {gridConfig.showDevice && (
                      <Typography variant="body2" fontWeight={600} color="text.secondary">
                        DEVICE
                      </Typography>
                    )}
                    {gridConfig.showLocation && (
                      <Typography variant="body2" fontWeight={600} color="text.secondary">
                        LOCATION
                      </Typography>
                    )}
                    {gridConfig.showGps && (
                      <Typography variant="body2" fontWeight={600} color="text.secondary" textAlign="center">
                        GPS
                      </Typography>
                    )}
                    {gridConfig.showSpacer && (
                      <Box /> // Empty spacer
                    )}
                    <Typography variant="body2" fontWeight={600} color="text.secondary">
                      COUNT
                    </Typography>
                    {showNotesColumn && (
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

                              {/* Device Column - when sighting attaches to a device */}
                              {gridConfig.showDevice && (
                                <Typography variant="body2" sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
                                  {getDeviceLabel(sighting.device_id)}
                                </Typography>
                              )}

                              {/* Location Column - when location is at sighting level */}
                              {gridConfig.showLocation && (
                                <Typography variant="body2" sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
                                  {sighting.location_name || '-'}
                                </Typography>
                              )}

                              {/* GPS Column - for individual geolocation */}
                              {gridConfig.showGps && (
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
                              {gridConfig.showSpacer && (
                                <Box /> // Empty spacer
                              )}

                              {/* Count Column */}
                              <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.875rem' }}>
                                {sighting.count}
                              </Typography>

                              {/* Notes Column — only rendered when at least one sighting has notes */}
                              {showNotesColumn && (
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
                                    timestamp={clip.detection_timestamp}
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
        )}

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
              Are you sure you want to delete this survey from {formatDate(survey.date)} at {survey.location_name ?? 'Unknown'}?
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

        {/* Unsaved entries found on this device from an earlier session */}
        {resumeDraft !== null && (
          <ResumeDraftDialog
            open
            savedAt={resumeDraft.savedAt}
            onResume={handleResumeDraft}
            onDiscard={handleDiscardDraft}
          />
        )}

        {/* Confirm before Cancel throws away dirty edits */}
        <UnsavedChangesDialog
          open={showCancelConfirm}
          onKeepWorking={() => setShowCancelConfirm(false)}
          onDiscard={discardEdits}
        />

        {/* Confirm before navigating away from dirty edits */}
        <UnsavedChangesDialog
          open={blocker.state === 'blocked'}
          onKeepWorking={() => blocker.reset?.()}
          onDiscard={() => {
            removeDraft();
            setPendingSync(false);
            blocker.proceed?.();
          }}
        />
    </Box>
  );
}
