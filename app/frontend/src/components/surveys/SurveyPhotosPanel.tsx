import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { AddAPhoto } from '@mui/icons-material';
import { imagesAPI } from '../../services/api';
import type { CameraTrapImage } from '../../services/api';
import { ImageViewerModal, type ImageViewerItem } from '../ImageViewerModal';
import { downscalePhotos } from '../../utils/downscalePhoto';
import {
  SURVEY_PHOTO_ACCEPT,
  orderSurveyPhotos,
  partitionSurveyPhotoFiles,
  rejectedPhotosMessage,
} from '../../config/surveyPhotos';

/**
 * Thumbnail that lazily resolves a presigned preview URL, filling its grid cell.
 * Same lifecycle as the sighting thumbnails, sized for a gallery rather than a row.
 */
function SurveyPhotoThumbnail({ imageId, alt }: { imageId: number; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    imagesAPI
      .getPreviewUrl(imageId)
      .then((res) => {
        if (mounted) setUrl(res.preview_url);
      })
      .catch(() => {
        /* a missing preview just leaves the placeholder in place */
      });
    return () => {
      mounted = false;
    };
  }, [imageId]);

  if (!url) {
    return <Box sx={{ width: '100%', aspectRatio: '4 / 3', bgcolor: 'grey.200', borderRadius: 1 }} />;
  }

  return (
    <Box
      component="img"
      src={url}
      alt={alt}
      loading="lazy"
      sx={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 1, display: 'block' }}
    />
  );
}

export interface SurveyPhotosPanelProps {
  surveyId: number;
  /** Editors get the upload control; everyone else just browses. */
  canEdit: boolean;
}

/**
 * Photos of the survey itself: habitat and landscape shots, or scanned report
 * plates, that describe the visit rather than any one sighting. Shown when the
 * survey type has allow_survey_photos.
 *
 * Uploads skip processing, so nothing is queued for AI inference.
 */
export function SurveyPhotosPanel({ surveyId, canEdit }: SurveyPhotosPanelProps) {
  const [photos, setPhotos] = useState<CameraTrapImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [viewerImages, setViewerImages] = useState<ImageViewerItem[]>([]);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  const loadPhotos = useCallback(async () => {
    try {
      // Photos attached to individual sightings stay out of this gallery —
      // they already show on their sighting rows.
      const images = await imagesAPI.getImages(surveyId, true);
      setPhotos(orderSurveyPhotos(images));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load photos');
    }
  }, [surveyId]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    loadPhotos().finally(() => {
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [loadPhotos]);

  const openViewer = async (clickedId: number) => {
    const items = await Promise.all(
      photos.map(async (photo) => {
        try {
          const res = await imagesAPI.getPreviewUrl(photo.id);
          return { id: photo.id, src: res.preview_url, alt: photo.filename, caption: photo.filename };
        } catch {
          return { id: photo.id, src: '', alt: photo.filename, caption: photo.filename };
        }
      })
    );
    // Failed preview fetches drop out, so find the clicked photo's position
    // in the surviving list — a grid index would point at the wrong image.
    const usable = items.filter((item) => item.src);
    setViewerImages(usable.map(({ id: _id, ...item }) => item));
    setViewerIndex(Math.max(0, usable.findIndex((item) => item.id === clickedId)));
    setViewerOpen(true);
  };

  const handleFilesChosen = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const { accepted, rejected } = partitionSurveyPhotoFiles(Array.from(fileList));
    setNotice(rejectedPhotosMessage(rejected));
    if (accepted.length === 0) {
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const prepared = await downscalePhotos(accepted);
      // Recovers from duplicate-filename 400s (phone capture names repeat),
      // same as the sighting-photo upload sites.
      await imagesAPI.uploadFilesRecoveringDuplicates(surveyId, prepared, undefined, true);
      await loadPhotos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload photos');
    } finally {
      setUploading(false);
      // Clearing lets the same file be picked again after a failed attempt.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Paper
      sx={{
        p: { xs: 2, sm: 2.5, md: 3 },
        mb: { xs: 2, md: 3 },
        boxShadow: 'none',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 2 }}
      >
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Photos{photos.length > 0 ? ` (${photos.length})` : ''}
        </Typography>
        {canEdit && (
          <Button
            component="label"
            variant="outlined"
            size="small"
            startIcon={uploading ? <CircularProgress size={16} /> : <AddAPhoto />}
            disabled={uploading}
            sx={{ textTransform: 'none', fontWeight: 600, flexShrink: 0 }}
          >
            {uploading ? 'Uploading...' : 'Add photos'}
            <input
              ref={inputRef}
              type="file"
              hidden
              multiple
              accept={SURVEY_PHOTO_ACCEPT}
              onChange={(e) => handleFilesChosen(e.target.files)}
            />
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} />
        </Box>
      ) : photos.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
          {canEdit
            ? 'No photos yet. Add habitat or landscape shots for this survey.'
            : 'No photos for this survey.'}
        </Typography>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(auto-fill, minmax(100px, 1fr))',
              sm: 'repeat(auto-fill, minmax(140px, 1fr))',
              md: 'repeat(auto-fill, minmax(170px, 1fr))',
            },
            gap: { xs: 1, sm: 1.5 },
          }}
        >
          {photos.map((photo, idx) => (
            <Box
              key={photo.id}
              onClick={() => openViewer(photo.id)}
              title={photo.filename}
              sx={{
                cursor: 'pointer',
                borderRadius: 1,
                overflow: 'hidden',
                transition: 'opacity 0.15s',
                '&:hover': { opacity: 0.85 },
              }}
            >
              <SurveyPhotoThumbnail imageId={photo.id} alt={photo.filename} />
            </Box>
          ))}
        </Box>
      )}

      <ImageViewerModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        images={viewerImages}
        initialIndex={viewerIndex}
        title="Survey photos"
      />
    </Paper>
  );
}
