/**
 * Groups grid (landing). Shows a card per survey type in the current org's
 * beta list (see BETA_GROUPS in groupMeta), ordered alphabetically. Selecting
 * a card opens that survey type's space.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Typography, CircularProgress } from '@mui/material';
import { surveyTypesAPI, surveysAPI, scheduledSurveysAPI, dashboardAPI, type SurveyTypeWithDetails } from '../../services/api';
import { groupColors, GROUP_MAX_WIDTH } from './groupsTokens';
import { formatRecordedDate, formatSurveyDate, nextScheduledSurvey } from './surveyState';
import { primarySpeciesType, groupPath, betaGroupNames, groupActivity } from './groupMeta';
import GroupCard from '../../components/groups/GroupCard';
import { PageTitle } from '../../components/layout/PageTitle';

interface CardData {
  surveyType: SurveyTypeWithDetails;
  surveyCount: number;
  countStat: { label: 'Species' | 'Sightings'; value: number };
  dateStat: { label: 'Next survey' | 'Last survey'; value: string | null };
}

/**
 * Middle card stat: distinct species recorded by this type's surveys — except
 * for types fixed to a single species, where that would always read 1, so we
 * show total sightings instead (same source as the group page's headline).
 */
async function countStatFor(details: SurveyTypeWithDetails): Promise<CardData['countStat']> {
  const singleSpecies = details.species.length === 1 ? details.species[0] : null;
  if (singleSpecies) {
    const res = await dashboardAPI.getSpeciesOccurrences(singleSpecies.id, undefined, undefined, details.id);
    return { label: 'Sightings', value: res.data.reduce((sum, d) => sum + d.occurrence_count, 0) };
  }
  const speciesType = primarySpeciesType(details);
  const res = await dashboardAPI.getCumulativeSpecies([speciesType], details.id);
  return {
    label: 'Species',
    value: res.data
      .filter((d) => d.type === speciesType)
      .reduce((max, d) => Math.max(max, d.cumulative_count), 0),
  };
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
        // "Surveys" is the recorded total (matching the All surveys count);
        // the middle stat is countStatFor's species-or-sightings count; the
        // date stat is the soonest scheduled survey for worklist groups, or —
        // for unscheduled ('record') groups, which never have slots — the most
        // recently recorded one (the list is date-descending, so it rides
        // along on the same limit-1 totals call).
        const loaded = await Promise.all(
          matched.map(async (t): Promise<CardData> => {
            const details = await surveyTypesAPI.getById(t.id);
            const scheduled = groupActivity(t.name) === 'worklist';
            const [totalPage, slots, countStat] = await Promise.all([
              surveysAPI.getAll({ survey_type_id: t.id, page: 1, limit: 1 }),
              scheduled ? scheduledSurveysAPI.getAll({ survey_type_id: t.id }) : Promise.resolve([]),
              countStatFor(details),
            ]);
            const next = nextScheduledSurvey(slots);
            const last = totalPage.data[0] ?? null;
            const dateStat: CardData['dateStat'] = scheduled
              ? { label: 'Next survey', value: next ? formatSurveyDate(next) : null }
              : { label: 'Last survey', value: last ? formatRecordedDate(last.date) : null };
            return {
              surveyType: details,
              surveyCount: totalPage.total,
              countStat,
              dateStat,
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
                countStat={c.countStat}
                dateStat={c.dateStat}
                onOpen={() => navigate(groupPath(c.surveyType))}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
