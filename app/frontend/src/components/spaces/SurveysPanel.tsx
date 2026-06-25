/**
 * The Surveys worklist panel: a fixed-height list of at most ~6 actionable rows
 * (needs-survey, then upcoming) plus a door to the full All surveys history.
 */
import { Box, Paper, Typography, ButtonBase } from '@mui/material';
import { AssignmentTurnedIn, ChevronRight } from '@mui/icons-material';
import type { Survey, Surveyor } from '../../services/api';
import { spaceCardSx, spaceColors } from '../../pages/spaces/spacesTokens';
import { buildWorklist } from '../../pages/spaces/surveyState';
import SurveyWorklistRow from './SurveyWorklistRow';

interface SurveysPanelProps {
  surveys: Survey[];
  resolveSurveyors: (ids: number[]) => Surveyor[];
  totalCount: number;
  greenIds?: Set<number>;
  onAddSurvey: (survey: Survey) => void;
  onAssign: (survey: Survey) => void;
  onViewAll: () => void;
}

export default function SurveysPanel({
  surveys,
  resolveSurveyors,
  totalCount,
  greenIds,
  onAddSurvey,
  onAssign,
  onViewAll,
}: SurveysPanelProps) {
  const { needsSurvey, upcoming } = buildWorklist(surveys);
  const empty = needsSurvey.length === 0 && upcoming.length === 0;

  return (
    <Paper sx={spaceCardSx}>
      <Box sx={{ px: 2.25, py: 1.75, borderBottom: `1px solid ${spaceColors.divider}` }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: spaceColors.textPrimary }}>
          Surveys
        </Typography>
      </Box>

      {empty && (
        <Box sx={{ px: 2.25, py: 3 }}>
          <Typography sx={{ fontSize: 13.5, color: spaceColors.textMuted }}>
            No surveys need recording and none are scheduled. Use “Add survey” to schedule one.
          </Typography>
        </Box>
      )}

      {needsSurvey.map((s) => (
        <SurveyWorklistRow
          key={s.id}
          survey={s}
          state="needs-survey"
          surveyors={resolveSurveyors(s.surveyor_ids)}
          onAddSurvey={onAddSurvey}
          onAssign={onAssign}
        />
      ))}

      {upcoming.map((s) => (
        <SurveyWorklistRow
          key={s.id}
          survey={s}
          state="upcoming"
          surveyors={resolveSurveyors(s.surveyor_ids)}
          greenIds={greenIds}
          onAddSurvey={onAddSurvey}
          onAssign={onAssign}
        />
      ))}

      {/* All surveys door */}
      <ButtonBase
        onClick={onViewAll}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 1.6,
          px: 2.25,
          py: 1.6,
          borderTop: `1px solid ${spaceColors.dividerInner}`,
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
          <AssignmentTurnedIn sx={{ fontSize: 18, color: spaceColors.brandDark }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: spaceColors.textPrimary }}>
            All surveys
          </Typography>
          <Typography sx={{ fontSize: 12, color: spaceColors.textMuted }}>
            {totalCount} survey{totalCount === 1 ? '' : 's'} · most recent first
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, color: spaceColors.brand, flexShrink: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>View all</Typography>
          <ChevronRight sx={{ fontSize: 18 }} />
        </Box>
      </ButtonBase>
    </Paper>
  );
}
