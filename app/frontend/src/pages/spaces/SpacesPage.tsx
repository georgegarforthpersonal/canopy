/**
 * Spaces grid (landing). For the Heal beta this shows a single Butterfly card.
 * Selecting a card opens that survey type's space.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Typography, CircularProgress } from '@mui/material';
import { surveyTypesAPI, surveysAPI, dashboardAPI, type Survey, type SurveyTypeWithDetails } from '../../services/api';
import { spaceColors, SPACE_MAX_WIDTH } from './spacesTokens';
import { nextScheduledSurvey } from './surveyState';
import { primarySpeciesType, spacePath } from './spaceMeta';
import SpaceCard from '../../components/spaces/SpaceCard';

// The survey type the beta surfaces. Matched case-insensitively by name.
const BETA_SURVEY_TYPE_NAME = 'butterfly';

interface CardData {
  surveyType: SurveyTypeWithDetails;
  surveyCount: number;
  speciesCount: number;
  nextSurvey: Survey | null;
}

export default function SpacesPage() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<CardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const types = await surveyTypesAPI.getAll();
        const butterfly = types.find(
          (t) => t.name.trim().toLowerCase() === BETA_SURVEY_TYPE_NAME,
        );
        if (!butterfly) {
          if (active) setCards([]);
          return;
        }
        // "Surveys" is the total across all statuses (matching the All surveys
        // count); "Species" is the distinct species recorded (the all-time
        // cumulative total); "Next survey" is the soonest scheduled future one.
        const details = await surveyTypesAPI.getById(butterfly.id);
        const speciesType = primarySpeciesType(details);
        const [totalPage, scheduled, cumulative] = await Promise.all([
          surveysAPI.getAll({ survey_type_id: butterfly.id, page: 1, limit: 1 }),
          surveysAPI.getAllPages({ survey_type_id: butterfly.id, survey_status: 'scheduled' }),
          dashboardAPI.getCumulativeSpecies([speciesType]),
        ]);
        if (!active) return;
        const speciesCount = cumulative.data
          .filter((d) => d.type === speciesType)
          .reduce((max, d) => Math.max(max, d.cumulative_count), 0);
        setCards([
          {
            surveyType: details,
            surveyCount: totalPage.total,
            speciesCount,
            nextSurvey: nextScheduledSurvey(scheduled),
          },
        ]);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <Box sx={{ bgcolor: spaceColors.page, minHeight: '100%', px: { xs: 2, sm: 4 }, py: { xs: 2, sm: 3.5 } }}>
      <Box sx={{ maxWidth: SPACE_MAX_WIDTH, mx: 'auto' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Alert severity="error">Failed to load survey spaces. Please try again.</Alert>
        ) : cards.length === 0 ? (
          <Typography sx={{ fontSize: 14, color: spaceColors.textMuted }}>
            No survey spaces are available yet.
          </Typography>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
              gap: 2,
            }}
          >
            {cards.map((c) => (
              <SpaceCard
                key={c.surveyType.id}
                surveyType={c.surveyType}
                surveyCount={c.surveyCount}
                speciesCount={c.speciesCount}
                nextSurvey={c.nextSurvey}
                onOpen={() => navigate(spacePath(c.surveyType))}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
