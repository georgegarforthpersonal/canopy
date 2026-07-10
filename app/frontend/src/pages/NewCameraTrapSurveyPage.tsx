import {
  Box,
  Button,
  Alert,
  CircularProgress,
  Stepper,
  Step,
  StepLabel,
} from '@mui/material';
import { Cancel } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth, usePermissions } from '../context/AuthContext';
import { AccessNotice } from '../components/auth/AccessNotice';
import { useResponsive } from '../hooks/useResponsive';
import { useCameraTrapWizard, WIZARD_STEPS } from '../hooks/useCameraTrapWizard';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { PageHeader } from '../components/layout/PageHeader';
import { SPACING } from '../config/responsive';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';
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
  const { isLoading: authLoading } = useAuth();
  const { canEditSurveys } = usePermissions();
  const { isMobile } = useResponsive();
  const wizard = useCameraTrapWizard();

  // Dirty once the wizard has progressed or images are selected, until the
  // survey is saved. Blocks Cancel, the back link, and browser back; the
  // confirmation dialog below lets the user proceed or stay.
  const blocker = useUnsavedChangesGuard(
    () => (wizard.activeStep > 0 || wizard.imageFiles.length > 0) && !wizard.saveCompleteRef.current,
  );

  if (authLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  if (!canEditSurveys) {
    return <AccessNotice message="Creating camera trap surveys needs editor access." />;
  }

  if (wizard.loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: SPACING.PAGE_PADDING }}>
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

      {/* On phones the labelled horizontal stepper overflows, so show icon-only steps */}
      <Stepper activeStep={wizard.activeStep} sx={{ mb: 4 }}>
        {WIZARD_STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{isMobile ? '' : label}</StepLabel>
          </Step>
        ))}
      </Stepper>

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

      <UnsavedChangesDialog
        open={blocker.state === 'blocked'}
        onKeepWorking={() => blocker.reset?.()}
        onDiscard={() => blocker.proceed?.()}
      />
    </Box>
  );
}
