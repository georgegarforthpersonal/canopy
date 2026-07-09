/**
 * All surveys: the full chronological history/forward-schedule for a survey
 * type. Status-only rows (no titles); the date — a single day or a week range,
 * with the year — heads each row and is the identifier (no calendar tile). The
 * server returns surveys date-descending (upcoming on top), paged via Load more.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Paper, Typography, Button, CircularProgress } from '@mui/material';
import { Add } from '@mui/icons-material';
import {
  ApiError,
  surveyTypesAPI,
  surveysAPI,
  surveyorsAPI,
  type SurveyTypeWithDetails,
  type Survey,
  type Surveyor,
} from '../../services/api';
import { recordButtonSx, groupCardSx, groupColors } from './groupsTokens';
import { primarySpeciesType, resolveGroupTypeId } from './groupMeta';
import { deriveSurveyState, formatSurveyDate, type SurveyState } from './surveyState';
import { getSpeciesIcon } from '../../config/speciesTypes';
import { useSignupSaved, useSurveyorLookup } from '../../hooks';
import { usePermissions } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import GroupBreadcrumb from '../../components/groups/GroupBreadcrumb';
import SelfSignupButton from '../../components/groups/SelfSignupButton';
import SurveyorAvatars from '../../components/groups/SurveyorAvatars';

const PAGE_SIZE = 25;

const STATUS_STYLES: Record<SurveyState, { label: string; color: string; bg: string }> = {
  recorded: { label: 'Recorded', color: '#2E6B42', bg: '#DBEDDB' },
  upcoming: { label: 'Upcoming', color: '#454648', bg: '#EBECED' },
  'due-this-week': { label: 'Due this week', color: '#2C5F8A', bg: '#DCE8F2' },
  'needs-survey': { label: 'Needs survey', color: groupColors.amberMonth, bg: '#FBF3DB' },
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

  const [surveyType, setSurveyType] = useState<SurveyTypeWithDetails | null>(null);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [total, setTotal] = useState(0);
  const [surveyors, setSurveyors] = useState<Surveyor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [greenIds, setGreenIds] = useState<Set<number>>(new Set());
  const toast = useToast();
  const { canEditSurveys } = usePermissions();

  useEffect(() => {
    if (!typeId) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        // The route param is a name slug (or a legacy numeric id) — resolve it
        // to the survey type id before anything else can be fetched.
        const surveyTypeId = await resolveGroupTypeId(typeId);
        if (!active) return;
        if (surveyTypeId == null) {
          setNotFound(true);
          return;
        }
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
      } catch (err) {
        // Only a 404 means the group doesn't exist; anything else is a fault.
        if (active) {
          if (err instanceof ApiError && err.status === 404) setNotFound(true);
          else setError(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [typeId]);

  const resolveSurveyors = useSurveyorLookup(surveyors);
  const handleSignupSaved = useSignupSaved(surveys, setSurveys, setGreenIds, surveyors, setSurveyors);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ maxWidth: 900, mx: 'auto', px: { xs: 2, sm: 4 }, py: 4 }}>
        <GroupBreadcrumb crumbs={[{ label: 'Groups', to: '/groups' }, { label: 'Error' }]} />
        <Alert severity="error">Failed to load surveys. Please try again.</Alert>
      </Box>
    );
  }

  if (notFound || !surveyType) {
    return (
      <Box sx={{ maxWidth: 900, mx: 'auto', px: { xs: 2, sm: 4 }, py: 4 }}>
        <GroupBreadcrumb crumbs={[{ label: 'Groups', to: '/groups' }, { label: 'Not found' }]} />
        <Typography sx={{ color: groupColors.textSecondary }}>
          This group could not be found.
        </Typography>
      </Box>
    );
  }

  const speciesType = primarySpeciesType(surveyType);
  const SpeciesIcon = getSpeciesIcon(speciesType);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const nextPage = Math.floor(surveys.length / PAGE_SIZE) + 1;
      const page = await surveysAPI.getAll({ survey_type_id: surveyType.id, page: nextPage, limit: PAGE_SIZE });
      setSurveys((prev) => [...prev, ...page.data]);
      setTotal(page.total);
    } catch {
      toast.error('Failed to load more surveys');
    } finally {
      setLoadingMore(false);
    }
  };

  // Open a survey, telling it to return here (the group's survey history)
  // rather than the main surveys list after editing/deleting. Record survey
  // passes record so the form opens in record mode — saving marks the
  // scheduled survey completed; a plain open never changes the lifecycle.
  const goToSurvey = (surveyId: number, opts?: { record?: boolean }) =>
    navigate(`/surveys/${surveyId}${opts?.record ? '?record=true' : ''}`, {
      state: {
        returnTo: {
          pathname: `/groups/${typeId}/all`,
          label: surveyType?.name ?? 'All surveys',
        },
      },
    });

  return (
    <Box sx={{ bgcolor: groupColors.page, minHeight: '100%', px: { xs: 2, sm: 4 }, py: { xs: 2, sm: 3 } }}>
      <Box sx={{ maxWidth: 900, mx: 'auto' }}>
        <GroupBreadcrumb
          crumbs={[
            { label: 'Groups', to: '/groups' },
            { label: surveyType?.name ?? 'Survey type', to: `/groups/${typeId}` },
            { label: 'All surveys' },
          ]}
        />

        <Typography sx={{ fontSize: 24, fontWeight: 600, color: groupColors.textPrimary }}>
          All surveys
        </Typography>
        <Typography sx={{ fontSize: 13.5, color: '#888', mb: 2 }}>
          {surveyType?.name ?? ''} · {total} survey{total === 1 ? '' : 's'}, most recent first
        </Typography>

        <Paper sx={groupCardSx}>
          {surveys.length === 0 ? (
            <Box sx={{ px: 2.25, py: 3 }}>
              <Typography sx={{ fontSize: 13.5, color: groupColors.textMuted }}>
                No surveys yet.
              </Typography>
            </Box>
          ) : (
            surveys.map((survey, idx) => {
              const state = deriveSurveyState(survey);
              const assigned = resolveSurveyors(survey.surveyor_ids);
              const actionable = state === 'needs-survey' || state === 'due-this-week';
              return (
                <Box
                  key={survey.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.75,
                    px: 2.25,
                    py: 1.6,
                    borderTop: idx === 0 ? 'none' : `1px solid ${groupColors.dividerInner}`,
                    bgcolor: state === 'needs-survey' ? groupColors.amberRowBg : 'transparent',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: state === 'needs-survey' ? groupColors.amberRowBg : groupColors.page },
                  }}
                  onClick={() => goToSurvey(survey.id)}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 14.5, fontWeight: 700, color: groupColors.textPrimary }} noWrap>
                      {formatSurveyDate(survey)}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.4, minWidth: 0 }}>
                      <StatusChip state={state} />
                      {survey.location_name && (
                        <Typography sx={{ fontSize: 13, color: groupColors.textMuted }} noWrap>
                          {survey.location_name}
                        </Typography>
                      )}
                    </Box>
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

                  {/* Sign-up is open for future weeks and the current week alike —
                      the same one-click self toggle for every role. */}
                  {(state === 'upcoming' || state === 'due-this-week') && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
                      <SurveyorAvatars surveyors={assigned} greenIds={greenIds} />
                      <SelfSignupButton survey={survey} assigned={assigned} onSaved={handleSignupSaved} />
                    </Box>
                  )}

                  {actionable && canEditSurveys && (
                    <Button
                      variant="contained"
                      startIcon={<Add sx={{ fontSize: 18 }} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        goToSurvey(survey.id, { record: true });
                      }}
                      sx={recordButtonSx}
                    >
                      Record survey
                    </Button>
                  )}
                </Box>
              );
            })
          )}

          {surveys.length < total && (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 1.5, borderTop: `1px solid ${groupColors.dividerInner}` }}>
              <Button
                onClick={loadMore}
                disabled={loadingMore}
                startIcon={loadingMore ? <CircularProgress size={14} /> : undefined}
                sx={{ textTransform: 'none', color: groupColors.brand }}
              >
                Load more
              </Button>
            </Box>
          )}
        </Paper>
      </Box>

    </Box>
  );
}
