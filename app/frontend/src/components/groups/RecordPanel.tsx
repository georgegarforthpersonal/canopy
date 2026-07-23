/**
 * The Surveys panel for unscheduled ('record' activity) groups. These types
 * have no ScheduledSurvey slots to build a worklist from — surveys arrive
 * opportunistically — so the panel leads with a record CTA, shows the most
 * recent recorded surveys, and keeps the same "All surveys" door as the
 * worklist panel (recorded count only; nothing is ever scheduled).
 */
import { Box, Paper, Typography, Button } from '@mui/material';
import { Add, ChevronRight } from '@mui/icons-material';
import type { Survey, Surveyor } from '../../services/api';
import { usePermissions } from '../../context/AuthContext';
import { groupCardSx, groupColors, recordButtonSx } from '../../pages/groups/groupsTokens';
import { formatRecordedDate } from '../../pages/groups/surveyState';
import SpeciesCountChips from './SpeciesCountChips';
import SurveyorAvatars from './SurveyorAvatars';
import AllSurveysDoor from './AllSurveysDoor';

interface RecordPanelProps {
  /** Most recent recorded surveys, newest first (already capped upstream). */
  surveys: Survey[];
  /** Recorded surveys total — shown on the All surveys door. */
  recordedCount: number;
  resolveSurveyors: (ids: number[]) => Surveyor[];
  /** Icon for the zero-sightings chip when a survey has no recorded species. */
  speciesType: string;
  /** CTA text — "Log a sighting" for ad hoc capture, "Record survey" for media types. */
  recordLabel: string;
  onRecord: () => void;
  onOpenSurvey: (survey: Survey) => void;
  onViewAll: () => void;
}

export default function RecordPanel({
  surveys,
  recordedCount,
  resolveSurveyors,
  speciesType,
  recordLabel,
  onRecord,
  onOpenSurvey,
  onViewAll,
}: RecordPanelProps) {
  const { canEditSurveys } = usePermissions();

  return (
    <Paper sx={groupCardSx}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          px: 2.25,
          py: 1.75,
          borderBottom: `1px solid ${groupColors.divider}`,
        }}
      >
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: groupColors.textPrimary }}>
          Surveys
        </Typography>
        {canEditSurveys && (
          <Button
            variant="contained"
            startIcon={<Add sx={{ fontSize: 18 }} />}
            onClick={onRecord}
            sx={recordButtonSx}
          >
            {recordLabel}
          </Button>
        )}
      </Box>

      {surveys.length === 0 ? (
        <Box sx={{ px: 2.25, py: 3 }}>
          <Typography sx={{ fontSize: 13.5, color: groupColors.textMuted }}>
            No surveys recorded yet.
          </Typography>
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, px: 2.25, pt: 1.5, pb: 0.25 }}>
            <Typography
              sx={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: groupColors.textMuted }}
            >
              Recent
            </Typography>
          </Box>
          {surveys.map((survey) => (
            <Box
              key={survey.id}
              onClick={() => onOpenSurvey(survey)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.6,
                px: 2.25,
                py: 1.6,
                borderTop: `1px solid ${groupColors.dividerInner}`,
                cursor: 'pointer',
                '&:hover': { bgcolor: groupColors.page },
              }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontSize: 14.5, fontWeight: 700, color: groupColors.textPrimary }} noWrap>
                  {formatRecordedDate(survey.date)}
                </Typography>
                {survey.location_name && (
                  <Typography sx={{ fontSize: 13, color: groupColors.textMuted, mt: 0.25 }} noWrap>
                    {survey.location_name}
                  </Typography>
                )}
              </Box>
              <Box sx={{ flexShrink: 0 }}>
                <SpeciesCountChips survey={survey} fallbackSpeciesType={speciesType} />
              </Box>
              <SurveyorAvatars surveyors={resolveSurveyors(survey.surveyor_ids)} emptyLabel="" />
              <ChevronRight sx={{ fontSize: 18, color: groupColors.textMuted, flexShrink: 0 }} />
            </Box>
          ))}
        </>
      )}

      {/* Nothing is ever scheduled for these groups, so the door counts recorded only. */}
      <AllSurveysDoor summary={`${recordedCount} recorded`} onViewAll={onViewAll} />
    </Paper>
  );
}
