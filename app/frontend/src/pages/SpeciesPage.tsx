import { Box, Typography, Paper, MenuItem, Autocomplete, TextField, createFilterOptions } from '@mui/material';
import { useState, useEffect } from 'react';
import dayjs from 'dayjs';
import { dashboardAPI, getOrgSlug, surveyTypesAPI } from '../services/api';
import type { SpeciesWithCount, SpeciesSightingLocation } from '../services/api';
import SightingsMap from '../components/dashboard/SightingsMap';
import CumulativeSpeciesChart from '../components/dashboard/CumulativeSpeciesChart';
import SpeciesOccurrenceChart from '../components/dashboard/SpeciesOccurrenceChart';
import SpeciesGroupIcon from '../components/dashboard/SpeciesGroupIcon';
import AnnualFrequencyPanel from '../components/groups/AnnualFrequencyPanel';
import { speciesTypes, getSpeciesDisplayName } from '../config';
import { SPACING } from '../config/responsive';
import { PageTitle } from '../components/layout/PageTitle';

/** Search species by common OR scientific name (the input shows the common
 * name, so the scientific one would otherwise be unsearchable). */
const filterSpecies = createFilterOptions<SpeciesWithCount>({
  stringify: (option) => `${option.name ?? ''} ${option.scientific_name ?? ''}`,
});

/** Headline figures for the selected species group, all derived from the
 * ranked species list the page already fetches. */
function groupStats(speciesList: SpeciesWithCount[]) {
  const year = String(new Date().getFullYear());
  const individuals = speciesList.reduce((sum, s) => sum + s.total_count, 0);
  const newThisYear = speciesList.filter((s) => s.first_observed?.startsWith(year)).length;
  const latest = speciesList.reduce<SpeciesWithCount | null>(
    (best, s) =>
      s.first_observed && (!best?.first_observed || s.first_observed > best.first_observed) ? s : best,
    null,
  );
  return { species: speciesList.length, individuals, newThisYear, latest };
}

/**
 * One figure in the stats band — value over a quiet sentence-case label, the
 * same shape the group cards use. Every figure is the SAME size: a 40px hero
 * beside 24px siblings read as an accident rather than a hierarchy, and these
 * four are peers. Labels wrap (uppercase no-wrap truncated on phones).
 */
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: 26, fontWeight: 600, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
      {sub && (
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>{sub}</Typography>
      )}
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.5 }}>{label}</Typography>
    </Box>
  );
}

/**
 * Species: headline figures, the cumulative discovery chart and per-species
 * seasonal counts for the selected species group, plus a sightings map for
 * orgs that record coordinates. Both charts are shared components
 * (CumulativeSpeciesChart, SpeciesOccurrenceChart) reused by Groups.
 * Device tracking lives on its own page (TrackingPage), not here.
 */
