/**
 * All surveys: the full chronological history/forward-schedule for a survey
 * type. Status-only rows (no titles); the date — a single day or a week range,
 * with the year — heads each row and is the identifier (no calendar tile).
 *
 * The list merges two sources, date-descending (upcoming on top): the group's
 * open/cancelled slots (schedule) and its recorded surveys (history, paged via
 * Load more). Fulfilled slots are represented by their recorded surveys, so
 * no week appears twice.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Paper, Typography, Button, CircularProgress } from '@mui/material';
import { Add } from '@mui/icons-material';
import {
  ApiError,
  surveyTypesAPI,
  surveysAPI,
  scheduledSurveysAPI,
  surveyorsAPI,
  type SurveyTypeWithDetails,
  type Survey,
  type ScheduledSurvey,
  type Surveyor,
} from '../../services/api';
import { recordButtonSx, groupCardSx, groupColors } from './groupsTokens';
import { groupActivity, primarySpeciesType, resolveGroupTypeId } from './groupMeta';
import { deriveSlotState, formatRecordedDate, formatSurveyDate, type SlotState } from './surveyState';
import { useSignupSaved, useSurveyorLookup } from '../../hooks';
import { usePermissions } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import GroupBreadcrumb from '../../components/groups/GroupBreadcrumb';
import SelfSignupButton from '../../components/groups/SelfSignupButton';
import SpeciesCountChips from '../../components/groups/SpeciesCountChips';
import SurveyorAvatars from '../../components/groups/SurveyorAvatars';

const PAGE_SIZE = 25;

const STATUS_STYLES: Record<SlotState, { label: string; color: string; bg: string }> = {
  recorded: { label: 'Recorded', color: '#2E6B42', bg: '#DBEDDB' },
  upcoming: { label: 'Upcoming', color: '#454648', bg: '#EBECED' },
  'due-this-week': { label: 'Due this week', color: '#2C5F8A', bg: '#DCE8F2' },
  'needs-survey': { label: 'Needs survey', color: groupColors.amberMonth, bg: '#FBF3DB' },
  cancelled: { label: 'Cancelled', color: '#888888', bg: '#EBECED' },
};

function StatusChip({ state }: { state: SlotState }) {
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

/** One merged list entry: an unfulfilled/cancelled slot, or a recorded survey. */
type Row =
  | { kind: 'slot'; slot: ScheduledSurvey; sortDate: string }
  | { kind: 'survey'; survey: Survey; sortDate: string };

