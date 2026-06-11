import {
  Typography,
  Paper,
  Button,
  Alert,
  CircularProgress,
  LinearProgress,
} from '@mui/material';
import { CheckCircle } from '@mui/icons-material';

export interface SaveStepWizard {
  saving: boolean;
  saveProgress: { step: string; percent: number };
  error: string | null;
  setError: (e: string | null) => void;
  handleSave: () => void;
  /** True when a failed attempt left partial progress that retrying will resume */
  hasPartialSave?: boolean;
}

interface SaveStepProps {
  wizard: SaveStepWizard;
}

export function SaveStep({ wizard }: SaveStepProps) {
  const { saving, saveProgress, error, setError, handleSave, hasPartialSave } = wizard;

  return (
    <Paper sx={{ p: 3, textAlign: 'center', boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
      {saving ? (
        <>
          <CircularProgress sx={{ mb: 2 }} />
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            {saveProgress.step}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={saveProgress.percent}
            sx={{ height: 8, borderRadius: 4, maxWidth: 400, mx: 'auto' }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {saveProgress.percent}%
          </Typography>
        </>
      ) : error ? (
        <>
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
          <Button
            variant="contained"
            onClick={() => { setError(null); handleSave(); }}
            sx={{ textTransform: 'none' }}
          >
            {hasPartialSave ? 'Retry (resumes where it left off)' : 'Retry'}
          </Button>
        </>
      ) : (
        <>
          <CheckCircle sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
          <Typography variant="h6">Survey saved successfully!</Typography>
        </>
      )}
    </Paper>
  );
}
