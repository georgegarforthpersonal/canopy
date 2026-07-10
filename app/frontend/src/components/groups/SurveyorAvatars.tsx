/**
 * Overlapping avatar group for the surveyors assigned to a survey. Falls back to
 * a muted "No surveyors yet" when empty.
 */
import { Box, Tooltip, Typography } from '@mui/material';
import type { Surveyor } from '../../services/api';
import { groupColors } from '../../pages/groups/groupsTokens';
import { surveyorAvatarColor, surveyorInitials } from '../../pages/groups/groupsTokens';

function surveyorName(s: Surveyor) {
  return `${s.first_name}${s.last_name ? ' ' + s.last_name : ''}`;
}

// enterTouchDelay=0 makes a tap open the tooltip on touch devices.
const touchProps = { enterTouchDelay: 0, leaveTouchDelay: 3000 } as const;

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
    return (
      <Typography variant="caption" sx={{ color: '#999', fontStyle: 'italic' }}>
        {emptyLabel}
      </Typography>
    );
  }

  const shown = surveyors.slice(0, max);
  const overflow = surveyors.length - shown.length;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((s, idx) => (
        <Tooltip key={s.id} title={surveyorName(s)} arrow {...touchProps}>
          <Box
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
          title={surveyors.slice(max).map(surveyorName).join(', ')}
          arrow
          {...touchProps}
        >
          <Box
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
