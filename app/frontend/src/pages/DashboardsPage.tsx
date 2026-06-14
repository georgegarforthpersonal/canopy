import { Box, Typography, Paper, Stack, IconButton, Tooltip, CircularProgress, Alert, Autocomplete, TextField, Tabs, Tab, Button } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar } from 'recharts';
import { useState, useEffect } from 'react';
import dayjs from 'dayjs';
import { dashboardAPI, locationsAPI, getOrgSlug } from '../services/api';
import type { CumulativeSpeciesResponse, SpeciesWithCount, SpeciesOccurrenceResponse, SpeciesSightingLocation, LocationWithBoundary } from '../services/api';
import SightingsMap from '../components/dashboard/SightingsMap';
import { DeviceTrackerMap } from '../components/dashboard/DeviceTrackerMap';
import { useAuth } from '../context/AuthContext';
import { speciesTypes, getSpeciesIcon, getSpeciesDisplayName } from '../config';
import { notionColors, brandColors } from '../theme';
import { SPACING } from '../config/responsive';

/**
 * DashboardsPage displays cumulative species count charts
 *
 * Features:
 * - Multi-select species group filter using icon toggles (default: bird)
 * - Cumulative unique species count chart (LineChart from @mui/x-charts)
 * - Different colored line per selected species group
 * - Responsive design with Notion-inspired styling
 */
