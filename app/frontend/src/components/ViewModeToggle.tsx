/**
 * Shared list / map view switch, used wherever a list and a map are two views
 * of the same data (sightings, locations & devices). Keeps the icons, tooltips
 * and sizing consistent across the app.
 */

import { ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import { ViewList, Map as MapIcon } from '@mui/icons-material';

export type ViewMode = 'list' | 'map';

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  size?: 'small' | 'medium';
}

export default function ViewModeToggle({ value, onChange, size = 'small' }: ViewModeToggleProps) {
  return (
    <ToggleButtonGroup
      value={value}
      exclusive
      onChange={(_, next: ViewMode | null) => next && onChange(next)}
      size={size}
      sx={{ height: 32 }}
    >
      <ToggleButton value="list" aria-label="list mode">
        <Tooltip title="List Mode">
          <ViewList fontSize="small" />
        </Tooltip>
      </ToggleButton>
      <ToggleButton value="map" aria-label="map mode">
        <Tooltip title="Map Mode">
          <MapIcon fontSize="small" />
        </Tooltip>
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
