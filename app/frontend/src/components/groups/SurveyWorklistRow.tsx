/**
 * A single row in the Surveys worklist. The date — a single day or a week range,
 * with the year — is the identifier and heads the row; there is no calendar tile
 * or icon (a week has no single day to pin one to). The middle carries the
 * location and status, never a title.
 *
 * Actions by state: overdue rows record only (the week has passed, surveyors
 * are captured on the record form); due-this-week rows both sign up and record
 * (people join surveys later in the current week); upcoming rows sign up only;
 * recorded rows (this week's survey, already done) link through to the survey.
 * The "To record" section header carries the due-now meaning, so due-this-week
 * rows need no status line of their own.
 */
import { Box, Button, Typography } from '@mui/material';
import { Add, CheckCircleOutline, ChevronRight, WarningAmberRounded } from '@mui/icons-material';
import type { Survey, Surveyor } from '../../services/api';
import { usePermissions } from '../../context/AuthContext';
import SelfSignupButton from './SelfSignupButton';
import SurveyorAvatars from './SurveyorAvatars';
import { recordButtonSx, groupColors } from '../../pages/groups/groupsTokens';
import { formatSurveyDate } from '../../pages/groups/surveyState';

interface SurveyWorklistRowProps {
  survey: Survey;
  state: 'needs-survey' | 'due-this-week' | 'upcoming' | 'recorded';
  surveyors: Surveyor[];
  /** Surveyor ids assigned this session — rendered green. */
  greenIds?: Set<number>;
  /** Open the survey to record sightings. */
  onAddSurvey: (survey: Survey) => void;
  /** Called after a one-click sign-up/withdraw with the new surveyor ids. */
  onSignupSaved: (surveyId: number, surveyorIds: number[]) => void;
  /** Open a recorded survey read-only (recorded rows only). */
  onOpen?: (survey: Survey) => void;
}

export default function SurveyWorklistRow({
  survey,
  state,
  surveyors,
  greenIds,
  onAddSurvey,
  onSignupSaved,
  onOpen,
}: SurveyWorklistRowProps) {
  const needsSurvey = state === 'needs-survey';
  const dueThisWeek = state === 'due-this-week';
  const upcoming = state === 'upcoming';
  const recorded = state === 'recorded';
  // Rows that carry the sign-up toggle (with or without Record survey) crush
  // the date on phones, so they stack: date + avatars line, actions line.
  const stacked = dueThisWeek || upcoming;
  // Recording a survey needs editor access; the button is hidden below that.
  // Sign up is the same one-click self toggle for every role — putting other
  // people on a survey is done on the survey itself, not here.
  const { canEditSurveys } = usePermissions();

  const recordButton = canEditSurveys ? (
    <Button
      variant="contained"
      startIcon={<Add sx={{ fontSize: 18 }} />}
      onClick={() => onAddSurvey(survey)}
      sx={recordButtonSx}
    >
      Record survey
    </Button>
  ) : null;

  const assignButton = (
    <SelfSignupButton survey={survey} assigned={surveyors} onSaved={onSignupSaved} />
  );

  return (
    <Box
      onClick={recorded && onOpen ? () => onOpen(survey) : undefined}
      sx={{
        display: 'flex',
        flexDirection: { xs: stacked ? 'column' : 'row', sm: 'row' },
        alignItems: { xs: stacked ? 'stretch' : 'center', sm: 'center' },
        gap: { xs: stacked ? 1 : 1.6, sm: 1.6 },
        px: 2.25,
        py: 1.6,
        borderTop: `1px solid ${groupColors.dividerInner}`,
        bgcolor: needsSurvey ? groupColors.amberRowBg : 'transparent',
        ...(recorded && onOpen
          ? { cursor: 'pointer', '&:hover': { bgcolor: groupColors.page } }
          : {}),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, flex: 1 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 14.5, fontWeight: 700, color: groupColors.textPrimary }} noWrap>
            {formatSurveyDate(survey)}
          </Typography>
          {survey.location_name && (
            <Typography sx={{ fontSize: 13, color: groupColors.textMuted, mt: 0.25 }} noWrap>
              {survey.location_name}
            </Typography>
          )}
          {needsSurvey && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
              <WarningAmberRounded sx={{ fontSize: 15, color: groupColors.amberText }} />
              <Typography sx={{ fontSize: 13.5, color: groupColors.amberText }}>
                Overdue — no survey recorded
              </Typography>
            </Box>
          )}
        </Box>
        {/* On the stacked phone layout the avatars ride with the date (who's
            going is information); the buttons line below is actions only. */}
        {stacked && surveyors.length > 0 && (
          <Box sx={{ display: { xs: 'flex', sm: 'none' }, flexShrink: 0 }}>
            <SurveyorAvatars surveyors={surveyors} greenIds={greenIds} emptyLabel="" />
          </Box>
        )}
      </Box>

      {recorded ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
          {surveyors.length > 0 && (
            <SurveyorAvatars surveyors={surveyors} greenIds={greenIds} emptyLabel="" />
          )}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              px: 1.25,
              py: 0.4,
              borderRadius: '6px',
              bgcolor: '#DBEDDB',
              color: groupColors.brandDark,
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            <CheckCircleOutline sx={{ fontSize: 15 }} />
            Recorded
          </Box>
          {onOpen && <ChevronRight sx={{ fontSize: 18, color: groupColors.textMuted }} />}
        </Box>
      ) : needsSurvey ? (
        recordButton
      ) : dueThisWeek ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            gap: 1,
            flexShrink: 0,
          }}
        >
          {surveyors.length > 0 && (
            <Box sx={{ display: { xs: 'none', sm: 'flex' } }}>
              <SurveyorAvatars surveyors={surveyors} greenIds={greenIds} emptyLabel="" />
            </Box>
          )}
          {assignButton}
          {recordButton}
        </Box>
      ) : (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 1.25,
            flexShrink: 0,
          }}
        >
          {/* On xs the avatars already sit on the date line (or, with nobody
              signed up yet, the empty label stays here beside the button). */}
          <Box sx={{ display: { xs: surveyors.length > 0 ? 'none' : 'flex', sm: 'flex' } }}>
            <SurveyorAvatars surveyors={surveyors} greenIds={greenIds} />
          </Box>
          {assignButton}
        </Box>
      )}
    </Box>
  );
}
