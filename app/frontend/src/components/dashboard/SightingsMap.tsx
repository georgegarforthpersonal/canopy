import { useState, useEffect, useMemo } from 'react';
import { Box, Paper, Typography, Slider, Stack, CircularProgress, Alert, ToggleButtonGroup, ToggleButton, Tooltip, IconButton, Chip } from '@mui/material';
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, useMap } from 'react-leaflet';
import { LatLngBounds, LatLng, DivIcon } from 'leaflet';
import MapIcon from '@mui/icons-material/Map';
import SatelliteIcon from '@mui/icons-material/Satellite';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import { BarChart, Bar, ResponsiveContainer, XAxis } from 'recharts';
import dayjs from 'dayjs';
import 'leaflet/dist/leaflet.css';
import type { SpeciesSightingLocation, LocationWithBoundary } from '../../services/api';
import FieldBoundaryOverlay from '../surveys/FieldBoundaryOverlay';
import { useMapFullscreen, MapResizeHandler } from '../../hooks';
import { getSurveyTypeColorStyles } from '../SurveyTypeColors';
import { brandColors } from '../../theme';
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '../../config';
import BreedingStatusFilter from './BreedingStatusFilter';

interface SightingsMapProps {
  sightings: SpeciesSightingLocation[];
  loading?: boolean;
  error?: string | null;
  locationsWithBoundaries?: LocationWithBoundary[];
}

interface SightingCluster {
  latitude: number;
  longitude: number;
  sightings: SpeciesSightingLocation[];
  count: number;
  surveyTypeColor: string | null;
  surveyTypeName: string | null;
}

/**
 * Component to fit map bounds to markers
 */
