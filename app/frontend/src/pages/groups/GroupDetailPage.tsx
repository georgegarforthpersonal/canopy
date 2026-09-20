/**
 * Group detail: the single-screen overview for one survey type. Neutral hero
 * plus two balanced columns — Surveys + Species count (left); Files, Routes
 * (right). Data joins whichever column is shorter: the left one when the
 * Seasonal counts chart occupies the right, the right one otherwise.
 * The Surveys panel is the slot-driven worklist for scheduled
 * ('worklist') groups, or a record-CTA + recent-history panel for unscheduled
 * ('record') ones; media groups additionally get a recent photos/clips panel.
 * On mobile the panels stack in the order Files → Surveys → Routes →
 * Species count → Recent media → Data.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import {
  ApiError,
  surveyTypesAPI,
  surveysAPI,
  scheduledSurveysAPI,
  surveyorsAPI,
  locationsAPI,
  type SurveyTypeWithDetails,
  type ScheduledSurvey,
  type Survey,
  type Surveyor,
  type LocationWithBoundary,
  type SurveyTypeFile,
} from '../../services/api';
import { groupColors, GROUP_MAX_WIDTH } from './groupsTokens';
import { groupActivity, primarySpeciesType, recordSurveyPath, resolveGroupTypeId } from './groupMeta';
import { useSignupSaved, useSurveyorLookup } from '../../hooks';
import GroupBreadcrumb from '../../components/groups/GroupBreadcrumb';
import GroupHero from '../../components/groups/GroupHero';
import SurveysPanel from '../../components/groups/SurveysPanel';
import RecordPanel from '../../components/groups/RecordPanel';
import RecentMediaPanel from '../../components/groups/RecentMediaPanel';
import FilesPanel from '../../components/groups/FilesPanel';
import LocationsPanel from '../../components/groups/LocationsPanel';
import SpeciesCountPanel from '../../components/groups/SpeciesCountPanel';
import SingleSpeciesCountPanel from '../../components/groups/SingleSpeciesCountPanel';
import SeasonalCountPanel from '../../components/groups/SeasonalCountPanel';
import DataPanel from '../../components/groups/DataPanel';
import AnnualFrequencyPanel from '../../components/groups/AnnualFrequencyPanel';

export default function GroupDetailPage() {
  const { id: typeId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [surveyType, setSurveyType] = useState<SurveyTypeWithDetails | null>(null);
  const [slots, setSlots] = useState<ScheduledSurvey[]>([]);
  const [recentSurveys, setRecentSurveys] = useState<Survey[]>([]);
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

        // The worklist is built from the group's slots (linked recorded
        // surveys come embedded, so fulfilment derives from the same list);
        // every variant's Recent section shows the most recent surveys from
        // the same paged call that gives it its recorded total (the list is
        // date-descending, so page 1 IS the recent list).
        const scheduled = groupActivity(details.name) === 'worklist';
        const [slotList, surveysPage, surveyorList, withBoundaries] = await Promise.all([
          scheduled
            ? scheduledSurveysAPI.getAll({ survey_type_id: surveyTypeId })
            : Promise.resolve([]),
          surveysAPI.getAll({ survey_type_id: surveyTypeId, page: 1, limit: 3 }),
          surveyorsAPI.getAll(),
          locationsAPI.getAllWithBoundaries(),
        ]);
        if (!active) return;

        setSlots(slotList);
        setRecentSurveys(surveysPage.data);
        setRecordedCount(surveysPage.total);
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
            (route.sectors ?? []).map(
              (s) => [s.id, { sector: s, routeName: route.name, routeColor: route.color ?? null }] as const,
            ),
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
              // A sector shown standalone keeps its parent route's colour.
              color: loc.color ?? nested?.routeColor ?? null,
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
      <Box sx={{ maxWidth: GROUP_MAX_WIDTH, mx: 'auto', px: { xs: 2, sm: 4 }, py: 4 }}>
        <GroupBreadcrumb crumbs={[{ label: 'Surveys', to: '/surveys' }, { label: 'Error' }]} />
        <Alert severity="error">Failed to load this survey type. Please try again.</Alert>
      </Box>
    );
  }

  if (notFound || !surveyType) {
    return (
      <Box sx={{ maxWidth: GROUP_MAX_WIDTH, mx: 'auto', px: { xs: 2, sm: 4 }, py: 4 }}>
        <GroupBreadcrumb crumbs={[{ label: 'Surveys', to: '/surveys' }, { label: 'Not found' }]} />
        <Typography sx={{ color: groupColors.textSecondary }}>
          This group could not be found.
        </Typography>
      </Box>
    );
  }

  const speciesType = primarySpeciesType(surveyType);
  // A survey type narrowed to exactly one species (e.g. Marsh Fritillary)
  // gets the per-survey seasonal count panel instead of the diversity chart.
  const singleSpecies = surveyType.species.length === 1 ? surveyType.species[0] : null;
  const activity = groupActivity(surveyType.name);
  // Seasonal counts need repeat visits through a season to compare, so they
  // belong to the scheduled groups: Bird, Butterfly, Dragonfly today.
  // Single-species scheduled groups already get the same chart from
  // SingleSpeciesCountPanel, without a picker.
  const hasSeasonal = activity === 'worklist' && !singleSpecies;
  // Frequency-scored (botanical) groups get the annual sibling of the
  // seasonal chart in the same right-column slot.
  const hasAnnual = surveyType.allow_frequency_score;
  const returnTo = { returnTo: { pathname: `/surveys/${typeId}`, label: surveyType.name } };
  // Unscheduled groups record without a slot: media types jump straight to
  // their wizard, plain types to the standard form with the type preselected.
  const recordNew = () => navigate(recordSurveyPath(surveyType), { state: returnTo });
  const openSurvey = (survey: Survey) => navigate(`/surveys/${survey.id}`, { state: returnTo });

  const dataPanel = (
    <Box sx={{ order: 7, minWidth: 0 }}>
      <DataPanel surveyTypeId={surveyType.id} surveyTypeName={surveyType.name} />
    </Box>
  );

  return (
    <Box sx={{ bgcolor: groupColors.page, minHeight: '100%', px: { xs: 2, sm: 4 }, py: { xs: 2, sm: 3 } }}>
      <Box sx={{ maxWidth: GROUP_MAX_WIDTH, mx: 'auto' }}>
        <GroupBreadcrumb
          crumbs={[{ label: 'Surveys', to: '/surveys' }, { label: surveyType.name }]}
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
              {activity === 'record' ? (
                <RecordPanel
                  surveys={recentSurveys}
                  recordedCount={recordedCount}
                  resolveSurveyors={resolveSurveyors}
                  speciesType={speciesType}
                  recordLabel={
                    surveyType.allow_image_upload || surveyType.allow_audio_upload
                      ? 'Record survey'
                      : 'Log a sighting'
                  }
                  onRecord={recordNew}
                  onOpenSurvey={openSurvey}
                  onViewAll={() => navigate(`/surveys/${typeId}/all`)}
                />
              ) : (
                <SurveysPanel
                  slots={slots}
                  resolveSurveyors={resolveSurveyors}
                  recordedCount={recordedCount}
                  recentSurveys={recentSurveys}
                  speciesType={speciesType}
                  greenIds={greenIds}
                  onSignupSaved={handleSignupSaved}
                  onOpenRecorded={openSurvey}
                  onViewAll={() => navigate(`/surveys/${typeId}/all`)}
                  onRecordNew={recordNew}
                />
              )}
            </Box>
            <Box sx={{ order: 4, minWidth: 0 }}>
              {singleSpecies ? (
                <SingleSpeciesCountPanel surveyTypeId={surveyType.id} species={singleSpecies} />
              ) : (
                <SpeciesCountPanel speciesTypes={surveyType.species_types.map((st) => st.name)} surveyTypeId={surveyType.id} />
              )}
            </Box>
            {(surveyType.allow_image_upload || surveyType.allow_audio_upload || surveyType.allow_sighting_photo_upload) && (
              <Box sx={{ order: 6, minWidth: 0 }}>
                <RecentMediaPanel
                  kind={surveyType.allow_audio_upload && !surveyType.allow_image_upload ? 'clips' : 'photos'}
                  perSpecies={surveyType.allow_image_upload}
                  surveyTypeId={surveyType.id}
                  onViewAll={() => navigate(`/surveys/${typeId}/media`)}
                />
              </Box>
            )}
            {/* The seasonal/annual chart makes the right column the tall
                one, so Data balances into the left column; on xs its order
                still stacks it last either way. */}
            {(hasSeasonal || hasAnnual) && dataPanel}
          </Box>

          {/* Right column */}
          <Box sx={{ display: { xs: 'contents', md: 'flex' }, flexDirection: 'column', gap: 2.25, flex: 1, minWidth: 0 }}>
            {/* An empty Files panel must not own the first phone screenful —
                sink it below the working panels on xs. Desktop keeps its slot
                (the two-column layout has room), and while loading it holds
                position rather than jumping when the fetch resolves. */}
            <Box sx={{ order: { xs: !filesLoading && files.length === 0 ? 6 : 1, md: 1 }, minWidth: 0 }}>
              <FilesPanel surveyTypeId={surveyType.id} files={files} loading={filesLoading} />
            </Box>
            <Box sx={{ order: 3, minWidth: 0 }}>
              <LocationsPanel locations={locations} devices={surveyType.devices} />
            </Box>
            {hasSeasonal && (
              <Box sx={{ order: 5, minWidth: 0 }}>
                <SeasonalCountPanel
                  surveyTypeId={surveyType.id}
                  speciesTypes={surveyType.species_types.map((st) => st.name)}
                />
              </Box>
            )}
            {hasAnnual && (
              <Box sx={{ order: 5, minWidth: 0 }}>
                <AnnualFrequencyPanel surveyTypeId={surveyType.id} />
              </Box>
            )}
            {!hasSeasonal && !hasAnnual && dataPanel}
          </Box>
        </Box>

      </Box>

    </Box>
  );
}
