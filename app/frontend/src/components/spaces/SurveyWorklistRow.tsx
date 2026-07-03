/**
 * A single row in the Surveys worklist. The date — a single day or a week range,
 * with the year — is the identifier and heads the row; there is no calendar tile
 * or icon (a week has no single day to pin one to). The middle carries the
 * location and status, never a title.
 *
 * Actions by state: overdue rows record only (the week has passed, surveyors
 * are captured on the record form); due-this-week rows both sign up and record
 * (people join surveys later in the current week); upcoming rows sign up only.
 * The "To record" section header carries the due-now meaning, so due-this-week
 * rows need no status line of their own.
 */
import { Box, Button, Typography } from '@mui/material';
import { Add, PersonAddAlt1, WarningAmberRounded } from '@mui/icons-material';
import type { Survey, Surveyor } from '../../services/api';
import SurveyorAvatars from './SurveyorAvatars';
import { spaceColors } from '../../pages/spaces/spacesTokens';
import { formatSurveyDate } from '../../pages/spaces/surveyState';

interface SurveyWorklistRowProps {
  survey: Survey;
  state: 'needs-survey' | 'due-this-week' | 'upcoming';
  surveyors: Surveyor[];
  /** Surveyor ids assigned this session — rendered green. */
  greenIds?: Set<number>;
  /** Open the survey to record sightings. */
  onAddSurvey: (survey: Survey) => void;
  /** Open the surveyor sign-up picker. */
  onAssign: (survey: Survey) => void;
}

const recordButtonSx = {
  flexShrink: 0,
  bgcolor: spaceColors.brand,
  '&:hover': { bgcolor: spaceColors.brandHover },
  borderRadius: '7px',
  textTransform: 'none',
  fontSize: 13,
  px: 1.5,
  py: 0.6,
};

const assignButtonSx = {
  flexShrink: 0,
  color: spaceColors.brand,
  borderColor: spaceColors.brand,
  '&:hover': { borderColor: spaceColors.brandDark, bgcolor: 'rgba(61,139,86,0.04)' },
  borderRadius: '7px',
  textTransform: 'none',
  fontSize: 13,
  px: 1.5,
  py: 0.5,
};

export default function SurveyWorklistRow({
  survey,
  state,
  surveyors,
  greenIds,
  onAddSurvey,
  onAssign,
}: SurveyWorklistRowProps) {
  const needsSurvey = state === 'needs-survey';
  const dueThisWeek = state === 'due-this-week';

  const recordButton = (
    <Button
      variant="contained"
      startIcon={<Add sx={{ fontSize: 18 }} />}
      onClick={() => onAddSurvey(survey)}
      sx={recordButtonSx}
    >
      Record survey
    </Button>
  );

  const assignButton = (
    <Button
      variant="outlined"
      startIcon={<PersonAddAlt1 sx={{ fontSize: 17 }} />}
      onClick={() => onAssign(survey)}
      sx={assignButtonSx}
    >
      Sign up
    </Button>
  );

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.6,
        px: 2.25,
        py: 1.6,
        borderTop: `1px solid ${spaceColors.dividerInner}`,
        bgcolor: needsSurvey ? spaceColors.amberRowBg : 'transparent',
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 14.5, fontWeight: 700, color: spaceColors.textPrimary }} noWrap>
          {formatSurveyDate(survey)}
        </Typography>
        {survey.location_name && (
          <Typography sx={{ fontSize: 13, color: spaceColors.textMuted, mt: 0.25 }} noWrap>
            {survey.location_name}
          </Typography>
        )}
        {needsSurvey && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
            <WarningAmberRounded sx={{ fontSize: 15, color: spaceColors.amberText }} />
            <Typography sx={{ fontSize: 13.5, color: spaceColors.amberText }}>
              Overdue — no survey recorded
            </Typography>
          </Box>
        )}
      </Box>

      {needsSurvey ? (
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
            <SurveyorAvatars surveyors={surveyors} greenIds={greenIds} emptyLabel="" />
          )}
          {assignButton}
          {recordButton}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
          <SurveyorAvatars surveyors={surveyors} greenIds={greenIds} />
          {assignButton}
        </Box>
      )}
    </Box>
  );
}
