/**
 * Spaces grid (landing). For the Heal beta this shows a single Butterfly card.
 * Selecting a card opens that survey type's space.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Button, CircularProgress } from '@mui/material';
import { Add } from '@mui/icons-material';
import { surveyTypesAPI, surveysAPI, type SurveyTypeWithDetails } from '../../services/api';
import { spaceColors, SPACE_MAX_WIDTH } from './spacesTokens';
import { nextSessionDate } from './surveyState';
import SpaceCard from '../../components/spaces/SpaceCard';

// The survey type the beta surfaces. Matched case-insensitively by name.
const BETA_SURVEY_TYPE_NAME = 'butterfly';

interface CardData {
  surveyType: SurveyTypeWithDetails;
  surveyCount: number;
  siteCount: number;
  nextSession: string | null;
}

export default function SpacesPage() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<CardData[]>([]);
  const [loading, setLoading] = useState(true);

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
        // count); "Next session" is the soonest scheduled future survey.
        const [details, totalPage, scheduledPage] = await Promise.all([
          surveyTypesAPI.getById(butterfly.id),
          surveysAPI.getAll({ survey_type_id: butterfly.id, page: 1, limit: 1 }),
          surveysAPI.getAll({ survey_type_id: butterfly.id, survey_status: 'scheduled', page: 1, limit: 100 }),
        ]);
        if (!active) return;
        setCards([
          {
            surveyType: details,
            surveyCount: totalPage.total,
            siteCount: details.locations.length,
            nextSession: nextSessionDate(scheduledPage.data),
          },
        ]);
      } catch {
        if (active) setCards([]);
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
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 2,
            mb: 3,
          }}
        >
          <Box sx={{ maxWidth: 560 }}>
            <Typography sx={{ fontSize: 26, fontWeight: 600, color: spaceColors.textPrimary }}>
              Survey spaces
            </Typography>
            <Typography sx={{ fontSize: 14, color: spaceColors.textSecondary, mt: 0.5 }}>
              Each survey type has its own space — the rules, an open sign-up sheet, the sites
              and devices in the field, and every recorded survey, all in one place.
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => navigate('/surveys/new')}
            sx={{
              bgcolor: spaceColors.brand,
              '&:hover': { bgcolor: spaceColors.brandHover },
              textTransform: 'none',
              borderRadius: '6px',
              px: 2,
              height: 40,
            }}
          >
            Add survey
          </Button>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
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
                siteCount={c.siteCount}
                nextSession={c.nextSession}
                onOpen={() => navigate(`/spaces/${c.surveyType.id}`)}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
