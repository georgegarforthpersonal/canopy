/**
 * Space detail: the single-screen overview for one survey type. Neutral hero
 * plus two balanced columns — Surveys worklist + Species recorded (left); Files,
 * Locations & devices (right). On mobile the panels stack in the order
 * Files → Surveys → Locations & devices → Species recorded.
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
  devicesAPI,
  type SurveyTypeWithDetails,
  type Survey,
  type Surveyor,
  type LocationWithBoundary,
  type Device,
  type SurveyTypeFile,
} from '../../services/api';
import { spaceColors, SPACE_MAX_WIDTH } from './spacesTokens';
import { primarySpeciesType } from './spaceMeta';
import { useSurveyorLookup } from '../../hooks';
import SpaceBreadcrumb from '../../components/spaces/SpaceBreadcrumb';
import SpaceHero from '../../components/spaces/SpaceHero';
import SurveysPanel from '../../components/spaces/SurveysPanel';
import FilesPanel from '../../components/spaces/FilesPanel';
import LocationsDevicesPanel from '../../components/spaces/LocationsDevicesPanel';
import SpeciesRecordedChart from '../../components/spaces/SpeciesRecordedChart';
import SurveyorPickerDialog from '../../components/spaces/SurveyorPickerDialog';

export default function SpaceDetailPage() {
  const { typeId } = useParams<{ typeId: string }>();
  const navigate = useNavigate();
  const surveyTypeId = Number(typeId);

  const [surveyType, setSurveyType] = useState<SurveyTypeWithDetails | null>(null);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [recordedCount, setRecordedCount] = useState(0);
  const [surveyors, setSurveyors] = useState<Surveyor[]>([]);
  const [locations, setLocations] = useState<LocationWithBoundary[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [files, setFiles] = useState<SurveyTypeFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  // Surveyor assignment picker state
  const [assignSurvey, setAssignSurvey] = useState<Survey | null>(null);
  const [greenIds, setGreenIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!Number.isFinite(surveyTypeId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let active = true;

    (async () => {
      try {
        const details = await surveyTypesAPI.getById(surveyTypeId);
        if (!active) return;
        setSurveyType(details);

        const typeLocationIds = new Set(details.locations.map((l) => l.id));

        // The worklist is built from ALL scheduled surveys (upcoming + overdue;
        // truncation would drop exactly the overdue rows, which sort last);
        // the "All surveys" door shows a recorded/scheduled split, so the
        // recorded side needs the completed-only total.
        const [scheduled, completedPage, surveyorList, withBoundaries, deviceList] = await Promise.all([
          surveysAPI.getAllPages({ survey_type_id: surveyTypeId, survey_status: 'scheduled' }),
          surveysAPI.getAll({ survey_type_id: surveyTypeId, survey_status: 'completed', page: 1, limit: 1 }),
          surveyorsAPI.getAll(),
          locationsAPI.getAllWithBoundaries(),
          devicesAPI.getAll(),
        ]);
        if (!active) return;

        setSurveys(scheduled);
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
        setDevices(deviceList.filter((d) => d.location_id != null && typeLocationIds.has(d.location_id)));
      } catch (err) {
        // Only a 404 means the space doesn't exist; anything else is a fault.
        if (active) {
          if (err instanceof ApiError && err.status === 404) setNotFound(true);
          else setError(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    // Files load independently so a slow/empty files call doesn't block the page.
    setFilesLoading(true);
    surveyTypesAPI
      .getFiles(surveyTypeId)
      .then((f) => active && setFiles(f))
      .catch(() => active && setFiles([]))
      .finally(() => active && setFilesLoading(false));

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

  if (error) {
    return (
      <Box sx={{ maxWidth: SPACE_MAX_WIDTH, mx: 'auto', px: { xs: 2, sm: 4 }, py: 4 }}>
        <SpaceBreadcrumb crumbs={[{ label: 'Spaces', to: '/spaces' }, { label: 'Error' }]} />
        <Alert severity="error">Failed to load this survey space. Please try again.</Alert>
      </Box>
    );
  }

  if (notFound || !surveyType) {
    return (
      <Box sx={{ maxWidth: SPACE_MAX_WIDTH, mx: 'auto', px: { xs: 2, sm: 4 }, py: 4 }}>
        <SpaceBreadcrumb crumbs={[{ label: 'Spaces', to: '/spaces' }, { label: 'Not found' }]} />
        <Typography sx={{ color: spaceColors.textSecondary }}>
          This survey space could not be found.
        </Typography>
      </Box>
    );
  }

  const speciesType = primarySpeciesType(surveyType);
  const goToSurvey = (s: Survey) =>
    navigate(`/surveys/${s.id}`, {
      state: { returnTo: { pathname: `/spaces/${surveyTypeId}`, label: surveyType.name } },
    });

  const handleAssignSaved = (surveyId: number, surveyorIds: number[]) => {
    setSurveys((prev) =>
      prev.map((s) => (s.id === surveyId ? { ...s, surveyor_ids: surveyorIds } : s)),
    );
    // Highlight any surveyor newly added to this survey in green for the session.
    const previous = surveys.find((s) => s.id === surveyId)?.surveyor_ids ?? [];
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
      <Box sx={{ maxWidth: SPACE_MAX_WIDTH, mx: 'auto' }}>
        <SpaceBreadcrumb
          crumbs={[{ label: 'Spaces', to: '/spaces' }, { label: surveyType.name }]}
        />

        <SpaceHero surveyType={surveyType} />

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
                resolveSurveyors={resolveSurveyors}
                recordedCount={recordedCount}
                greenIds={greenIds}
                onAddSurvey={goToSurvey}
                onAssign={setAssignSurvey}
                onViewAll={() => navigate(`/spaces/${surveyTypeId}/all`)}
              />
            </Box>
            <Box sx={{ order: 4, minWidth: 0 }}>
              <SpeciesRecordedChart speciesType={speciesType} />
            </Box>
          </Box>

          {/* Right column */}
          <Box sx={{ display: { xs: 'contents', md: 'flex' }, flexDirection: 'column', gap: 2.25, flex: 1, minWidth: 0 }}>
            <Box sx={{ order: 1, minWidth: 0 }}>
              <FilesPanel surveyTypeId={surveyTypeId} files={files} loading={filesLoading} />
            </Box>
            <Box sx={{ order: 3, minWidth: 0 }}>
              <LocationsDevicesPanel locations={locations} devices={devices} />
            </Box>
          </Box>
        </Box>
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
