/**
 * A single row in the Surveys worklist. The calendar date block is the
 * identifier; the middle carries the transect/location and status, never a
 * title. Layout follows the design screenshots (location shown when present).
 */
import { Box, Button, Typography } from '@mui/material';
import { Add, PersonAddAlt1, WarningAmberRounded } from '@mui/icons-material';
import type { Survey, Surveyor } from '../../services/api';
import DateBlock from './DateBlock';
import SurveyorAvatars from './SurveyorAvatars';
import { spaceColors } from '../../pages/spaces/spacesTokens';

interface SurveyWorklistRowProps {
  survey: Survey;
  state: 'needs-survey' | 'upcoming';
  surveyors: Surveyor[];
  /** Surveyor ids assigned this session — rendered green. */
  greenIds?: Set<number>;
  /** Record sightings for a needs-survey row. */
  onAddSurvey: (survey: Survey) => void;
  /** Assign surveyors to an upcoming row. */
  onAssign: (survey: Survey) => void;
}

export default function SurveyWorklistRow({
  survey,
  state,
  surveyors,
  greenIds,
  onAddSurvey,
  onAssign,
}: SurveyWorklistRowProps) {
  const needsSurvey = state === 'needs-survey';

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
      <DateBlock isoDate={survey.date} amber={needsSurvey} monthColor="#AD5E99" />

      <Box sx={{ minWidth: 0, flex: 1 }}>
        {survey.location_name && (
          <Typography
            sx={{ fontSize: 13.5, fontWeight: 600, color: spaceColors.textPrimary }}
            noWrap
          >
            {survey.location_name}
          </Typography>
        )}
        {needsSurvey ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: survey.location_name ? 0.25 : 0 }}>
            <WarningAmberRounded sx={{ fontSize: 15, color: spaceColors.amberText }} />
            <Typography sx={{ fontSize: 13.5, color: spaceColors.amberText }}>
              No survey recorded
            </Typography>
          </Box>
        ) : (
          !survey.location_name && (
            <Typography sx={{ fontSize: 13, color: spaceColors.textMuted }}>
              Upcoming survey
            </Typography>
          )
        )}
      </Box>

      {needsSurvey ? (
        <Button
          variant="contained"
          startIcon={<Add sx={{ fontSize: 18 }} />}
          onClick={() => onAddSurvey(survey)}
          sx={{
            flexShrink: 0,
            bgcolor: spaceColors.brand,
            '&:hover': { bgcolor: spaceColors.brandHover },
            borderRadius: '7px',
            textTransform: 'none',
            fontSize: 13,
            px: 1.5,
            py: 0.6,
          }}
        >
          Add survey
        </Button>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
          <SurveyorAvatars surveyors={surveyors} greenIds={greenIds} />
          <Button
            variant="outlined"
            startIcon={<PersonAddAlt1 sx={{ fontSize: 17 }} />}
            onClick={() => onAssign(survey)}
            sx={{
              color: spaceColors.brand,
              borderColor: spaceColors.brand,
              '&:hover': { borderColor: spaceColors.brandDark, bgcolor: 'rgba(61,139,86,0.04)' },
              borderRadius: '7px',
              textTransform: 'none',
              fontSize: 13,
              px: 1.5,
              py: 0.5,
            }}
          >
            Add
          </Button>
        </Box>
      )}
    </Box>
  );
}
