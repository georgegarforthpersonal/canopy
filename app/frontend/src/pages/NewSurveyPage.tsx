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
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, usePermissions } from '../context/AuthContext';
import { hasPositiveStageCounts, pickStageCounts, stageCountErrors } from '../config/stageCounts';
import { frequencyScoreErrors, pickFrequencyScore } from '../config/frequencyScore';
import { AccessNotice } from '../components/auth/AccessNotice';
import {
  surveysAPI,
  surveyorsAPI,
  locationsAPI,
  speciesAPI,
  surveyTypesAPI,
  imagesAPI,
  devicesAPI,
  isRetryableError,
} from '../services/api';
import type {
  Survey,
  Location,
  Surveyor,
  Species,
  BreedingStatusCode,
  LocationWithBoundary,
  SurveyType,
  Device,
} from '../services/api';
import { readReturnTo, returnToHref } from '../utils/returnTo';
import { SurveyFormFields, hasTimeValidationError } from '../components/surveys/SurveyFormFields';
import { SightingsEditor } from '../components/surveys/SightingsEditor';
import type { DraftSighting } from '../components/surveys/SightingsEditor';
import { PageHeader } from '../components/layout/PageHeader';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';
import { ResumeDraftDialog } from '../components/surveys/ResumeDraftDialog';
import { SyncStatusBanner } from '../components/surveys/SyncStatusBanner';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { useResponsive } from '../hooks/useResponsive';
import { scopeBoundariesToLocations } from '../utils/scopeBoundaries';
import { useDraftAutosave, useOnlineStatus, useSyncRetry, useWakeLock } from '../hooks';
import { downscalePhotos } from '../utils/downscalePhoto';
import {
  loadSurveyDraft,
  deleteSurveyDraft,
  saveSurveyDraft,
  NEW_SURVEY_DRAFT_KEY,
} from '../services/draftStore';
import type { SurveyDraftRecord } from '../services/draftStore';
import { ensureClientUuids, fileKey, mintClientUuid } from '../utils/surveyDraftSync';
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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // Where Cancel goes and where the detail page's back button points after
  // save — a group page when the record CTA got us here, else the surveys list.
  const returnTo = readReturnTo(location);
  const { isLoading: authLoading } = useAuth();
  const { canEditSurveys } = usePermissions();
  const { isMobile } = useResponsive();

  // Group record flow: ?survey_type_id=N preselects the type (still
  // changeable). Media types never link here — their record CTAs go straight
  // to the wizards — so they're ignored rather than re-dispatched.
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

  // Deliberately NOT defaulted to today: the date decides which scheduled
  // week the survey fulfils (the backend links by window), so it must be the
  // surveyor's statement of when the survey happened, never our guess.
  const [date, setDate] = useState<Dayjs | null>(null);
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
  // Unsaved Changes Guard + Field Resilience (local draft, retryable save)
  // ============================================================================

  // Flipped synchronously just before the post-save navigation so the
  // unsaved-changes guard does not block it (state would be one render stale).
  const saveCompleteRef = useRef(false);

  // Location preselected because the survey type has exactly one — not a user
  // edit, so it alone must not make the unsaved-changes guard fire.
  const autoLocationIdRef = useRef<number | null>(null);

  // Set when a save failed on connectivity: entries are safe on this device
  // and the save re-runs automatically when the connection returns.
  const [pendingSync, setPendingSync] = useState(false);
  // What the last failed upload attempt said (only shown while pendingSync).
  const [syncErrorDetail, setSyncErrorDetail] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  // A stored draft found on load, awaiting the user's resume/discard choice.
  const [resumeDraft, setResumeDraft] = useState<SurveyDraftRecord | null>(null);
  // Autosave must stay disarmed until the stored-draft check has resolved and
  // any resume offer has been answered — otherwise the near-empty current
  // form overwrites the very draft being offered for resume.
  const [draftCheckComplete, setDraftCheckComplete] = useState(false);
  // The draft the user chose to resume; fetches that complete afterwards
  // re-apply its id-based fields instead of resetting the form.
  const appliedDraftRef = useRef<SurveyDraftRecord | null>(null);
  const online = useOnlineStatus();
  // Idempotency uuid for the survey create; survives retries (and reloads,
  // via the stored draft) so a re-sent create can never duplicate the survey.
  const surveyClientUuidRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  savingRef.current = saving;
  const handleSaveRef = useRef<() => void>(() => {});

  // Dirty once the user has entered anything beyond the defaults, until the
  // survey is saved. Drives the local draft backup, and blocks Cancel, the
  // back link, and browser back via the confirmation dialog below.
  const isDirty =
    !saveCompleteRef.current &&
    (notes.trim() !== '' ||
      pendingImageFiles.length > 0 ||
      (locationId !== null && locationId !== autoLocationIdRef.current) ||
      selectedSurveyors.length > 0 ||
      // Date, times and conditions count too — a date-only or times-only
      // entry is still work worth guarding and backing up.
      date !== null ||
      startTime !== null ||
      endTime !== null ||
      sunPercentage !== '' ||
      temperatureCelsius !== '' ||
      draftSightings.some((s) => s.species_id !== null));
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;

  // saveCompleteRef is read live (not via isDirtyRef, which is one render
  // stale) so the synchronous post-save navigate() is never blocked.
  const blocker = useUnsavedChangesGuard(
    () => !saveCompleteRef.current && isDirtyRef.current,
  );

  const activeDraft: SurveyDraftRecord | null = isDirty && draftCheckComplete && resumeDraft === null
    ? {
        key: NEW_SURVEY_DRAFT_KEY,
        savedAt: 0,
        mode: 'new',
        form: {
          date: date?.isValid() ? date.format('YYYY-MM-DD') : null,
          locationId,
          surveyorIds: selectedSurveyors.map((s) => s.id),
          notes,
          startTime: startTime?.isValid() ? startTime.format('HH:mm:ss') : null,
          endTime: endTime?.isValid() ? endTime.format('HH:mm:ss') : null,
          sunPercentage,
          temperatureCelsius,
          surveyTypeId: selectedSurveyType?.id ?? null,
        },
        sightings: draftSightings,
        pendingImageFiles: pendingImageFiles.length > 0 ? pendingImageFiles : undefined,
        surveyClientUuid: surveyClientUuidRef.current ?? undefined,
      }
    : null;
  const { clearDraft } = useDraftAutosave(activeDraft, setDraftSavedAt);

  /** Delete the stored draft and stop autosaving for this session. */
  const removeDraft = () => {
    clearDraft();
    deleteSurveyDraft(NEW_SURVEY_DRAFT_KEY).catch(() => {});
  };

  // No Background Sync on iOS: retries happen in the foreground, when the
  // connection returns or the app becomes visible (plus the Sync now button).
  useSyncRetry(pendingSync, () => {
    if (!savingRef.current) handleSaveRef.current();
  });

  // Keep the screen awake during entry, like a navigation app mid-route —
  // phones otherwise dim and lock mid-transect.
  useWakeLock(true);

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
        const [surveyTypesData, surveyorsData, breedingCodesData, boundariesData] = await Promise.all([
          surveyTypesAPI.getAll(),
          surveyorsAPI.getAll(),
          surveysAPI.getBreedingCodes(),
          locationsAPI.getAllWithBoundaries(),
        ]);

        setSurveyTypes(surveyTypesData);
        setSurveyors(surveyorsData);
        setBreedingCodes(breedingCodesData);
        setLocationsWithBoundaries(boundariesData);

        // The component survives in-app navigation between different
        // /surveys/new links, so the preset must be re-applied (or unwound),
        // not just set once.
        const preset = presetTypeIdParam
          ? surveyTypesData.find(
              (t) =>
                t.id === Number(presetTypeIdParam) &&
                !t.allow_image_upload &&
                !t.allow_audio_upload,
            ) ?? null
          : null;
        // If a draft was already resumed (the check runs independently of
        // these fetches), re-apply its id-based fields now that the lists
        // exist, instead of resetting the form under the user.
        const applied = appliedDraftRef.current;
        if (applied) {
          setSelectedSurveyType(
            surveyTypesData.find((t) => t.id === applied.form.surveyTypeId) ?? null,
          );
          setSelectedSurveyors(
            surveyorsData.filter((s) => applied.form.surveyorIds.includes(s.id)),
          );
        } else {
          setSelectedSurveyType(preset);
          setDate(null);
          setLocationId(null);
          autoLocationIdRef.current = null;
          setSelectedSurveyors([]);
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
  }, [presetTypeIdParam]);

  // A stored draft means a survey was being entered on this device and never
  // uploaded (tab killed, failed save). The check is independent of the
  // network fetches above so the resume offer appears even when they fail —
  // offline is exactly when the draft matters.
  useEffect(() => {
    let cancelled = false;
    loadSurveyDraft(NEW_SURVEY_DRAFT_KEY)
      .then((storedDraft) => {
        if (!cancelled && storedDraft) setResumeDraft(storedDraft);
      })
      .catch(() => {
        // Local storage unavailable (e.g. private browsing) — nothing to resume.
      })
      .finally(() => {
        if (!cancelled) setDraftCheckComplete(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

    // If location at sighting level, check that each sighting has a location.
    // A zero-adult row still counts when positive breeding evidence carries it.
    const validSightings = draftSightings.filter(
      (s) => s.species_id !== null && (s.count > 0 || hasPositiveStageCounts(pickStageCounts(s)))
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

    // Stage counts contradicting the adult total are impossible by definition
    // (only dragonfly sightings carry them; everything else has none).
    if (!errors.sightings) {
      const stageErrs = validSightings.flatMap((s) => [
        ...stageCountErrors(pickStageCounts(s), s.count),
        ...frequencyScoreErrors(pickFrequencyScore(s)),
      ]);
      if (stageErrs.length > 0) {
        errors.sightings = stageErrs[0];
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
  // Draft Resume
  // ============================================================================

  const handleResumeDraft = () => {
    if (!resumeDraft) return;
    const d = resumeDraft;
    // In-flight initial fetches re-apply the id-based fields from this ref
    // when they land, instead of resetting the form under the user.
    appliedDraftRef.current = d;
    // Setting the survey type directly (not via handleSurveyTypeChange) skips
    // the wizard redirects; drafts only exist for the plain form. The
    // type-change effect then re-fetches locations/species and re-validates
    // the restored location and species ids against them.
    setSelectedSurveyType(surveyTypes.find((t) => t.id === d.form.surveyTypeId) ?? null);
    setDate(d.form.date ? dayjs(d.form.date) : null);
    setLocationId(d.form.locationId);
    setSelectedSurveyors(surveyors.filter((s) => d.form.surveyorIds.includes(s.id)));
    setNotes(d.form.notes);
    setStartTime(d.form.startTime ? dayjs(d.form.startTime, 'HH:mm:ss') : null);
    setEndTime(d.form.endTime ? dayjs(d.form.endTime, 'HH:mm:ss') : null);
    setSunPercentage(d.form.sunPercentage);
    setTemperatureCelsius(d.form.temperatureCelsius);
    setDraftSightings(
      d.sightings.length > 0
        ? d.sightings
        : [{ tempId: `temp-${Date.now()}`, species_id: null, count: 1 }]
    );
    setPendingImageFiles(d.pendingImageFiles ?? []);
    if (d.surveyClientUuid) surveyClientUuidRef.current = d.surveyClientUuid;
    setResumeDraft(null);
  };

  const handleDiscardDraft = () => {
    deleteSurveyDraft(NEW_SURVEY_DRAFT_KEY).catch(() => {});
    setResumeDraft(null);
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

    // Idempotency uuids for everything this save will create, minted once and
    // persisted to the local draft BEFORE any request: a retry — even after a
    // reload — re-sends the same uuids, so the server never duplicates the
    // survey or its sightings.
    surveyClientUuidRef.current = surveyClientUuidRef.current ?? mintClientUuid();
    const sightingsWithUuids = ensureClientUuids(draftSightings);
    setDraftSightings(sightingsWithUuids);
    if (activeDraft) {
      await saveSurveyDraft({
        ...activeDraft,
        savedAt: Date.now(),
        sightings: sightingsWithUuids,
        surveyClientUuid: surveyClientUuidRef.current,
      }).catch(() => {});
    }

    try {
      const surveyData: Partial<Survey> & { survey_type_id?: number } = {
        date: date!.format('YYYY-MM-DD'),
        surveyor_ids: selectedSurveyors.map((s) => s.id),
        notes: notes.trim() || null,
        survey_type_id: selectedSurveyType?.id,
        // Never set here: the backend links the survey to the open slot
        // whose window contains its date.
        scheduled_survey_id: null,
        start_time: startTime?.isValid() ? startTime.format('HH:mm:ss') : null,
        end_time: endTime?.isValid() ? endTime.format('HH:mm:ss') : null,
        sun_percentage: sunPercentage !== '' ? Number(sunPercentage) : null,
        temperature_celsius: temperatureCelsius !== '' ? temperatureCelsius : null,
        client_uuid: surveyClientUuidRef.current,
      };

      // Only include location_id if NOT at sighting level
      if (!selectedSurveyType?.location_at_sighting_level) {
        surveyData.location_id = locationId ?? undefined;
      }

      const validSightings = sightingsWithUuids.filter(
        (s) => s.species_id !== null && (s.count > 0 || hasPositiveStageCounts(pickStageCounts(s)))
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
              const uploaded = await imagesAPI.uploadFilesRecoveringDuplicates(
                surveyId,
                // Shrunk client-side so a save doesn't hang on flaky signal
                await downscalePhotos(sighting.pendingPhotos!),
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
              ...pickStageCounts(sighting),
              ...pickFrequencyScore(sighting),
              // Retried creates with the same uuid return the existing row
              client_uuid: sighting.client_uuid,
              // Include individual locations with count and breeding status codes
              individuals: sighting.individuals?.map((ind) => ({
                latitude: ind.latitude,
                longitude: ind.longitude,
                count: ind.count,
                breeding_status_code: ind.breeding_status_code,
                notes: ind.notes,
                client_uuid: ind.client_uuid,
              })),
              image_ids: sightingPhotoMap.get(sighting.tempId),
            }).then(() => {
              resume.createdSightingTempIds.add(sighting.tempId);
            })
          )
      );

      // Step 4: Upload image files if any (for camera trap surveys)
      if (pendingImageFiles.length > 0 && !resume.surveyImagesUploaded) {
        await imagesAPI.uploadFilesRecoveringDuplicates(surveyId, pendingImageFiles);
        resume.surveyImagesUploaded = true;
      }

      // Success — land on the survey just recorded (the flat list and its
      // ?created highlight are retired where Groups covers the org). The
      // origin rides along so the detail page's back button returns there.
      saveCompleteRef.current = true;
      saveResumeRef.current = emptySaveResumeState();
      surveyClientUuidRef.current = null;
      removeDraft();
      setPendingSync(false);
      navigate(`/surveys/${surveyId}`, { state: { returnTo } });
    } catch (err) {
      if (isRetryableError(err)) {
        // Connectivity, not a real rejection: everything is stored on this
        // device and the sync banner explains what happens next — including
        // what the last attempt said, so a repeating failure isn't invisible.
        setPendingSync(true);
        setSyncErrorDetail(err instanceof Error ? err.message : String(err));
        setError(null);
      } else {
        setPendingSync(false);
        const message = err instanceof Error ? err.message : 'Failed to create survey';
        setError(
          saveResumeRef.current.surveyId != null
            ? `${message} — click "Save Survey" again to retry; it will resume where it left off.`
            : message
        );
      }
      console.error('Error creating survey:', err);
      setSaving(false);
    }
  };
  handleSaveRef.current = handleSave;

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleCancel = () => {
    navigate(returnToHref(returnTo));
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
  const allowFrequencyScore = selectedSurveyType?.allow_frequency_score ?? false;
  const showStartEndTime = selectedSurveyType?.allow_start_end_time ?? false;
  const showSunPercentage = selectedSurveyType?.allow_sun_percentage ?? false;
  const showTemperature = selectedSurveyType?.allow_temperature ?? false;

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
                'Save survey'
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

      {/* Field-entry sync status: offline notice, pending upload, local backup */}
      <SyncStatusBanner
        online={online}
        pendingSync={pendingSync}
        saving={saving}
        draftSavedAt={isDirty ? draftSavedAt : null}
        errorDetail={syncErrorDetail}
        onSyncNow={handleSave}
      />

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
          // A required single choice is a picker, not a text box: no clear ✕
          // (you change the value by picking another, never to empty) and no
          // select-on-focus text highlight (that affordance exists to retype
          // over a value, which a picker doesn't do).
          disableClearable={selectedSurveyType !== null}
          selectOnFocus={false}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Survey Type"
              required
              error={!!validationErrors.surveyType}
              helperText={validationErrors.surveyType}
              // A handful of options needs no typing: read-only on mobile so
              // tapping opens the list without summoning the keyboard.
              inputProps={{ ...params.inputProps, readOnly: isMobile }}
              sx={{
                '& .MuiInputBase-input': isMobile
                  ? { cursor: 'pointer', userSelect: 'none', caretColor: 'transparent' }
                  : {},
              }}
            />
          )}
          isOptionEqualToValue={(option, value) => option.id === value.id}
        />
      </Paper>


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
            // A single possible location is auto-selected, so a field offering
            // no choice would only be noise — hide it.
            hideLocation={locationAtSightingLevel || locations.length <= 1}
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
            allowFrequencyScore={allowFrequencyScore}
            allowSightingDeviceSelection={allowSightingDeviceSelection}
            devices={devices}
            surveyLocationId={locationId}
            recordMode={selectedSurveyType.record_mode}
          />
        </Paper>
      )}

      <UnsavedChangesDialog
        open={blocker.state === 'blocked'}
        onKeepWorking={() => blocker.reset?.()}
        onDiscard={() => {
          removeDraft();
          setPendingSync(false);
          blocker.proceed?.();
        }}
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
    </Box>
  );
}
