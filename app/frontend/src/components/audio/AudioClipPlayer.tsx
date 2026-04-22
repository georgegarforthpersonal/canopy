import { useState, useRef, useEffect } from 'react';
import { Box, IconButton, Typography, CircularProgress, Tooltip } from '@mui/material';
import { PlayArrow, Stop } from '@mui/icons-material';
import { audioAPI } from '../../services/api';
import { parseTimeToSeconds } from '../../utils/time';

interface AudioClipPlayerProps {
  audioRecordingId?: number;
  audioUrl?: string; // Direct URL (e.g. object URL for local files)
  startTime: string; // HH:MM:SS format
  endTime: string;   // HH:MM:SS format
  confidence: number; // 0-1
  /** Absolute wall-clock time of the detection. ISO string or null. */
  timestamp?: string | null;
}

/** Format an ISO datetime as "YYYY-MM-DD HH:MM:SS" in the viewer's local time. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * AudioClipPlayer - Plays a specific time range of an audio file
 *
 * Shows a play button with confidence percentage. When clicked, fetches
 * the presigned URL and plays the audio from startTime to endTime.
 */
export function AudioClipPlayer({
  audioRecordingId,
  audioUrl,
  startTime,
  endTime,
  confidence,
  timestamp,
}: AudioClipPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const checkIntervalRef = useRef<number | null>(null);

  const startSeconds = parseTimeToSeconds(startTime);
  const endSeconds = parseTimeToSeconds(endTime);
  const confidencePercent = Math.round(confidence * 100);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, []);

  const handlePlay = async () => {
    if (isPlaying) {
      // Stop playback
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
      setIsPlaying(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Use direct URL if provided, otherwise fetch presigned URL
      let baseUrl: string;
      if (audioUrl) {
        baseUrl = audioUrl;
      } else if (audioRecordingId) {
        const { download_url } = await audioAPI.getDownloadUrl(audioRecordingId);
        baseUrl = download_url;
      } else {
        setError('No audio source');
        setIsLoading(false);
        return;
      }

      // Use Media Fragments URI to specify time range
      // This helps browsers handle seeking in large remote files
      const urlWithFragment = `${baseUrl}#t=${startSeconds},${endSeconds}`;

      // Create audio element
      const audio = new Audio(urlWithFragment);
      audioRef.current = audio;

      // For seeking in remote files, we need to wait for metadata and handle seeking manually
      audio.preload = 'metadata';

      const attemptSeekAndPlay = () => {
        // Try to seek to start position
        try {
          audio.currentTime = startSeconds;
        } catch {
          // Some browsers may not support seeking before enough data is loaded
          console.warn('Could not seek to start time, playing from current position');
        }

        audio.play().then(() => {
          setIsLoading(false);
          setIsPlaying(true);

          // Set up interval to check if we've reached end time
          checkIntervalRef.current = window.setInterval(() => {
            if (audio.currentTime >= endSeconds || audio.ended) {
              audio.pause();
              setIsPlaying(false);
              if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current);
                checkIntervalRef.current = null;
              }
            }
          }, 100);
        }).catch((playError) => {
          console.error('Play error:', playError);
          setError('Failed to play audio');
          setIsLoading(false);
        });
      };

      // Handle when we can seek
      audio.onseeked = () => {
        // Successfully seeked, now play
      };

      // When metadata is loaded, try to seek and play
      audio.onloadedmetadata = () => {
        attemptSeekAndPlay();
      };

      // Fallback: if canplay fires first
      audio.oncanplay = () => {
        if (isLoading) {
          attemptSeekAndPlay();
        }
      };

      audio.onended = () => {
        setIsPlaying(false);
        if (checkIntervalRef.current) {
          clearInterval(checkIntervalRef.current);
          checkIntervalRef.current = null;
        }
      };

      audio.onerror = (e) => {
        console.error('Audio error:', e);
        setError('Failed to load audio');
        setIsLoading(false);
        setIsPlaying(false);
      };

      // Start loading
      audio.load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audio');
      setIsLoading(false);
    }
  };

  const baseTitle = `Play detection clip (${confidencePercent}% confidence)`;
  const tooltipTitle = error
    ? error
    : timestamp
      ? `${formatTimestamp(timestamp)} — ${baseTitle}`
      : baseTitle;

  return (
    <Tooltip
      title={tooltipTitle}
      arrow
    >
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          bgcolor: error ? 'error.light' : isPlaying ? 'primary.light' : 'grey.100',
          borderRadius: 1,
          px: 0.5,
          py: 0.25,
          cursor: 'pointer',
          transition: 'background-color 0.2s',
          '&:hover': {
            bgcolor: error ? 'error.light' : isPlaying ? 'primary.main' : 'grey.200',
          },
        }}
        onClick={handlePlay}
      >
        {isLoading ? (
          <CircularProgress size={18} sx={{ m: 0.5 }} />
        ) : (
          <IconButton
            size="small"
            sx={{
              p: 0.25,
              color: error ? 'error.main' : isPlaying ? 'primary.contrastText' : 'primary.main',
            }}
          >
            {isPlaying ? <Stop fontSize="small" /> : <PlayArrow fontSize="small" />}
          </IconButton>
        )}
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            color: error ? 'error.main' : isPlaying ? 'primary.contrastText' : 'text.primary',
            pr: 0.5,
          }}
        >
          {confidencePercent}%
        </Typography>
      </Box>
    </Tooltip>
  );
}
