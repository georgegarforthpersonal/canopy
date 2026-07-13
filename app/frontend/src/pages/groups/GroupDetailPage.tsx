/**
 * Group detail: the single-screen overview for one survey type. Neutral hero
 * plus two balanced columns — Surveys worklist + Species count (left); Files,
 * Routes, Data (right). On mobile the panels stack in the order
 * Files → Surveys → Routes → Species count → Data.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import {
  ApiError,
  surveyTypesAPI,
  surveysAPI,
  surveyorsAPI,
  locationsAPI,
  type SurveyTypeWithDetails,
  type Survey,
  type Surveyor,
  type LocationWithBoundary,
  type SurveyTypeFile,
} from '../../services/api';
import { groupColors, GROUP_MAX_WIDTH } from './groupsTokens';
import { primarySpeciesType, resolveGroupTypeId } from './groupMeta';
import { recordedThisWeek } from './surveyState';
import { useSignupSaved, useSurveyorLookup } from '../../hooks';
import GroupBreadcrumb from '../../components/groups/GroupBreadcrumb';
import GroupHero from '../../components/groups/GroupHero';
import SurveysPanel from '../../components/groups/SurveysPanel';
import FilesPanel from '../../components/groups/FilesPanel';
import RoutesPanel from '../../components/groups/RoutesPanel';
import SpeciesCountPanel from '../../components/groups/SpeciesCountPanel';
import DataPanel from '../../components/groups/DataPanel';

export default function GroupDetailPage() {
  const { typeId } = useParams<{ typeId: string }>();
  const navigate = useNavigate();

  const [surveyType, setSurveyType] = useState<SurveyTypeWithDetails | null>(null);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [recentCompleted, setRecentCompleted] = useState<Survey[]>([]);
  const [recordedCount, setRecordedCount] = useState(0);
  const [surveyors, setSurveyors] = useState<Surveyor[]>([]);
  const [locations, setLocations] = useState<LocationWithBoundary[]>([]);
  const [files, setFiles] = useState<SurveyTypeFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  const [greenIds, setGreenIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!typeId) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let active = true;
    setFilesLoading(true);

    (async () => {
      try {
        // The route param is a name slug (or a legacy numeric id) — resolve it
        // to the survey type id before anything else can be fetched.
        const surveyTypeId = await resolveGroupTypeId(typeId);
        if (!active) return;
        if (surveyTypeId == null) {
          setNotFound(true);
          setFilesLoading(false);
          return;
        }

        // Files load independently so a slow/empty files call doesn't block the page.
        surveyTypesAPI
          .getFiles(surveyTypeId)
          .then((f) => active && setFiles(f))
          .catch(() => active && setFiles([]))
          .finally(() => active && setFilesLoading(false));

        const details = await surveyTypesAPI.getById(surveyTypeId);
        if (!active) return;
        setSurveyType(details);

        // The worklist is built from ALL scheduled surveys (upcoming + overdue;
        // truncation would drop exactly the overdue rows, which sort last);
        // the "All surveys" door shows a recorded/scheduled split, so the
        // recorded side needs the completed-only total. The first completed
        // page (date-descending) is kept so the panel can pin any survey
        // already recorded for the current week.
        const [scheduled, completedPage, surveyorList, withBoundaries] = await Promise.all([
          surveysAPI.getAllPages({ survey_type_id: surveyTypeId, survey_status: 'scheduled' }),
          surveysAPI.getAll({ survey_type_id: surveyTypeId, survey_status: 'completed', page: 1, limit: 25 }),
          surveyorsAPI.getAll(),
          locationsAPI.getAllWithBoundaries(),
        ]);
        if (!active) return;

        setSurveys(scheduled);
        setRecentCompleted(completedPage.data);
        setRecordedCount(completedPage.total);
        setSurveyors(surveyorList);

        // The survey type's full location set is authoritative (all transects,
        // with or without geometry). /with-boundaries only returns locations
        // that HAVE geometry, so use it just to enrich the map markers — never
        // to decide which locations exist.
        const geometryById = new Map(withBoundaries.map((l) => [l.id, l]));
        // Sector geometry is only served nested under the parent route, so
        // index it by sector id for sector locations assigned to the type.
        const sectorById = new Map(
          withBoundaries.flatMap((route) =>
            (route.sectors ?? []).map((s) => [s.id, { sector: s, routeName: route.name }] as const),
          ),
        );
        setLocations(
          details.locations.map((loc) => {
            const geo = geometryById.get(loc.id);
            const nested = sectorById.get(loc.id);
            return {
              id: loc.id,
              name: loc.name,
              parent_name: loc.parent_name ?? nested?.routeName ?? null,
              ordinal: loc.ordinal ?? nested?.sector.ordinal ?? null,
              location_type: loc.location_type ?? geo?.location_type,
              geometry: geo?.geometry ?? nested?.sector.geometry ?? null,
              boundary_geometry: geo?.boundary_geometry ?? null,
              sectors: geo?.sectors ?? null,
            };
          }),
        );
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
      <Box sx={{ maxWidth: GROUP_MAX_WIDTH, mx: 'auto', px: { xs: 2, sm: 4 }, py: 4 }}>
        <GroupBreadcrumb crumbs={[{ label: 'Groups', to: '/groups' }, { label: 'Error' }]} />
        <Alert severity="error">Failed to load this group. Please try again.</Alert>
      </Box>
    );
  }

  if (notFound || !surveyType) {
    return (
      <Box sx={{ maxWidth: GROUP_MAX_WIDTH, mx: 'auto', px: { xs: 2, sm: 4 }, py: 4 }}>
        <GroupBreadcrumb crumbs={[{ label: 'Groups', to: '/groups' }, { label: 'Not found' }]} />
        <Typography sx={{ color: groupColors.textSecondary }}>
          This group could not be found.
        </Typography>
      </Box>
    );
  }

  const speciesType = primarySpeciesType(surveyType);
  // `record` opens the survey form in record mode: saving marks the
  // scheduled survey completed. A plain open never changes the lifecycle.
  const goToSurvey = (s: Survey, opts?: { record?: boolean }) =>
    navigate(`/surveys/${s.id}${opts?.record ? '?record=true' : ''}`, {
      state: { returnTo: { pathname: `/groups/${typeId}`, label: surveyType.name } },
    });

  return (
    <Box sx={{ bgcolor: groupColors.page, minHeight: '100%', px: { xs: 2, sm: 4 }, py: { xs: 2, sm: 3 } }}>
      <Box sx={{ maxWidth: GROUP_MAX_WIDTH, mx: 'auto' }}>
        <GroupBreadcrumb
          crumbs={[{ label: 'Groups', to: '/groups' }, { label: surveyType.name }]}
        />

        <GroupHero surveyType={surveyType} />

        {/* On xs the column wrappers become display: contents so the four
            panels stack as direct flex items in their `order`; the md column
            grouping is unaffected (orders preserve in-column order). */}
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            alignItems: { xs: 'stretch', md: 'flex-start' },
            gap: 2.25,
            mt: 2.25,
          }}
        >
          {/* Left column */}
          <Box sx={{ display: { xs: 'contents', md: 'flex' }, flexDirection: 'column', gap: 2.25, flex: 1, minWidth: 0 }}>
            <Box sx={{ order: 2, minWidth: 0 }}>
              <SurveysPanel
                surveys={surveys}
                recordedThisWeek={recordedThisWeek(recentCompleted)}
                resolveSurveyors={resolveSurveyors}
                recordedCount={recordedCount}
                greenIds={greenIds}
                onAddSurvey={(s) => goToSurvey(s, { record: true })}
                onSignupSaved={handleSignupSaved}
                onOpenSurvey={goToSurvey}
                onViewAll={() => navigate(`/groups/${typeId}/all`)}
              />
            </Box>
            <Box sx={{ order: 4, minWidth: 0 }}>
              <SpeciesCountPanel speciesType={speciesType} />
            </Box>
          </Box>

          {/* Right column */}
          <Box sx={{ display: { xs: 'contents', md: 'flex' }, flexDirection: 'column', gap: 2.25, flex: 1, minWidth: 0 }}>
            <Box sx={{ order: 1, minWidth: 0 }}>
              <FilesPanel surveyTypeId={surveyType.id} files={files} loading={filesLoading} />
            </Box>
            <Box sx={{ order: 3, minWidth: 0 }}>
              <RoutesPanel locations={locations} />
            </Box>
            <Box sx={{ order: 5, minWidth: 0 }}>
              <DataPanel surveyTypeId={surveyType.id} surveyTypeName={surveyType.name} />
            </Box>
          </Box>
        </Box>
      </Box>

    </Box>
  );
}
