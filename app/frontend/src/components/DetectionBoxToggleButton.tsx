import { IconButton, Tooltip } from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';

interface DetectionBoxToggleButtonProps {
  showing: boolean;
  onToggle: () => void;
  /** When true, positions absolutely in the top-right and uses a translucent dark backdrop for legibility over images */
  overlay?: boolean;
}

export function DetectionBoxToggleButton({ showing, onToggle, overlay }: DetectionBoxToggleButtonProps) {
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
        sx={
          overlay
            ? {
                position: 'absolute',
                top: 6,
                right: 6,
                bgcolor: 'rgba(0, 0, 0, 0.5)',
                color: 'white',
                '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.7)' },
              }
            : undefined
        }
      >
        {showing ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}
