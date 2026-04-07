import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import {
  surveysAPI,
  surveyorsAPI,
  surveyTypesAPI,
  devicesAPI,
  audioAPI,
  withRetry,
} from '../services/api';
import type {
  Surveyor,
  SurveyType,
  Device,
  AudioRecording,
  AudioDetectionResult,
  TempUploadResponse,
} from '../services/api';
import { extractWavSnippet } from '../utils/wavSnippet';
import { parseTimeToSeconds, formatDuration } from '../utils/time';

// ============================================================================
// Types
// ============================================================================

export interface AudioFile {
  file: File;
  objectUrl: string;
  filename: string;
}

/** Detection result enriched with source file info */
export interface WizardDetection extends AudioDetectionResult {
  /** Index into audioFiles array */
  fileIndex: number;
}

/** Aggregated species data for the Review step */
export interface SpeciesReviewData {
  speciesId: number;
  speciesName: string;
  speciesScientificName: string | null;
  /** BirdNET species string (Scientific_Common) */
  birdnetName: string;
  detectionCount: number;
  /** Top 3 detections sorted by confidence */
  topDetections: WizardDetection[];
  /** All detections for this species */
  allDetections: WizardDetection[];
}

export const AUDIO_WIZARD_STEPS = ['Setup', 'Upload', 'Review', 'Save'] as const;

const UPLOAD_BATCH_SIZE = 10;

// ============================================================================
// Hook
// ============================================================================

