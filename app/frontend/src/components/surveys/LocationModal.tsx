import { Dialog, DialogTitle, DialogContent, DialogActions, Button, IconButton, Typography, Box } from '@mui/material';
import { Close } from '@mui/icons-material';
import MultiLocationMapPicker, { type DraftIndividualLocation } from './MultiLocationMapPicker';
import { useState, useEffect } from 'react';
import { useResponsive } from '../../hooks/useResponsive';
import type { BreedingStatusCode, LocationWithBoundary } from '../../services/api';

interface LocationModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (individuals: DraftIndividualLocation[]) => void;
  initialIndividuals?: DraftIndividualLocation[];
  speciesName?: string;
  speciesType?: string;
  breedingCodes?: BreedingStatusCode[];
  count?: number; // Maximum number of individuals (from sighting count)
  locationsWithBoundaries?: LocationWithBoundary[]; // Optional locations with boundaries to display on the map
  surveyLocationId?: number | null; // Survey-level location ID for initial map zoom
  allowCoordinateEntry?: boolean; // Whether typed coordinates / photo GPS can place locations
  photos?: File[]; // Pending sighting photos, offered as GPS location suggestions
}

export function LocationModal({
  open,
  onClose,
  onSave,
  initialIndividuals,
  speciesName,
  speciesType,
  breedingCodes = [],
  count = 1,
  locationsWithBoundaries,
  surveyLocationId,
  allowCoordinateEntry = false,
  photos,
}: LocationModalProps) {
  const { isMobile } = useResponsive();
  const [individuals, setIndividuals] = useState<DraftIndividualLocation[]>(
    initialIndividuals || []
  );

  const isBirdSpecies = speciesType === 'bird';

  // Update local state when initial values change
  useEffect(() => {
    if (open) {
      setIndividuals(initialIndividuals || []);
    }
  }, [open, initialIndividuals]);

  const handleSave = () => {
    onSave(individuals);
    onClose();
  };

  const handleClear = () => {
    setIndividuals([]);
  };

  const handleCancel = () => {
    // Reset to initial values
    setIndividuals(initialIndividuals || []);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      maxWidth="md"
      fullWidth
      fullScreen={isMobile}
      PaperProps={
        isMobile
          ? undefined
          : {
              sx: {
                minHeight: '600px',
                maxHeight: '90vh',
              },
            }
      }
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid',
          borderColor: 'divider',
          pb: 2,
        }}
      >
        <Box>
          <Typography variant="h6" fontWeight={600}>
            Set Individual Locations
          </Typography>
          {speciesName && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {speciesName} {count > 1 && `• Count: ${count}`}
            </Typography>
          )}
        </Box>
        <IconButton onClick={handleCancel} edge="end">
          <Close />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 3, pb: 2 }}>
        <MultiLocationMapPicker
          locations={individuals}
          onChange={setIndividuals}
          breedingCodes={breedingCodes}
          showBreedingStatus={isBirdSpecies}
          maxCount={count}
          locationsWithBoundaries={locationsWithBoundaries}
          surveyLocationId={surveyLocationId}
          allowCoordinateEntry={allowCoordinateEntry}
          photos={photos}
        />
      </DialogContent>

      <DialogActions
        sx={{
          borderTop: '1px solid',
          borderColor: 'divider',
          p: 2,
          gap: 1,
          justifyContent: 'space-between',
        }}
      >
        <Box>
          {individuals.length > 0 && (
            <Button
              onClick={handleClear}
              color="error"
              variant="outlined"
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Clear All
            </Button>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            onClick={handleCancel}
            variant="outlined"
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            variant="contained"
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Save
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
