/**
 * The Surveys worklist panel, split into labelled sections ordered
 * chronologically top to bottom: "To record" (every overdue row, oldest first
 * — the actionable backlog is never hidden), "This week" (the current week's
 * survey always has an anchor here — still due or already recorded, it never
 * vanishes), "Upcoming" (the next 3 scheduled rows), and an "All surveys"
 * door whose recorded/scheduled split says exactly what's behind it. To
 * record and Upcoming hide when empty; This week hides only when the panel
 * has nothing at all to show.
 */
import { Box, Paper, Typography, ButtonBase } from '@mui/material';
import { AssignmentTurnedIn, ChevronRight } from '@mui/icons-material';
import type { ScheduledSurvey, Surveyor } from '../../services/api';
import { groupCardSx, groupColors } from '../../pages/groups/groupsTokens';
import { buildWorklist } from '../../pages/groups/surveyState';
import SurveyWorklistRow from './SurveyWorklistRow';

interface SurveysPanelProps {
  /** All of this group's scheduled slots (open, fulfilled and cancelled). */
  slots: ScheduledSurvey[];
  /** This week's already-recorded slots — pinned so the week stays visible. */
  recordedThisWeek: ScheduledSurvey[];
  resolveSurveyors: (ids: number[]) => Surveyor[];
  /** Recorded surveys total — shown alongside the scheduled count on the door. */
  recordedCount: number;
  greenIds?: Set<number>;
  onAddSurvey: (slot: ScheduledSurvey) => void;
  /** Called after a one-click sign-up/withdraw with the new surveyor ids. */
  onSignupSaved: (slotId: number, surveyorIds: number[]) => void;
  /** Open a recorded slot's survey read-only. */
  onOpenSurvey: (slot: ScheduledSurvey) => void;
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
        borderTop: `1px solid ${groupColors.dividerInner}`,
      }}
    >
      <Typography sx={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color }}>
        {label}
      </Typography>
      {suffix && (
        <Typography sx={{ fontSize: 11.5, color: groupColors.textMuted }}>{suffix}</Typography>
      )}
    </Box>
  );
}

export default function SurveysPanel({
  slots,
  recordedThisWeek,
  resolveSurveyors,
  recordedCount,
  greenIds,
  onAddSurvey,
  onSignupSaved,
  onOpenSurvey,
  onViewAll,
}: SurveysPanelProps) {
  const { dueThisWeek, overdue, upcoming, upcomingTotal } = buildWorklist(slots);
  const scheduledCount = overdue.length + dueThisWeek.length + upcomingTotal;
  const thisWeekCount = dueThisWeek.length + recordedThisWeek.length;
  const empty = thisWeekCount === 0 && overdue.length === 0 && upcoming.length === 0;

  return (
    <Paper sx={groupCardSx}>
      <Box sx={{ px: 2.25, py: 1.75, borderBottom: `1px solid ${groupColors.divider}` }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: groupColors.textPrimary }}>
          Surveys
        </Typography>
      </Box>

      {empty && (
        <Box sx={{ px: 2.25, py: 3 }}>
          <Typography sx={{ fontSize: 13.5, color: groupColors.textMuted }}>
            No surveys need recording and none are scheduled.
          </Typography>
        </Box>
      )}

      {overdue.length > 0 && (
        <SectionHeader label={`To record (${overdue.length})`} color={groupColors.amberText} />
      )}
      {overdue.map((s) => (
        <SurveyWorklistRow
          key={s.id}
          slot={s}
          state="needs-survey"
          surveyors={resolveSurveyors(s.surveyor_ids)}
          greenIds={greenIds}
          onAddSurvey={onAddSurvey}
          onSignupSaved={onSignupSaved}
        />
      ))}

      {/* This week: still-due rows first (actionable), then recorded ones. */}
      {!empty && <SectionHeader label="This week" color={groupColors.brandDark} />}
      {dueThisWeek.map((s) => (
        <SurveyWorklistRow
          key={s.id}
          slot={s}
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
          slot={s}
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
          <Typography sx={{ fontSize: 13.5, color: groupColors.textMuted }}>
            No survey scheduled this week.
          </Typography>
        </Box>
      )}

      {upcoming.length > 0 && (
        <SectionHeader
          label={`Upcoming (${upcomingTotal})`}
          color={groupColors.textMuted}
          suffix={upcomingTotal > upcoming.length ? `showing next ${upcoming.length}` : undefined}
        />
      )}
      {upcoming.map((s) => (
        <SurveyWorklistRow
          key={s.id}
          slot={s}
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
          <Typography sx={{ fontSize: 12, color: groupColors.textMuted }}>
            {recordedCount} recorded · {scheduledCount} scheduled
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, color: groupColors.brand, flexShrink: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>View all</Typography>
          <ChevronRight sx={{ fontSize: 18 }} />
        </Box>
      </ButtonBase>
    </Paper>
  );
}
