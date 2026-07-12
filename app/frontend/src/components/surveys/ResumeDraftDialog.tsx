import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import dayjs from 'dayjs';

interface ResumeDraftDialogProps {
  open: boolean;
  /** When the draft was last backed up (epoch ms). */
  savedAt: number;
  /** Re-enter the form with the draft applied. */
  onResume: () => void;
  /** Delete the draft and continue with the server state. */
  onDiscard: () => void;
}

const formatSavedAt = (savedAt: number): string => {
  const saved = dayjs(savedAt);
  return saved.isSame(dayjs(), 'day') ? saved.format('HH:mm') : saved.format('D MMM, HH:mm');
};

/**
 * Offered when a survey with an unsaved local draft is reopened — e.g. the
 * tab was killed in the field, or a save never went through. Resume is the
 * safe default; Discard permanently deletes the local copy.
 */
export function ResumeDraftDialog({ open, savedAt, onResume, onDiscard }: ResumeDraftDialogProps) {
  return (
    <Dialog open={open} onClose={onResume}>
      <DialogTitle>Resume unsaved survey?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Survey entries saved on this device at {formatSavedAt(savedAt)} were never uploaded.
          You can pick up where you left off, or discard them and start from the last uploaded
          version.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onDiscard} color="error" sx={{ textTransform: 'none' }}>
          Discard
        </Button>
        <Button onClick={onResume} variant="contained" autoFocus sx={{ textTransform: 'none' }}>
          Resume
        </Button>
      </DialogActions>
    </Dialog>
  );
}