export function useAudioWizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // ---- Wizard step ----
  const [activeStep, setActiveStep] = useState(0);

  // ---- Step 0: Setup ----
  const [surveyTypes, setSurveyTypes] = useState<SurveyType[]>([]);
  const [selectedSurveyType, setSelectedSurveyType] = useState<SurveyType | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [date, setDate] = useState<Dayjs | null>(dayjs());
  const [surveyors, setSurveyors] = useState<Surveyor[]>([]);
  const [selectedSurveyors, setSelectedSurveyors] = useState<Surveyor[]>([]);

  // ---- Step 1: Upload + Process ----
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [processPhase, setProcessPhase] = useState<'uploading' | 'analysing'>('uploading');
  const [processProgress, setProcessProgress] = useState({ processed: 0, total: 0, currentFilename: '' });
  const [processError, setProcessError] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [detections, setDetections] = useState<WizardDetection[]>([]);
  const [unmatchedSpecies, setUnmatchedSpecies] = useState<string[]>([]);
  /** Track which files have been processed (to detect re-selection) */
  const [processedFileSet, setProcessedFileSet] = useState<AudioFile[] | null>(null);
  /** R2 keys for temp-uploaded files, used for cleanup */
  const [tempUploads, setTempUploads] = useState<TempUploadResponse[]>([]);

  // ---- Step 2: Review ----
  const [deselectedSpecies, setDeselectedSpecies] = useState<Set<number>>(new Set());

  // ---- Step 3: Save ----
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ step: '', percent: 0 });

  // ---- Shared ----
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ============================================================================
  // Derived review data
  // ============================================================================

  const reviewData = useMemo((): SpeciesReviewData[] => {
    // Group detections by species_id
    const speciesMap = new Map<number, {
      speciesName: string;
      speciesScientificName: string | null;
      birdnetName: string;
      detections: WizardDetection[];
    }>();

    for (const det of detections) {
      if (!det.species_id) continue;
      const existing = speciesMap.get(det.species_id);
      if (existing) {
        existing.detections.push(det);
      } else {
        speciesMap.set(det.species_id, {
          speciesName: det.species_common_name || det.species_scientific_name || det.species_name,
          speciesScientificName: det.species_scientific_name,
          birdnetName: det.species_name,
          detections: [det],
        });
      }
    }

    return Array.from(speciesMap.entries())
      .map(([speciesId, data]) => {
        const sorted = [...data.detections].sort((a, b) => b.confidence - a.confidence);
        return {
          speciesId,
          speciesName: data.speciesName,
          speciesScientificName: data.speciesScientificName,
          birdnetName: data.birdnetName,
          detectionCount: data.detections.length,
          topDetections: sorted.slice(0, 3),
          allDetections: sorted,
        };
      })
      .sort((a, b) => {
        // Sort by max confidence descending
        const maxA = a.topDetections[0]?.confidence ?? 0;
        const maxB = b.topDetections[0]?.confidence ?? 0;
        return maxB - maxA;
      });
  }, [detections]);

  const selectedSpeciesCount = useMemo(() => {
    return reviewData.filter((s) => !deselectedSpecies.has(s.speciesId)).length;
  }, [reviewData, deselectedSpecies]);

  // ============================================================================
  // Data fetching
  // ============================================================================

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [allSurveyTypes, allSurveyors, allDevices] = await Promise.all([
          surveyTypesAPI.getAll(),
          surveyorsAPI.getAll(),
          devicesAPI.getAll(false, 'audio_recorder'),
        ]);
        const audioTypes = allSurveyTypes.filter((st) => st.allow_audio_upload && st.is_active);
        setSurveyTypes(audioTypes);
        setSurveyors(allSurveyors);
        setDevices(allDevices);

        const typeId = searchParams.get('type');
        if (typeId) {
          const preselected = audioTypes.find((st) => st.id === Number(typeId));
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

  // Track temp uploads in a ref so cleanup on unmount always has the latest keys
  const tempUploadsRef = useRef<TempUploadResponse[]>([]);
  useEffect(() => {
    tempUploadsRef.current = tempUploads;
  }, [tempUploads]);

  const cleanupTempFiles = useCallback(() => {
    const keys = tempUploadsRef.current.map((u) => u.r2_key);
    if (keys.length === 0) return;
    // Fire-and-forget — don't block on cleanup
    audioAPI.cleanupTempFiles(keys).catch(() => {});
    setTempUploads([]);
    tempUploadsRef.current = [];
  }, []);

  // Cleanup object URLs and temp R2 files on unmount
  useEffect(() => {
    return () => {
      audioFiles.forEach((af) => URL.revokeObjectURL(af.objectUrl));
      // Best-effort cleanup of temp R2 files
      const keys = tempUploadsRef.current.map((u) => u.r2_key);
      if (keys.length > 0) {
        audioAPI.cleanupTempFiles(keys).catch(() => {});
      }
    };
  }, [audioFiles]);

  // ============================================================================
  // Step 1: File selection + processing
  // ============================================================================

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setLoadingFiles(true);
    setError(null);

    try {
      const wavFiles = Array.from(files).filter((f) => {
        return f.name.toLowerCase().endsWith('.wav');
      });

      if (wavFiles.length === 0) {
        setError('No valid audio files found. Only WAV files are accepted.');
        setLoadingFiles(false);
        return;
      }

      // Revoke old object URLs before replacing
      audioFiles.forEach((af) => URL.revokeObjectURL(af.objectUrl));

      const processed: AudioFile[] = wavFiles
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((file) => ({
          file,
          objectUrl: URL.createObjectURL(file),
          filename: file.name,
        }));

      setAudioFiles(processed);
      setDetections([]);
      setUnmatchedSpecies([]);
      setDeselectedSpecies(new Set());
      setProcessedFileSet(null);
      setProcessError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to process files');
    } finally {
      setLoadingFiles(false);
    }
  }, [audioFiles]);

  const runProcessing = useCallback(async () => {
    if (audioFiles.length === 0) return;

    setProcessing(true);
    setProcessPhase('uploading');
    setProcessError(null);
    setFileErrors([]);
    setDetections([]);
    setUnmatchedSpecies([]);
    setTempUploads([]);
    setProcessProgress({ processed: 0, total: audioFiles.length, currentFilename: audioFiles[0]?.filename ?? '' });

    try {
      // Phase A: Upload files to R2 with per-file retry
      const uploaded: (TempUploadResponse & { fileIndex: number })[] = [];
      const uploadErrors: string[] = [];

      for (let i = 0; i < audioFiles.length; i++) {
        const af = audioFiles[i];
        setProcessProgress({ processed: i, total: audioFiles.length, currentFilename: af.filename });
        try {
          const result = await withRetry(() => audioAPI.uploadTempFile(af.file));
          uploaded.push({ ...result, fileIndex: i });
        } catch (err) {
          uploadErrors.push(`Upload failed: ${af.filename} — ${err instanceof Error ? err.message : String(err)}`);
        }
        setProcessProgress({ processed: i + 1, total: audioFiles.length, currentFilename: '' });
      }

      setTempUploads(uploaded.map(({ r2_key, filename }) => ({ r2_key, filename })));

      if (uploaded.length === 0) {
        setProcessError('All file uploads failed. Check your connection and try again.');
        setFileErrors(uploadErrors);
        return;
      }

      // Phase B: Analyze files from R2 with per-file retry + error isolation
      setProcessPhase('analysing');
      const allDetections: WizardDetection[] = [];
      const allUnmatched: string[] = [];
      const analyzeErrors: string[] = [];

      for (let i = 0; i < uploaded.length; i++) {
        const { r2_key, filename, fileIndex } = uploaded[i];
        setProcessProgress({ processed: i, total: uploaded.length, currentFilename: filename });

        try {
          const result = await withRetry(() =>
            audioAPI.analyzeTempFile(
              r2_key,
              filename,
              selectedDevice?.latitude ?? undefined,
              selectedDevice?.longitude ?? undefined,
            ),
          );

          for (const det of result.detections) {
            allDetections.push({ ...det, fileIndex });
          }
          for (const species of result.unmatched_species) {
            if (!allUnmatched.includes(species)) {
              allUnmatched.push(species);
            }
          }
        } catch (err) {
          analyzeErrors.push(`Analysis failed: ${filename} — ${err instanceof Error ? err.message : String(err)}`);
        }

        setProcessProgress({ processed: i + 1, total: uploaded.length, currentFilename: '' });
        setDetections([...allDetections]);
      }

      setUnmatchedSpecies(allUnmatched);
      setFileErrors([...uploadErrors, ...analyzeErrors]);

      // All species start deselected — user must explicitly tick to include
      const allSpeciesIds = new Set(
        allDetections.map((d) => d.species_id).filter((id): id is number => id != null),
      );
      setDeselectedSpecies(allSpeciesIds);
      setProcessedFileSet(audioFiles);
    } catch (err: unknown) {
      setProcessError(err instanceof Error ? err.message : 'Failed to process audio files');
    } finally {
      setProcessing(false);
    }
  }, [audioFiles, selectedDevice]);

  // Auto-start processing when entering Upload step with new files
  useEffect(() => {
    if (activeStep !== 1 || processing || processError) return;
    if (audioFiles.length === 0) return;
    const needsRun = processedFileSet !== audioFiles;
    if (needsRun) {
      runProcessing();
    }
  }, [activeStep, processing, processError, audioFiles, processedFileSet, runProcessing]);

  // ============================================================================
  // Step 2: Review
  // ============================================================================

  const toggleSpecies = useCallback((speciesId: number) => {
    setDeselectedSpecies((prev) => {
      const next = new Set(prev);
      if (next.has(speciesId)) {
        next.delete(speciesId);
      } else {
        next.add(speciesId);
      }
      return next;
    });
  }, []);

  // ============================================================================
  // Step 3: Save
  // ============================================================================

  const handleSave = useCallback(async () => {
    if (!selectedSurveyType || !selectedDevice || !date) return;

    setSaving(true);
    setError(null);

    try {
      // 1. Create survey
      setSaveProgress({ step: 'Creating survey...', percent: 5 });
      let survey;
      try {
        survey = await surveysAPI.create({
          date: date.format('YYYY-MM-DD'),
          survey_type_id: selectedSurveyType.id,
          device_id: selectedDevice.id,
          surveyor_ids: selectedSurveyors.map((s) => s.id),
        });
      } catch (createErr: unknown) {
        throw new Error(`Failed to create survey: ${createErr instanceof Error ? createErr.message : String(createErr)}`);
      }

      // 2. Collect top 3 snippets per selected species
      const selectedReviewData = reviewData.filter((s) => !deselectedSpecies.has(s.speciesId));
      interface SnippetInfo {
        speciesId: number;
        speciesData: SpeciesReviewData;
        det: WizardDetection;
        snippetFilename: string;
      }
      const snippetsToExtract: SnippetInfo[] = [];

      for (const speciesData of selectedReviewData) {
        // Only top 3 detections per species
        for (const det of speciesData.topDetections) {
          snippetsToExtract.push({
            speciesId: speciesData.speciesId,
            speciesData,
            det,
            snippetFilename: `snippet_${speciesData.speciesId}_${det.start_time.replace(/:/g, '')}_${det.fileIndex}.wav`,
          });
        }
      }

      // 3. Extract WAV snippets from local files and upload
      const totalSnippets = snippetsToExtract.length;
      setSaveProgress({ step: `Extracting ${totalSnippets} audio snippets...`, percent: 10 });

      const snippetFiles: File[] = [];
      for (let i = 0; i < snippetsToExtract.length; i++) {
        const { det, snippetFilename } = snippetsToExtract[i];
        const sourceFile = audioFiles[det.fileIndex]?.file;
        if (!sourceFile) continue;

        const snippetBlob = await extractWavSnippet(sourceFile, det.start_time, det.end_time);
        snippetFiles.push(new File([snippetBlob], snippetFilename, { type: 'audio/wav' }));

        const extractPercent = 10 + Math.round(((i + 1) / totalSnippets) * 25);
        setSaveProgress({ step: `Extracted ${i + 1} of ${totalSnippets} snippets...`, percent: extractPercent });
      }

      setSaveProgress({ step: `Uploading ${totalSnippets} snippets...`, percent: 40 });
      const uploadedRecordings: AudioRecording[] = [];
      for (let i = 0; i < snippetFiles.length; i += UPLOAD_BATCH_SIZE) {
        const batch = snippetFiles.slice(i, i + UPLOAD_BATCH_SIZE);
        let result;
        try {
          result = await audioAPI.uploadFilesSkipProcessing(survey.id, batch);
        } catch (uploadErr: unknown) {
          throw new Error(`Failed to upload snippets: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`);
        }
        uploadedRecordings.push(...result);
        const uploadPercent = 40 + Math.round(((i + batch.length) / totalSnippets) * 30);
        setSaveProgress({ step: `Uploaded ${Math.min(i + UPLOAD_BATCH_SIZE, totalSnippets)} of ${totalSnippets} snippets...`, percent: uploadPercent });
      }

      // Build snippet filename -> recording ID mapping
      const filenameToRecordingId = new Map<string, number>();
      for (const rec of uploadedRecordings) {
        filenameToRecordingId.set(rec.filename, rec.id);
      }

      // 4. Create sightings for selected species
      setSaveProgress({ step: 'Creating sightings...', percent: 75 });

      for (const speciesData of selectedReviewData) {
        const audioDetections = speciesData.topDetections
          .map((det) => {
            const snippetFilename = `snippet_${speciesData.speciesId}_${det.start_time.replace(/:/g, '')}_${det.fileIndex}.wav`;
            const recordingId = filenameToRecordingId.get(snippetFilename);
            if (!recordingId) return null;
            return {
              audio_recording_id: recordingId,
              species_name: det.species_name,
              confidence: det.confidence,
              // Snippet-relative times (file IS the clip)
              start_time: '00:00:00',
              end_time: det.end_time > det.start_time
                ? formatDuration(parseTimeToSeconds(det.end_time) - parseTimeToSeconds(det.start_time))
                : '00:00:03',
            };
          })
          .filter((d): d is NonNullable<typeof d> => d !== null);

        if (audioDetections.length === 0) continue;

        await surveysAPI.addSighting(survey.id, {
          species_id: speciesData.speciesId,
          count: 1,
          audio_detections: audioDetections,
          individuals:
            selectedDevice.latitude != null && selectedDevice.longitude != null
              ? [{ latitude: selectedDevice.latitude, longitude: selectedDevice.longitude, count: 1 }]
              : [],
        });
      }

      // Clean up temp R2 files now that save is complete
      cleanupTempFiles();

      setSaveProgress({ step: 'Done!', percent: 100 });
      navigate(`/surveys/${survey.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save survey');
      setSaving(false);
    }
  }, [selectedSurveyType, selectedDevice, date, selectedSurveyors, audioFiles, reviewData, deselectedSpecies, navigate, cleanupTempFiles]);

  // ============================================================================
  // Step validation
  // ============================================================================

  const canProceed = useCallback(
    (step: number): boolean => {
      switch (step) {
        case 0:
          return !!selectedSurveyType && !!selectedDevice && !!date && selectedSurveyors.length > 0;
        case 1:
          return !processing && processedFileSet === audioFiles && detections.length > 0;
        case 2:
          return selectedSpeciesCount > 0;
        default:
          return false;
      }
    },
    [selectedSurveyType, selectedDevice, date, selectedSurveyors.length, processing, processedFileSet, audioFiles, detections.length, selectedSpeciesCount],
  );

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

    // Upload + Process
    audioFiles,
    loadingFiles,
    fileInputRef,
    handleFileSelect,
    processing,
    processPhase,
    processProgress,
    processError,
    setProcessError,
    fileErrors,
    runProcessing,
    detections,
    unmatchedSpecies,

    // Review
    reviewData,
    deselectedSpecies,
    selectedSpeciesCount,
    toggleSpecies,

    // Save
    saving,
    saveProgress,
    handleSave,

    // Navigation
    navigate,
    canProceed,

    // Shared
    error,
    setError,
    loading,
  };
}

export type AudioWizardState = ReturnType<typeof useAudioWizard>;
