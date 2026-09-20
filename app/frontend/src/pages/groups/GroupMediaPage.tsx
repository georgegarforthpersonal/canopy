/**
 * Full media gallery for a group. Camera trap types: every species ever
 * recorded, each with its most recent photo (grid), most recently seen
 * first. Audio types: the same per species for detection clips (rows).
 * Sighting- and survey-photo types: the latest photos added, newest first,
 * which may repeat a species.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Box, ButtonBase, CircularProgress, Paper, Typography } from '@mui/material';
import {
  ApiError,
  imagesAPI,
  surveyTypesAPI,
  type RecentSpeciesClip,
  type RecentSpeciesPhoto,
  type SurveyTypeWithDetails,
} from '../../services/api';
import { groupCardSx, groupColors } from './groupsTokens';
import { resolveGroupTypeId } from './groupMeta';
import { formatRecordedDate, photoLabel } from './surveyState';
import GroupBreadcrumb from '../../components/groups/GroupBreadcrumb';
import { AudioClipPlayer } from '../../components/audio/AudioClipPlayer';
import { ImageViewerModal, type ImageViewerItem } from '../../components/ImageViewerModal';

type LoadedPhoto = RecentSpeciesPhoto & { url: string | null };

export default function GroupMediaPage() {
  const { id: typeId } = useParams<{ id: string }>();

  const [surveyType, setSurveyType] = useState<SurveyTypeWithDetails | null>(null);
  const [photos, setPhotos] = useState<LoadedPhoto[]>([]);
  const [clips, setClips] = useState<RecentSpeciesClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!typeId) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const surveyTypeId = await resolveGroupTypeId(typeId);
        if (!active) return;
        if (surveyTypeId == null) {
          setNotFound(true);
          return;
        }
        const [details, media] = await Promise.all([
          surveyTypesAPI.getById(surveyTypeId),
          surveyTypesAPI.getRecentMedia(surveyTypeId),
        ]);
        if (!active) return;
        setSurveyType(details);
        setClips(media.clips);
        const loaded = await Promise.all(
          media.photos.map(async (p): Promise<LoadedPhoto> => {
            try {
              const res = await imagesAPI.getPreviewUrl(p.camera_trap_image_id);
              return { ...p, url: res.preview_url };
            } catch {
              return { ...p, url: null };
            }
          }),
        );
        if (!active) return;
        setPhotos(loaded);
      } catch (err) {
        if (active) {
          if (err instanceof ApiError && err.status === 404) setNotFound(true);
          else setError(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [typeId]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ maxWidth: 900, mx: 'auto', px: { xs: 2, sm: 4 }, py: 4 }}>
        <GroupBreadcrumb crumbs={[{ label: 'Surveys', to: '/surveys' }, { label: 'Error' }]} />
        <Alert severity="error">Failed to load the species gallery. Please try again.</Alert>
      </Box>
    );
  }

  if (notFound || !surveyType) {
    return (
      <Box sx={{ maxWidth: 900, mx: 'auto', px: { xs: 2, sm: 4 }, py: 4 }}>
        <GroupBreadcrumb crumbs={[{ label: 'Surveys', to: '/surveys' }, { label: 'Not found' }]} />
        <Typography sx={{ color: groupColors.textSecondary }}>
          This group could not be found.
        </Typography>
      </Box>
    );
  }

  // The type's config decides the mode — inferring it from whichever list
  // happens to be non-empty would call an empty audio group a photo gallery.
  const isPhotos =
    surveyType.allow_image_upload || surveyType.allow_sighting_photo_upload || surveyType.allow_survey_photos;
  // Camera trap galleries show one latest photo per species; sighting- and
  // survey-photo galleries are a feed of the latest uploads.
  const feed =
    (surveyType.allow_sighting_photo_upload || surveyType.allow_survey_photos) && !surveyType.allow_image_upload;
  const photoAlt = feed ? 'Photo' : 'Camera trap photo';
  const total = isPhotos ? photos.length : clips.length;
  const viewerImages: ImageViewerItem[] = [];
  const viewerIndexOf = photos.map((p) => {
    if (!p.url) return null;
    viewerImages.push({
      src: p.url,
      alt: p.species_name ?? photoAlt,
      caption: `${photoLabel(p)} · ${formatRecordedDate(p.date)}`,
    });
    return viewerImages.length - 1;
  });
  // 'Recent', not 'All': the feed is capped (RECENT_PHOTO_FEED_CAP), and a
  // type with more photos than that keeps the rest on its survey pages.
  const galleryTitle = feed ? 'Recent photos' : 'All species';

  return (
    <Box sx={{ bgcolor: groupColors.page, minHeight: '100%', px: { xs: 2, sm: 4 }, py: { xs: 2, sm: 3 } }}>
      <Box sx={{ maxWidth: 900, mx: 'auto' }}>
        <GroupBreadcrumb
          crumbs={[
            { label: 'Surveys', to: '/surveys' },
            { label: surveyType.name, to: `/surveys/${typeId}` },
            { label: galleryTitle },
          ]}
        />

        <Typography sx={{ fontSize: 24, fontWeight: 600, color: groupColors.textPrimary }}>
          {galleryTitle}
        </Typography>
        <Typography sx={{ fontSize: 13.5, color: '#888', mb: 2 }}>
          {feed
            ? `${surveyType.name} · ${total} recent photo${total === 1 ? '' : 's'}, newest first`
            : `${surveyType.name} · ${total} species, each with its latest ${isPhotos ? 'photo' : 'detection'}, most recently seen first`}
        </Typography>

        <Paper sx={{ ...groupCardSx, p: total === 0 ? 0 : undefined }}>
          {total === 0 ? (
            <Box sx={{ px: 2.25, py: 3 }}>
              <Typography sx={{ fontSize: 13.5, color: groupColors.textMuted }}>
                Nothing recorded yet.
              </Typography>
            </Box>
          ) : isPhotos ? (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)' },
                gap: 1.5,
                p: 2.25,
              }}
            >
              {photos.map((p, i) => (
                <ButtonBase
                  key={p.camera_trap_image_id}
                  onClick={() => viewerIndexOf[i] != null && setViewerIndex(viewerIndexOf[i])}
                  sx={{ display: 'block', textAlign: 'left', borderRadius: '8px' }}
                >
                  {p.url ? (
                    <Box
                      component="img"
                      src={p.url}
                      alt={p.species_name ?? photoAlt}
                      sx={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: '8px', display: 'block' }}
                    />
                  ) : (
                    <Box sx={{ width: '100%', aspectRatio: '4 / 3', bgcolor: 'grey.200', borderRadius: '8px' }} />
                  )}
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: groupColors.textPrimary, mt: 0.5 }} noWrap>
                    {photoLabel(p)}
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: groupColors.textMuted }} noWrap>
                    {formatRecordedDate(p.date)}
                  </Typography>
                </ButtonBase>
              ))}
            </Box>
          ) : (
            clips.map((c, i) => (
              <Box
                key={c.species_id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.6,
                  px: 2.25,
                  py: 1.5,
                  borderTop: i === 0 ? 'none' : `1px solid ${groupColors.dividerInner}`,
                }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 600, color: groupColors.textPrimary }} noWrap>
                    {c.species_name ?? 'Unidentified'}
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: groupColors.textMuted }} noWrap>
                    {formatRecordedDate(c.date)}
                  </Typography>
                </Box>
                <AudioClipPlayer
                  audioRecordingId={c.audio_recording_id}
                  startTime={c.start_time}
                  endTime={c.end_time}
                  confidence={c.confidence}
                  timestamp={c.detection_timestamp}
                />
              </Box>
            ))
          )}
        </Paper>
      </Box>

      <ImageViewerModal
        open={viewerIndex != null}
        onClose={() => setViewerIndex(null)}
        images={viewerImages}
        initialIndex={viewerIndex ?? 0}
      />
    </Box>
  );
}
