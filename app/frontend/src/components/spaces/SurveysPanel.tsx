/**
 * The Surveys worklist panel, split into two labelled sections so the three
 * situations read at a glance: "To record" (every overdue / due-this-week row —
 * the actionable backlog is never hidden), "Upcoming" (the next 3 scheduled
 * rows), and an "All surveys" door whose recorded/scheduled split says exactly
 * what's behind it. Sections hide when empty.
 */
import { Box, Paper, Typography, ButtonBase } from '@mui/material';
import { AssignmentTurnedIn, ChevronRight } from '@mui/icons-material';
import type { Survey, Surveyor } from '../../services/api';
import { spaceCardSx, spaceColors } from '../../pages/spaces/spacesTokens';
import { buildWorklist, deriveSurveyState } from '../../pages/spaces/surveyState';
import SurveyWorklistRow from './SurveyWorklistRow';

interface SurveysPanelProps {
  /** All scheduled (not yet recorded) surveys for this space. */
  surveys: Survey[];
  resolveSurveyors: (ids: number[]) => Surveyor[];
  /** Completed surveys only — shown alongside the scheduled count on the door. */
  recordedCount: number;
  greenIds?: Set<number>;
  onAddSurvey: (survey: Survey) => void;
  onAssign: (survey: Survey) => void;
  onViewAll: () => void;
}

function SectionHeader({ label, color, suffix }: { label: string; color: string; suffix?: string }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 1,
        px: 2.25,
        pt: 1.5,
        pb: 0.25,
        borderTop: `1px solid ${spaceColors.dividerInner}`,
      }}
    >
      <Typography sx={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color }}>
        {label}
      </Typography>
      {suffix && (
        <Typography sx={{ fontSize: 11.5, color: spaceColors.textMuted }}>{suffix}</Typography>
      )}
    </Box>
  );
}

export default function SurveysPanel({
  surveys,
  resolveSurveyors,
  recordedCount,
  greenIds,
  onAddSurvey,
  onAssign,
  onViewAll,
}: SurveysPanelProps) {
  const { needsSurvey, upcoming, upcomingTotal } = buildWorklist(surveys);
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

      {needsSurvey.length > 0 && (
        <SectionHeader label={`To record (${needsSurvey.length})`} color={spaceColors.amberText} />
      )}
      {needsSurvey.map((s) => (
        <SurveyWorklistRow
          key={s.id}
          survey={s}
          state={deriveSurveyState(s) === 'due-this-week' ? 'due-this-week' : 'needs-survey'}
          surveyors={resolveSurveyors(s.surveyor_ids)}
          greenIds={greenIds}
          onAddSurvey={onAddSurvey}
          onAssign={onAssign}
        />
      ))}

      {upcoming.length > 0 && (
        <SectionHeader
          label={`Upcoming (${upcomingTotal})`}
          color={spaceColors.textMuted}
          suffix={upcomingTotal > upcoming.length ? `showing next ${upcoming.length}` : undefined}
        />
      )}
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
            {recordedCount} recorded · {surveys.length} scheduled
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
