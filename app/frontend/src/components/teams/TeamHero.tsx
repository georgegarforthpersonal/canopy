/**
 * Neutral hero band for a team: tinted species icon tile + name + description.
 * No action button (recording and sign-up live on the survey rows) and no
 * season/coordinator meta (not modelled in the backend for the beta).
 */
import { Box, Paper, Typography } from '@mui/material';
import type { SurveyTypeWithDetails } from '../../services/api';
import { teamColors } from '../../pages/teams/teamsTokens';
import { accentColors, primarySpeciesType } from '../../pages/teams/teamMeta';
import SpeciesIconTile from './SpeciesIconTile';

interface TeamHeroProps {
  surveyType: SurveyTypeWithDetails;
}

export default function TeamHero({ surveyType }: TeamHeroProps) {
  const accent = accentColors(surveyType);
  return (
    <Paper
      sx={{
        bgcolor: teamColors.paper,
        border: `1px solid ${teamColors.divider}`,
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
        <Typography sx={{ fontSize: 24, fontWeight: 600, color: teamColors.textPrimary, lineHeight: 1.2 }}>
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
