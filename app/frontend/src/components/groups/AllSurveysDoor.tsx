/**
 * The "All surveys" door row at the foot of a group's Surveys panel — shared
 * by the scheduled worklist panel (recorded/scheduled split summary) and the
 * unscheduled record panel (recorded count only).
 */
import { Box, ButtonBase, Typography } from '@mui/material';
import { AssignmentTurnedIn, ChevronRight } from '@mui/icons-material';
import { groupColors } from '../../pages/groups/groupsTokens';

interface AllSurveysDoorProps {
  /** Counts line under the label, e.g. "12 recorded · 3 scheduled". */
  summary: string;
  onViewAll: () => void;
}

export default function AllSurveysDoor({ summary, onViewAll }: AllSurveysDoorProps) {
  return (
    <ButtonBase
      onClick={onViewAll}
      sx={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 1.6,
        px: 2.25,
        py: 1.6,
        borderTop: `1px solid ${groupColors.dividerInner}`,
        textAlign: 'left',
        '&:hover': { bgcolor: '#f9fbf9' },
      }}
    >
      <Box
        sx={{
          width: 34,
          height: 34,
          borderRadius: '8px',
          bgcolor: '#f1f3f1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <AssignmentTurnedIn sx={{ fontSize: 18, color: groupColors.brandDark }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: groupColors.textPrimary }}>
          All surveys
        </Typography>
        <Typography sx={{ fontSize: 12, color: groupColors.textMuted }}>{summary}</Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, color: groupColors.brand, flexShrink: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>View all</Typography>
        <ChevronRight sx={{ fontSize: 18 }} />
      </Box>
    </ButtonBase>
  );
}
