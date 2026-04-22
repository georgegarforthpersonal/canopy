import {
  Box,
  Typography,
  Paper,
  Stack,
  Button,
  Checkbox,
} from '@mui/material';
import { ArrowBack, Save } from '@mui/icons-material';
import type { AudioWizardState } from '../../hooks/useAudioWizard';
import { AudioClipPlayer } from '../audio/AudioClipPlayer';

interface ReviewStepProps {
  wizard: AudioWizardState;
}

export function ReviewStep({ wizard }: ReviewStepProps) {
  const {
    reviewData, deselectedSpecies, selectedSpeciesCount, toggleSpecies,
    audioFiles, canProceed, setActiveStep, handleSave,
  } = wizard;

  return (
    <Paper sx={{ p: 3, boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
        Review Detections
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {selectedSpeciesCount} of {reviewData.length} species selected. Tick the species you want to include as sightings.
      </Typography>

      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        {/* Table Header */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '48px 2fr 80px 1.5fr',
            gap: 2,
            p: 1.5,
            bgcolor: 'grey.50',
            borderBottom: '1px solid',
            borderColor: 'divider',
            alignItems: 'center',
          }}
        >
          <Box />
          <Typography variant="body2" fontWeight={600} color="text.secondary">
            SPECIES
          </Typography>
          <Typography variant="body2" fontWeight={600} color="text.secondary" textAlign="center">
            COUNT
          </Typography>
          <Typography variant="body2" fontWeight={600} color="text.secondary">
            TOP DETECTIONS
          </Typography>
        </Box>

        {/* Species Rows */}
        {reviewData.map((species) => {
          const isSelected = !deselectedSpecies.has(species.speciesId);

          return (
            <Box
              key={species.speciesId}
              sx={{
                display: 'grid',
                gridTemplateColumns: '48px 2fr 80px 1.5fr',
                gap: 2,
                p: 1.5,
                borderBottom: '1px solid',
                borderColor: 'divider',
                alignItems: 'center',
                '&:last-child': { borderBottom: 'none' },
                cursor: 'pointer',
                '&:hover': { bgcolor: 'grey.50' },
              }}
              onClick={() => toggleSpecies(species.speciesId)}
            >
              {/* Checkbox */}
              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <Checkbox
                  checked={isSelected}
                  size="small"
                  sx={{ p: 0 }}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSpecies(species.speciesId)}
                />
              </Box>

              {/* Species Name */}
              <Box>
                <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>
                  {species.speciesName}
                </Typography>
                {species.speciesScientificName && species.speciesName !== species.speciesScientificName && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    {species.speciesScientificName}
                  </Typography>
                )}
              </Box>

              {/* Detection Count */}
              <Typography variant="body2" fontWeight={600} textAlign="center" sx={{ fontSize: '0.875rem' }}>
                {species.detectionCount}
              </Typography>

              {/* Top Detection Clips */}
              <Stack
                direction="row"
                spacing={1}
                onClick={(e) => e.stopPropagation()}
              >
                {species.topDetections.map((det, idx) => (
                  <AudioClipPlayer
                    key={idx}
                    audioUrl={audioFiles[det.fileIndex]?.objectUrl}
                    startTime={det.start_time}
                    endTime={det.end_time}
                    confidence={det.confidence}
                    timestamp={det.detection_timestamp}
                  />
                ))}
              </Stack>
            </Box>
          );
        })}
      </Box>

      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => setActiveStep(1)}
          sx={{ textTransform: 'none' }}
        >
          Back
        </Button>
        <Button
          variant="contained"
          startIcon={<Save />}
          disabled={!canProceed(2)}
          onClick={() => { setActiveStep(3); handleSave(); }}
          sx={{ textTransform: 'none' }}
        >
          Save Survey ({selectedSpeciesCount} species)
        </Button>
      </Box>
    </Paper>
  );
}
