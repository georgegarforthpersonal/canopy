/**
 * Neutral hero band for a group: tinted species icon tile + name + description.
 * No action button (recording and sign-up live on the survey rows) and no
 * season/coordinator meta (not modelled in the backend for the beta).
 */
import { Box, Paper, Typography } from '@mui/material';
import type { SurveyTypeWithDetails } from '../../services/api';
import { groupColors } from '../../pages/groups/groupsTokens';
import { accentColors, primarySpeciesType } from '../../pages/groups/groupMeta';
import SpeciesIconTile from './SpeciesIconTile';

interface GroupHeroProps {
  surveyType: SurveyTypeWithDetails;
}

export default function GroupHero({ surveyType }: GroupHeroProps) {
  const accent = accentColors(surveyType);
  return (
    <Paper
      sx={{
        bgcolor: groupColors.paper,
        border: `1px solid ${groupColors.divider}`,
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
        <Typography sx={{ fontSize: 24, fontWeight: 600, color: groupColors.textPrimary, lineHeight: 1.2 }}>
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
