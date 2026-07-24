import { Box, Typography, Paper, Stack, IconButton, Tooltip, Autocomplete, TextField, Tabs, Tab } from '@mui/material';
import { useState, useEffect } from 'react';
import { dashboardAPI, locationsAPI, getOrgSlug } from '../services/api';
import type { SpeciesWithCount, SpeciesSightingLocation, LocationWithBoundary } from '../services/api';
import SightingsMap from '../components/dashboard/SightingsMap';
import CumulativeSpeciesChart from '../components/dashboard/CumulativeSpeciesChart';
import SpeciesOccurrenceChart from '../components/dashboard/SpeciesOccurrenceChart';
import { DeviceTrackerMap } from '../components/dashboard/DeviceTrackerMap';
import { speciesTypes, getSpeciesIcon, getSpeciesDisplayName } from '../config';
import { notionColors, brandColors } from '../theme';
import { SPACING } from '../config/responsive';
import { PageTitle } from '../components/layout/PageTitle';

/**
 * DashboardsPage displays cumulative species and per-species occurrence charts,
 * plus a sightings map. The two top charts are shared components
 * (CumulativeSpeciesChart, SpeciesOccurrenceChart) reused by Groups.
 */
export function DashboardsPage() {
  // Cannwood-only "GPS tracking" tab alongside the species dashboards
  const isCannwood = getOrgSlug() === 'cannwood';
  const [activeTab, setActiveTab] = useState(0);

  // Species group (single selection drives both charts + the species picker)
  const [selectedSpeciesTypes, setSelectedSpeciesTypes] = useState<string[]>(['bird']);

  // Species selector state (for the occurrence chart)
  const [speciesList, setSpeciesList] = useState<SpeciesWithCount[]>([]);
  const [selectedSpeciesId, setSelectedSpeciesId] = useState<number | null>(null);

  // Sightings map state
  const [sightingsData, setSightingsData] = useState<SpeciesSightingLocation[]>([]);
  const [sightingsLoading, setSightingsLoading] = useState(false);
  const [sightingsError, setSightingsError] = useState<string | null>(null);

  // Field boundaries + which species types actually have entries
  const [locationsWithBoundaries, setLocationsWithBoundaries] = useState<LocationWithBoundary[]>([]);
  const [availableSpeciesTypes, setAvailableSpeciesTypes] = useState<string[]>([]);

  // Fetch the species list (ranked) when the species type changes; auto-select the top.
  useEffect(() => {
    const fetchSpecies = async () => {
      try {
        const species = await dashboardAPI.getSpeciesByCount(selectedSpeciesTypes[0]);
        setSpeciesList(species);
        setSelectedSpeciesId(species.length > 0 ? species[0].id : null);
      } catch (err) {
        console.error('Failed to fetch species list:', err);
        setSpeciesList([]);
        setSelectedSpeciesId(null);
      }
    };
    fetchSpecies();
  }, [selectedSpeciesTypes]);

  // Fetch all-time sightings for the selected species (for the map).
  useEffect(() => {
    if (!selectedSpeciesId) {
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
  }, [selectedSpeciesId]);

  // Field boundaries (once)
  useEffect(() => {
    locationsAPI
      .getAllWithBoundaries()
      .then(setLocationsWithBoundaries)
      .catch((err) => console.warn('Failed to load field boundaries:', err));
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

  return (
    <Box sx={{ p: SPACING.PAGE_PADDING }}>
      <PageTitle title="Dashboards" />
      {isCannwood && (
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
          <Tabs value={activeTab} onChange={(_e, v) => setActiveTab(v)}>
            <Tab label="Species" />
            <Tab label="GPS tracking" />
          </Tabs>
        </Box>
      )}

      {isCannwood && activeTab === 1 && <DeviceTrackerMap />}

      {(!isCannwood || activeTab === 0) && (
        <>
          {/* Species Group Selector */}
          <Paper elevation={0} sx={{ p: 2, mb: 3, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {speciesTypes
                .filter((type) => availableSpeciesTypes.includes(type))
                .map((type) => {
                  const Icon = getSpeciesIcon(type);
                  const isSelected = selectedSpeciesTypes.includes(type);
                  return (
                    <Tooltip key={type} title={getSpeciesDisplayName(type)} arrow>
                      <IconButton
                        onClick={() => handleToggle(type)}
                        sx={{
                          bgcolor: isSelected ? brandColors.main : notionColors.gray.background,
                          color: isSelected ? '#fff' : 'text.secondary',
                          width: 40,
                          height: 40,
                          '&:hover': { bgcolor: isSelected ? brandColors.hover : '#DDD' },
                          transition: 'all 0.2s',
                          border: isSelected ? `2px solid ${brandColors.hover}` : 'none',
                        }}
                      >
                        <Icon sx={{ fontSize: '20px' }} />
                      </IconButton>
                    </Tooltip>
                  );
                })}
            </Stack>
          </Paper>

          {/* Cumulative species chart */}
          <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', minHeight: 500 }}>
            <CumulativeSpeciesChart
              speciesTypes={[selectedSpeciesTypes[0]]}
              height={400}
              emptyMessage="No data available for selected species groups"
            />
          </Paper>

          {/* Species occurrence chart */}
          <Paper elevation={0} sx={{ p: 3, mt: 3, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', minHeight: 400 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2 }}>
              <Autocomplete
                options={speciesList}
                getOptionLabel={(option) => `${option.name || option.scientific_name} (${option.total_count} total)`}
                value={speciesList.find((s) => s.id === selectedSpeciesId) || null}
                onChange={(_event, newValue) => setSelectedSpeciesId(newValue ? newValue.id : null)}
                renderInput={(params) => (
                  <TextField {...params} label="Select Species" placeholder="Type to search..." size="small" />
                )}
                sx={{ minWidth: { xs: '100%', sm: 300 } }}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                selectOnFocus
                clearOnBlur
                blurOnSelect
                autoHighlight
              />
            </Box>
            <SpeciesOccurrenceChart speciesId={selectedSpeciesId} height={300} />
          </Paper>

          {/* Sightings Map Section */}
          <Paper elevation={0} sx={{ p: 3, mt: 3, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', minHeight: 400 }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
              Sighting Locations
            </Typography>
            {selectedSpeciesId ? (
              <SightingsMap
                sightings={sightingsData}
                loading={sightingsLoading}
                error={sightingsError}
                locationsWithBoundaries={locationsWithBoundaries}
              />
            ) : (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300, color: 'text.secondary' }}>
                <Typography variant="body1">Select a species to view sighting locations</Typography>
              </Box>
            )}
          </Paper>
        </>
      )}
    </Box>
  );
}
