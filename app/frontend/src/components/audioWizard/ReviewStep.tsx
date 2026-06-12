import {
  Box,
  Typography,
  Paper,
  Stack,
  Button,
  Checkbox,
} from '@mui/material';
import { ArrowBack, Save } from '@mui/icons-material';
import { paddedSnippetRange, type AudioWizardState } from '../../hooks/useAudioWizard';
import { AudioClipPlayer } from '../audio/AudioClipPlayer';
import { useResponsive } from '../../hooks/useResponsive';

interface ReviewStepProps {
  wizard: AudioWizardState;
}

export function ReviewStep({ wizard }: ReviewStepProps) {
  const {
    reviewData, deselectedSpecies, selectedSpeciesCount, toggleSpecies,
    audioFiles, canProceed, setActiveStep, handleSave,
  } = wizard;

  const { isMobile } = useResponsive();

  return (
    <Paper sx={{ p: 3, boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
        Review Detections
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {selectedSpeciesCount} of {reviewData.length} species selected. Tick the species you want to include as sightings.
      </Typography>

      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        {isMobile ? (
          /* Mobile: card-style rows without the audio clip column */
          reviewData.map((species) => {
            const isSelected = !deselectedSpecies.has(species.speciesId);
            return (
              <Box
                key={species.speciesId}
                sx={{
                  p: 1.5,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' },
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'grey.50' },
                }}
                onClick={() => toggleSpecies(species.speciesId)}
              >
                <Stack direction="row" alignItems="flex-start" spacing={1}>
                  <Checkbox
                    checked={isSelected}
                    size="small"
                    sx={{ p: 0, mt: 0.25 }}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSpecies(species.speciesId)}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontSize: '0.875rem', fontWeight: 500 }}>
                          {species.speciesName}
                        </Typography>
                        {species.speciesScientificName && species.speciesName !== species.speciesScientificName && (
                          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                            {species.speciesScientificName}
                          </Typography>
                        )}
                      </Box>
                      <Typography variant="body2" fontWeight={600} sx={{ flexShrink: 0, color: 'text.secondary' }}>
                        {species.detectionCount} det.
                      </Typography>
                    </Stack>
                    {species.topDetections.length > 0 && (
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ mt: 1 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {species.topDetections.map((det, idx) => {
                          const { paddedStart, paddedEnd } = paddedSnippetRange(det.start_time, det.end_time);
                          return (
                            <AudioClipPlayer
                              key={idx}
                              audioUrl={audioFiles[det.fileIndex]?.objectUrl}
                              startTime={paddedStart}
                              endTime={paddedEnd}
                              confidence={det.confidence}
                              timestamp={det.detection_timestamp}
                            />
                          );
                        })}
                      </Stack>
                    )}
                  </Box>
                </Stack>
              </Box>
            );
          })
        ) : (
          <>
            {/* Desktop: table header */}
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

            {/* Desktop: species rows */}
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
                  <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                    <Checkbox
                      checked={isSelected}
                      size="small"
                      sx={{ p: 0 }}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSpecies(species.speciesId)}
                    />
                  </Box>
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
                  <Typography variant="body2" fontWeight={600} textAlign="center" sx={{ fontSize: '0.875rem' }}>
                    {species.detectionCount}
                  </Typography>
                  <Stack direction="row" spacing={1} onClick={(e) => e.stopPropagation()}>
                    {species.topDetections.map((det, idx) => {
                      const { paddedStart, paddedEnd } = paddedSnippetRange(det.start_time, det.end_time);
                      return (
                        <AudioClipPlayer
                          key={idx}
                          audioUrl={audioFiles[det.fileIndex]?.objectUrl}
                          startTime={paddedStart}
                          endTime={paddedEnd}
                          confidence={det.confidence}
                          timestamp={det.detection_timestamp}
                        />
                      );
                    })}
                  </Stack>
                </Box>
              );
            })}
          </>
        )}
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
