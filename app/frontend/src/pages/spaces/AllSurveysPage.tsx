/**
 * All surveys: the full chronological history/forward-schedule for a survey
 * type. Status-only rows (no titles); the date block is the identifier. The
 * server returns surveys date-descending (upcoming on top), paged via Load more.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Paper, Typography, Button, CircularProgress } from '@mui/material';
import { Add, PersonAddAlt1 } from '@mui/icons-material';
import {
  surveyTypesAPI,
  surveysAPI,
  surveyorsAPI,
  type SurveyTypeWithDetails,
  type Survey,
  type Surveyor,
} from '../../services/api';
import { spaceCardSx, spaceColors } from './spacesTokens';
import { primarySpeciesType } from './spaceMeta';
import { deriveSurveyState, type SurveyState } from './surveyState';
import { getSpeciesIcon } from '../../config/speciesTypes';
import { useSurveyorLookup } from '../../hooks';
import SpaceBreadcrumb from '../../components/spaces/SpaceBreadcrumb';
import DateBlock from '../../components/spaces/DateBlock';
import SurveyorAvatars from '../../components/spaces/SurveyorAvatars';
import SurveyorPickerDialog from '../../components/spaces/SurveyorPickerDialog';

const PAGE_SIZE = 25;

const STATUS_STYLES: Record<SurveyState, { label: string; color: string; bg: string }> = {
  recorded: { label: 'Recorded', color: '#2E6B42', bg: '#DBEDDB' },
  upcoming: { label: 'Upcoming', color: '#454648', bg: '#EBECED' },
  'needs-survey': { label: 'Needs survey', color: spaceColors.amberMonth, bg: '#FBF3DB' },
  cancelled: { label: 'Cancelled', color: '#888888', bg: '#EBECED' },
};

function StatusChip({ state }: { state: SurveyState }) {
  const s = STATUS_STYLES[state];
  return (
    <Box
      sx={{
        px: 1.25,
        py: 0.4,
        borderRadius: '6px',
        bgcolor: s.bg,
        color: s.color,
        fontSize: 12.5,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {s.label}
    </Box>
  );
}

export default function AllSurveysPage() {
  const { typeId } = useParams<{ typeId: string }>();
  const navigate = useNavigate();
  const surveyTypeId = Number(typeId);

  const [surveyType, setSurveyType] = useState<SurveyTypeWithDetails | null>(null);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [total, setTotal] = useState(0);
  const [surveyors, setSurveyors] = useState<Surveyor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [assignSurvey, setAssignSurvey] = useState<Survey | null>(null);
  const [greenIds, setGreenIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!Number.isFinite(surveyTypeId)) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const [details, page, surveyorList] = await Promise.all([
          surveyTypesAPI.getById(surveyTypeId),
          surveysAPI.getAll({ survey_type_id: surveyTypeId, page: 1, limit: PAGE_SIZE }),
          surveyorsAPI.getAll(),
        ]);
        if (!active) return;
        setSurveyType(details);
        setSurveys(page.data);
        setTotal(page.total);
        setSurveyors(surveyorList);
      } catch {
        if (active) setSurveyType(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [surveyTypeId]);

  const resolveSurveyors = useSurveyorLookup(surveyors);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const speciesType = surveyType ? primarySpeciesType(surveyType) : 'butterfly';
  const SpeciesIcon = getSpeciesIcon(speciesType);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const nextPage = Math.floor(surveys.length / PAGE_SIZE) + 1;
      const page = await surveysAPI.getAll({ survey_type_id: surveyTypeId, page: nextPage, limit: PAGE_SIZE });
      setSurveys((prev) => [...prev, ...page.data]);
      setTotal(page.total);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleAssignSaved = (surveyId: number, surveyorIds: number[]) => {
    const previous = surveys.find((s) => s.id === surveyId)?.surveyor_ids ?? [];
    setSurveys((prev) =>
      prev.map((s) => (s.id === surveyId ? { ...s, surveyor_ids: surveyorIds } : s)),
    );
    const added = surveyorIds.filter((id) => !previous.includes(id));
    if (added.length > 0) {
      setGreenIds((prev) => {
        const next = new Set(prev);
        added.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  return (
    <Box sx={{ bgcolor: spaceColors.page, minHeight: '100%', px: { xs: 2, sm: 4 }, py: { xs: 2, sm: 3 } }}>
      <Box sx={{ maxWidth: 900, mx: 'auto' }}>
        <SpaceBreadcrumb
          crumbs={[
            { label: 'Spaces', to: '/spaces' },
            { label: surveyType?.name ?? 'Survey type', to: `/spaces/${surveyTypeId}` },
            { label: 'All surveys' },
          ]}
        />

        <Typography sx={{ fontSize: 24, fontWeight: 600, color: spaceColors.textPrimary }}>
          All surveys
        </Typography>
        <Typography sx={{ fontSize: 13.5, color: '#888', mb: 2 }}>
          {surveyType?.name ?? ''} · {total} survey{total === 1 ? '' : 's'}, most recent first
        </Typography>

        <Paper sx={spaceCardSx}>
          {surveys.length === 0 ? (
            <Box sx={{ px: 2.25, py: 3 }}>
              <Typography sx={{ fontSize: 13.5, color: spaceColors.textMuted }}>
                No surveys yet.
              </Typography>
            </Box>
          ) : (
            surveys.map((survey, idx) => {
              const state = deriveSurveyState(survey);
              const assigned = resolveSurveyors(survey.surveyor_ids);
              return (
                <Box
                  key={survey.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.75,
                    px: 2.25,
                    py: 1.6,
                    borderTop: idx === 0 ? 'none' : `1px solid ${spaceColors.dividerInner}`,
                    bgcolor: state === 'needs-survey' ? spaceColors.amberRowBg : 'transparent',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: state === 'needs-survey' ? spaceColors.amberRowBg : spaceColors.page },
                  }}
                  onClick={() => navigate(`/surveys/${survey.id}`)}
                >
                  <DateBlock isoDate={survey.date} amber={state === 'needs-survey'} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    {survey.location_name && (
                      <Typography sx={{ fontSize: 13, fontWeight: 600, color: spaceColors.textPrimary }} noWrap>
                        {survey.location_name}
                      </Typography>
                    )}
                    <StatusChip state={state} />
                  </Box>

                  {/* Right cell varies by status */}
                  {state === 'recorded' && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                          px: 1,
                          py: 0.4,
                          borderRadius: '6px',
                          bgcolor: '#EBECED',
                          color: '#454648',
                          fontSize: 12.5,
                          fontWeight: 600,
                        }}
                      >
                        <SpeciesIcon sx={{ fontSize: 15 }} />
                        {survey.sightings_count}
                      </Box>
                      <SurveyorAvatars surveyors={assigned} emptyLabel="" greenIds={greenIds} />
                    </Box>
                  )}

                  {state === 'upcoming' && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
                      <SurveyorAvatars surveyors={assigned} greenIds={greenIds} />
                      <Button
                        variant="outlined"
                        startIcon={<PersonAddAlt1 sx={{ fontSize: 17 }} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          setAssignSurvey(survey);
                        }}
                        sx={{
                          color: spaceColors.brand,
                          borderColor: spaceColors.brand,
                          '&:hover': { borderColor: spaceColors.brandDark, bgcolor: 'rgba(61,139,86,0.04)' },
                          borderRadius: '7px',
                          textTransform: 'none',
                          fontSize: 13,
                          px: 1.5,
                          py: 0.5,
                        }}
                      >
                        Add
                      </Button>
                    </Box>
                  )}

                  {state === 'needs-survey' && (
                    <Button
                      variant="contained"
                      startIcon={<Add sx={{ fontSize: 18 }} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/surveys/${survey.id}`);
                      }}
                      sx={{
                        flexShrink: 0,
                        bgcolor: spaceColors.brand,
                        '&:hover': { bgcolor: spaceColors.brandHover },
                        borderRadius: '7px',
                        textTransform: 'none',
                        fontSize: 13,
                        px: 1.5,
                        py: 0.6,
                      }}
                    >
                      Add survey
                    </Button>
                  )}
                </Box>
              );
            })
          )}

          {surveys.length < total && (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 1.5, borderTop: `1px solid ${spaceColors.dividerInner}` }}>
              <Button
                onClick={loadMore}
                disabled={loadingMore}
                startIcon={loadingMore ? <CircularProgress size={14} /> : undefined}
                sx={{ textTransform: 'none', color: spaceColors.brand }}
              >
                Load more
              </Button>
            </Box>
          )}
        </Paper>
      </Box>

      <SurveyorPickerDialog
        open={assignSurvey != null}
        survey={assignSurvey}
        surveyors={surveyors}
        onClose={() => setAssignSurvey(null)}
        onSaved={handleAssignSaved}
      />
    </Box>
  );
}
