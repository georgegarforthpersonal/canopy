import {
  Box,
  Typography,
  Paper,
  Stack,
  Button,
  Alert,
  CircularProgress,
  LinearProgress,
} from '@mui/material';
import { ArrowBack, ArrowForward, CloudUpload, AudioFile, Warning } from '@mui/icons-material';
import type { AudioWizardState } from '../../hooks/useAudioWizard';

interface UploadStepProps {
  wizard: AudioWizardState;
}

export function UploadStep({ wizard }: UploadStepProps) {
  const {
    audioFiles, loadingFiles, fileInputRef, handleFileSelect,
    processing, processPhase, processProgress, processError, setProcessError, fileErrors, runProcessing,
    detections, unmatchedSpecies, reviewData,
    canProceed, setActiveStep,
  } = wizard;

  const hasFiles = audioFiles.length > 0;
  const isProcessed = !processing && detections.length > 0;
  const phaseLabel = processPhase === 'uploading' ? 'Uploading' : 'Analysing';

  return (
    <Paper sx={{ p: 3, boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
        Upload Audio Files
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Select WAV audio files from your recorder. Files will be uploaded and analysed with BirdNET to detect species.
      </Typography>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".wav,.WAV"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      <Button
        variant="outlined"
        startIcon={loadingFiles ? <CircularProgress size={20} /> : <CloudUpload />}
        onClick={() => fileInputRef.current?.click()}
        disabled={loadingFiles || processing}
        sx={{ textTransform: 'none', mb: 2 }}
      >
        {loadingFiles ? 'Loading...' : 'Select Audio Files'}
      </Button>

      {/* File list */}
      {hasFiles && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            <strong>{audioFiles.length}</strong> file{audioFiles.length !== 1 ? 's' : ''} selected
          </Typography>
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', maxHeight: 200, overflowY: 'auto' }}>
            {audioFiles.map((af, idx) => (
              <Stack
                key={idx}
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                  px: 1.5, py: 0.75,
                  borderBottom: idx < audioFiles.length - 1 ? '1px solid' : 'none',
                  borderColor: 'divider',
                }}
              >
                <AudioFile sx={{ fontSize: 18, color: 'text.secondary' }} />
                <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
                  {af.filename}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                  {(af.file.size / (1024 * 1024)).toFixed(1)} MB
                </Typography>
              </Stack>
            ))}
          </Box>
        </Box>
      )}

      {/* Processing progress */}
      {processing && (
        <Box sx={{ mb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" fontWeight={600}>
              {phaseLabel} file {Math.min(processProgress.processed + 1, processProgress.total)} of {processProgress.total}
            </Typography>
          </Stack>
          {processProgress.currentFilename && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5, ml: 4.5 }}>
              {processProgress.currentFilename}
            </Typography>
          )}
          <LinearProgress
            variant="determinate"
            value={processProgress.total > 0 ? (processProgress.processed / processProgress.total) * 100 : 0}
            sx={{ height: 6, borderRadius: 3 }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {processProgress.processed} of {processProgress.total} files {processPhase === 'uploading' ? 'uploaded' : 'analysed'}
            {processPhase === 'analysing' && reviewData.length > 0 && <> &middot; {reviewData.length} species detected so far</>}
          </Typography>
        </Box>
      )}

      {/* Processing error */}
      {processError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => { setProcessError(null); runProcessing(); }}>
              Retry
            </Button>
          }
        >
          {processError}
        </Alert>
      )}

      {/* Per-file errors (non-fatal) */}
      {!processing && fileErrors.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
            {fileErrors.length} file{fileErrors.length !== 1 ? 's' : ''} had errors:
          </Typography>
          {fileErrors.map((err, i) => (
            <Typography key={i} variant="body2" sx={{ fontSize: '0.85rem' }}>
              {err}
            </Typography>
          ))}
        </Alert>
      )}

      {/* Processing results summary */}
      {isProcessed && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Processing complete — <strong>{detections.length}</strong> detections across <strong>{reviewData.length}</strong> species found.
          {unmatchedSpecies.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Warning sx={{ fontSize: 16, color: 'warning.main' }} />
                <Typography variant="body2" color="text.secondary">
                  {unmatchedSpecies.length} species not in database (skipped)
                </Typography>
              </Stack>
            </Box>
          )}
        </Alert>
      )}

      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => setActiveStep(0)}
          sx={{ textTransform: 'none' }}
        >
          Back
        </Button>
        <Button
          variant="contained"
          endIcon={<ArrowForward />}
          disabled={!canProceed(1)}
          onClick={() => setActiveStep(2)}
          sx={{ textTransform: 'none' }}
        >
          Next: Review Detections
        </Button>
      </Box>
    </Paper>
  );
}
