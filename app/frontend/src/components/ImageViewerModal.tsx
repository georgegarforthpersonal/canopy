import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { Box, Dialog, DialogContent, IconButton, Stack, Typography } from '@mui/material';
import { ArrowBack, ArrowForward, Close } from '@mui/icons-material';
import { useResponsive } from '../hooks/useResponsive';

export interface ImageViewerItem {
  src: string;
  alt?: string;
  caption?: string;
}

export interface ImageViewerModalProps {
  open: boolean;
  onClose: () => void;
  images: ImageViewerItem[];
  initialIndex?: number;
  title?: string;
  /** Render overlay content (e.g. bounding boxes) absolutely positioned over the image */
  renderOverlay?: (index: number) => ReactNode;
  /** Render action buttons in the header toolbar */
  renderActions?: (index: number) => ReactNode;
}

export function ImageViewerModal({
  open,
  onClose,
  images,
  initialIndex = 0,
  title,
  renderOverlay,
  renderActions,
}: ImageViewerModalProps) {
  const { isMobile } = useResponsive();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  // Reset index when modal opens or initialIndex changes
  useEffect(() => {
    if (open) setCurrentIndex(initialIndex);
  }, [open, initialIndex]);

  // Clamp to valid range
  const idx = Math.max(0, Math.min(currentIndex, images.length - 1));
  const image = images[idx];

  const goNext = useCallback(() => {
    setCurrentIndex((prev) => Math.min(images.length - 1, prev + 1));
  }, [images.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, goNext, goPrev, onClose]);

  if (!image) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      fullScreen={isMobile}
      PaperProps={isMobile ? undefined : { sx: { maxHeight: '90vh' } }}
    >
      <DialogContent sx={{ p: 2 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Box>
            {title && (
              <Typography variant="body2" fontWeight={600}>
                {title}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              {image.caption && <>{image.caption} &mdash; </>}
              {idx + 1} of {images.length}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            {renderActions?.(idx)}
            <IconButton onClick={onClose} size="small">
              <Close />
            </IconButton>
          </Stack>
        </Box>

        {/* Image with optional overlay */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            bgcolor: 'black',
            borderRadius: 1,
            overflow: 'hidden',
            mb: 1,
          }}
        >
          <Box sx={{ position: 'relative', display: 'inline-block', maxWidth: '100%', maxHeight: '65vh' }}>
            <img
              src={image.src}
              alt={image.alt ?? ''}
              style={{ display: 'block', maxWidth: '100%', maxHeight: '65vh' }}
            />
            {renderOverlay?.(idx)}
          </Box>
        </Box>

        {/* Navigation */}
        {images.length > 1 && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Stack direction="row" spacing={1}>
              <IconButton onClick={goPrev} disabled={idx === 0}>
                <ArrowBack />
              </IconButton>
              <IconButton onClick={goNext} disabled={idx === images.length - 1}>
                <ArrowForward />
              </IconButton>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Use arrow keys to navigate
            </Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
