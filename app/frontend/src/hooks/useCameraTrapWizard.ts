import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import {
  surveysAPI,
  surveyorsAPI,
  speciesAPI,
  surveyTypesAPI,
  devicesAPI,
  imagesAPI,
} from '../services/api';
import type {
  Surveyor,
  Species,
  SurveyType,
  Device,
  CameraTrapImage,
  ImageFilterResult,
} from '../services/api';
import exifr from 'exifr';

// ============================================================================
// Types
// ============================================================================

export interface ImageFile {
  file: File;
  objectUrl: string;
  exifDate: Date | null;
  filename: string;
}

export interface Classification {
  speciesId: number;
  speciesName: string;
}

/** User override for a single image in the filter step */
export type FilterOverride = 'include' | 'exclude';

export const WIZARD_STEPS = ['Setup', 'Upload', 'Filter', 'Classify', 'Review', 'Save'] as const;

const UPLOAD_BATCH_SIZE = 10;
// Number of filter requests kept in flight at once. One request per image so
// each runs as its own Modal call; the pool gives Modal several to fan out
// across containers concurrently (mirrors PROCESS_CONCURRENCY in useAudioWizard).
const FILTER_CONCURRENCY = 6;

// ============================================================================
// Derived filter state — single-pass computation
// ============================================================================

interface FilterDerived {
  /** Images that pass the filter (for classification) */
  filteredFiles: ImageFile[];
  /** Maps filtered index -> original index in imageFiles */
  indexMapping: number[];
  /** Summary counts */
  summary: { animalCount: number; emptyCount: number; personCount: number };
  /** Check if an original index is included */
  isIncluded: (idx: number) => boolean;
  /** Original indices in the "animal" group */
  animalIndices: number[];
  /** Original indices in the "empty" group */
  emptyIndices: number[];
}

function computeFilterDerived(
  imageFiles: ImageFile[],
  filterResults: Map<number, ImageFilterResult>,
  overrides: Map<number, FilterOverride>,
): FilterDerived {
  const isIncluded = (idx: number): boolean => {
    const override = overrides.get(idx);
    if (override === 'exclude') return false;
    if (override === 'include') return true;
    const r = filterResults.get(idx);
    return r?.has_animal ?? true;
  };

  const filteredFiles: ImageFile[] = [];
  const indexMapping: number[] = [];
  const animalIndices: number[] = [];
  const emptyIndices: number[] = [];
  let animalCount = 0;
  let emptyCount = 0;
  let personCount = 0;

  imageFiles.forEach((img, idx) => {
    const hasResult = filterResults.has(idx);
    const included = filterResults.size === 0 || isIncluded(idx);

    if (included) {
      filteredFiles.push(img);
      indexMapping.push(idx);
    }

    if (hasResult) {
      if (included) {
        animalCount++;
        animalIndices.push(idx);
      } else {
        emptyCount++;
        emptyIndices.push(idx);
      }
      if (filterResults.get(idx)!.categories.includes('person')) {
        personCount++;
      }
    }
  });

  return {
    filteredFiles,
    indexMapping,
    summary: { animalCount, emptyCount, personCount },
    isIncluded,
    animalIndices,
    emptyIndices,
  };
}

// ============================================================================
// Save resume state
// ============================================================================

/**
 * Progress from a failed save attempt. Lets Retry resume where it left off
 * instead of creating a duplicate survey and re-uploading every image.
 */
interface SaveResumeState {
  /** Serialised save inputs; a mismatch means inputs changed, so start fresh */
  fingerprint: string;
  surveyId: number | null;
  /** original image index -> uploaded image record */
  uploadedImages: Map<number, CameraTrapImage>;
  /** species ids whose sighting has already been created */
  createdSightingSpecies: Set<number>;
}

function emptySaveResumeState(): SaveResumeState {
  return {
    fingerprint: '',
    surveyId: null,
    uploadedImages: new Map(),
    createdSightingSpecies: new Set(),
  };
}

// ============================================================================
// Hook
// ============================================================================