function FitBounds({ sightings }: { sightings: SpeciesSightingLocation[] }) {
  const map = useMap();

  useEffect(() => {
    if (sightings.length > 0) {
      const bounds = new LatLngBounds(
        sightings.map(s => new LatLng(s.latitude, s.longitude))
      );
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  }, [sightings, map]);

  return null;
}

/**
 * Get the marker colour for a survey type (uses the darker notion text shade)
 */
function getMarkerColor(surveyTypeColor: string | null | undefined): string {
  return getSurveyTypeColorStyles(surveyTypeColor).text;
}

/**
 * Create a DivIcon for a cluster marker with a count badge
 */
function createClusterIcon(count: number, color: string): DivIcon {
  const size = 26;
  return new DivIcon({
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background-color: ${color};
      border: 2px solid #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
      line-height: 1;
    ">${count}</div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * Bin sightings into time buckets for the histogram, stacked by survey type
 */
function buildHistogramData(
  sightings: SpeciesSightingLocation[],
  minTime: number,
  maxTime: number,
  bucketCount: number,
): { time: number; [surveyType: string]: number }[] {
  const range = maxTime - minTime;
  if (range === 0) return [];

  const bucketSize = range / bucketCount;
  const buckets: { time: number; [key: string]: number }[] = [];

  for (let i = 0; i < bucketCount; i++) {
    buckets.push({ time: minTime + bucketSize * i });
  }

  for (const s of sightings) {
    const time = new Date(s.survey_date).getTime();
    const idx = Math.min(Math.floor((time - minTime) / bucketSize), bucketCount - 1);
    const key = s.survey_type_name || 'Unknown';
    buckets[idx][key] = ((buckets[idx][key] as number) || 0) + 1;
  }

  return buckets;
}

/**
 * Clickable survey-type legend that doubles as a filter. Empty `selected` set
 * means no filter is applied — every chip renders in its filled state.
 */
function SurveyTypeFilterLegend({
  surveyTypes,
  selected,
  onToggle,
}: {
  surveyTypes: { name: string; color: string }[];
  selected: Set<string>;
  onToggle: (name: string) => void;
}) {
  const hasFilter = selected.size > 0;
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
      {surveyTypes.map((st) => {
        const isActive = !hasFilter || selected.has(st.name);
        return (
          <Chip
            key={st.name}
            label={st.name}
            size="small"
            onClick={() => onToggle(st.name)}
            icon={
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: st.color,
                  ml: '8px !important',
                }}
              />
            }
            variant={isActive ? 'filled' : 'outlined'}
            sx={{
              opacity: isActive ? 1 : 0.5,
              cursor: 'pointer',
            }}
          />
        );
      })}
    </Stack>
  );
}

export default function SightingsMap({ sightings, loading, error, locationsWithBoundaries }: SightingsMapProps) {
  // Fullscreen state
  const { isFullscreen, toggleFullscreen, fullscreenContainerSx, fullscreenMapSx } = useMapFullscreen();

  // Map type state
  const [mapType, setMapType] = useState<'street' | 'satellite'>('satellite');

  // Calculate date range for the data
  const dateRange = useMemo(() => {
    if (sightings.length === 0) return null;

    const dates = sightings.map(s => new Date(s.survey_date).getTime());
    const minTime = Math.min(...dates);
    const maxTime = Math.max(...dates);

    return {
      min: new Date(minTime),
      max: new Date(maxTime),
      minTime,
      maxTime
    };
  }, [sightings]);

  // Date range filter state
  const [dateFilterRange, setDateFilterRange] = useState<[number, number]>([
    dateRange?.minTime || 0,
    dateRange?.maxTime || 0
  ]);

  // Update filter range when data changes
  useEffect(() => {
    if (dateRange) {
      setDateFilterRange([dateRange.minTime, dateRange.maxTime]);
    }
  }, [dateRange]);

  // Breeding status filter state — empty Set means "no filter applied"
  const [selectedBreedingCodes, setSelectedBreedingCodes] = useState<Set<string>>(new Set());
  // Survey type filter state — empty Set means "no filter applied"
  const [selectedSurveyTypes, setSelectedSurveyTypes] = useState<Set<string>>(new Set());

  // Reset filters when the underlying sightings change (e.g. species switch)
  useEffect(() => {
    setSelectedBreedingCodes(new Set());
    setSelectedSurveyTypes(new Set());
  }, [sightings]);

  const handleToggleSurveyType = (name: string) => {
    setSelectedSurveyTypes(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Counts per available breeding code (only includes codes that appear at least once)
  const breedingCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sightings) {
      if (!s.breeding_status_code) continue;
      counts.set(s.breeding_status_code, (counts.get(s.breeding_status_code) ?? 0) + 1);
    }
    return counts;
  }, [sightings]);

  // Filter sightings based on date range, breeding codes, and survey types
  const filteredSightings = useMemo(() => {
    const breedingActive = selectedBreedingCodes.size > 0;
    const surveyActive = selectedSurveyTypes.size > 0;
    return sightings.filter(s => {
      if (dateRange) {
        const time = new Date(s.survey_date).getTime();
        if (time < dateFilterRange[0] || time > dateFilterRange[1]) return false;
      }
      if (breedingActive) {
        if (!s.breeding_status_code || !selectedBreedingCodes.has(s.breeding_status_code)) return false;
      }
      if (surveyActive) {
        const name = s.survey_type_name || 'Unknown';
        if (!selectedSurveyTypes.has(name)) return false;
      }
      return true;
    });
  }, [sightings, dateFilterRange, dateRange, selectedBreedingCodes, selectedSurveyTypes]);

  // Cluster filtered sightings by location
  const clusters = useMemo((): SightingCluster[] => {
    const map = new Map<string, SightingCluster>();

    for (const s of filteredSightings) {
      const key = `${s.latitude.toFixed(6)},${s.longitude.toFixed(6)}`;
      const existing = map.get(key);
      if (existing) {
        existing.sightings.push(s);
        existing.count++;
      } else {
        map.set(key, {
          latitude: s.latitude,
          longitude: s.longitude,
          sightings: [s],
          count: 1,
          surveyTypeColor: s.survey_type_color,
          surveyTypeName: s.survey_type_name,
        });
      }
    }

    return Array.from(map.values());
  }, [filteredSightings]);

  // Get unique survey types present in the data (for legend and histogram)
  const surveyTypes = useMemo(() => {
    const typeMap = new Map<string, { name: string; color: string }>();
    for (const s of sightings) {
      const name = s.survey_type_name || 'Unknown';
      if (!typeMap.has(name)) {
        typeMap.set(name, {
          name,
          color: getMarkerColor(s.survey_type_color),
        });
      }
    }
    return Array.from(typeMap.values());
  }, [sightings]);

  // Build histogram data (uses ALL sightings, not filtered, so the histogram shows full density)
  const histogramData = useMemo(() => {
    if (!dateRange || dateRange.minTime === dateRange.maxTime) return [];
    return buildHistogramData(sightings, dateRange.minTime, dateRange.maxTime, 30);
  }, [sightings, dateRange]);

  // Handle date range change
  const handleDateRangeChange = (_event: Event, newValue: number | number[]) => {
    if (Array.isArray(newValue)) {
      setDateFilterRange([newValue[0], newValue[1]]);
    }
  };

  const defaultCenter = DEFAULT_MAP_CENTER;
  const defaultZoom = DEFAULT_MAP_ZOOM;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  if (sightings.length === 0) {
    return (
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
          No sighting locations recorded for this species
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Date Range Filter with Histogram and Legend */}
      {dateRange && dateRange.minTime !== dateRange.maxTime && (
        <Paper
          elevation={0}
          sx={{
            p: 2,
            mb: 2,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider'
          }}
        >
          <Stack spacing={1}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  Date Range Filter
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Showing {filteredSightings.length} of {sightings.length} sightings
                </Typography>
              </Box>

              <Stack direction="row" spacing={1} alignItems="center">
                <BreedingStatusFilter
                  availableCounts={breedingCounts}
                  selectedCodes={selectedBreedingCodes}
                  onChange={setSelectedBreedingCodes}
                />
                <ToggleButtonGroup
                  value={mapType}
                  exclusive
                  onChange={(_, newValue) => newValue && setMapType(newValue)}
                  size="small"
                  sx={{ height: '32px' }}
                >
                  <ToggleButton value="street" aria-label="street map">
                    <Tooltip title="Street Map">
                      <MapIcon fontSize="small" />
                    </Tooltip>
                  </ToggleButton>
                  <ToggleButton value="satellite" aria-label="satellite view">
                    <Tooltip title="Satellite View">
                      <SatelliteIcon fontSize="small" />
                    </Tooltip>
                  </ToggleButton>
                </ToggleButtonGroup>
              </Stack>
            </Box>

            {/* Histogram + Slider overlay */}
            <Box sx={{ px: 1, position: 'relative' }}>
              {/* Histogram behind the slider */}
              {histogramData.length > 0 && (
                <Box sx={{ width: '100%', height: 40, mb: -3.5 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={histogramData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barCategoryGap={1}>
                      <XAxis dataKey="time" hide />
                      {surveyTypes.map((st) => (
                        <Bar
                          key={st.name}
                          dataKey={st.name}
                          stackId="a"
                          fill={st.color}
                          opacity={0.35}
                          isAnimationActive={false}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              )}

              <Slider
                value={dateFilterRange}
                onChange={handleDateRangeChange}
                min={dateRange.minTime}
                max={dateRange.maxTime}
                valueLabelDisplay="auto"
                valueLabelFormat={(value) => dayjs(value).format('MMM DD, YYYY')}
                sx={{
                  position: 'relative',
                  zIndex: 1,
                  '& .MuiSlider-thumb': {
                    bgcolor: '#fff',
                    border: `2px solid ${brandColors.main}`,
                  },
                  '& .MuiSlider-track': {
                    border: 'none',
                    bgcolor: brandColors.main,
                    opacity: 0.2,
                  },
                  '& .MuiSlider-rail': {
                    opacity: 0,
                    height: 6,
                  },
                }}
              />
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="caption" color="text.secondary">
                  {dayjs(dateFilterRange[0]).format('MMM DD, YYYY')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {dayjs(dateFilterRange[1]).format('MMM DD, YYYY')}
                </Typography>
              </Box>
            </Box>

            {/* Survey type legend / filter */}
            {surveyTypes.length > 1 && (
              <Box sx={{ pt: 0.5 }}>
                <SurveyTypeFilterLegend
                  surveyTypes={surveyTypes}
                  selected={selectedSurveyTypes}
                  onToggle={handleToggleSurveyType}
                />
              </Box>
            )}
          </Stack>
        </Paper>
      )}

      {/* Map Toggle for single-date datasets */}
      {(!dateRange || dateRange.minTime === dateRange.maxTime) && (
        <Paper
          elevation={0}
          sx={{
            p: 2,
            mb: 2,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider'
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Map View
              </Typography>
              {/* Legend / filter for single-date view */}
              {surveyTypes.length > 1 && (
                <SurveyTypeFilterLegend
                  surveyTypes={surveyTypes}
                  selected={selectedSurveyTypes}
                  onToggle={handleToggleSurveyType}
                />
              )}
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <BreedingStatusFilter
                availableCounts={breedingCounts}
                selectedCodes={selectedBreedingCodes}
                onChange={setSelectedBreedingCodes}
              />
              <ToggleButtonGroup
                value={mapType}
                exclusive
                onChange={(_, newValue) => newValue && setMapType(newValue)}
                size="small"
                sx={{ height: '32px' }}
              >
                <ToggleButton value="street" aria-label="street map">
                  <Tooltip title="Street Map">
                    <MapIcon fontSize="small" />
                  </Tooltip>
                </ToggleButton>
                <ToggleButton value="satellite" aria-label="satellite view">
                  <Tooltip title="Satellite View">
                    <SatelliteIcon fontSize="small" />
                  </Tooltip>
                </ToggleButton>
              </ToggleButtonGroup>
            </Stack>
          </Box>
        </Paper>
      )}

      {/* Map */}
      <Paper
        elevation={0}
        className="fullscreen-map-container"
        sx={{
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
          position: 'relative',
          ...fullscreenContainerSx,
        }}
      >
        {/* Fullscreen toggle */}
        <Stack
          direction="row"
          spacing={0.5}
          sx={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 1000,
          }}
        >
          <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
            <IconButton
              size="small"
              onClick={toggleFullscreen}
              sx={{
                bgcolor: 'white',
                boxShadow: 2,
                '&:hover': { bgcolor: 'grey.100' },
              }}
            >
              {isFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Stack>

        <Box sx={{ height: 500, width: '100%', ...fullscreenMapSx }}>
          <MapContainer
            center={defaultCenter}
            zoom={defaultZoom}
            style={{ height: '100%', width: '100%' }}
          >
            {mapType === 'satellite' ? (
              <TileLayer
                key="satellite"
                attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
            ) : (
              <TileLayer
                key="street"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
            )}

            {/* Field boundaries layer (rendered before markers so markers appear on top) */}
            {locationsWithBoundaries && locationsWithBoundaries.length > 0 && (
              <FieldBoundaryOverlay locations={locationsWithBoundaries} />
            )}

            {clusters.map((cluster) => {
              const color = getMarkerColor(cluster.surveyTypeColor);

              if (cluster.count === 1) {
                // Single sighting — simple CircleMarker
                const sighting = cluster.sightings[0];
                return (
                  <CircleMarker
                    key={sighting.id}
                    center={[sighting.latitude, sighting.longitude]}
                    radius={8}
                    pathOptions={{
                      fillColor: color,
                      fillOpacity: 0.85,
                      color: '#fff',
                      weight: 2,
                    }}
                  >
                    <Popup>
                      <Box sx={{ p: 1 }}>
                        {sighting.survey_type_name && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                            {sighting.survey_type_name}
                          </Typography>
                        )}
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                          {dayjs(sighting.survey_date).format('MMM DD, YYYY')}
                        </Typography>
                        {sighting.breeding_status_code && (
                          <Typography variant="body2" color="text.secondary">
                            <strong>{sighting.breeding_status_code}</strong>
                            {sighting.breeding_status_description && ` - ${sighting.breeding_status_description}`}
                          </Typography>
                        )}
                      </Box>
                    </Popup>
                  </CircleMarker>
                );
              }

              // Cluster — DivIcon with count badge
              const clusterKey = `cluster-${cluster.latitude.toFixed(6)}-${cluster.longitude.toFixed(6)}`;
              const sortedSightings = [...cluster.sightings].sort(
                (a, b) => new Date(b.survey_date).getTime() - new Date(a.survey_date).getTime()
              );

              return (
                <Marker
                  key={clusterKey}
                  position={[cluster.latitude, cluster.longitude]}
                  icon={createClusterIcon(cluster.count, color)}
                >
                  <Popup>
                    <Box sx={{ p: 1, maxHeight: 200, overflowY: 'auto' }}>
                      {cluster.surveyTypeName && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                          {cluster.surveyTypeName}
                        </Typography>
                      )}
                      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                        {cluster.count} sightings
                      </Typography>
                      {sortedSightings.map((s) => (
                        <Box key={s.id} sx={{ mb: 0.5 }}>
                          <Typography variant="body2">
                            {dayjs(s.survey_date).format('MMM DD, YYYY')}
                            {s.breeding_status_code && (
                              <Typography component="span" variant="body2" color="text.secondary">
                                {' — '}{s.breeding_status_code}
                              </Typography>
                            )}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Popup>
                </Marker>
              );
            })}

            <FitBounds sightings={sightings} />
            <MapResizeHandler isFullscreen={isFullscreen} />
          </MapContainer>
        </Box>
      </Paper>
    </Box>
  );
}
