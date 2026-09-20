/**
 * Media gallery panel for groups. For camera trap types (perSpecies): each
 * species' MOST RECENT photo, ordered by how recently the species was last
 * seen — one look at what's around, without one busy badger monopolising the
 * strip. For sighting- and survey-photo types (!perSpecies): a feed of the
 * latest photos added, which may repeat a species. 'clips' lists each
 * species' latest audio detection. Capped, with a door to the full gallery
 * page. Photos open in the shared image viewer; clips play in place via
 * AudioClipPlayer.
 */
import { useEffect, useState } from 'react';
import { Box, Paper, Typography, CircularProgress, ButtonBase } from '@mui/material';
import { ChevronRight } from '@mui/icons-material';
import {
  imagesAPI,
  surveyTypesAPI,
  type RecentSpeciesClip,
  type RecentSpeciesPhoto,
} from '../../services/api';
import { AudioClipPlayer } from '../audio/AudioClipPlayer';
import { ImageViewerModal, type ImageViewerItem } from '../ImageViewerModal';
import { groupCardSx, groupColors } from '../../pages/groups/groupsTokens';
import { formatRecordedDateShort, photoLabel } from '../../pages/groups/surveyState';

/** Species shown on the panel before the "All species" door takes over. */
const PHOTO_PANEL_CAP = 8;
const CLIP_PANEL_CAP = 6;

interface RecentMediaPanelProps {
  kind: 'photos' | 'clips';
  /** One latest photo per species (camera trap) vs a feed of the most
      recent photos. Only meaningful for kind 'photos'. */
  perSpecies?: boolean;
  surveyTypeId: number;
  onViewAll: () => void;
}

type LoadedPhoto = RecentSpeciesPhoto & { url: string | null };

export default function RecentMediaPanel({ kind, perSpecies = true, surveyTypeId, onViewAll }: RecentMediaPanelProps) {
  const [photos, setPhotos] = useState<LoadedPhoto[]>([]);
  const [clips, setClips] = useState<RecentSpeciesClip[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const media = await surveyTypesAPI.getRecentMedia(surveyTypeId);
        if (!active) return;
        if (kind === 'clips') {
          setTotal(media.clips.length);
          setClips(media.clips.slice(0, CLIP_PANEL_CAP));
        } else {
          setTotal(media.photos.length);
          // Preview URLs are presigned per image; a failed one just leaves a
          // grey tile rather than sinking the whole strip.
          const loaded = await Promise.all(
            media.photos.slice(0, PHOTO_PANEL_CAP).map(async (p): Promise<LoadedPhoto> => {
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
        }
      } catch {
        if (active) {
          setPhotos([]);
          setClips([]);
          setTotal(0);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [kind, surveyTypeId]);

  // Three copy flavours: audio clips, the camera trap per-species gallery,
  // and the sighting-photo feed.
  const feed = kind === 'photos' && !perSpecies;
  const title =
    kind === 'clips' ? 'Latest detections by species'
    : feed ? 'Recent photos'
    : 'Latest by species';
  const photoAlt = feed ? 'Photo' : 'Camera trap photo';
  const empty = kind === 'photos' ? photos.length === 0 : clips.length === 0;
  // The viewer skips tiles whose preview URL failed, so map each photo to its
  // viewer slot by position.
  const viewerImages: ImageViewerItem[] = [];
  const viewerIndexOf = photos.map((p) => {
    if (!p.url) return null;
    viewerImages.push({
      src: p.url,
      alt: p.species_name ?? photoAlt,
      caption: `${photoLabel(p)} · ${formatRecordedDateShort(p.date)}`,
    });
    return viewerImages.length - 1;
  });

  return (
    <Paper sx={groupCardSx}>
      <Box sx={{ px: 2.25, py: 1.75, borderBottom: `1px solid ${groupColors.divider}` }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: groupColors.textPrimary }}>
          {title}
        </Typography>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={22} />
        </Box>
      ) : empty ? (
        <Box sx={{ px: 2.25, py: 3 }}>
          <Typography sx={{ fontSize: 13.5, color: groupColors.textMuted }}>
            {kind === 'clips'
              ? 'No detections yet — each species appears here with its latest clip.'
              : feed
                ? 'No photos yet — the latest photos added appear here.'
                : 'No photos yet — each species appears here with its latest photo.'}
          </Typography>
        </Box>
      ) : kind === 'photos' ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' },
            gap: 1.25,
            px: 2.25,
            py: 1.75,
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
              <Typography sx={{ fontSize: 12, fontWeight: 600, color: groupColors.textPrimary, mt: 0.5 }} noWrap>
                {photoLabel(p)}
              </Typography>
              <Typography sx={{ fontSize: 11, color: groupColors.textMuted }} noWrap>
                {formatRecordedDateShort(p.date)}
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
              py: 1.4,
              borderTop: i === 0 ? 'none' : `1px solid ${groupColors.dividerInner}`,
            }}
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: groupColors.textPrimary }} noWrap>
                {c.species_name ?? 'Unidentified'}
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: groupColors.textMuted }} noWrap>
                {formatRecordedDateShort(c.date)}
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

      {!loading && total > 0 && (
        <ButtonBase
          onClick={onViewAll}
          sx={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 1.6,
            px: 2.25,
            py: 1.6,
            borderTop: `1px solid ${groupColors.dividerInner}`,
            textAlign: 'left',
            '&:hover': { bgcolor: '#f9fbf9' },
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: groupColors.textPrimary }}>
              {feed ? 'Recent photos' : 'All species'}
            </Typography>
            <Typography sx={{ fontSize: 12, color: groupColors.textMuted }}>
              {kind === 'clips'
                ? `${total} species detected`
                : feed
                  ? `${total} recent photo${total === 1 ? '' : 's'}`
                  : `${total} species photographed`}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, color: groupColors.brand, flexShrink: 0 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>View all</Typography>
            <ChevronRight sx={{ fontSize: 18 }} />
          </Box>
        </ButtonBase>
      )}

      <ImageViewerModal
        open={viewerIndex != null}
        onClose={() => setViewerIndex(null)}
        images={viewerImages}
        initialIndex={viewerIndex ?? 0}
      />
    </Paper>
  );
}
