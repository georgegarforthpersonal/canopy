import { Box, Button } from '@mui/material';
import { ArrowBack, ArrowForward, Save } from '@mui/icons-material';

interface WizardNavigationProps {
  backLabel?: string;
  nextLabel: string;
  onBack?: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  nextIcon?: 'forward' | 'save';
}

export function WizardNavigation({
  backLabel,
  nextLabel,
  onBack,
  onNext,
  nextDisabled = false,
  nextIcon = 'forward',
}: WizardNavigationProps) {
  return (
    <Box sx={{ mt: 3, display: 'flex', gap: 1 }}>
      <Button
        variant="outlined"
        startIcon={<ArrowBack />}
        onClick={onBack}
        sx={{
          flex: 1,
          textTransform: 'none',
          whiteSpace: 'normal',
          lineHeight: 1.3,
          visibility: backLabel ? 'visible' : 'hidden',
        }}
      >
        {backLabel ?? ''}
      </Button>
      <Button
        variant="contained"
        {...(nextIcon === 'save'
          ? { startIcon: <Save /> }
          : { endIcon: <ArrowForward /> })}
        disabled={nextDisabled}
        onClick={onNext}
        sx={{
          flex: 1,
          textTransform: 'none',
          whiteSpace: 'normal',
          lineHeight: 1.3,
        }}
      >
        {nextLabel}
      </Button>
    </Box>
  );
}
