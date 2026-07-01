/**
 * Neutral hero band for a space: tinted species icon tile + name + description.
 * No action button (Add survey lives on the grid header and survey rows) and no
 * season/coordinator meta (not modelled in the backend for the beta).
 */
import { Box, Paper, Typography } from '@mui/material';
import type { SurveyTypeWithDetails } from '../../services/api';
import { spaceColors } from '../../pages/spaces/spacesTokens';
import { accentColors, primarySpeciesType } from '../../pages/spaces/spaceMeta';
import SpeciesIconTile from './SpeciesIconTile';

interface SpaceHeroProps {
  surveyType: SurveyTypeWithDetails;
}

export default function SpaceHero({ surveyType }: SpaceHeroProps) {
  const accent = accentColors(surveyType);
  return (
    <Paper
      sx={{
        bgcolor: spaceColors.paper,
        border: `1px solid ${spaceColors.divider}`,
        borderRadius: '12px',
        boxShadow: 'none',
        px: 3,
        py: 2.75,
        display: 'flex',
        alignItems: 'center',
        gap: 2.5,
      }}
    >
      <SpeciesIconTile
        speciesType={primarySpeciesType(surveyType)}
        size={60}
        radius={14}
        bg={accent.bg}
        fg={accent.fg}
      />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 24, fontWeight: 600, color: spaceColors.textPrimary, lineHeight: 1.2 }}>
          {surveyType.name}
        </Typography>
        {surveyType.description && (
          <Typography sx={{ fontSize: 14, color: '#5d6660', mt: 0.5 }}>
            {surveyType.description}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}
