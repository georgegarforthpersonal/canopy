import { useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Stack,
  Button,
  Alert,
  Autocomplete,
  TextField,
  LinearProgress,
  IconButton,
  Chip,
  Tooltip,
} from '@mui/material';
import {
  ArrowBack,
  ArrowForward,
  CheckCircle,
  SmartToy,
  Check,
  Close,
} from '@mui/icons-material';
import dayjs from 'dayjs';
import type { CameraTrapWizardState } from '../../hooks/useCameraTrapWizard';
import { ImageViewerModal } from '../ImageViewerModal';
import { DetectionBoxOverlay } from '../DetectionBoxOverlay';
import { useArrowKeyNavigation } from '../../hooks/useArrowKeyNavigation';

interface ClassifyStepProps {
  wizard: CameraTrapWizardState;
}

function confidenceColor(confidence: number): 'success' | 'warning' | 'error' {
  if (confidence >= 0.7) return 'success';
  if (confidence >= 0.4) return 'warning';
  return 'error';
}

export function ClassifyStep({ wizard }: ClassifyStepProps) {
  const {
    filteredImageFiles, filteredToOriginalIndex, filterResults,
    currentImageIndex, setCurrentImageIndex,
    classifications, species,
    speciesSearchValue, setSpeciesSearchValue,
    speciesInputRef, thumbnailStripRef,
    classifyViewerOpen, setClassifyViewerOpen,
    classifyImage, removeClassification,
    goToPrev, goToNext, goToNextUnviewed,
    viewedImages, viewedCount, uniqueSpeciesCount, remainingCount,
    canProceed, setActiveStep,
    detecting, detectProgress, detectError, setDetectError,
    aiSuggestions, acceptSuggestion, dismissSuggestion,
    skipDetection, runSpeciesDetection,
  } = wizard;

  const currentImage = filteredImageFiles[currentImageIndex];
  const origIdx = filteredToOriginalIndex[currentImageIndex];
  const currentClassifications = classifications.get(origIdx);
  const detections = origIdx !== undefined ? filterResults.get(origIdx)?.detections : undefined;

  // AI suggestions for the current image (non-dismissed only)
  const currentSuggestions = origIdx !== undefined
    ? (aiSuggestions.get(origIdx) || []).filter((s) => !s.dismissed)
    : [];

  // Keyboard navigation — only when species search is empty
  const shouldHandle = useCallback(
    (e: KeyboardEvent) => {
      const isInSpeciesInput = e.target === speciesInputRef.current;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (!isInSpeciesInput) return false;
        if (speciesSearchValue) return false;
      }
      return true;
    },
    [speciesSearchValue, speciesInputRef],
  );

  useArrowKeyNavigation({
    enabled: wizard.activeStep === 3,
    onNext: goToNext,
    onPrev: goToPrev,
    ignoreInputs: false,
    shouldHandle,
  });

  return (
    <Paper sx={{ p: 3, boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
      {/* AI Detection progress */}
      {detecting && (
        <Alert severity="info" sx={{ mb: 2 }} action={
          <Button size="small" onClick={skipDetection} sx={{ textTransform: 'none' }}>
            Skip
          </Button>
        }>
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            Identifying species... {detectProgress.processed} of {detectProgress.total} images
          </Typography>
          <LinearProgress
            variant="determinate"
            value={detectProgress.total > 0 ? (detectProgress.processed / detectProgress.total) * 100 : 0}
            sx={{ height: 4, borderRadius: 2 }}
          />
        </Alert>
      )}

      {/* AI Detection error */}
      {detectError && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => { setDetectError(null); runSpeciesDetection(); }} sx={{ textTransform: 'none' }}>
                Retry
              </Button>
              <Button size="small" onClick={skipDetection} sx={{ textTransform: 'none' }}>
                Skip
              </Button>
            </Stack>
          }
        >
          AI detection failed: {detectError}
        </Alert>
      )}

      {/* Progress bar */}
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            Image {currentImageIndex + 1} of {filteredImageFiles.length}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Viewed {viewedCount} of {filteredImageFiles.length} · {uniqueSpeciesCount} species identified
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={(viewedCount / filteredImageFiles.length) * 100}
          sx={{ height: 6, borderRadius: 3 }}
        />
      </Box>

      {/* Current classification chips */}
      {(currentClassifications?.length ?? 0) > 0 && (
        <Stack direction="row" spacing={0.5} sx={{ mb: 1, flexWrap: 'wrap', gap: 0.5 }}>
          {currentClassifications!.map((cls) => (
            <Chip
              key={cls.speciesId}
              label={cls.speciesName}
              size="small"
              color="primary"
              onDelete={() => removeClassification(origIdx, cls.speciesId)}
            />
          ))}
        </Stack>
      )}

      {/* AI suggestion chips */}
      {currentSuggestions.length > 0 && (
        <Stack direction="row" spacing={0.5} sx={{ mb: 1, flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
          <SmartToy sx={{ fontSize: 16, color: 'text.secondary', mr: 0.5 }} />
          {currentSuggestions.map((s) => {
            const isMatchable = s.speciesId != null;
            return (
              <Chip
                key={s.scientificName}
                icon={<SmartToy sx={{ fontSize: '14px !important' }} />}
                label={`${s.speciesName} ${(s.confidence * 100).toFixed(0)}%`}
                size="small"
                variant="outlined"
                color={confidenceColor(s.confidence)}
                deleteIcon={
                  <Stack direction="row" spacing={0} sx={{ alignItems: 'center' }}>
                    {isMatchable && (
                      <Tooltip title="Accept">
                        <IconButton
                          size="small"
                          sx={{ p: 0.25 }}
                          onClick={(e) => { e.stopPropagation(); acceptSuggestion(origIdx, s); }}
                        >
                          <Check sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Dismiss">
                      <IconButton
                        size="small"
                        sx={{ p: 0.25 }}
                        onClick={(e) => { e.stopPropagation(); dismissSuggestion(origIdx, s.scientificName); }}
                      >
                        <Close sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                }
                onDelete={() => {}} // Required for deleteIcon to render
                sx={!isMatchable ? { opacity: 0.6 } : undefined}
              />
            );
          })}
        </Stack>
      )}

      {/* Main image with bounding boxes */}
      <Box
        onClick={() => setClassifyViewerOpen(true)}
        sx={{
          display: 'flex',
          justifyContent: 'center',
          bgcolor: 'black',
          borderRadius: 1,
          overflow: 'hidden',
          mb: 2,
          maxHeight: '50vh',
          cursor: 'pointer',
        }}
      >
        <Box sx={{ position: 'relative', display: 'inline-block', maxWidth: '100%', maxHeight: '50vh' }}>
          <img
            src={currentImage.objectUrl}
            alt={currentImage.filename}
            style={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: '50vh',
            }}
          />
          {detections?.length ? <DetectionBoxOverlay detections={detections} /> : null}
        </Box>
      </Box>

      {/* Classify image zoom modal */}
      <ImageViewerModal
        open={classifyViewerOpen}
        onClose={() => setClassifyViewerOpen(false)}
        images={filteredImageFiles.map((img) => ({
          src: img.objectUrl,
          alt: img.filename,
          caption: [
            img.filename,
            img.exifDate ? dayjs(img.exifDate).format('DD/MM/YYYY HH:mm:ss') : null,
          ].filter(Boolean).join(' — '),
        }))}
        initialIndex={currentImageIndex}
        renderOverlay={(viewerIdx) => {
          const viewOrigIdx = filteredToOriginalIndex[viewerIdx];
          const dets = viewOrigIdx !== undefined ? filterResults.get(viewOrigIdx)?.detections : undefined;
          return dets?.length ? <DetectionBoxOverlay detections={dets} /> : null;
        }}
      />

      {/* Image info */}
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
        {currentImage.filename}
        {currentImage.exifDate && (
          <> &mdash; {dayjs(currentImage.exifDate).format('DD/MM/YYYY HH:mm:ss')}</>
        )}
      </Typography>

      {/* Species selection */}
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
            inputRef={speciesInputRef}
            label="Select species"
            placeholder="Type to search..."
            size="small"
          />
        )}
        sx={{ mb: 2 }}
        clearOnBlur={false}
        blurOnSelect
      />

      {/* Navigation */}
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <IconButton onClick={goToPrev} disabled={currentImageIndex === 0}>
            <ArrowBack />
          </IconButton>
          <IconButton onClick={goToNext} disabled={currentImageIndex === filteredImageFiles.length - 1}>
            <ArrowForward />
          </IconButton>
        </Stack>
        {remainingCount > 0 && (
          <Button
            size="small"
            onClick={goToNextUnviewed}
            sx={{ textTransform: 'none' }}
          >
            Next unviewed →
          </Button>
        )}
      </Stack>

      {/* Thumbnail strip */}
      <Box
        ref={thumbnailStripRef}
        sx={{
          display: 'flex',
          gap: 0.5,
          overflow: 'auto',
          py: 1,
          '&::-webkit-scrollbar': { height: 6 },
          '&::-webkit-scrollbar-thumb': { bgcolor: 'divider', borderRadius: 3 },
        }}
      >
        {filteredImageFiles.map((img, idx) => {
          const thumbOrigIdx = filteredToOriginalIndex[idx];
          const hasClassifications = (classifications.get(thumbOrigIdx)?.length ?? 0) > 0;
          const hasPendingSuggestions = !hasClassifications &&
            (aiSuggestions.get(thumbOrigIdx) || []).some((s) => !s.dismissed);
          const isViewed = viewedImages.has(idx);
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
                opacity: isViewed ? 1 : 0.35,
                position: 'relative',
              }}
            >
              <img
                src={img.objectUrl}
                alt=""
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {hasClassifications && (
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
              {hasPendingSuggestions && (
                <SmartToy
                  sx={{
                    position: 'absolute',
                    top: 1,
                    right: 1,
                    fontSize: 14,
                    color: 'info.main',
                    bgcolor: 'white',
                    borderRadius: '50%',
                    p: '1px',
                  }}
                />
              )}
            </Box>
          );
        })}
      </Box>

      {remainingCount === 0 && (
        <Alert severity="success" sx={{ mt: 2 }}>
          All images reviewed! {uniqueSpeciesCount} species identified.
        </Alert>
      )}

      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => setActiveStep(2)}
          sx={{ textTransform: 'none' }}
        >
          Back
        </Button>
        <Button
          variant="contained"
          endIcon={<ArrowForward />}
          disabled={!canProceed(3)}
          onClick={() => setActiveStep(4)}
          sx={{ textTransform: 'none' }}
        >
          Next: Review ({uniqueSpeciesCount} species identified)
        </Button>
      </Box>
    </Paper>
  );
}