export function DashboardsPage() {
  // ============================================================================
  // State Management
  // ============================================================================

  // Cannwood-only "Devices" tab alongside the species dashboards (auth-gated)
  const isCannwood = getOrgSlug() === 'cannwood';
  const { isAuthenticated, requireAuth } = useAuth();
  const [activeTab, setActiveTab] = useState(0);

  const handleTabChange = (value: number) => {
    setActiveTab(value);
    if (value === 1 && !isAuthenticated) requireAuth(() => {});
  };

  const [selectedSpeciesTypes, setSelectedSpeciesTypes] = useState<string[]>(['bird']); // Default: bird selected
  const [chartData, setChartData] = useState<CumulativeSpeciesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Species selector state
  const [speciesList, setSpeciesList] = useState<SpeciesWithCount[]>([]);
  const [selectedSpeciesId, setSelectedSpeciesId] = useState<number | null>(null);
  const [occurrenceData, setOccurrenceData] = useState<SpeciesOccurrenceResponse | null>(null);
  const [occurrenceLoading, setOccurrenceLoading] = useState(false);
  const [occurrenceError, setOccurrenceError] = useState<string | null>(null);

  // Sightings map state
  const [sightingsData, setSightingsData] = useState<SpeciesSightingLocation[]>([]);
  const [sightingsLoading, setSightingsLoading] = useState(false);
  const [sightingsError, setSightingsError] = useState<string | null>(null);

  // Field boundaries state
  const [locationsWithBoundaries, setLocationsWithBoundaries] = useState<LocationWithBoundary[]>([]);

  // Available species types (only those with entries)
  const [availableSpeciesTypes, setAvailableSpeciesTypes] = useState<string[]>([]);

  // ============================================================================
  // Chart Configuration
  // ============================================================================

  const CHART_MARGIN = { top: 10, right: 10, left: 0, bottom: 0 };

  // Format timestamp for x-axis (Year for Jan, Month name for Apr/Jul/Oct)
  const formatXAxisTick = (timestamp: number): string => {
    const d = dayjs(timestamp);
    const month = d.month();
    return month === 0 ? d.format('YYYY') : d.format('MMM');
  };

  // Custom tooltip component for chart hover
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) {
      return null;
    }

    const data = payload[0].payload;
    const date = dayjs(data.date).format('MMM DD, YYYY');

    // Get the current species type and its new species
    const currentType = selectedSpeciesTypes[0];
    const newSpeciesList = data.newSpecies?.[currentType] || [];
    const count = data[currentType] || 0;

    return (
      <Paper
        elevation={3}
        sx={{
          p: 2,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          maxWidth: 300,
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
          {date}
        </Typography>
        <Typography variant="body2" sx={{ mb: 1 }}>
          Total: {count} {getSpeciesDisplayName(currentType).toLowerCase()}
        </Typography>

        {newSpeciesList.length > 0 && (
          <>
            <Typography variant="body2" sx={{ fontWeight: 600, mt: 1.5, mb: 0.5 }}>
              New this week:
            </Typography>
            <Box sx={{ maxHeight: 150, overflowY: 'auto' }}>
              {newSpeciesList.map((species: string, idx: number) => (
                <Typography key={idx} variant="body2" sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
                  • {species}
                </Typography>
              ))}
            </Box>
          </>
        )}

        {newSpeciesList.length === 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
            No new species this week
          </Typography>
        )}
      </Paper>
    );
  };

  // ============================================================================
  // Data Fetching
  // ============================================================================

  // Fetch cumulative species data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await dashboardAPI.getCumulativeSpecies(selectedSpeciesTypes);
        setChartData(response);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedSpeciesTypes]);

  // Fetch species list when species type changes
  useEffect(() => {
    const fetchSpecies = async () => {
      try {
        const currentType = selectedSpeciesTypes[0];
        const species = await dashboardAPI.getSpeciesByCount(currentType);
        setSpeciesList(species);

        // Auto-select most common species (first in list)
        if (species.length > 0) {
          setSelectedSpeciesId(species[0].id);
        } else {
          setSelectedSpeciesId(null);
        }
      } catch (err) {
        console.error('Failed to fetch species list:', err);
        setSpeciesList([]);
        setSelectedSpeciesId(null);
      }
    };

    fetchSpecies();
  }, [selectedSpeciesTypes]);

  // Fetch occurrence data when species is selected
  useEffect(() => {
    const fetchOccurrences = async () => {
      if (!selectedSpeciesId) {
        setOccurrenceData(null);
        return;
      }

      try {
        setOccurrenceLoading(true);
        setOccurrenceError(null);

        // Use same date range as cumulative chart if available
        const startDate = chartData?.date_range.start;
        const endDate = chartData?.date_range.end;

        const response = await dashboardAPI.getSpeciesOccurrences(
          selectedSpeciesId,
          startDate,
          endDate
        );
        setOccurrenceData(response);
      } catch (err) {
        setOccurrenceError(err instanceof Error ? err.message : 'Failed to load occurrence data');
      } finally {
        setOccurrenceLoading(false);
      }
    };

    fetchOccurrences();
  }, [selectedSpeciesId, chartData?.date_range]);

  // Fetch sightings data when species is selected
  useEffect(() => {
    const fetchSightings = async () => {
      if (!selectedSpeciesId) {
        setSightingsData([]);
        return;
      }

      try {
        setSightingsLoading(true);
        setSightingsError(null);

        // Use same date range as cumulative chart if available
        const startDate = chartData?.date_range.start;
        const endDate = chartData?.date_range.end;

        const response = await dashboardAPI.getSpeciesSightings(
          selectedSpeciesId,
          startDate,
          endDate
        );
        setSightingsData(response);
      } catch (err) {
        setSightingsError(err instanceof Error ? err.message : 'Failed to load sightings data');
      } finally {
        setSightingsLoading(false);
      }
    };

    fetchSightings();
  }, [selectedSpeciesId, chartData?.date_range]);

  // Fetch field boundaries once on mount
  useEffect(() => {
    locationsAPI.getAllWithBoundaries()
      .then(setLocationsWithBoundaries)
      .catch((err) => {
        console.warn('Failed to load field boundaries:', err);
      });
  }, []);

  // Fetch available species types (only those with entries) once on mount
  useEffect(() => {
    dashboardAPI.getSpeciesTypesWithEntries()
      .then((types) => {
        setAvailableSpeciesTypes(types);
        // If current selection is not in available types, select first available
        if (types.length > 0 && !types.includes(selectedSpeciesTypes[0])) {
          setSelectedSpeciesTypes([types[0]]);
        }
      })
      .catch((err) => {
        console.warn('Failed to load species types with entries:', err);
        // Fallback to showing all types if fetch fails
        setAvailableSpeciesTypes(speciesTypes);
      });
  }, []);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleToggle = (type: string) => {
    // Only allow one species type at a time
    setSelectedSpeciesTypes([type]);
  };

  // ============================================================================
  // Chart Data Transformation
  // ============================================================================

  const prepareChartData = () => {
    if (!chartData || chartData.data.length === 0) {
      return null;
    }

    // Get all species types present in the data
    const types = Array.from(new Set(chartData.data.map(d => d.type)));

    // Aggregate data by date (not week - to preserve individual survey dates)
    const dateData = new Map<string, { counts: { [key: string]: number }; species: { [key: string]: string[] } }>();

    chartData.data.forEach(({ date, type, cumulative_count, new_species }) => {
      const dateKey = date; // Use actual date as key

      if (!dateData.has(dateKey)) {
        dateData.set(dateKey, { counts: {}, species: {} });
      }

      const dayData = dateData.get(dateKey)!;

      // Take the max cumulative count for each type on this date
      dayData.counts[type] = Math.max(dayData.counts[type] || 0, cumulative_count);

      // Collect all new species for this type on this date
      if (!dayData.species[type]) {
        dayData.species[type] = [];
      }
      dayData.species[type].push(...new_species);
    });

    // Convert to array format with timestamps for x-axis (Option 2: Time scale)
    const chartArray = Array.from(dateData.entries())
      .map(([dateKey, data]) => {
        // Deduplicate species names for each type
        const deduplicatedSpecies: { [key: string]: string[] } = {};
        Object.entries(data.species).forEach(([type, speciesList]) => {
          deduplicatedSpecies[type] = Array.from(new Set(speciesList));
        });

        return {
          date: new Date(dateKey).getTime(), // Use timestamp for time scale
          dateStr: dateKey, // Keep string for reference
          ...data.counts,
          newSpecies: deduplicatedSpecies,
        };
      })
      .sort((a, b) => a.date - b.date);

    // Calculate custom ticks for x-axis (Year in Jan, then Apr, Jul, Oct)
    const customTicks: number[] = [];
    const seenMonths = new Set<string>();

    chartArray.forEach(item => {
      const date = new Date(item.date);
      const month = date.getMonth(); // 0-11
      const year = date.getFullYear();
      const key = `${year}-${month}`;

      // Only add tick for Jan (year), Apr, Jul, Oct - once per month
      if ((month === 0 || month === 3 || month === 6 || month === 9) && !seenMonths.has(key)) {
        customTicks.push(item.date);
        seenMonths.add(key);
      }
    });

    return {
      data: chartArray,
      types,
      customTicks,
    };
  };

  const chartDataPrepared = prepareChartData();

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <Box sx={{ p: SPACING.PAGE_PADDING }}>
      {isCannwood && (
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
          <Tabs value={activeTab} onChange={(_e, v) => handleTabChange(v)}>
            <Tab label="Species" />
            <Tab label="GPS tracking" />
          </Tabs>
        </Box>
      )}

      {isCannwood && activeTab === 1 && (
        isAuthenticated ? (
          <DeviceTrackerMap />
        ) : (
          <Paper
            elevation={0}
            sx={{ p: 4, textAlign: 'center', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}
          >
            <LockIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
            <Typography variant="body1" sx={{ mb: 2 }}>
              Enter the admin password to view tracker locations.
            </Typography>
            <Button
              variant="contained"
              onClick={() => requireAuth(() => {})}
              sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
            >
              Unlock
            </Button>
          </Paper>
        )
      )}

      {(!isCannwood || activeTab === 0) && (
        <>
      {/* Species Group Selector */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          mb: 3,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider'
        }}
      >
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {speciesTypes.filter(type => availableSpeciesTypes.includes(type)).map(type => {
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
                    '&:hover': {
                      bgcolor: isSelected ? brandColors.hover : '#DDD',
                    },
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

      {/* Chart Section */}
      <Paper
        elevation={0}
        sx={{
          p: 3,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          minHeight: 500
        }}
      >
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
            <CircularProgress />
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {!loading && !error && chartDataPrepared && chartDataPrepared.types.length > 0 && (
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={chartDataPrepared.data} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
              <XAxis
                dataKey="date"
                type="number"
                domain={['dataMin', 'dataMax']}
                scale="time"
                ticks={chartDataPrepared.customTicks}
                tickFormatter={formatXAxisTick}
                tick={{ fontSize: 12, fill: '#666' }}
                tickLine={false}
                axisLine={{ stroke: '#e0e0e0' }}
              />
              <YAxis hide={true} />
              <RechartsTooltip content={<CustomTooltip />} />
              {chartDataPrepared.types.map(type => (
                <Area
                  key={type}
                  type="monotone"
                  dataKey={type}
                  stroke={brandColors.main}
                  fill={brandColors.main}
                  fillOpacity={0.6}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}

        {!loading && !error && (!chartDataPrepared || chartDataPrepared.types.length === 0) && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              minHeight: 400,
              color: 'text.secondary'
            }}
          >
            <Typography variant="body1">
              No data available for selected species groups
            </Typography>
          </Box>
        )}
      </Paper>

      {/* Species Occurrence Chart */}
      <Paper
        elevation={0}
        sx={{
          p: 3,
          mt: 3,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          minHeight: 400
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2 }}>
          <Autocomplete
            options={speciesList}
            getOptionLabel={(option) =>
              `${option.name || option.scientific_name} (${option.total_count} total)`
            }
            value={speciesList.find(s => s.id === selectedSpeciesId) || null}
            onChange={(_event, newValue) => {
              setSelectedSpeciesId(newValue ? newValue.id : null);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Select Species"
                placeholder="Type to search..."
                size="small"
              />
            )}
            sx={{ minWidth: { xs: '100%', sm: 300 } }}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            selectOnFocus
            clearOnBlur
            blurOnSelect
            autoHighlight
          />
        </Box>

        {occurrenceLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
            <CircularProgress />
          </Box>
        )}

        {occurrenceError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {occurrenceError}
          </Alert>
        )}

        {!occurrenceLoading && !occurrenceError && occurrenceData && (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={(() => {
                // Option 3: Ordinal positioning with date labels
                // Calculate year boundaries and store them with the chart data
                const chartData = occurrenceData.data.map((d, index) => {
                  const year = new Date(d.survey_date).getFullYear();
                  return {
                    index,
                    surveyId: d.survey_id,
                    date: new Date(d.survey_date).getTime(),
                    dateStr: d.survey_date,
                    count: d.occurrence_count,
                    year,
                  };
                });

                // Calculate year boundaries
                const yearTickMap = new Map<number, number>(); // tick position -> year
                let prevYear: number | null = null;
                let lastIndexOfPrevYear: number | null = null;

                chartData.forEach((d, index) => {
                  if (prevYear !== null && d.year !== prevYear) {
                    // Year boundary detected
                    const midpoint = lastIndexOfPrevYear !== null
                      ? (lastIndexOfPrevYear + index) / 2
                      : index / 2;
                    yearTickMap.set(midpoint, d.year);
                  }

                  prevYear = d.year;
                  lastIndexOfPrevYear = index;
                });

                // Store the tick map in a way the formatter can access
                (chartData as any).yearTickMap = yearTickMap;

                return chartData;
              })()}
              margin={CHART_MARGIN}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
              <XAxis
                dataKey="index"
                type="category"
                ticks={(() => {
                  // Show year label at the first survey of each year
                  const yearFirstSurvey = new Map<number, number>(); // year -> first index

                  occurrenceData.data.forEach((d, index) => {
                    const year = new Date(d.survey_date).getFullYear();
                    if (!yearFirstSurvey.has(year)) {
                      yearFirstSurvey.set(year, index);
                    }
                  });

                  // Return array of first indices for each year
                  return Array.from(yearFirstSurvey.values());
                })()}
                tickFormatter={(tickValue) => {
                  const survey = occurrenceData.data[tickValue];
                  if (!survey) return '';
                  const year = new Date(survey.survey_date).getFullYear();
                  return year.toString();
                }}
                tick={{ fontSize: 12, fill: '#666' }}
                tickLine={false}
                axisLine={{ stroke: '#e0e0e0' }}
              />
              <YAxis hide={true} />
              <RechartsTooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const data = payload[0].payload;
                  const date = dayjs(data.dateStr).format('MMM DD, YYYY');
                  return (
                    <Paper
                      elevation={3}
                      sx={{
                        p: 2,
                        bgcolor: 'background.paper',
                        border: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                        {date}
                      </Typography>
                      <Typography variant="body2" sx={{ mb: 0.5 }}>
                        Survey #{data.surveyId}
                      </Typography>
                      <Typography variant="body2">
                        Count: {data.count} individuals
                      </Typography>
                    </Paper>
                  );
                }}
              />
              <Bar dataKey="count" fill={brandColors.main} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}

        {!occurrenceLoading && !occurrenceError && !occurrenceData && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              minHeight: 300,
              color: 'text.secondary'
            }}
          >
            <Typography variant="body1">
              {selectedSpeciesId ? 'No occurrence data available' : 'Select a species to view occurrences'}
            </Typography>
          </Box>
        )}
      </Paper>

      {/* Sightings Map Section */}
      <Paper
        elevation={0}
        sx={{
          p: 3,
          mt: 3,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          minHeight: 400
        }}
      >
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
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              minHeight: 300,
              color: 'text.secondary'
            }}
          >
            <Typography variant="body1">
              Select a species to view sighting locations
            </Typography>
          </Box>
        )}
      </Paper>
        </>
      )}
    </Box>
  );
}
