import { useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Stack,
  Button,
  Alert,
  LinearProgress,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  ArrowBack,
  ArrowForward,
  FilterList,
  Restore,
  RemoveCircleOutline,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import dayjs from 'dayjs';
import type { CameraTrapWizardState } from '../../hooks/useCameraTrapWizard';
import { ImageViewerModal } from '../ImageViewerModal';
import { DetectionBoxOverlay } from '../DetectionBoxOverlay';
import { ThumbnailGrid, type ThumbnailGridItem } from '../ThumbnailGrid';
import { useArrowKeyNavigation } from '../../hooks/useArrowKeyNavigation';

interface FilterStepProps {
  wizard: CameraTrapWizardState;
}

export function FilterStep({ wizard }: FilterStepProps) {
  const {
    imageFiles, filterResults, filtering, filterProgress,
    filterError, setFilterError, runFiltering,
    filterReviewGroup, setFilterReviewGroup,
    filterReviewIdx, setFilterReviewIdx,
    toggleFilterOverride, filterDerived,
    showDetectionBoxes, toggleDetectionBoxes,
    canProceed, goBackToUpload, goToClassifyStep, skipFiltering,
    filteredImageFiles,
  } = wizard;

  const { summary, animalIndices, emptyIndices } = filterDerived;

  // Current review state
  const reviewIndices = filterReviewGroup === 'animal' ? animalIndices : filterReviewGroup === 'empty' ? emptyIndices : [];

  const goNextReview = useCallback(() => setFilterReviewIdx((prev) => Math.min(prev + 1, reviewIndices.length - 1)), [reviewIndices.length]);
  const goPrevReview = useCallback(() => setFilterReviewIdx((prev) => Math.max(0, prev - 1)), []);

  useArrowKeyNavigation({
    enabled: wizard.activeStep === 2 && filterReviewGroup !== null,
    onNext: goNextReview,
    onPrev: goPrevReview,
    onEscape: () => setFilterReviewGroup(null),
  });

  // Build ThumbnailGrid items for each group
  const animalGridItems: ThumbnailGridItem[] = useMemo(
    () => animalIndices.map((idx) => ({ key: idx, src: imageFiles[idx].objectUrl, alt: imageFiles[idx].filename })),
    [animalIndices, imageFiles],
  );
  const emptyGridItems: ThumbnailGridItem[] = useMemo(
    () => emptyIndices.map((idx) => ({ key: idx, src: imageFiles[idx].objectUrl, alt: imageFiles[idx].filename })),
    [emptyIndices, imageFiles],
  );

  const handleClickAnimal = useCallback((gridIdx: number) => {
    setFilterReviewGroup('animal');
    setFilterReviewIdx(gridIdx);
  }, [setFilterReviewGroup, setFilterReviewIdx]);

  const handleClickEmpty = useCallback((gridIdx: number) => {
    setFilterReviewGroup('empty');
    setFilterReviewIdx(gridIdx);
  }, [setFilterReviewGroup, setFilterReviewIdx]);

  return (
    <Paper sx={{ p: 3, boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
        <FilterList sx={{ mr: 1, verticalAlign: 'middle' }} />
        Filter False Positives
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        AI is analysing your images to identify and remove empty frames (false positives triggered by wind, vegetation, etc.).
      </Typography>

      {/* Progress during filtering */}
      {filtering && (
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Filtering image {filterProgress.processed} of {filterProgress.total}...
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {filterProgress.total > 0
                ? `${Math.round((filterProgress.processed / filterProgress.total) * 100)}%`
                : '0%'}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={filterProgress.total > 0 ? (filterProgress.processed / filterProgress.total) * 100 : 0}
            sx={{ height: 6, borderRadius: 3 }}
          />
        </Box>
      )}

      {/* Filter error */}
      {filterError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {filterError}
          <Button
            size="small"
            onClick={() => { setFilterError(null); runFiltering(); }}
            sx={{ ml: 1, textTransform: 'none' }}
          >
            Retry
          </Button>
        </Alert>
      )}

      {/* Results */}
      {!filtering && filterResults.size > 0 && (
        <>
          {/* Summary */}
          <Alert
            severity={summary.emptyCount > 0 ? 'success' : 'info'}
            sx={{ mb: 3 }}
          >
            {summary.emptyCount > 0 ? (
              <>
                Found <strong>{summary.animalCount}</strong> images with animals and{' '}
                <strong>{summary.emptyCount}</strong> empty/false positive images
                {summary.personCount > 0 && (
                  <> ({summary.personCount} with people)</>
                )}
                . Empty images will be excluded from classification.
              </>
            ) : (
              <>All {summary.animalCount} images appear to contain animals.</>
            )}
          </Alert>

          {/* Review modal */}
          <ImageViewerModal
            open={filterReviewGroup !== null && reviewIndices.length > 0}
            onClose={() => setFilterReviewGroup(null)}
            images={reviewIndices.map((origIdx) => {
              const img = imageFiles[origIdx];
              const r = filterResults.get(origIdx);
              return {
                src: img?.objectUrl ?? '',
                alt: img?.filename,
                caption: [
                  img?.filename,
                  img?.exifDate ? dayjs(img.exifDate).format('DD/MM/YYYY HH:mm:ss') : null,
                  r ? `${(r.max_confidence * 100).toFixed(0)}% confidence` : null,
                ].filter(Boolean).join(' — '),
              };
            })}
            initialIndex={filterReviewIdx}
            title={filterReviewGroup === 'animal' ? 'Images with Animals' : 'Empty / No Animal Detected'}
            renderOverlay={(viewerIdx) => {
              const origIdx = reviewIndices[viewerIdx];
              const detections = origIdx !== undefined ? filterResults.get(origIdx)?.detections : undefined;
              return showDetectionBoxes && detections?.length ? <DetectionBoxOverlay detections={detections} /> : null;
            }}
            renderActions={(viewerIdx) => {
              const origIdx = reviewIndices[viewerIdx];
              if (origIdx === undefined) return null;
              const detections = filterResults.get(origIdx)?.detections;
              return (
                <>
                  {detections?.length ? (
                    <Tooltip title={`${showDetectionBoxes ? 'Hide' : 'Show'} detection boxes (B)`}>
                      <IconButton size="small" onClick={toggleDetectionBoxes}>
                        {showDetectionBoxes ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  ) : null}
                  {filterReviewGroup === 'animal' ? (
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      startIcon={<RemoveCircleOutline />}
                      onClick={() => toggleFilterOverride(origIdx, 'exclude')}
                      sx={{ textTransform: 'none' }}
                    >
                      Exclude
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      variant="outlined"
                      color="success"
                      startIcon={<Restore />}
                      onClick={() => toggleFilterOverride(origIdx, 'include')}
                      sx={{ textTransform: 'none' }}
                    >
                      Restore
                    </Button>
                  )}
                </>
              );
            }}
          />

          {/* Images with Animals group */}
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography variant="subtitle2" fontWeight={600}>
                Images with Animals ({animalIndices.length})
              </Typography>
              {animalIndices.length > 0 && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => { setFilterReviewGroup('animal'); setFilterReviewIdx(0); }}
                  sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                >
                  Review
                </Button>
              )}
            </Box>
            {animalIndices.length > 0 ? (
              <ThumbnailGrid
                items={animalGridItems}
                onClickItem={handleClickAnimal}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                No animals detected in any images.
              </Typography>
            )}
          </Box>

          {/* Empty / No Animal group */}
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography variant="subtitle2" fontWeight={600}>
                Empty / No Animal Detected ({emptyIndices.length})
              </Typography>
              {emptyIndices.length > 0 && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => { setFilterReviewGroup('empty'); setFilterReviewIdx(0); }}
                  sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                >
                  Review
                </Button>
              )}
            </Box>
            {emptyIndices.length > 0 ? (
              <ThumbnailGrid
                items={emptyGridItems}
                onClickItem={handleClickEmpty}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                All images appear to contain animals.
              </Typography>
            )}
          </Box>
        </>
      )}

      {/* Navigation */}
      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
        <Button
          startIcon={<ArrowBack />}
          onClick={goBackToUpload}
          sx={{ textTransform: 'none' }}
        >
          Back
        </Button>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            onClick={skipFiltering}
            sx={{ textTransform: 'none' }}
          >
            Skip Filtering
          </Button>
          <Button
            variant="contained"
            endIcon={<ArrowForward />}
            disabled={!canProceed(2)}
            onClick={goToClassifyStep}
            sx={{ textTransform: 'none' }}
          >
            Next: Classify ({filteredImageFiles.length} images)
          </Button>
        </Stack>
      </Box>
    </Paper>
  );
}
