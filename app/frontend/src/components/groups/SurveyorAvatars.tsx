/**
 * Overlapping avatar group for the surveyors assigned to a survey. Falls back to
 * a muted "No surveyors yet" when empty.
 */
import type { MouseEvent } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import type { Surveyor } from '../../services/api';
import { groupColors } from '../../pages/groups/groupsTokens';
import { surveyorAvatarColor, surveyorInitials } from '../../pages/groups/groupsTokens';
import { surveyorFullName } from '../../utils/formatters';

// enterTouchDelay=0 makes a tap open the tooltip on touch devices. The tap
// must not bubble: avatars sit inside clickable rows, and navigating away
// would close the tooltip the tap just opened.
const touchProps = { enterTouchDelay: 0, leaveTouchDelay: 3000 } as const;
const stopClick = (e: MouseEvent) => e.stopPropagation();

interface SurveyorAvatarsProps {
  surveyors: Surveyor[];
  emptyLabel?: string;
  max?: number;
  /** Surveyor ids assigned in this session — rendered brand green. */
  greenIds?: Set<number>;
}

export default function SurveyorAvatars({
  surveyors,
  emptyLabel = 'No surveyors yet',
  max = 5,
  greenIds,
}: SurveyorAvatarsProps) {
  if (surveyors.length === 0) {
    // Occupy the same 28px-tall right-aligned slot as the circles, so rows
    // with and without surveyors line up.
    return (
      <Box sx={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <Typography variant="caption" sx={{ color: '#999', fontStyle: 'italic' }}>
          {emptyLabel}
        </Typography>
      </Box>
    );
  }

  const shown = surveyors.slice(0, max);
  const overflow = surveyors.length - shown.length;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((s, idx) => (
        <Tooltip key={s.id} title={surveyorFullName(s)} arrow {...touchProps}>
          <Box
            onClick={stopClick}
            sx={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              bgcolor: greenIds?.has(s.id) ? groupColors.brand : surveyorAvatarColor(s.id),
              color: '#fff',
              border: '2px solid #fff',
              ml: idx === 0 ? 0 : '-8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10.5,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {surveyorInitials(s.first_name, s.last_name)}
          </Box>
        </Tooltip>
      ))}
      {overflow > 0 && (
        <Tooltip
          title={surveyors.slice(max).map(surveyorFullName).join(', ')}
          arrow
          {...touchProps}
        >
          <Box
            onClick={stopClick}
            sx={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              bgcolor: '#e0e0e0',
              color: '#555',
              border: '2px solid #fff',
              ml: '-8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10.5,
              fontWeight: 600,
            }}
          >
            +{overflow}
          </Box>
        </Tooltip>
      )}
    </Box>
  );
}
