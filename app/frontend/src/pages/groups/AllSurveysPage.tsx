/**
 * All surveys: the full history/forward-schedule for a survey type, split into
 * the same labelled sections as the Surveys panel — To record, This week,
 * Upcoming — followed by Recorded (the full history, most recent first). The
 * section carries the status meaning, so rows have no status chip. The date —
 * a single day or a week range, with the year — heads each row and is the
 * identifier (no calendar tile). The server returns surveys date-descending,
 * paged via Load more (older history arrives at the bottom).
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
import { deriveSurveyState, formatSurveyDate, recordedThisWeek } from './surveyState';
import { getSpeciesIcon } from '../../config/speciesTypes';
import { useSignupSaved, useSurveyorLookup } from '../../hooks';
import { usePermissions } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import GroupBreadcrumb from '../../components/groups/GroupBreadcrumb';
import SectionHeader from '../../components/groups/SectionHeader';
import SelfSignupButton from '../../components/groups/SelfSignupButton';
import SurveyorAvatars from '../../components/groups/SurveyorAvatars';

const PAGE_SIZE = 25;

/** Cancelled rows sit inside the Recorded history and need their own marker. */
function CancelledChip() {
  return (
    <Box
      sx={{
        px: 1.25,
        py: 0.4,
        borderRadius: '6px',
        bgcolor: '#EBECED',
        color: '#888888',
        fontSize: 12.5,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      Cancelled
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

  // The same sections as the Surveys panel, computed over the loaded pages.
  // The server streams date-descending, so Upcoming and This week arrive on
  // the first page and Load more extends the Recorded history; any overdue
  // rows on later pages surface into To record as they load.
  const toRecord = surveys
    .filter((s) => deriveSurveyState(s) === 'needs-survey')
    .sort((a, b) => a.date.localeCompare(b.date));
  const dueNow = surveys
    .filter((s) => deriveSurveyState(s) === 'due-this-week')
    .sort((a, b) => a.date.localeCompare(b.date));
  const doneThisWeek = recordedThisWeek(surveys);
  const thisWeek = [...dueNow, ...doneThisWeek];
  const upcoming = surveys
    .filter((s) => deriveSurveyState(s) === 'upcoming')
    .sort((a, b) => a.date.localeCompare(b.date));
  const doneThisWeekIds = new Set(doneThisWeek.map((s) => s.id));
  const history = surveys.filter((s) => {
    const state = deriveSurveyState(s);
    return (state === 'recorded' && !doneThisWeekIds.has(s.id)) || state === 'cancelled';
  });

  const renderRow = (survey: Survey) => {
    const state = deriveSurveyState(survey);
    const assigned = resolveSurveyors(survey.surveyor_ids);
    // Rows carrying the sign-up toggle are too wide for a phone, so they
    // stack — same rule as SurveyWorklistRow: date line with avatars top
    // right, actions line below.
    const stacked = state === 'due-this-week' || state === 'upcoming';
    const recordButton = (
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
    );
    return (
      <Box
        key={survey.id}
        sx={{
          display: 'flex',
          flexDirection: { xs: stacked ? 'column' : 'row', sm: 'row' },
          alignItems: { xs: stacked ? 'stretch' : 'center', sm: 'center' },
          gap: { xs: stacked ? 1 : 1.75, sm: 1.75 },
          px: 2.25,
          py: 1.6,
          borderTop: `1px solid ${groupColors.dividerInner}`,
          bgcolor: state === 'needs-survey' ? groupColors.amberRowBg : 'transparent',
          cursor: 'pointer',
          '&:hover': { bgcolor: state === 'needs-survey' ? groupColors.amberRowBg : groupColors.page },
        }}
        onClick={() => goToSurvey(survey.id)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, flex: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 14.5, fontWeight: 700, color: groupColors.textPrimary }} noWrap>
              {formatSurveyDate(survey)}
            </Typography>
            {/* The section header carries the status; this line is place only */}
            {(survey.location_name || state === 'cancelled') && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.4, minWidth: 0 }}>
                {state === 'cancelled' && <CancelledChip />}
                {survey.location_name && (
                  <Typography sx={{ fontSize: 13, color: groupColors.textMuted }} noWrap>
                    {survey.location_name}
                  </Typography>
                )}
              </Box>
            )}
          </Box>
          {/* On phones the date line's top-right slot carries who's going —
              avatars, or "No surveyors yet" when empty. */}
          {stacked && (
            <Box sx={{ display: { xs: 'flex', sm: 'none' }, flexShrink: 0 }}>
              <SurveyorAvatars surveyors={assigned} greenIds={greenIds} />
            </Box>
          )}
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

        {/* Sign-up is open for future weeks and the current week alike — the
            same one-click self toggle for every role. The record button rides
            in the same cell so stacked rows keep every action on one
            wrappable line. */}
        {(state === 'upcoming' || state === 'due-this-week') && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
              gap: 1.25,
              flexShrink: 0,
            }}
          >
            {/* On xs the date line's slot carries the avatars/empty label */}
            <Box sx={{ display: { xs: 'none', sm: 'flex' } }}>
              <SurveyorAvatars surveyors={assigned} greenIds={greenIds} />
            </Box>
            <SelfSignupButton survey={survey} assigned={assigned} onSaved={handleSignupSaved} />
            {state === 'due-this-week' && canEditSurveys && recordButton}
          </Box>
        )}

        {state === 'needs-survey' && canEditSurveys && recordButton}
      </Box>
    );
  };

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
          {surveyType?.name ?? ''} · {total} survey{total === 1 ? '' : 's'}
        </Typography>

        <Paper sx={groupCardSx}>
          {surveys.length === 0 ? (
            <Box sx={{ px: 2.25, py: 3 }}>
              <Typography sx={{ fontSize: 13.5, color: groupColors.textMuted }}>
                No surveys yet.
              </Typography>
            </Box>
          ) : (
            <>
              {toRecord.length > 0 && (
                <SectionHeader label={`To record (${toRecord.length})`} color={groupColors.amberText} />
              )}
              {toRecord.map(renderRow)}

              {thisWeek.length > 0 && (
                <SectionHeader label="This week" color={groupColors.brandDark} />
              )}
              {thisWeek.map(renderRow)}

              {upcoming.length > 0 && (
                <SectionHeader label={`Upcoming (${upcoming.length})`} color={groupColors.textMuted} />
              )}
              {upcoming.map(renderRow)}

              {history.length > 0 && (
                <SectionHeader
                  label="Recorded"
                  color={groupColors.textMuted}
                  suffix="most recent first"
                />
              )}
              {history.map(renderRow)}
            </>
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
