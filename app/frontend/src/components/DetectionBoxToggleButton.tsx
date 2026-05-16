import { Button, Tooltip } from '@mui/material';
import { CropFree } from '@mui/icons-material';

interface DetectionBoxToggleButtonProps {
  showing: boolean;
  onToggle: () => void;
}

export function DetectionBoxToggleButton({ showing, onToggle }: DetectionBoxToggleButtonProps) {
  return (
    <Tooltip title="Toggle detection boxes (B)">
      <Button
        size="small"
        variant="outlined"
        startIcon={<CropFree />}
        aria-pressed={showing}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
      >
        {showing ? 'Hide boxes' : 'Show boxes'}
      </Button>
    </Tooltip>
  );
}
