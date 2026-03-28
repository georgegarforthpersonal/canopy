import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  Stepper,
  Step,
  StepLabel,
  Checkbox,
  LinearProgress,
  IconButton,
  Chip,
} from '@mui/material';
import {
  ArrowBack,
  ArrowForward,
  SkipNext,
  Save,
  Cancel,
  CloudUpload,
  PhotoCamera,
  CheckCircle,
  Delete,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
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
} from '../services/api';
import { PageHeader } from '../components/layout/PageHeader';
import exifr from 'exifr';

// ============================================================================
// Types
// ============================================================================

interface ImageFile {
  file: File;
  objectUrl: string;
  exifDate: Date | null;
  filename: string;
}

interface Classification {
  speciesId: number;
  speciesName: string;
}

// Classification state per image index: undefined = unvisited, 'skipped' = discarded, Classification = assigned
type ImageClassification = Classification | 'skipped' | undefined;

const WIZARD_STEPS = ['Setup', 'Upload', 'Classify', 'Review', 'Save'];

const UPLOAD_BATCH_SIZE = 10;

// ============================================================================
// Component
// ============================================================================

export function NewCameraTrapSurveyPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

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

  // ---- Step 3: Classify ----
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [classifications, setClassifications] = useState<Map<number, ImageClassification>>(new Map());
  const [species, setSpecies] = useState<Species[]>([]);
  const [speciesSearchValue, setSpeciesSearchValue] = useState('');

  // ---- Step 4: Review ----
  const [deselectedImages, setDeselectedImages] = useState<Set<string>>(new Set()); // "speciesId-imageIndex"

  // ---- Step 5: Save ----
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ step: '', percent: 0 });

  // ---- Shared ----
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
        setSurveyTypes(allSurveyTypes.filter((st) => st.allow_image_upload && st.is_active));
        setSurveyors(allSurveyors);
        setDevices(allDevices);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    fetchInitialData();
  }, []);

  // Load species when survey type changes
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
      // Filter to image files only
      const imageFileList = Array.from(files).filter((f) => {
        const ext = f.name.toLowerCase().split('.').pop();
        return ['jpg', 'jpeg', 'png'].includes(ext || '');
      });

      if (imageFileList.length === 0) {
        setError('No valid image files found. Accepted formats: JPG, JPEG, PNG');
        setLoadingImages(false);
        return;
      }

      // Process in batches for EXIF extraction
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
              // No EXIF data - that's fine
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

      // Sort by EXIF date (images without dates go to the end)
      processed.sort((a, b) => {
        if (!a.exifDate && !b.exifDate) return a.filename.localeCompare(b.filename);
        if (!a.exifDate) return 1;
        if (!b.exifDate) return -1;
        return a.exifDate.getTime() - b.exifDate.getTime();
      });

      setImageFiles(processed);
      setClassifications(new Map());
      setCurrentImageIndex(0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to process images');
    } finally {
      setLoadingImages(false);
    }
  }, []);

  // ============================================================================
  // Step 3: Classification helpers
  // ============================================================================

  const classifyImage = useCallback(
    (speciesId: number, speciesName: string) => {
      setClassifications((prev) => {
        const next = new Map(prev);
        next.set(currentImageIndex, { speciesId, speciesName });
        return next;
      });
      // Auto-advance to next unclassified
      const nextUnclassified = findNextUnclassified(currentImageIndex);
      if (nextUnclassified !== null) {
        setCurrentImageIndex(nextUnclassified);
      } else {
        // All done - advance to next image or stay
        if (currentImageIndex < imageFiles.length - 1) {
          setCurrentImageIndex(currentImageIndex + 1);
        }
      }
      setSpeciesSearchValue('');
    },
    [currentImageIndex, imageFiles.length]
  );

  const skipImage = useCallback(() => {
    setClassifications((prev) => {
      const next = new Map(prev);
      next.set(currentImageIndex, 'skipped');
      return next;
    });
    if (currentImageIndex < imageFiles.length - 1) {
      setCurrentImageIndex(currentImageIndex + 1);
    }
    setSpeciesSearchValue('');
  }, [currentImageIndex, imageFiles.length]);

  const findNextUnclassified = (fromIndex: number): number | null => {
    for (let i = fromIndex + 1; i < imageFiles.length; i++) {
      if (!classifications.has(i)) return i;
    }
    for (let i = 0; i < fromIndex; i++) {
      if (!classifications.has(i)) return i;
    }
    return null;
  };

  const goToPrev = useCallback(() => {
    setCurrentImageIndex((prev) => Math.max(0, prev - 1));
    setSpeciesSearchValue('');
  }, []);

  const goToNext = useCallback(() => {
    setCurrentImageIndex((prev) => Math.min(imageFiles.length - 1, prev + 1));
    setSpeciesSearchValue('');
  }, [imageFiles.length]);

  // Keyboard navigation for classify step
  useEffect(() => {
    if (activeStep !== 2) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') goToNext();
      if (e.key === 'ArrowLeft') goToPrev();
      if (e.key === 's' || e.key === 'S') skipImage();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeStep, goToNext, goToPrev, skipImage]);

  // ============================================================================
  // Step 4: Review computed data
  // ============================================================================

  const reviewData = useMemo(() => {
    const speciesMap = new Map<number, { speciesName: string; imageIndices: number[] }>();

    classifications.forEach((value, imageIndex) => {
      if (value && value !== 'skipped') {
        const existing = speciesMap.get(value.speciesId);
        if (existing) {
          existing.imageIndices.push(imageIndex);
        } else {
          speciesMap.set(value.speciesId, {
            speciesName: value.speciesName,
            imageIndices: [imageIndex],
          });
        }
      }
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

  const toggleImageSelection = (speciesId: number, imageIndex: number) => {
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
  };

  // ============================================================================
  // Step 5: Save
  // ============================================================================

  const handleSave = async () => {
    if (!selectedSurveyType || !selectedDevice || !date) return;

    setSaving(true);
    setError(null);

    try {
      // 1. Create survey
      setSaveProgress({ step: 'Creating survey...', percent: 5 });
      const survey = await surveysAPI.create({
        date: date.format('YYYY-MM-DD'),
        survey_type_id: selectedSurveyType.id,
        device_id: selectedDevice.id,
        surveyor_ids: selectedSurveyors.map((s) => s.id),
      });

      // 2. Build list of images to upload, grouped by species
      const imagesToUpload = new Map<number, { file: File; exifDate: Date | null; speciesId: number }>();

      reviewData.forEach(({ speciesId, imageIndices }) => {
        imageIndices.forEach((idx) => {
          const key = `${speciesId}-${idx}`;
          if (!deselectedImages.has(key)) {
            imagesToUpload.set(idx, {
              file: imageFiles[idx].file,
              exifDate: imageFiles[idx].exifDate,
              speciesId,
            });
          }
        });
      });

      const uploadEntries = Array.from(imagesToUpload.entries());
      const totalFiles = uploadEntries.length;

      // 3. Upload in batches
      setSaveProgress({ step: `Uploading ${totalFiles} images...`, percent: 10 });
      const uploadedImages = new Map<number, CameraTrapImage>(); // imageIndex -> CameraTrapImage

      for (let i = 0; i < uploadEntries.length; i += UPLOAD_BATCH_SIZE) {
        const batch = uploadEntries.slice(i, i + UPLOAD_BATCH_SIZE);
        const batchFiles = batch.map(([, entry]) => entry.file);

        // Build timestamps metadata
        const timestamps: Record<string, string> = {};
        batch.forEach(([, entry]) => {
          if (entry.exifDate) {
            timestamps[entry.file.name] = entry.exifDate.toISOString();
          }
        });

        const result = await imagesAPI.uploadFilesWithMetadata(
          survey.id,
          batchFiles,
          Object.keys(timestamps).length > 0 ? timestamps : undefined,
          true // skip processing
        );

        // Map uploaded images back to their indices
        batch.forEach(([imageIndex], batchIdx) => {
          if (result[batchIdx]) {
            uploadedImages.set(imageIndex, result[batchIdx]);
          }
        });

        const uploadPercent = 10 + Math.round(((i + batch.length) / totalFiles) * 60);
        setSaveProgress({ step: `Uploaded ${Math.min(i + UPLOAD_BATCH_SIZE, totalFiles)} of ${totalFiles} images...`, percent: uploadPercent });
      }

      // 4. Create sightings per species
      setSaveProgress({ step: 'Creating sightings...', percent: 75 });

      for (const { speciesId, imageIndices } of reviewData) {
        const selectedIndices = imageIndices.filter(
          (idx) => !deselectedImages.has(`${speciesId}-${idx}`)
        );
        if (selectedIndices.length === 0) continue;

        const individuals = selectedIndices
          .map((idx) => {
            const uploaded = uploadedImages.get(idx);
            if (!uploaded) return null;
            return {
              latitude: selectedDevice.latitude!,
              longitude: selectedDevice.longitude!,
              count: 1,
              camera_trap_image_id: uploaded.id,
            };
          })
          .filter((ind): ind is NonNullable<typeof ind> => ind !== null);

        if (individuals.length === 0) continue;

        await surveysAPI.addSighting(survey.id, {
          species_id: speciesId,
          count: individuals.length,
          individuals,
        });
      }

      setSaveProgress({ step: 'Done!', percent: 100 });

      // Navigate to survey detail
      navigate(`/surveys/${survey.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save survey');
      setSaving(false);
    }
  };

  // ============================================================================
  // Step validation
  // ============================================================================

  const classifiedCount = Array.from(classifications.values()).filter((v) => v && v !== 'skipped').length;
  const skippedCount = Array.from(classifications.values()).filter((v) => v === 'skipped').length;

  const canProceed = (step: number): boolean => {
    switch (step) {
      case 0: // Setup
        return !!selectedSurveyType && !!selectedDevice && !!date && selectedSurveyors.length > 0;
      case 1: // Upload
        return imageFiles.length > 0;
      case 2: // Classify
        return classifiedCount > 0;
      case 3: // Review
        return selectedImageCount > 0;
      default:
        return false;
    }
  };

  // ============================================================================
  // Auth guard
  // ============================================================================

  if (authLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <Alert severity="warning">Please sign in to create a camera trap survey.</Alert>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <Box sx={{ pb: 4 }}>
      <PageHeader
        backButton={{ label: 'Surveys', to: '/surveys' }}
        actions={
          <Button
            variant="outlined"
            startIcon={<Cancel />}
            onClick={() => navigate('/surveys')}
            sx={{ textTransform: 'none' }}
          >
            Cancel
          </Button>
        }
      />

      <Typography variant="h5" fontWeight={600} gutterBottom>
        New Camera Trap Survey
      </Typography>

      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {WIZARD_STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* ================================================================ */}
      {/* Step 1: Setup                                                     */}
      {/* ================================================================ */}
      {activeStep === 0 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Survey Setup
          </Typography>
          <Stack spacing={3}>
            <Autocomplete
              options={surveyTypes}
              getOptionLabel={(option) => option.name}
              value={selectedSurveyType}
              onChange={(_, value) => setSelectedSurveyType(value)}
              renderInput={(params) => (
                <TextField {...params} label="Survey Type" required />
              )}
            />
            <Autocomplete
              options={devices}
              getOptionLabel={(option) =>
                option.name ? `${option.name} (${option.device_id})` : option.device_id
              }
              value={selectedDevice}
              onChange={(_, value) => setSelectedDevice(value)}
              renderInput={(params) => (
                <TextField {...params} label="Camera Trap Device" required />
              )}
              noOptionsText="No camera trap devices found. Add one in Admin > Devices."
            />
            {selectedDevice && !selectedDevice.latitude && (
              <Alert severity="warning">
                This device has no GPS coordinates set. Sightings will not have location data.
              </Alert>
            )}
            <DatePicker
              label="Survey Date"
              value={date}
              onChange={setDate}
              slotProps={{ textField: { required: true, fullWidth: true } }}
            />
            <Autocomplete
              multiple
              options={surveyors}
              getOptionLabel={(option) => option.name}
              value={selectedSurveyors}
              onChange={(_, value) => setSelectedSurveyors(value)}
              renderInput={(params) => (
                <TextField {...params} label="Surveyors" required />
              )}
            />
          </Stack>
          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              endIcon={<ArrowForward />}
              disabled={!canProceed(0)}
              onClick={() => setActiveStep(1)}
              sx={{ textTransform: 'none' }}
            >
              Next
            </Button>
          </Box>
        </Paper>
      )}

      {/* ================================================================ */}
      {/* Step 2: Upload                                                    */}
      {/* ================================================================ */}
      {activeStep === 1 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Select Images
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select the image files from your camera trap. Images will be sorted by date.
          </Typography>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />

          <Button
            variant="outlined"
            startIcon={loadingImages ? <CircularProgress size={20} /> : <CloudUpload />}
            onClick={() => fileInputRef.current?.click()}
            disabled={loadingImages}
            sx={{ textTransform: 'none', mb: 2 }}
          >
            {loadingImages ? 'Processing...' : 'Select Images'}
          </Button>

          {imageFiles.length > 0 && (
            <>
              <Typography variant="body2" sx={{ mb: 2 }}>
                <strong>{imageFiles.length}</strong> images loaded
                {imageFiles[0]?.exifDate && (
                  <> &mdash; {dayjs(imageFiles[0].exifDate).format('DD/MM/YYYY')} to {dayjs(imageFiles[imageFiles.length - 1]?.exifDate).format('DD/MM/YYYY')}</>
                )}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: 1,
                  maxHeight: 400,
                  overflow: 'auto',
                }}
              >
                {imageFiles.slice(0, 100).map((img, idx) => (
                  <Box key={idx} sx={{ position: 'relative' }}>
                    <img
                      src={img.objectUrl}
                      alt={img.filename}
                      loading="lazy"
                      style={{
                        width: '100%',
                        height: 100,
                        objectFit: 'cover',
                        borderRadius: 4,
                      }}
                    />
                    {img.exifDate && (
                      <Typography
                        variant="caption"
                        sx={{
                          position: 'absolute',
                          bottom: 2,
                          left: 2,
                          bgcolor: 'rgba(0,0,0,0.6)',
                          color: 'white',
                          px: 0.5,
                          borderRadius: 0.5,
                          fontSize: '0.65rem',
                        }}
                      >
                        {dayjs(img.exifDate).format('DD/MM HH:mm')}
                      </Typography>
                    )}
                  </Box>
                ))}
                {imageFiles.length > 100 && (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: 100,
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      +{imageFiles.length - 100} more
                    </Typography>
                  </Box>
                )}
              </Box>
            </>
          )}

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
            <Button
              startIcon={<ArrowBack />}
              onClick={() => setActiveStep(0)}
              sx={{ textTransform: 'none' }}
            >
              Back
            </Button>
            <Button
              variant="contained"
              endIcon={<ArrowForward />}
              disabled={!canProceed(1)}
              onClick={() => setActiveStep(2)}
              sx={{ textTransform: 'none' }}
            >
              Next: Classify Images
            </Button>
          </Box>
        </Paper>
      )}

      {/* ================================================================ */}
      {/* Step 3: Classify                                                  */}
      {/* ================================================================ */}
      {activeStep === 2 && imageFiles.length > 0 && (
        <Paper sx={{ p: 3 }}>
          {/* Progress bar */}
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                Image {currentImageIndex + 1} of {imageFiles.length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {classifiedCount} classified, {skippedCount} skipped
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={(classifications.size / imageFiles.length) * 100}
              sx={{ height: 6, borderRadius: 3 }}
            />
          </Box>

          {/* Current classification indicator */}
          {classifications.get(currentImageIndex) && (
            <Box sx={{ mb: 1 }}>
              {classifications.get(currentImageIndex) === 'skipped' ? (
                <Chip label="Skipped" size="small" color="default" onDelete={() => {
                  setClassifications((prev) => {
                    const next = new Map(prev);
                    next.delete(currentImageIndex);
                    return next;
                  });
                }} />
              ) : (
                <Chip
                  label={(classifications.get(currentImageIndex) as Classification).speciesName}
                  size="small"
                  color="primary"
                  onDelete={() => {
                    setClassifications((prev) => {
                      const next = new Map(prev);
                      next.delete(currentImageIndex);
                      return next;
                    });
                  }}
                />
              )}
            </Box>
          )}

          {/* Main image */}
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              bgcolor: 'black',
              borderRadius: 1,
              overflow: 'hidden',
              mb: 2,
              maxHeight: '50vh',
            }}
          >
            <img
              src={imageFiles[currentImageIndex].objectUrl}
              alt={imageFiles[currentImageIndex].filename}
              style={{
                maxWidth: '100%',
                maxHeight: '50vh',
                objectFit: 'contain',
              }}
            />
          </Box>

          {/* Image info */}
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
            {imageFiles[currentImageIndex].filename}
            {imageFiles[currentImageIndex].exifDate && (
              <> &mdash; {dayjs(imageFiles[currentImageIndex].exifDate).format('DD/MM/YYYY HH:mm:ss')}</>
            )}
          </Typography>

          {/* Species selection + skip */}
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
            <Autocomplete
              options={species}
              getOptionLabel={(option) =>
                option.name ? `${option.name} (${option.scientific_name || ''})` : option.scientific_name || ''
              }
              value={null}
              inputValue={speciesSearchValue}
              onInputChange={(_, value) => setSpeciesSearchValue(value)}
              onChange={(_, value) => {
                if (value) {
                  classifyImage(value.id, value.name || value.scientific_name || 'Unknown');
                }
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Select species"
                  placeholder="Type to search..."
                  size="small"
                />
              )}
              sx={{ flexGrow: 1 }}
              clearOnBlur={false}
              blurOnSelect
            />
            <Button
              variant="outlined"
              startIcon={<SkipNext />}
              onClick={skipImage}
              sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
            >
              Skip (S)
            </Button>
          </Stack>

          {/* Navigation */}
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" sx={{ mb: 2 }}>
            <IconButton onClick={goToPrev} disabled={currentImageIndex === 0}>
              <ArrowBack />
            </IconButton>
            <Typography variant="body2">
              Use arrow keys to navigate
            </Typography>
            <IconButton onClick={goToNext} disabled={currentImageIndex === imageFiles.length - 1}>
              <ArrowForward />
            </IconButton>
          </Stack>

          {/* Thumbnail strip */}
          <Box
            sx={{
              display: 'flex',
              gap: 0.5,
              overflow: 'auto',
              py: 1,
              '&::-webkit-scrollbar': { height: 6 },
              '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 3 },
            }}
          >
            {imageFiles.map((img, idx) => {
              const cls = classifications.get(idx);
              const isCurrent = idx === currentImageIndex;
              return (
                <Box
                  key={idx}
                  onClick={() => { setCurrentImageIndex(idx); setSpeciesSearchValue(''); }}
                  sx={{
                    flexShrink: 0,
                    width: 56,
                    height: 42,
                    borderRadius: 0.5,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    border: isCurrent ? '2px solid' : '2px solid transparent',
                    borderColor: isCurrent ? 'primary.main' : 'transparent',
                    opacity: cls === 'skipped' ? 0.4 : 1,
                    position: 'relative',
                  }}
                >
                  <img
                    src={img.objectUrl}
                    alt=""
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  {cls && cls !== 'skipped' && (
                    <CheckCircle
                      sx={{
                        position: 'absolute',
                        top: 1,
                        right: 1,
                        fontSize: 14,
                        color: 'success.main',
                        bgcolor: 'white',
                        borderRadius: '50%',
                      }}
                    />
                  )}
                </Box>
              );
            })}
          </Box>

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
            <Button
              startIcon={<ArrowBack />}
              onClick={() => setActiveStep(1)}
              sx={{ textTransform: 'none' }}
            >
              Back
            </Button>
            <Button
              variant="contained"
              endIcon={<ArrowForward />}
              disabled={!canProceed(2)}
              onClick={() => setActiveStep(3)}
              sx={{ textTransform: 'none' }}
            >
              Next: Review ({classifiedCount} species identified)
            </Button>
          </Box>
        </Paper>
      )}

      {/* ================================================================ */}
      {/* Step 4: Review                                                    */}
      {/* ================================================================ */}
      {activeStep === 3 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Review Classifications
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {reviewData.length} species identified, {selectedImageCount} images to save.
            Deselect any images you don't want to keep.
          </Typography>

          {reviewData.length === 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              No species have been classified yet. Go back and classify some images.
            </Alert>
          )}

          <Stack spacing={3}>
            {reviewData.map(({ speciesId, speciesName, imageIndices }) => {
              const selectedCount = imageIndices.filter(
                (idx) => !deselectedImages.has(`${speciesId}-${idx}`)
              ).length;

              return (
                <Box key={speciesId}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <PhotoCamera fontSize="small" color="action" />
                    <Typography variant="subtitle1" fontWeight={600}>
                      {speciesName}
                    </Typography>
                    <Chip
                      label={`${selectedCount} of ${imageIndices.length} images`}
                      size="small"
                      color={selectedCount > 0 ? 'primary' : 'default'}
                    />
                  </Box>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                      gap: 1,
                    }}
                  >
                    {imageIndices.map((idx) => {
                      const key = `${speciesId}-${idx}`;
                      const isSelected = !deselectedImages.has(key);
                      return (
                        <Box
                          key={idx}
                          onClick={() => toggleImageSelection(speciesId, idx)}
                          sx={{
                            position: 'relative',
                            cursor: 'pointer',
                            opacity: isSelected ? 1 : 0.4,
                            border: isSelected ? '2px solid' : '2px solid transparent',
                            borderColor: isSelected ? 'primary.main' : 'transparent',
                            borderRadius: 1,
                            overflow: 'hidden',
                            transition: 'opacity 0.15s',
                          }}
                        >
                          <img
                            src={imageFiles[idx].objectUrl}
                            alt={imageFiles[idx].filename}
                            loading="lazy"
                            style={{
                              width: '100%',
                              height: 100,
                              objectFit: 'cover',
                            }}
                          />
                          <Checkbox
                            checked={isSelected}
                            size="small"
                            sx={{
                              position: 'absolute',
                              top: 0,
                              right: 0,
                              bgcolor: 'rgba(255,255,255,0.8)',
                              borderRadius: 0,
                              p: 0.25,
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleImageSelection(speciesId, idx)}
                          />
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              );
            })}
          </Stack>

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
            <Button
              startIcon={<ArrowBack />}
              onClick={() => setActiveStep(2)}
              sx={{ textTransform: 'none' }}
            >
              Back to Classify
            </Button>
            <Button
              variant="contained"
              startIcon={<Save />}
              disabled={!canProceed(3)}
              onClick={() => { setActiveStep(4); handleSave(); }}
              sx={{ textTransform: 'none' }}
            >
              Save Survey ({selectedImageCount} images)
            </Button>
          </Box>
        </Paper>
      )}

      {/* ================================================================ */}
      {/* Step 5: Save                                                      */}
      {/* ================================================================ */}
      {activeStep === 4 && (
        <Paper sx={{ p: 3, textAlign: 'center' }}>
          {saving ? (
            <>
              <CircularProgress sx={{ mb: 2 }} />
              <Typography variant="h6" gutterBottom>
                {saveProgress.step}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={saveProgress.percent}
                sx={{ height: 8, borderRadius: 4, maxWidth: 400, mx: 'auto' }}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {saveProgress.percent}%
              </Typography>
            </>
          ) : error ? (
            <>
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
              <Button
                variant="contained"
                onClick={() => { setError(null); handleSave(); }}
                sx={{ textTransform: 'none' }}
              >
                Retry
              </Button>
            </>
          ) : (
            <>
              <CheckCircle sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
              <Typography variant="h6">Survey saved successfully!</Typography>
            </>
          )}
        </Paper>
      )}
    </Box>
  );
}
