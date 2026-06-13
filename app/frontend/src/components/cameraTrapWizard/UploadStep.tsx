import { useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  CircularProgress,
} from '@mui/material';
import { ArrowBack, ArrowForward, CloudUpload } from '@mui/icons-material';
import dayjs from 'dayjs';
import type { CameraTrapWizardState } from '../../hooks/useCameraTrapWizard';
import { ThumbnailGrid, type ThumbnailGridItem } from '../ThumbnailGrid';
import { ImageViewerModal } from '../ImageViewerModal';

interface UploadStepProps {
  wizard: CameraTrapWizardState;
}

export function UploadStep({ wizard }: UploadStepProps) {
  const {
    imageFiles, loadingImages, fileInputRef, handleFileSelect,
    canProceed, setActiveStep, goToFilterStep,
  } = wizard;

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerInitialIdx, setViewerInitialIdx] = useState(0);

  const thumbnailItems: ThumbnailGridItem[] = imageFiles.map((img, idx) => ({
    key: idx,
    src: img.objectUrl,
    alt: img.filename,
  }));

  const handleClickThumbnail = useCallback((index: number) => {
    setViewerInitialIdx(index);
    setViewerOpen(true);
  }, []);

  const renderOverlay = useCallback((index: number) => {
    const img = imageFiles[index];
    if (!img?.exifDate) return null;
    return (
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
    );
  }, [imageFiles]);

  return (
    <Paper sx={{ p: 3, boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
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
          <ThumbnailGrid
            items={thumbnailItems}
            onClickItem={handleClickThumbnail}
            renderOverlay={renderOverlay}
          />
          <ImageViewerModal
            open={viewerOpen}
            onClose={() => setViewerOpen(false)}
            images={imageFiles.map((img) => ({
              src: img.objectUrl,
              alt: img.filename,
              caption: [
                img.filename,
                img.exifDate ? dayjs(img.exifDate).format('DD/MM/YYYY HH:mm:ss') : null,
              ].filter(Boolean).join(' — '),
            }))}
            initialIndex={viewerInitialIdx}
            title="Image Preview"
          />
        </>
      )}

      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => setActiveStep(0)}
          sx={{ textTransform: 'none' }}
        >
          Back to Setup
        </Button>
        <Button
          variant="contained"
          endIcon={<ArrowForward />}
          disabled={!canProceed(1)}
          onClick={goToFilterStep}
          sx={{ textTransform: 'none' }}
        >
          Next: Filter Images
        </Button>
      </Box>
    </Paper>
  );
}
