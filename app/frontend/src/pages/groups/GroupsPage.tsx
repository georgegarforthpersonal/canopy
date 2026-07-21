/**
 * Groups grid (landing). Shows a card per survey type in the current org's
 * beta list (see BETA_GROUPS in groupMeta), ordered alphabetically. Selecting
 * a card opens that survey type's space.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Typography, CircularProgress } from '@mui/material';
import { surveyTypesAPI, surveysAPI, scheduledSurveysAPI, dashboardAPI, type ScheduledSurvey, type SurveyTypeWithDetails } from '../../services/api';
import { groupColors, GROUP_MAX_WIDTH } from './groupsTokens';
import { nextScheduledSurvey } from './surveyState';
import { primarySpeciesType, groupPath, betaGroupNames } from './groupMeta';
import GroupCard from '../../components/groups/GroupCard';
import { PageTitle } from '../../components/layout/PageTitle';

interface CardData {
  surveyType: SurveyTypeWithDetails;
  surveyCount: number;
  speciesCount: number;
  nextSurvey: ScheduledSurvey | null;
}

export default function GroupsPage() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<CardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const names = betaGroupNames();
        const types = await surveyTypesAPI.getAll();
        const matched = types.filter((t) => names.includes(t.name.trim().toLowerCase()));
        if (matched.length === 0) {
          if (active) setCards([]);
          return;
        }
        // "Surveys" is the recorded total (matching the All surveys
        // count); "Species" is the distinct species recorded by this type's
        // surveys; "Next survey" is the soonest scheduled future one.
        const loaded = await Promise.all(
          matched.map(async (t): Promise<CardData> => {
            const details = await surveyTypesAPI.getById(t.id);
            const speciesType = primarySpeciesType(details);
            const [totalPage, slots, cumulative] = await Promise.all([
              surveysAPI.getAll({ survey_type_id: t.id, page: 1, limit: 1 }),
              scheduledSurveysAPI.getAll({ survey_type_id: t.id }),
              dashboardAPI.getCumulativeSpecies([speciesType], t.id),
            ]);
            const speciesCount = cumulative.data
              .filter((d) => d.type === speciesType)
              .reduce((max, d) => Math.max(max, d.cumulative_count), 0);
            return {
              surveyType: details,
              surveyCount: totalPage.total,
              speciesCount,
              nextSurvey: nextScheduledSurvey(slots),
            };
          }),
        );
        if (!active) return;
        setCards(
          loaded.sort((a, b) => a.surveyType.name.localeCompare(b.surveyType.name)),
        );
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
    <Box sx={{ bgcolor: groupColors.page, minHeight: '100%', px: { xs: 2, sm: 4 }, py: { xs: 2, sm: 3.5 } }}>
      <Box sx={{ maxWidth: GROUP_MAX_WIDTH, mx: 'auto' }}>
        <PageTitle
          title="Groups"
          subtitle="Sign-up, instructions, and records for each survey type."
        />
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Alert severity="error">Failed to load groups. Please try again.</Alert>
        ) : cards.length === 0 ? (
          <Typography sx={{ fontSize: 14, color: groupColors.textMuted }}>
            No groups are available yet.
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
              <GroupCard
                key={c.surveyType.id}
                surveyType={c.surveyType}
                surveyCount={c.surveyCount}
                speciesCount={c.speciesCount}
                nextSurvey={c.nextSurvey}
                onOpen={() => navigate(groupPath(c.surveyType))}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
