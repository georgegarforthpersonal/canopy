/**
 * A type card on the Groups grid. The whole card is a button that opens the
 * group page. Shows the tinted species icon tile, name + sub-label, and a three-stat
 * row (surveys, unique species found, next survey).
 */
import { Box, Paper, ButtonBase, Typography } from '@mui/material';
import { ChevronRight } from '@mui/icons-material';
import type { ScheduledSurvey, SurveyTypeWithDetails } from '../../services/api';
import { groupColors } from '../../pages/groups/groupsTokens';
import { accentColors, primarySpeciesType } from '../../pages/groups/groupMeta';
import { formatSurveyDate } from '../../pages/groups/surveyState';
import SpeciesIconTile from './SpeciesIconTile';

interface GroupCardProps {
  surveyType: SurveyTypeWithDetails;
  surveyCount: number;
  /** Distinct species recorded across all surveys of this type. */
  speciesCount: number;
  /** Soonest upcoming survey, or null if none scheduled. */
  nextSurvey: ScheduledSurvey | null;
  onOpen: () => void;
}

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        sx={{ fontSize: 13, fontWeight: 600, color: valueColor ?? groupColors.textPrimary }}
        noWrap
      >
        {value}
      </Typography>
      <Typography sx={{ fontSize: 11, color: '#888' }}>{label}</Typography>
    </Box>
  );
}

export default function GroupCard({
  surveyType,
  surveyCount,
  speciesCount,
  nextSurvey,
  onOpen,
}: GroupCardProps) {
  const accent = accentColors(surveyType);
  return (
    <Paper sx={{ border: `1px solid ${groupColors.divider}`, borderRadius: '10px', boxShadow: 'none', overflow: 'hidden' }}>
      <ButtonBase
        onClick={onOpen}
        sx={{
          width: '100%',
          display: 'block',
          textAlign: 'left',
          p: 2.5,
          transition: 'box-shadow 120ms, border-color 120ms',
          '&:hover': { boxShadow: '0 4px 14px rgba(0,0,0,0.08)' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75 }}>
          <SpeciesIconTile
            speciesType={primarySpeciesType(surveyType)}
            size={46}
            radius={11}
            bg={accent.bg}
            fg={accent.fg}
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 17, fontWeight: 600, color: groupColors.textPrimary }} noWrap>
              {surveyType.name}
            </Typography>
            {surveyType.description && (
              <Typography sx={{ fontSize: 12.5, color: '#888' }} noWrap>
                {surveyType.description}
              </Typography>
            )}
          </Box>
          <ChevronRight sx={{ color: '#bbb' }} />
        </Box>

        <Box sx={{ height: '1px', bgcolor: groupColors.divider, my: 2 }} />

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: 1 }}>
          <Stat label="Surveys" value={String(surveyCount)} />
          <Stat label="Species" value={String(speciesCount)} />
          <Stat
            label="Next survey"
            value={nextSurvey ? formatSurveyDate(nextSurvey) : 'No sessions'}
            valueColor={nextSurvey ? groupColors.brand : '#888'}
          />
        </Box>
      </ButtonBase>
    </Paper>
  );
}
