/**
 * The Surveys worklist panel, split into labelled sections so the situations
 * read at a glance: "This week" (the current week's survey always has an
 * anchor here — still due or already recorded, it never vanishes), "To record"
 * (every overdue row — the actionable backlog is never hidden), "Upcoming"
 * (the next 3 scheduled rows), and an "All surveys" door whose
 * recorded/scheduled split says exactly what's behind it. To record and
 * Upcoming hide when empty; This week hides only when the panel has nothing
 * at all to show.
 */
import { Box, Paper, Typography, ButtonBase } from '@mui/material';
import { AssignmentTurnedIn, ChevronRight } from '@mui/icons-material';
import type { Survey, Surveyor } from '../../services/api';
import { teamCardSx, teamColors } from '../../pages/teams/teamsTokens';
import { buildWorklist } from '../../pages/teams/surveyState';
import SurveyWorklistRow from './SurveyWorklistRow';

interface SurveysPanelProps {
  /** All scheduled (not yet recorded) surveys for this team. */
  surveys: Survey[];
  /** This week's already-recorded surveys — pinned so the week stays visible. */
  recordedThisWeek: Survey[];
  resolveSurveyors: (ids: number[]) => Surveyor[];
  /** Completed surveys only — shown alongside the scheduled count on the door. */
  recordedCount: number;
  greenIds?: Set<number>;
  onAddSurvey: (survey: Survey) => void;
  /** Called after a one-click sign-up/withdraw with the new surveyor ids. */
  onSignupSaved: (surveyId: number, surveyorIds: number[]) => void;
  /** Open a recorded survey read-only. */
  onOpenSurvey: (survey: Survey) => void;
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
        borderTop: `1px solid ${teamColors.dividerInner}`,
      }}
    >
      <Typography sx={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color }}>
        {label}
      </Typography>
      {suffix && (
        <Typography sx={{ fontSize: 11.5, color: teamColors.textMuted }}>{suffix}</Typography>
      )}
    </Box>
  );
}

export default function SurveysPanel({
  surveys,
  recordedThisWeek,
  resolveSurveyors,
  recordedCount,
  greenIds,
  onAddSurvey,
  onSignupSaved,
  onOpenSurvey,
  onViewAll,
}: SurveysPanelProps) {
  const { dueThisWeek, overdue, upcoming, upcomingTotal } = buildWorklist(surveys);
  const thisWeekCount = dueThisWeek.length + recordedThisWeek.length;
  const empty = thisWeekCount === 0 && overdue.length === 0 && upcoming.length === 0;

  return (
    <Paper sx={teamCardSx}>
      <Box sx={{ px: 2.25, py: 1.75, borderBottom: `1px solid ${teamColors.divider}` }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: teamColors.textPrimary }}>
          Surveys
        </Typography>
      </Box>

      {empty && (
        <Box sx={{ px: 2.25, py: 3 }}>
          <Typography sx={{ fontSize: 13.5, color: teamColors.textMuted }}>
            No surveys need recording and none are scheduled.
          </Typography>
        </Box>
      )}

      {/* This week: still-due rows first (actionable), then recorded ones. */}
      {!empty && <SectionHeader label="This week" color={teamColors.brandDark} />}
      {dueThisWeek.map((s) => (
        <SurveyWorklistRow
          key={s.id}
          survey={s}
          state="due-this-week"
          surveyors={resolveSurveyors(s.surveyor_ids)}
          greenIds={greenIds}
          onAddSurvey={onAddSurvey}
          onSignupSaved={onSignupSaved}
        />
      ))}
      {recordedThisWeek.map((s) => (
        <SurveyWorklistRow
          key={s.id}
          survey={s}
          state="recorded"
          surveyors={resolveSurveyors(s.surveyor_ids)}
          greenIds={greenIds}
          onAddSurvey={onAddSurvey}
          onSignupSaved={onSignupSaved}
          onOpen={onOpenSurvey}
        />
      ))}
      {!empty && thisWeekCount === 0 && (
        <Box sx={{ px: 2.25, py: 1.4 }}>
          <Typography sx={{ fontSize: 13.5, color: teamColors.textMuted }}>
            No survey scheduled this week.
          </Typography>
        </Box>
      )}

      {overdue.length > 0 && (
        <SectionHeader label={`To record (${overdue.length})`} color={teamColors.amberText} />
      )}
      {overdue.map((s) => (
        <SurveyWorklistRow
          key={s.id}
          survey={s}
          state="needs-survey"
          surveyors={resolveSurveyors(s.surveyor_ids)}
          greenIds={greenIds}
          onAddSurvey={onAddSurvey}
          onSignupSaved={onSignupSaved}
        />
      ))}

      {upcoming.length > 0 && (
        <SectionHeader
          label={`Upcoming (${upcomingTotal})`}
          color={teamColors.textMuted}
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
          onSignupSaved={onSignupSaved}
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
          borderTop: `1px solid ${teamColors.dividerInner}`,
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
          <AssignmentTurnedIn sx={{ fontSize: 18, color: teamColors.brandDark }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: teamColors.textPrimary }}>
            All surveys
          </Typography>
          <Typography sx={{ fontSize: 12, color: teamColors.textMuted }}>
            {recordedCount} recorded · {surveys.length} scheduled
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, color: teamColors.brand, flexShrink: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>View all</Typography>
          <ChevronRight sx={{ fontSize: 18 }} />
        </Box>
      </ButtonBase>
    </Paper>
  );
}
