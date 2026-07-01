/**
 * A type card on the Spaces grid. The whole card is a button that opens the
 * space. Shows the tinted species icon tile, name + sub-label, and a three-stat
 * row (surveys, unique species found, next survey).
 */
import { Box, Paper, ButtonBase, Typography } from '@mui/material';
import { ChevronRight } from '@mui/icons-material';
import type { Survey, SurveyTypeWithDetails } from '../../services/api';
import { spaceColors } from '../../pages/spaces/spacesTokens';
import { accentColors, primarySpeciesType } from '../../pages/spaces/spaceMeta';
import { formatSurveyDate } from '../../pages/spaces/surveyState';
import SpeciesIconTile from './SpeciesIconTile';

interface SpaceCardProps {
  surveyType: SurveyTypeWithDetails;
  surveyCount: number;
  /** Distinct species recorded across all surveys of this type. */
  speciesCount: number;
  /** Soonest upcoming survey, or null if none scheduled. */
  nextSurvey: Survey | null;
  onOpen: () => void;
}

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        sx={{ fontSize: 13, fontWeight: 600, color: valueColor ?? spaceColors.textPrimary }}
        noWrap
      >
        {value}
      </Typography>
      <Typography sx={{ fontSize: 11, color: '#888' }}>{label}</Typography>
    </Box>
  );
}

export default function SpaceCard({
  surveyType,
  surveyCount,
  speciesCount,
  nextSurvey,
  onOpen,
}: SpaceCardProps) {
  const accent = accentColors(surveyType);
  return (
    <Paper sx={{ border: `1px solid ${spaceColors.divider}`, borderRadius: '10px', boxShadow: 'none', overflow: 'hidden' }}>
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
            <Typography sx={{ fontSize: 17, fontWeight: 600, color: spaceColors.textPrimary }} noWrap>
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

        <Box sx={{ height: '1px', bgcolor: spaceColors.divider, my: 2 }} />

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: 1 }}>
          <Stat label="Surveys" value={String(surveyCount)} />
          <Stat label="Species" value={String(speciesCount)} />
          <Stat
            label="Next survey"
            value={nextSurvey ? formatSurveyDate(nextSurvey) : 'No sessions'}
            valueColor={nextSurvey ? spaceColors.brand : '#888'}
          />
        </Box>
      </ButtonBase>
    </Paper>
  );
}
