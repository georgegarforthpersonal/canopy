/**
 * Recent-media panel for unscheduled media groups: a strip of the latest
 * camera trap photos ('photos') or audio detection clips ('clips'), flattened
 * from the sightings of the group's most recent surveys (the same list the
 * Record panel shows). Photos open in the shared image viewer; clips play in
 * place via AudioClipPlayer.
 */
import { useEffect, useState } from 'react';
import { Box, Paper, Typography, CircularProgress, ButtonBase } from '@mui/material';
import { imagesAPI, surveysAPI, type Sighting, type Survey } from '../../services/api';
import { AudioClipPlayer } from '../audio/AudioClipPlayer';
import { ImageViewerModal, type ImageViewerItem } from '../ImageViewerModal';
import { groupCardSx, groupColors } from '../../pages/groups/groupsTokens';
import { formatRecordedDate } from '../../pages/groups/surveyState';
import {
  collectRecentClips,
  collectRecentPhotos,
  type RecentClip,
  type RecentPhoto,
} from '../../pages/groups/recentMedia';

interface RecentMediaPanelProps {
  kind: 'photos' | 'clips';
  /** The group's most recent surveys, newest first. */
  surveys: Survey[];
}

type LoadedPhoto = RecentPhoto & { url: string | null };

export default function RecentMediaPanel({ kind, surveys }: RecentMediaPanelProps) {
  const [photos, setPhotos] = useState<LoadedPhoto[]>([]);
  const [clips, setClips] = useState<RecentClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const sightingsBySurvey = new Map<number, Sighting[]>(
          await Promise.all(
            surveys.map(async (s) => [s.id, await surveysAPI.getSightings(s.id)] as const),
          ),
        );
        if (!active) return;
        if (kind === 'clips') {
          setClips(collectRecentClips(surveys, sightingsBySurvey));
        } else {
          const collected = collectRecentPhotos(surveys, sightingsBySurvey);
          // Preview URLs are presigned per image; a failed one just leaves a
          // grey tile rather than sinking the whole strip.
          const loaded = await Promise.all(
            collected.map(async (p): Promise<LoadedPhoto> => {
              try {
                const res = await imagesAPI.getPreviewUrl(p.imageId);
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
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [kind, surveys]);

  const title = kind === 'photos' ? 'Recent photos' : 'Recent detections';
  const empty = kind === 'photos' ? photos.length === 0 : clips.length === 0;
  const viewerImages: ImageViewerItem[] = photos
    .filter((p) => p.url)
    .map((p) => ({ src: p.url as string, alt: p.speciesName ?? 'Camera trap photo', caption: p.speciesName ?? undefined }));

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
            {kind === 'photos'
              ? 'No photos yet — they appear here once camera trap surveys are recorded.'
              : 'No detections yet — they appear here once audio surveys are recorded.'}
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
          {photos.map((p) => (
            <ButtonBase
              key={p.imageId}
              onClick={() => p.url && setViewerIndex(viewerImages.findIndex((v) => v.src === p.url))}
              sx={{ display: 'block', textAlign: 'left', borderRadius: '8px' }}
            >
              {p.url ? (
                <Box
                  component="img"
                  src={p.url}
                  alt={p.speciesName ?? 'Camera trap photo'}
                  sx={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: '8px', display: 'block' }}
                />
              ) : (
                <Box sx={{ width: '100%', aspectRatio: '4 / 3', bgcolor: 'grey.200', borderRadius: '8px' }} />
              )}
              <Typography sx={{ fontSize: 12, color: groupColors.textSecondary, mt: 0.5 }} noWrap>
                {p.speciesName ?? 'Unidentified'}
              </Typography>
            </ButtonBase>
          ))}
        </Box>
      ) : (
        clips.map((c, i) => (
          <Box
            key={`${c.clip.audio_recording_id}-${c.clip.start_time}-${i}`}
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
                {c.speciesName ?? 'Unidentified'}
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: groupColors.textMuted }} noWrap>
                {formatRecordedDate(c.date)}
              </Typography>
            </Box>
            <AudioClipPlayer
              audioRecordingId={c.clip.audio_recording_id}
              startTime={c.clip.start_time}
              endTime={c.clip.end_time}
              confidence={c.clip.confidence}
              timestamp={c.clip.detection_timestamp}
            />
          </Box>
        ))
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
