import {
  Box,
  Button,
  Alert,
  CircularProgress,
  Stepper,
  Step,
  StepLabel,
  Typography,
} from '@mui/material';
import { Cancel } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useResponsive } from '../hooks/useResponsive';
import { useCameraTrapWizard, WIZARD_STEPS } from '../hooks/useCameraTrapWizard';
import { PageHeader } from '../components/layout/PageHeader';
import {
  SetupStep,
  UploadStep,
  FilterStep,
  ClassifyStep,
  ReviewStep,
  SaveStep,
} from '../components/cameraTrapWizard';

export function NewCameraTrapSurveyPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { isMobile } = useResponsive();
  const wizard = useCameraTrapWizard();

  if (authLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <Alert severity="warning">Please sign in to create a camera trap survey.</Alert>
      </Box>
    );
  }

  if (wizard.loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 4 }}>
      <PageHeader
        backButton={{ href: '/surveys' }}
        actions={
          <Button
            variant="outlined"
            startIcon={<Cancel />}
            onClick={() => navigate('/surveys')}
            sx={{ textTransform: 'none' }}
          >
            Cancel
          </Button>
        }
      />

      {/* On phones the labelled horizontal stepper overflows, so show
          icon-only steps with the current step named underneath */}
      <Stepper activeStep={wizard.activeStep} sx={{ mb: isMobile ? 1.5 : 4 }}>
        {WIZARD_STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{isMobile ? '' : label}</StepLabel>
          </Step>
        ))}
      </Stepper>
      {isMobile && (
        <Typography variant="subtitle2" align="center" sx={{ mb: 3, fontWeight: 600 }}>
          {WIZARD_STEPS[wizard.activeStep]}
        </Typography>
      )}

      {wizard.error && wizard.activeStep !== 5 && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => wizard.setError(null)}>
          {wizard.error}
        </Alert>
      )}

      {wizard.activeStep === 0 && <SetupStep wizard={wizard} />}
      {wizard.activeStep === 1 && <UploadStep wizard={wizard} />}
      {wizard.activeStep === 2 && wizard.imageFiles.length > 0 && <FilterStep wizard={wizard} />}
      {wizard.activeStep === 3 && wizard.filteredImageFiles.length > 0 && <ClassifyStep wizard={wizard} />}
      {wizard.activeStep === 4 && <ReviewStep wizard={wizard} />}
      {wizard.activeStep === 5 && <SaveStep wizard={wizard} />}
    </Box>
  );
}
