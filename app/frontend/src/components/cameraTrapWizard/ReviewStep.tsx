import { useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Stack,
  Button,
  Alert,
  Checkbox,
  Chip,
} from '@mui/material';
import { ArrowBack, Save, PhotoCamera } from '@mui/icons-material';
import { useResponsive } from '../../hooks/useResponsive';
import type { CameraTrapWizardState } from '../../hooks/useCameraTrapWizard';
import { ThumbnailGrid, type ThumbnailGridItem } from '../ThumbnailGrid';

interface ReviewStepProps {
  wizard: CameraTrapWizardState;
}

export function ReviewStep({ wizard }: ReviewStepProps) {
  const {
    imageFiles, reviewData, deselectedImages, selectedImageCount,
    toggleImageSelection, canProceed, setActiveStep, handleSave,
  } = wizard;

  const { isMobile } = useResponsive();

  return (
    <Paper sx={{ p: 3, boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
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
        {reviewData.map(({ speciesId, speciesName, imageIndices }) => (
          <ReviewSpeciesGroup
            key={speciesId}
            speciesId={speciesId}
            speciesName={speciesName}
            imageIndices={imageIndices}
            imageFiles={imageFiles}
            deselectedImages={deselectedImages}
            toggleImageSelection={toggleImageSelection}
          />
        ))}
      </Stack>

      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => setActiveStep(3)}
          sx={{ textTransform: 'none' }}
        >
          Back to Classify
        </Button>
        <Button
          variant="contained"
          startIcon={<Save />}
          disabled={!canProceed(4)}
          onClick={() => { setActiveStep(5); handleSave(); }}
          sx={{ textTransform: 'none' }}
        >
          {isMobile
            ? `Save (${selectedImageCount} images)`
            : `Save Survey (${selectedImageCount} images)`}
        </Button>
      </Box>
    </Paper>
  );
}

/** Per-species thumbnail group within the Review step */
function ReviewSpeciesGroup({
  speciesId,
  speciesName,
  imageIndices,
  imageFiles,
  deselectedImages,
  toggleImageSelection,
}: {
  speciesId: number;
  speciesName: string;
  imageIndices: number[];
  imageFiles: { objectUrl: string; filename: string }[];
  deselectedImages: Set<string>;
  toggleImageSelection: (speciesId: number, imageIndex: number) => void;
}) {
  const selectedCount = imageIndices.filter(
    (idx) => !deselectedImages.has(`${speciesId}-${idx}`),
  ).length;

  const gridItems: ThumbnailGridItem[] = useMemo(
    () => imageIndices.map((idx) => ({ key: idx, src: imageFiles[idx].objectUrl, alt: imageFiles[idx].filename })),
    [imageIndices, imageFiles],
  );

  const handleClick = useCallback(
    (gridIdx: number) => toggleImageSelection(speciesId, imageIndices[gridIdx]),
    [speciesId, imageIndices, toggleImageSelection],
  );

  const getItemSx = useCallback(
    (gridIdx: number) => {
      const isSelected = !deselectedImages.has(`${speciesId}-${imageIndices[gridIdx]}`);
      return {
        opacity: isSelected ? 1 : 0.4,
        border: isSelected ? '2px solid' : '2px solid transparent',
        borderColor: isSelected ? 'primary.main' : 'transparent',
        transition: 'opacity 0.15s',
      };
    },
    [speciesId, imageIndices, deselectedImages],
  );

  const renderOverlay = useCallback(
    (gridIdx: number) => {
      const isSelected = !deselectedImages.has(`${speciesId}-${imageIndices[gridIdx]}`);
      return (
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
          onChange={() => toggleImageSelection(speciesId, imageIndices[gridIdx])}
        />
      );
    },
    [speciesId, imageIndices, deselectedImages, toggleImageSelection],
  );

  return (
    <Box>
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
      <ThumbnailGrid
        items={gridItems}
        onClickItem={handleClick}
        getItemSx={getItemSx}
        renderOverlay={renderOverlay}
      />
    </Box>
  );
}