export function SpeciesPage() {
  // Heal doesn't record sighting coordinates, so the map is Cannwood-only.
  const isCannwood = getOrgSlug() === 'cannwood';

  // Species group (single selection drives both charts + the species picker)
  const [selectedSpeciesTypes, setSelectedSpeciesTypes] = useState<string[]>(['bird']);

  // Species selector state (for the occurrence chart)
  const [speciesList, setSpeciesList] = useState<SpeciesWithCount[]>([]);
  const [selectedSpeciesId, setSelectedSpeciesId] = useState<number | null>(null);

  // Sightings map state
  const [sightingsData, setSightingsData] = useState<SpeciesSightingLocation[]>([]);
  const [sightingsLoading, setSightingsLoading] = useState(false);
  const [sightingsError, setSightingsError] = useState<string | null>(null);

  // Which species types actually have entries
  const [availableSpeciesTypes, setAvailableSpeciesTypes] = useState<string[]>([]);

  // Frequency-scored survey types (admin → survey type's allow_frequency_score)
  // and the species groups they cover. Groups surveyed this way — plants,
  // scored as a % of sampling quadrats — get the annual frequency chart the
  // group page uses instead of seasonal counts, which don't fit that method.
  const [frequencyTypes, setFrequencyTypes] = useState<
    Array<{ id: number; name: string; speciesTypeNames: string[] }>
  >([]);

  // Fetch the species list (ranked) when the species type changes; auto-select
  // the top. Guarded so a slow earlier group can't overwrite a fast later one.
  useEffect(() => {
    let active = true;
    const fetchSpecies = async () => {
      try {
        const species = await dashboardAPI.getSpeciesByCount(selectedSpeciesTypes[0]);
        if (!active) return;
        setSpeciesList(species);
        setSelectedSpeciesId(species.length > 0 ? species[0].id : null);
      } catch (err) {
        if (!active) return;
        console.error('Failed to fetch species list:', err);
        setSpeciesList([]);
        setSelectedSpeciesId(null);
      }
    };
    fetchSpecies();
    return () => {
      active = false;
    };
  }, [selectedSpeciesTypes]);

  // Fetch all-time sightings for the selected species (for the map).
  // Heal doesn't record GPS coordinates on sightings, so the map section is
  // hidden for them and the fetch skipped.
  useEffect(() => {
    if (!selectedSpeciesId || !isCannwood) {
      setSightingsData([]);
      return;
    }
    let active = true;
    setSightingsLoading(true);
    setSightingsError(null);
    dashboardAPI
      .getSpeciesSightings(selectedSpeciesId)
      .then((res) => active && setSightingsData(res))
      .catch((err) => active && setSightingsError(err instanceof Error ? err.message : 'Failed to load sightings data'))
      .finally(() => active && setSightingsLoading(false));
    return () => {
      active = false;
    };
  }, [selectedSpeciesId, isCannwood]);

  // Which survey types are frequency-scored, and for which groups (once).
  // Failing quietly falls back to the seasonal chart — same as today.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const types = await surveyTypesAPI.getAll();
        const flagged = await Promise.all(
          types.filter((t) => t.allow_frequency_score).map((t) => surveyTypesAPI.getById(t.id)),
        );
        if (!active) return;
        setFrequencyTypes(
          flagged.map((t) => ({
            id: t.id,
            name: t.name,
            speciesTypeNames: t.species_types.map((st) => st.name),
          })),
        );
      } catch (err) {
        console.warn('Failed to load frequency-scored survey types:', err);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Species types that actually have entries (once)
  useEffect(() => {
    dashboardAPI
      .getSpeciesTypesWithEntries()
      .then((types) => {
        setAvailableSpeciesTypes(types);
        if (types.length > 0 && !types.includes(selectedSpeciesTypes[0])) {
          setSelectedSpeciesTypes([types[0]]);
        }
      })
      .catch((err) => {
        console.warn('Failed to load species types with entries:', err);
        setAvailableSpeciesTypes(speciesTypes);
      });
  }, []);

  const handleToggle = (type: string) => setSelectedSpeciesTypes([type]);
  // Non-null selection lets the picker use disableClearable: clearing to
  // "no species" only empties the chart, so the X is a dead end.
  const selectedSpecies = speciesList.find((s) => s.id === selectedSpeciesId) ?? null;
  // Frequency-scored survey types covering the selected group (normally zero
  // or one — e.g. Cannwood's Plant survey for the plants group).
  const groupFrequencyTypes = frequencyTypes.filter((t) =>
    t.speciesTypeNames.includes(selectedSpeciesTypes[0]),
  );

  return (
    <Box sx={{ p: SPACING.PAGE_PADDING }}>
      <PageTitle title="Species" />

      {/* Group filter. A sideways-scrolling chip row hid its own overflow —
          nothing said "there's more". A dropdown is the conventional,
          self-evident control and keeps the badge artwork in its rows. */}
      <TextField
        select
        size="small"
        label="Species group"
        value={availableSpeciesTypes.includes(selectedSpeciesTypes[0]) ? selectedSpeciesTypes[0] : ''}
        onChange={(e) => handleToggle(e.target.value)}
        sx={{ width: { xs: '100%', sm: 260 }, mb: 3 }}
        SelectProps={{
          renderValue: (value) => (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <SpeciesGroupIcon type={value as string} size={20} />
              {getSpeciesDisplayName(value as string)}
            </Box>
          ),
        }}
      >
        {/* Union, not intersection: any type the data reports but the config
            doesn't know (e.g. old slugs before the taxonomy-collapse script
            runs on this DB) still gets a row via the display-name fallback —
            better a plain label than thousands of unreachable records. */}
        {[
          ...speciesTypes.filter((type) => availableSpeciesTypes.includes(type)),
          ...availableSpeciesTypes.filter((type) => !speciesTypes.includes(type)),
        ]
          .sort((a, b) => getSpeciesDisplayName(a).localeCompare(getSpeciesDisplayName(b)))
          .map((type) => (
            <MenuItem key={type} value={type} sx={{ gap: 1.25 }}>
              <SpeciesGroupIcon type={type} size={22} />
              {getSpeciesDisplayName(type)}
            </MenuItem>
          ))}
      </TextField>

      {/* Headline figures — one card, hero figure first (four bordered boxes
          read as heavy chrome for four small numbers, and their uppercase
          no-wrap labels truncated on phones). */}
      {(() => {
        const stats = groupStats(speciesList);
        return (
          <Paper
            elevation={0}
            sx={{
              p: { xs: 2.5, sm: 3 },
              mb: 3,
              border: '1px solid',
              borderColor: 'divider',
              display: 'grid',
              gridTemplateColumns: { xs: '1fr 1fr', md: '1fr 1fr 1fr 1.2fr' },
              columnGap: { xs: 2, md: 3.5 },
              rowGap: 2.5,
              alignItems: 'start',
            }}
          >
            <Stat
              label={`${getSpeciesDisplayName(selectedSpeciesTypes[0])} recorded`}
              value={String(stats.species)}
            />
            {/* Frequency-scored records are presence scores (count=1 each),
                not individuals counted — label the sum honestly. */}
            <Stat
              label={groupFrequencyTypes.length > 0 ? 'Records' : 'Individuals recorded'}
              value={stats.individuals.toLocaleString()}
            />
            <Stat label="New this year" value={String(stats.newThisYear)} />
            <Stat
              label="Latest addition"
              value={stats.latest ? (stats.latest.name ?? stats.latest.scientific_name ?? '—') : '—'}
              sub={
                stats.latest?.first_observed
                  ? dayjs(stats.latest.first_observed).format('D MMM YYYY')
                  : undefined
              }
            />
          </Paper>
        );
      })()}

      <Paper elevation={0} sx={{ p: { xs: 2.5, sm: 3 }, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" sx={{ mb: 0.25, fontWeight: 600 }}>
          Species discovery
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
          Unique {getSpeciesDisplayName(selectedSpeciesTypes[0]).toLowerCase()} recorded over time
        </Typography>
        <CumulativeSpeciesChart
          speciesTypes={[selectedSpeciesTypes[0]]}
          height={280}
          emptyMessage="No data available for selected species groups"
        />
      </Paper>

      {/* Frequency-scored groups (plants): counts through the year don't fit
          a method that scores % of sampling quadrats, so those groups get the
          group page's annual frequency panel — its own species and location
          pickers included — instead of the seasonal chart. */}
      {groupFrequencyTypes.length > 0 ? (
        groupFrequencyTypes.map((t) => (
          <Box key={t.id} sx={{ mt: 3 }}>
            <AnnualFrequencyPanel surveyTypeId={t.id} />
          </Box>
        ))
      ) : (
      <Paper elevation={0} sx={{ p: { xs: 2.5, sm: 3 }, mt: 3, border: '1px solid', borderColor: 'divider' }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { xs: 'stretch', sm: 'flex-end' },
            justifyContent: 'space-between',
            gap: 2,
            mb: 2,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ mb: 0.25, fontWeight: 600 }}>
              Seasonal counts
            </Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              Counts through the year, compared season on season
            </Typography>
          </Box>
          {/* A species is always selected — clearing to "none" only empties
              the chart, so there's no clear (X). Clicking opens the list
              (it behaves like a dropdown that also accepts typing); the
              input holds just the name, with the count in the option rows,
              so the select-on-focus highlight is a word, not a sentence. */}
          {selectedSpecies ? (
          <Autocomplete
            options={speciesList}
            getOptionLabel={(option) => option.name || option.scientific_name || ''}
            filterOptions={filterSpecies}
            renderOption={({ key, ...props }, option) => (
              <Box
                component="li"
                key={key}
                {...props}
                sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}
              >
                <span>{option.name || option.scientific_name}</span>
                <Typography component="span" sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                  {option.total_count.toLocaleString()}
                </Typography>
              </Box>
            )}
            value={selectedSpecies}
            onChange={(_event, newValue) => setSelectedSpeciesId(newValue.id)}
            renderInput={(params) => (
              <TextField {...params} label="Species" placeholder="Type to search..." size="small" />
            )}
            sx={{ width: { xs: '100%', sm: 300 }, flexShrink: 0 }}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            disableClearable
            openOnFocus
            selectOnFocus
            handleHomeEndKeys
            blurOnSelect
            autoHighlight
          />
          ) : (
            <TextField
              label="Species"
              size="small"
              value=""
              placeholder="No species recorded"
              disabled
              sx={{ width: { xs: '100%', sm: 300 }, flexShrink: 0 }}
            />
          )}
        </Box>
        <SpeciesOccurrenceChart speciesId={selectedSpeciesId} height={280} />
      </Paper>
      )}

      {/* Sightings map — Cannwood only: Heal doesn't record GPS coordinates
          on sightings, so the map would always be empty. Hidden for
          frequency-scored groups too: quadrat scoring produces no point
          sightings, and the seasonal panel's species picker that drove this
          map is not shown for them. */}
      {isCannwood && groupFrequencyTypes.length === 0 && (
        <Paper elevation={0} sx={{ p: { xs: 2.5, sm: 3 }, mt: 3, border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            Sighting locations
          </Typography>
          {/* No locationsWithBoundaries: the field outlines competed with the
              sightings themselves, which are the point of this map. */}
          {selectedSpeciesId ? (
            <SightingsMap
              sightings={sightingsData}
              loading={sightingsLoading}
              error={sightingsError}
            />
          ) : (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300, color: 'text.secondary' }}>
              <Typography variant="body1">Select a species to view sighting locations</Typography>
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
}