export function useCameraTrapWizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // ---- Wizard step ----
  const [activeStep, setActiveStep] = useState(0);

  // ---- Step 1: Setup ----
  const [surveyTypes, setSurveyTypes] = useState<SurveyType[]>([]);
  const [selectedSurveyType, setSelectedSurveyType] = useState<SurveyType | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [date, setDate] = useState<Dayjs | null>(dayjs());
  const [surveyors, setSurveyors] = useState<Surveyor[]>([]);
  const [selectedSurveyors, setSelectedSurveyors] = useState<Surveyor[]>([]);

  // ---- Step 2: Upload ----
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Step 3: Filter ----
  const [filterResults, setFilterResults] = useState<Map<number, ImageFilterResult>>(new Map());
  const [filtering, setFiltering] = useState(false);
  const [filterProgress, setFilterProgress] = useState({ processed: 0, total: 0 });
  const [filterOverrides, setFilterOverrides] = useState<Map<number, FilterOverride>>(new Map());
  const [filterError, setFilterError] = useState<string | null>(null);
  const [filterReviewGroup, setFilterReviewGroup] = useState<'animal' | 'empty' | null>(null);
  const [filterReviewIdx, setFilterReviewIdx] = useState(0);
  // Track which imageFiles the filter results correspond to (to detect re-selection)
  const [filteredImageSet, setFilteredImageSet] = useState<ImageFile[] | null>(null);
  // Whether the user skipped filtering (so returning to this step isn't a dead end)
  const [skippedFiltering, setSkippedFiltering] = useState(false);

  // ---- Step 4: Classify ----
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [classifications, setClassifications] = useState<Map<number, Classification[]>>(new Map());
  const [viewedImages, setViewedImages] = useState<Set<number>>(new Set());
  const [species, setSpecies] = useState<Species[]>([]);
  const [speciesSearchValue, setSpeciesSearchValue] = useState('');
  const speciesInputRef = useRef<HTMLInputElement>(null);
  const thumbnailStripRef = useRef<HTMLDivElement>(null);
  const [classifyViewerOpen, setClassifyViewerOpen] = useState(false);
  // Track which filtered images the classifications correspond to (to detect changes)
  const [classifiedImageSet, setClassifiedImageSet] = useState<ImageFile[] | null>(null);

  // ---- Detection box visibility (shared across Filter + Classify steps) ----
  const [showDetectionBoxes, setShowDetectionBoxes] = useState(true);
  const toggleDetectionBoxes = useCallback(() => setShowDetectionBoxes((v) => !v), []);

  // 'B' toggles boxes during Classify, or during Filter while the review modal is open
  useEffect(() => {
    const enabled = activeStep === 3 || (activeStep === 2 && filterReviewGroup !== null);
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        toggleDetectionBoxes();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeStep, filterReviewGroup, toggleDetectionBoxes]);

  // ---- Step 5: Review ----
  const [deselectedImages, setDeselectedImages] = useState<Set<string>>(new Set());

  // ---- Step 6: Save ----
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ step: '', percent: 0 });
  // Flipped synchronously just before the post-save navigation so the page's
  // unsaved-changes guard does not block it (state would be one render stale).
  const saveCompleteRef = useRef(false);
  const saveResumeRef = useRef<SaveResumeState>(emptySaveResumeState());
  const resetSaveResume = useCallback(() => {
    saveResumeRef.current = emptySaveResumeState();
  }, []);

  // ---- Shared ----
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ============================================================================
  // Derived filter state (single-pass)
  // ============================================================================

  const filterDerived = useMemo(
    () => computeFilterDerived(imageFiles, filterResults, filterOverrides),
    [imageFiles, filterResults, filterOverrides],
  );

  const { filteredFiles: filteredImageFiles, indexMapping: filteredToOriginalIndex } = filterDerived;

  // ============================================================================
  // Data fetching
  // ============================================================================

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [allSurveyTypes, allSurveyors, allDevices] = await Promise.all([
          surveyTypesAPI.getAll(),
          surveyorsAPI.getAll(),
          devicesAPI.getAll(false, 'camera_trap'),
        ]);
        const cameraTrapTypes = allSurveyTypes.filter((st) => st.allow_image_upload && st.is_active);
        setSurveyTypes(cameraTrapTypes);
        setSurveyors(allSurveyors);
        setDevices(allDevices);

        const typeId = searchParams.get('type');
        if (typeId) {
          const preselected = cameraTrapTypes.find((st) => st.id === Number(typeId));
          if (preselected) setSelectedSurveyType(preselected);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (!selectedSurveyType) {
      setSpecies([]);
      return;
    }
    speciesAPI.getBySurveyType(selectedSurveyType.id).then(setSpecies).catch(() => {
      setError('Failed to load species');
    });
  }, [selectedSurveyType]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      imageFiles.forEach((img) => URL.revokeObjectURL(img.objectUrl));
    };
  }, [imageFiles]);

  // ============================================================================
  // Step 2: File selection & EXIF extraction
  // ============================================================================

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setLoadingImages(true);
    setError(null);

    try {
      const imageFileList = Array.from(files).filter((f) => {
        const ext = f.name.toLowerCase().split('.').pop();
        return ['jpg', 'jpeg', 'png'].includes(ext || '');
      });

      if (imageFileList.length === 0) {
        setError('No valid image files found. Accepted formats: JPG, JPEG, PNG');
        setLoadingImages(false);
        return;
      }

      // Revoke old object URLs before replacing
      imageFiles.forEach((img) => URL.revokeObjectURL(img.objectUrl));

      const processed: ImageFile[] = [];
      const batchSize = 20;

      for (let i = 0; i < imageFileList.length; i += batchSize) {
        const batch = imageFileList.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (file) => {
            let exifDate: Date | null = null;
            try {
              const exif = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate']);
              exifDate = exif?.DateTimeOriginal || exif?.CreateDate || null;
            } catch {
              // No EXIF data
            }
            return {
              file,
              objectUrl: URL.createObjectURL(file),
              exifDate,
              filename: file.name,
            };
          })
        );
        processed.push(...results);
      }

      processed.sort((a, b) => {
        if (!a.exifDate && !b.exifDate) return a.filename.localeCompare(b.filename);
        if (!a.exifDate) return 1;
        if (!b.exifDate) return -1;
        return a.exifDate.getTime() - b.exifDate.getTime();
      });

      setImageFiles(processed);
      setClassifications(new Map());
      setViewedImages(new Set());
      setCurrentImageIndex(0);
      setDeselectedImages(new Set());
      setSkippedFiltering(false);
      resetSaveResume();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to process images');
    } finally {
      setLoadingImages(false);
    }
  }, [imageFiles, resetSaveResume]);

  // ============================================================================
  // Step 3: Filter logic
  // ============================================================================

  // Bumped to invalidate an in-flight filtering run (e.g. when the user skips)
  const filterRunRef = useRef(0);

  const runFiltering = useCallback(async () => {
    if (imageFiles.length === 0) return;

    const runId = ++filterRunRef.current;
    setFiltering(true);
    setFilterError(null);
    setSkippedFiltering(false);
    setFilterResults(new Map());
    setFilterOverrides(new Map());
    setFilterProgress({ processed: 0, total: imageFiles.length });

    try {
      // One request per image so each is its own Modal call; a small worker
      // pool keeps several in flight at once (the server just waits on
      // inference per request), mirroring the audio wizard's runProcessing.
      const results = new Map<number, ImageFilterResult>();
      let completed = 0;
      let nextIndex = 0;
      let failed = false;

      const worker = async () => {
        while (!failed && nextIndex < imageFiles.length) {
          const i = nextIndex++;
          try {
            const response = await imagesAPI.filterImages([imageFiles[i].file]);
            if (filterRunRef.current !== runId) return; // cancelled (skipped)
            const result = response.results[0];
            if (result) results.set(i, result);
          } catch (err) {
            failed = true;
            throw err;
          }
          completed++;
          setFilterProgress({ processed: completed, total: imageFiles.length });
          // Update results progressively so the UI fills in as images finish.
          setFilterResults(new Map(results));
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(FILTER_CONCURRENCY, imageFiles.length) },
          () => worker(),
        ),
      );
      if (filterRunRef.current !== runId) return; // cancelled (skipped)

      setFilteredImageSet(imageFiles);
    } catch (err: unknown) {
      if (filterRunRef.current === runId) {
        setFilterError(err instanceof Error ? err.message : 'Failed to filter images');
      }
    } finally {
      if (filterRunRef.current === runId) {
        setFiltering(false);
      }
    }
  }, [imageFiles]);

  // Start filtering when entering the Filter step (only if images changed or no results)
  useEffect(() => {
    if (activeStep !== 2 || filtering || filterError) return;
    if (imageFiles.length === 0) return;
    // Only re-run if images changed since last filter run
    const needsRun = filteredImageSet !== imageFiles;
    if (needsRun) {
      runFiltering();
    }
  }, [activeStep, filtering, filterError, imageFiles, filteredImageSet, runFiltering]);

  const toggleFilterOverride = useCallback((origIdx: number, action: 'include' | 'exclude') => {
    setFilterOverrides((prev) => {
      const next = new Map(prev);
      if (next.get(origIdx) === action) {
        // Toggle off — revert to AI decision
        next.delete(origIdx);
      } else {
        next.set(origIdx, action);
      }
      return next;
    });
  }, []);


  // ============================================================================
  // Step 4: Classification helpers
  // ============================================================================

  // Scroll thumbnail strip to keep current image centred
  useEffect(() => {
    if (activeStep === 3 && thumbnailStripRef.current) {
      const container = thumbnailStripRef.current;
      const thumbWidth = 56 + 4;
      const scrollTarget = currentImageIndex * thumbWidth - container.clientWidth / 2 + thumbWidth / 2;
      container.scrollTo({ left: scrollTarget, behavior: 'smooth' });
    }
  }, [currentImageIndex, activeStep]);

  // Focus species input when image changes
  useEffect(() => {
    if (activeStep === 3) {
      const timer = setTimeout(() => speciesInputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [currentImageIndex, activeStep]);

  // Mark current image as viewed
  useEffect(() => {
    if (activeStep === 3 && filteredImageFiles.length > 0) {
      setViewedImages((prev) => {
        if (prev.has(currentImageIndex)) return prev;
        const next = new Set(prev);
        next.add(currentImageIndex);
        return next;
      });
    }
  }, [currentImageIndex, activeStep, filteredImageFiles.length]);

  // Reset classification state when entering Classify (only if the image set changed
  // since classifications were built — mirrors the filteredImageSet pattern above)
  useEffect(() => {
    if (activeStep !== 3) return;
    if (classifiedImageSet === filteredImageFiles) return;
    setClassifiedImageSet(filteredImageFiles);
    setCurrentImageIndex(0);
    setClassifications(new Map());
    setViewedImages(new Set());
    setDeselectedImages(new Set());
    resetSaveResume();
  }, [activeStep, classifiedImageSet, filteredImageFiles, resetSaveResume]);

  const findNextUnviewed = useCallback((fromIndex: number): number | null => {
    for (let i = fromIndex + 1; i < filteredImageFiles.length; i++) {
      if (!viewedImages.has(i)) return i;
    }
    for (let i = 0; i < fromIndex; i++) {
      if (!viewedImages.has(i)) return i;
    }
    return null;
  }, [viewedImages, filteredImageFiles.length]);

  const classifyImage = useCallback(
    (speciesId: number, speciesName: string) => {
      const originalIndex = filteredToOriginalIndex[currentImageIndex];
      setClassifications((prev) => {
        const next = new Map(prev);
        const existing = next.get(originalIndex) || [];
        if (existing.some((c) => c.speciesId === speciesId)) return prev;
        next.set(originalIndex, [...existing, { speciesId, speciesName }]);
        return next;
      });
      setSpeciesSearchValue('');
    },
    [currentImageIndex, filteredToOriginalIndex],
  );

  const removeClassification = useCallback((origIdx: number, speciesId: number) => {
    setClassifications((prev) => {
      const next = new Map(prev);
      const existing = next.get(origIdx) || [];
      const filtered = existing.filter((c) => c.speciesId !== speciesId);
      if (filtered.length === 0) {
        next.delete(origIdx);
      } else {
        next.set(origIdx, filtered);
      }
      return next;
    });
  }, []);

  const goToPrev = useCallback(() => {
    setCurrentImageIndex((prev) => Math.max(0, prev - 1));
    setSpeciesSearchValue('');
  }, []);

  const goToNext = useCallback(() => {
    setCurrentImageIndex((prev) => Math.min(filteredImageFiles.length - 1, prev + 1));
    setSpeciesSearchValue('');
  }, [filteredImageFiles.length]);

  const goToNextUnviewed = useCallback(() => {
    const next = findNextUnviewed(currentImageIndex);
    if (next !== null) {
      setCurrentImageIndex(next);
      setSpeciesSearchValue('');
    }
  }, [currentImageIndex, findNextUnviewed]);

  // ============================================================================
  // Step 5: Review computed data
  // ============================================================================

  const reviewData = useMemo(() => {
    const speciesMap = new Map<number, { speciesName: string; imageIndices: number[] }>();

    classifications.forEach((speciesList, imageIndex) => {
      speciesList.forEach((value) => {
        const existing = speciesMap.get(value.speciesId);
        if (existing) {
          if (!existing.imageIndices.includes(imageIndex)) {
            existing.imageIndices.push(imageIndex);
          }
        } else {
          speciesMap.set(value.speciesId, {
            speciesName: value.speciesName,
            imageIndices: [imageIndex],
          });
        }
      });
    });

    return Array.from(speciesMap.entries()).map(([speciesId, data]) => ({
      speciesId,
      speciesName: data.speciesName,
      imageIndices: data.imageIndices,
    }));
  }, [classifications]);

  const selectedImageCount = useMemo(() => {
    let count = 0;
    reviewData.forEach(({ speciesId, imageIndices }) => {
      imageIndices.forEach((idx) => {
        const key = `${speciesId}-${idx}`;
        if (!deselectedImages.has(key)) count++;
      });
    });
    return count;
  }, [reviewData, deselectedImages]);

  const toggleImageSelection = useCallback((speciesId: number, imageIndex: number) => {
    const key = `${speciesId}-${imageIndex}`;
    setDeselectedImages((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // ============================================================================
  // Step 6: Save
  // ============================================================================

  const handleSave = useCallback(async () => {
    if (!selectedSurveyType || !selectedDevice || !date) return;

    setSaving(true);
    setError(null);

    // Resume a previous failed attempt only if the save inputs are unchanged.
    // (New files / redone classification already reset the ref directly.)
    const fingerprint = JSON.stringify({
      date: date.format('YYYY-MM-DD'),
      surveyTypeId: selectedSurveyType.id,
      deviceId: selectedDevice.id,
      surveyorIds: selectedSurveyors.map((s) => s.id),
      review: reviewData.map(({ speciesId, imageIndices }) => [speciesId, imageIndices]),
      deselectedImages: Array.from(deselectedImages).sort(),
    });
    if (saveResumeRef.current.fingerprint !== fingerprint) {
      resetSaveResume();
      saveResumeRef.current.fingerprint = fingerprint;
    }
    const resume = saveResumeRef.current;

    try {
      // Create survey (skipped on retry if it already succeeded)
      let surveyId = resume.surveyId;
      if (surveyId == null) {
        setSaveProgress({ step: 'Creating survey...', percent: 5 });
        try {
          const survey = await surveysAPI.create({
            date: date.format('YYYY-MM-DD'),
            survey_type_id: selectedSurveyType.id,
            device_id: selectedDevice.id,
            surveyor_ids: selectedSurveyors.map((s) => s.id),
          });
          surveyId = survey.id;
        } catch (createErr: unknown) {
          throw new Error(`Failed to create survey: ${createErr instanceof Error ? createErr.message : String(createErr)}`);
        }
        resume.surveyId = surveyId;
      }

      const imageIndicesToUpload = new Set<number>();
      reviewData.forEach(({ speciesId, imageIndices }) => {
        imageIndices.forEach((idx) => {
          const key = `${speciesId}-${idx}`;
          if (!deselectedImages.has(key)) {
            imageIndicesToUpload.add(idx);
          }
        });
      });

      // Images uploaded by a previous failed attempt are skipped — their
      // records are already in resume.uploadedImages, keyed by original index.
      const imagesToUpload = Array.from(imageIndicesToUpload)
        .filter((idx) => !resume.uploadedImages.has(idx))
        .map((idx) => ({
          idx,
          file: imageFiles[idx].file,
          exifDate: imageFiles[idx].exifDate,
        }));

      const totalFiles = imagesToUpload.length;

      setSaveProgress({ step: `Uploading ${totalFiles} images...`, percent: 10 });
      const uploadedImages = resume.uploadedImages;

      for (let i = 0; i < imagesToUpload.length; i += UPLOAD_BATCH_SIZE) {
        const batch = imagesToUpload.slice(i, i + UPLOAD_BATCH_SIZE);
        const batchFiles = batch.map((entry) => entry.file);

        const timestamps: Record<string, string> = {};
        batch.forEach((entry) => {
          if (entry.exifDate) {
            timestamps[entry.file.name] = entry.exifDate.toISOString();
          }
        });

        let result;
        try {
          result = await imagesAPI.uploadFilesWithMetadata(
            surveyId,
            batchFiles,
            Object.keys(timestamps).length > 0 ? timestamps : undefined,
            true,
          );
        } catch (uploadErr: unknown) {
          throw new Error(`Failed to upload images (batch ${Math.floor(i / UPLOAD_BATCH_SIZE) + 1}): ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`);
        }

        batch.forEach((entry, batchIdx) => {
          if (result[batchIdx]) {
            uploadedImages.set(entry.idx, result[batchIdx]);
          }
        });

        const uploadPercent = 10 + Math.round(((i + batch.length) / totalFiles) * 60);
        setSaveProgress({ step: `Uploaded ${Math.min(i + UPLOAD_BATCH_SIZE, totalFiles)} of ${totalFiles} images...`, percent: uploadPercent });
      }

      setSaveProgress({ step: 'Creating sightings...', percent: 75 });

      for (const { speciesId, imageIndices } of reviewData) {
        if (resume.createdSightingSpecies.has(speciesId)) continue;
        const selectedIndices = imageIndices.filter(
          (idx) => !deselectedImages.has(`${speciesId}-${idx}`),
        );
        if (selectedIndices.length === 0) continue;

        const imageIds = selectedIndices
          .map((idx) => uploadedImages.get(idx)?.id)
          .filter((id): id is number => id != null);

        if (imageIds.length === 0) continue;

        await surveysAPI.addSighting(surveyId, {
          species_id: speciesId,
          count: 1,
          image_ids: imageIds,
          individuals:
            selectedDevice.latitude != null && selectedDevice.longitude != null
              ? [{ latitude: selectedDevice.latitude, longitude: selectedDevice.longitude, count: 1 }]
              : [],
        });
        resume.createdSightingSpecies.add(speciesId);
      }

      setSaveProgress({ step: 'Done!', percent: 100 });
      saveCompleteRef.current = true;
      resetSaveResume();
      navigate(`/surveys/${surveyId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save survey');
      setSaving(false);
    }
  }, [selectedSurveyType, selectedDevice, date, selectedSurveyors, reviewData, deselectedImages, imageFiles, navigate, resetSaveResume]);

  // ============================================================================
  // Step validation
  // ============================================================================

  const classifiedCount = classifications.size;
  const uniqueSpeciesCount = new Set(
    Array.from(classifications.values()).flatMap((list) => list.map((c) => c.speciesId)),
  ).size;
  const viewedCount = viewedImages.size;
  const remainingCount = filteredImageFiles.length - viewedCount;

  const canProceed = useCallback(
    (step: number): boolean => {
      switch (step) {
        case 0:
          return !!selectedSurveyType && !!selectedDevice && !!date && selectedSurveyors.length > 0;
        case 1:
          return imageFiles.length > 0;
        case 2:
          if (skippedFiltering) return true;
          return !filtering && filterResults.size === imageFiles.length && filteredImageFiles.length > 0;
        case 3:
          return classifiedCount > 0;
        case 4:
          return selectedImageCount > 0;
        default:
          return false;
      }
    },
    [selectedSurveyType, selectedDevice, date, selectedSurveyors.length, imageFiles.length, skippedFiltering, filtering, filterResults.size, filteredImageFiles.length, classifiedCount, selectedImageCount],
  );

  // ============================================================================
  // Navigation helpers
  // ============================================================================

  const goToFilterStep = useCallback(() => setActiveStep(2), []);

  const goBackToUpload = useCallback(() => {
    setActiveStep(1);
    // Don't clear filter results — they'll be re-used if images haven't changed
  }, []);

  // Classification state is reset on entry only if the image set changed (see effect above)
  const goToClassifyStep = useCallback(() => setActiveStep(3), []);

  const skipFiltering = useCallback(() => {
    filterRunRef.current++; // cancel any in-flight filtering run
    setFiltering(false);
    setFilterError(null);
    setSkippedFiltering(true);
    setFilteredImageSet(imageFiles);
    // Reset filter results so all images pass through. Skip if already empty, so
    // returning here after classifying doesn't change the image set and wipe work.
    if (filterResults.size > 0 || filterOverrides.size > 0) {
      setFilterResults(new Map());
      setFilterOverrides(new Map());
    }
    setActiveStep(3);
  }, [imageFiles, filterResults, filterOverrides]);

  return {
    // Step
    activeStep,
    setActiveStep,

    // Setup
    surveyTypes,
    selectedSurveyType,
    setSelectedSurveyType,
    devices,
    selectedDevice,
    setSelectedDevice,
    date,
    setDate,
    surveyors,
    selectedSurveyors,
    setSelectedSurveyors,

    // Upload
    imageFiles,
    loadingImages,
    fileInputRef,
    handleFileSelect,

    // Filter
    filterResults,
    filtering,
    filterProgress,
    filterOverrides,
    filterError,
    setFilterError,
    filterReviewGroup,
    setFilterReviewGroup,
    filterReviewIdx,
    setFilterReviewIdx,
    runFiltering,
    toggleFilterOverride,
    filterDerived,

    // Classify
    filteredImageFiles,
    filteredToOriginalIndex,
    currentImageIndex,
    setCurrentImageIndex,
    classifications,
    viewedImages,
    species,
    speciesSearchValue,
    setSpeciesSearchValue,
    speciesInputRef,
    thumbnailStripRef,
    classifyViewerOpen,
    setClassifyViewerOpen,
    showDetectionBoxes,
    toggleDetectionBoxes,
    classifyImage,
    removeClassification,
    goToPrev,
    goToNext,
    goToNextUnviewed,
    classifiedCount,
    uniqueSpeciesCount,
    viewedCount,
    remainingCount,

    // Review
    reviewData,
    deselectedImages,
    selectedImageCount,
    toggleImageSelection,

    // Save
    saving,
    saveProgress,
    saveCompleteRef,
    handleSave,
    // True when a failed attempt made partial progress a retry can resume
    hasPartialSave: saveResumeRef.current.surveyId != null,

    // Navigation
    navigate,
    canProceed,
    goToFilterStep,
    goBackToUpload,
    goToClassifyStep,
    skipFiltering,

    // Shared
    error,
    setError,
    loading,
  };
}

export type CameraTrapWizardState = ReturnType<typeof useCameraTrapWizard>;
