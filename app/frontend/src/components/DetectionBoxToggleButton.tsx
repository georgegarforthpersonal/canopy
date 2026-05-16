import { IconButton, Tooltip } from '@mui/material';
import { CropFree } from '@mui/icons-material';

interface DetectionBoxToggleButtonProps {
  showing: boolean;
  onToggle: () => void;
  /** When true, positions absolutely in the top-right and uses a translucent dark backdrop for legibility over images */
  overlay?: boolean;
}

export function DetectionBoxToggleButton({ showing, onToggle, overlay }: DetectionBoxToggleButtonProps) {
  const overlaySx = {
    position: 'absolute',
    top: 6,
    right: 6,
    color: 'white',
    bgcolor: showing ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.3)',
    opacity: showing ? 1 : 0.7,
    '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.75)' },
  };
  const inlineSx = {
    bgcolor: showing ? 'action.selected' : 'transparent',
    opacity: showing ? 1 : 0.6,
  };

  return (
    <Tooltip title={`${showing ? 'Hide' : 'Show'} detection boxes (B)`}>
      <IconButton
        size="small"
        aria-pressed={showing}
        aria-label={`${showing ? 'Hide' : 'Show'} detection boxes`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        sx={overlay ? overlaySx : inlineSx}
      >
        <CropFree fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