export default function AllSurveysPage() {
  const { typeId } = useParams<{ typeId: string }>();
  const navigate = useNavigate();

  const [surveyType, setSurveyType] = useState<SurveyTypeWithDetails | null>(null);
  const [slots, setSlots] = useState<ScheduledSurvey[]>([]);
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
        const [details, slotList, page, surveyorList] = await Promise.all([
          surveyTypesAPI.getById(surveyTypeId),
          scheduledSurveysAPI.getAll({ survey_type_id: surveyTypeId }),
          surveysAPI.getAll({ survey_type_id: surveyTypeId, page: 1, limit: PAGE_SIZE }),
          surveyorsAPI.getAll(),
        ]);
        if (!active) return;
        setSurveyType(details);
        setSlots(slotList);
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
  const handleSignupSaved = useSignupSaved(slots, setSlots, setGreenIds, surveyors, setSurveyors);

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
        <GroupBreadcrumb crumbs={[{ label: 'Surveys', to: '/groups' }, { label: 'Error' }]} />
        <Alert severity="error">Failed to load surveys. Please try again.</Alert>
      </Box>
    );
  }

  if (notFound || !surveyType) {
    return (
      <Box sx={{ maxWidth: 900, mx: 'auto', px: { xs: 2, sm: 4 }, py: 4 }}>
        <GroupBreadcrumb crumbs={[{ label: 'Surveys', to: '/groups' }, { label: 'Not found' }]} />
        <Typography sx={{ color: groupColors.textSecondary }}>
          This group could not be found.
        </Typography>
      </Box>
    );
  }

  const speciesType = primarySpeciesType(surveyType);

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

  const returnTo = {
    state: {
      returnTo: {
        pathname: `/groups/${typeId}/all`,
        label: surveyType?.name ?? 'All surveys',
      },
    },
  };
  // Open a recorded survey, telling it to return here (the group's survey
  // history) rather than the main surveys list after editing/deleting.
  const openSurvey = (surveyId: number) => navigate(`/surveys/${surveyId}`, returnTo);
  // Recording a slot creates a NEW survey linked to it, prefilled on the
  // new-survey form.
  const recordSlot = (slot: ScheduledSurvey) =>
    navigate(`/surveys/new?scheduled_survey_id=${slot.id}`, returnTo);

  // Slots with linked surveys are represented by those recorded surveys
  // (whatever the slot's status — a cancelled-then-recorded week must not
  // appear twice); the remaining slots are the schedule. Merged
  // date-descending so upcoming weeks sit on top of the history.
  const rows: Row[] = [
    ...slots
      .filter((s) => s.linked_surveys.length === 0)
      .map((slot): Row => ({ kind: 'slot', slot, sortDate: slot.window_start })),
    ...surveys.map((survey): Row => ({ kind: 'survey', survey, sortDate: survey.date })),
  ].sort((a, b) => b.sortDate.localeCompare(a.sortDate));

  const scheduledCount = slots.filter((s) => {
    const st = deriveSlotState(s);
    return st === 'upcoming' || st === 'due-this-week' || st === 'needs-survey';
  }).length;

  return (
    <Box sx={{ bgcolor: groupColors.page, minHeight: '100%', px: { xs: 2, sm: 4 }, py: { xs: 2, sm: 3 } }}>
      <Box sx={{ maxWidth: 900, mx: 'auto' }}>
        <GroupBreadcrumb
          crumbs={[
            { label: 'Surveys', to: '/groups' },
            { label: surveyType?.name ?? 'Survey type', to: `/groups/${typeId}` },
            { label: 'All surveys' },
          ]}
        />

        <Typography sx={{ fontSize: 24, fontWeight: 600, color: groupColors.textPrimary }}>
          All surveys
        </Typography>
        <Typography sx={{ fontSize: 13.5, color: '#888', mb: 2 }}>
          {/* Unscheduled ('record') groups never have slots — no point saying "0 scheduled". */}
          {surveyType?.name ?? ''} · {total} recorded
          {groupActivity(surveyType.name) === 'worklist' ? ` · ${scheduledCount} scheduled` : ''}, most recent first
        </Typography>

        <Paper sx={groupCardSx}>
          {rows.length === 0 ? (
            <Box sx={{ px: 2.25, py: 3 }}>
              <Typography sx={{ fontSize: 13.5, color: groupColors.textMuted }}>
                No surveys yet.
              </Typography>
            </Box>
          ) : (
            rows.map((row, idx) => {
              const state: SlotState = row.kind === 'survey' ? 'recorded' : deriveSlotState(row.slot);
              const assigned = resolveSurveyors(
                row.kind === 'survey' ? row.survey.surveyor_ids : row.slot.surveyor_ids,
              );
              const locationName = row.kind === 'survey' ? row.survey.location_name : row.slot.location_name;
              const clickable = row.kind === 'survey';
              // Rows carrying the sign-up toggle are too wide for a phone, so
              // they stack — same rule as SurveyWorklistRow: date + chip line
              // with avatars top right, actions line below. Recorded rows all
              // stack too, chips starting from the left — uniformly, so light
              // and chip-heavy rows read the same (mixed alignment looked odd).
              const stacked = state === 'due-this-week' || state === 'upcoming' || row.kind === 'survey';
              const recordButton = row.kind === 'slot' && (
                <Button
                  variant="contained"
                  startIcon={<Add sx={{ fontSize: 18 }} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    recordSlot(row.slot);
                  }}
                  sx={recordButtonSx}
                >
                  Record survey
                </Button>
              );
              return (
                <Box
                  key={`${row.kind}-${row.kind === 'survey' ? row.survey.id : row.slot.id}`}
                  sx={{
                    display: 'flex',
                    flexDirection: { xs: stacked ? 'column' : 'row', sm: 'row' },
                    alignItems: { xs: stacked ? 'stretch' : 'center', sm: 'center' },
                    gap: { xs: stacked ? 1 : 1.75, sm: 1.75 },
                    px: 2.25,
                    py: 1.6,
                    borderTop: idx === 0 ? 'none' : `1px solid ${groupColors.dividerInner}`,
                    bgcolor: state === 'needs-survey' ? groupColors.amberRowBg : 'transparent',
                    ...(clickable
                      ? {
                          cursor: 'pointer',
                          '&:hover': { bgcolor: groupColors.page },
                        }
                      : {}),
                  }}
                  onClick={clickable ? () => openSurvey(row.survey.id) : undefined}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, flex: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 14.5, fontWeight: 700, color: groupColors.textPrimary }} noWrap>
                        {row.kind === 'slot'
                          ? formatSurveyDate(row.slot)
                          : formatRecordedDate(row.survey.date)}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.4, minWidth: 0 }}>
                        <StatusChip state={state} />
                        {locationName && (
                          <Typography sx={{ fontSize: 13, color: groupColors.textMuted }} noWrap>
                            {locationName}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                    {/* On phones the date line's top-right slot carries who's
                        going — avatars, or "No surveyors yet" when empty
                        (recorded rows just omit them). */}
                    {stacked && (
                      <Box sx={{ display: { xs: 'flex', sm: 'none' }, flexShrink: 0 }}>
                        <SurveyorAvatars
                          surveyors={assigned}
                          greenIds={greenIds}
                          emptyLabel={row.kind === 'survey' ? '' : undefined}
                        />
                      </Box>
                    )}
                  </Box>

                  {/* Right cell varies by status */}
                  {row.kind === 'survey' && (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.25,
                        minWidth: 0,
                        // Phones: chips get their own full-width line, starting
                        // from the left (avatars sit on the date line above).
                        justifyContent: { xs: 'flex-start', sm: 'flex-end' },
                        flexShrink: { xs: 1, sm: 0 },
                      }}
                    >
                      <SpeciesCountChips
                        survey={row.survey}
                        fallbackSpeciesType={speciesType}
                        justify={{ xs: 'flex-start', sm: 'flex-end' }}
                      />
                      <Box sx={{ display: { xs: 'none', sm: 'flex' }, flexShrink: 0 }}>
                        <SurveyorAvatars surveyors={assigned} emptyLabel="" greenIds={greenIds} />
                      </Box>
                    </Box>
                  )}

                  {/* Sign-up is open for future weeks and the current week alike —
                      the same one-click self toggle for every role. The record
                      button rides in the same cell so stacked rows keep every
                      action on one wrappable line. */}
                  {row.kind === 'slot' && (state === 'upcoming' || state === 'due-this-week') && (
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
                      <SelfSignupButton slot={row.slot} assigned={assigned} onSaved={handleSignupSaved} />
                      {state === 'due-this-week' && canEditSurveys && recordButton}
                    </Box>
                  )}

                  {state === 'needs-survey' && canEditSurveys && recordButton}
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
