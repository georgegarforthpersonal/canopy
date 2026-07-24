/**
 * Neutral hero band for a group: survey-type badge + name + description.
 * No action button (recording and sign-up live on the survey rows) and no
 * season/coordinator meta (not modelled in the backend for the beta).
 */
import { Box, Paper, Typography } from '@mui/material';
import type { SurveyTypeWithDetails } from '../../services/api';
import { groupColors } from '../../pages/groups/groupsTokens';
import SurveyTypeBadge from './SurveyTypeBadge';

interface GroupHeroProps {
  surveyType: SurveyTypeWithDetails;
}

export default function GroupHero({ surveyType }: GroupHeroProps) {
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
      <SurveyTypeBadge surveyType={surveyType} size={60} radius={14} />
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
