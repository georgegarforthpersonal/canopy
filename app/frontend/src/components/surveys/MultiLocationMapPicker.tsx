import { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMapEvents, useMap, Popup } from 'react-leaflet';
import { LatLng } from 'leaflet';
import {
  Box,
  Typography,
  Stack,
  Paper,
  IconButton,
  Tooltip,
  ToggleButtonGroup,
  ToggleButton,
  Chip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  ListSubheader,
  TextField,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import MapIcon from '@mui/icons-material/Map';
import SatelliteIcon from '@mui/icons-material/Satellite';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import 'leaflet/dist/leaflet.css';

import type { BreedingStatusCode, BreedingCategory, LocationWithBoundary } from '../../services/api';
import { useMapFullscreen, MapResizeHandler, MapStopOnUnmount } from '../../hooks';
import { DEFAULT_MAP_CENTER } from '../../config';
import { CATEGORY_COLORS, CATEGORY_LABELS } from './breedingConstants';
import FieldBoundaryOverlay from './FieldBoundaryOverlay';

// Extended individual location with temp ID for tracking unsaved points
export interface DraftIndividualLocation {
  tempId: string;
  id?: number;
  latitude: number;
  longitude: number;
  count: number;
  breeding_status_code?: string | null;
  notes?: string | null;
}

interface MultiLocationMapPickerProps {
  locations: DraftIndividualLocation[];
  onChange: (locations: DraftIndividualLocation[]) => void;
  breedingCodes: BreedingStatusCode[];
  showBreedingStatus?: boolean;
  maxCount?: number; // Maximum number of individuals allowed (from sighting count)
  disabled?: boolean;
  locationsWithBoundaries?: LocationWithBoundary[]; // Optional locations with boundaries to display on the map
  surveyLocationId?: number | null;
}

// Component to handle map clicks
function MapClickHandler({ onClick, disabled }: { onClick: (latlng: LatLng) => void; disabled?: boolean }) {
  useMapEvents({
    click(e) {
      if (!disabled) {
        onClick(e.latlng);
      }
    },
  });
  return null;
}

// Component to fit map bounds to markers (only on initial mount with pre-existing locations)
function FitBoundsToMarkers({ locations, surveyLocationId, locationsWithBoundaries }: { locations: DraftIndividualLocation[]; surveyLocationId?: number | null; locationsWithBoundaries?: LocationWithBoundary[] }) {
  const map = useMap();
  // Capture whether there were locations when the component first mounted
  const hadInitialLocationsRef = useRef(locations.length > 0);
  const hasFittedRef = useRef(false);

  useEffect(() => {
    // Only fit bounds if there were pre-existing locations when the modal opened
    if (!hasFittedRef.current && hadInitialLocationsRef.current && locations.length > 0) {
      const bounds = locations.map((loc) => [loc.latitude, loc.longitude] as [number, number]);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      hasFittedRef.current = true;
    }

    if (!hasFittedRef.current && !hadInitialLocationsRef.current && surveyLocationId && locationsWithBoundaries) {
      const location = locationsWithBoundaries.find(l => l.id === surveyLocationId);
      if (location?.boundary_geometry && location.boundary_geometry.length > 0) {
        const bounds = location.boundary_geometry.map(([lng, lat]: [number, number]) => [lat, lng] as [number, number]);
        map.fitBounds(bounds, { padding: [20, 20], maxZoom: 17 });
        hasFittedRef.current = true;
      }
    }
  }, [locations, map, surveyLocationId, locationsWithBoundaries]);

  return null;
}

// Get marker color based on breeding status code
function getMarkerColor(code: string | null | undefined, breedingCodes: BreedingStatusCode[]): string {
  if (!code) return '#9E9E9E';
  const status = breedingCodes.find((bc) => bc.code === code);
  if (!status) return '#9E9E9E';
  return CATEGORY_COLORS[status.category as BreedingCategory] || '#9E9E9E';
}

// Group breeding codes by category
function groupBreedingCodes(breedingCodes: BreedingStatusCode[]) {
  const groups: Record<BreedingCategory, BreedingStatusCode[]> = {
    'non_breeding': [],
    'possible_breeder': [],
    'probable_breeder': [],
    'confirmed_breeder': [],
  };

  breedingCodes.forEach((code) => {
    if (groups[code.category]) {
      groups[code.category].push(code);
    }
  });

  return groups;
}

export default function MultiLocationMapPicker({
  locations,
  onChange,
  breedingCodes,
  showBreedingStatus = true,
  maxCount,
  disabled = false,
  locationsWithBoundaries,
  surveyLocationId,
}: MultiLocationMapPickerProps) {
  const [mapType, setMapType] = useState<'street' | 'satellite'>('satellite');
  const [mapCenter] = useState<LatLng>(new LatLng(DEFAULT_MAP_CENTER[0], DEFAULT_MAP_CENTER[1]));
  const { isFullscreen, toggleFullscreen, fullscreenContainerSx, fullscreenMapSx } = useMapFullscreen();

  // Calculate total count across all locations
  const totalCount = locations.reduce((sum, loc) => sum + loc.count, 0);
  const remainingCount = maxCount !== undefined ? maxCount - totalCount : undefined;
  const isAtMax = remainingCount !== undefined && remainingCount <= 0;
  const groupedCodes = groupBreedingCodes(breedingCodes);

  // Handle map click - add new individual location
  const handleMapClick = useCallback(
    (latlng: LatLng) => {
      if (isAtMax) return;

      const newLocation: DraftIndividualLocation = {
        tempId: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        latitude: latlng.lat,
        longitude: latlng.lng,
        count: 1,
        breeding_status_code: null,
        notes: null,
      };
      onChange([...locations, newLocation]);
    },
    [locations, onChange, isAtMax]
  );

  // Update count for a specific location
  const handleCountChange = useCallback(
    (tempId: string, newCount: number) => {
      // Check if new count would exceed max
      if (maxCount !== undefined) {
        const otherLocationsTotal = locations
          .filter((loc) => loc.tempId !== tempId)
          .reduce((sum, loc) => sum + loc.count, 0);
        const maxAllowed = maxCount - otherLocationsTotal;
        if (newCount > maxAllowed) return;
      }

      onChange(
        locations.map((loc) =>
          loc.tempId === tempId ? { ...loc, count: newCount } : loc
        )
      );
    },
    [locations, onChange, maxCount]
  );

  // Validate count on blur (ensure at least 1)
  const handleCountBlur = useCallback(
    (tempId: string, currentCount: number) => {
      if (currentCount < 1) {
        onChange(
          locations.map((loc) =>
            loc.tempId === tempId ? { ...loc, count: 1 } : loc
          )
        );
      }
    },
    [locations, onChange]
  );

  // Update breeding status for a specific individual
  const handleBreedingStatusChange = useCallback(
    (tempId: string, code: string | null) => {
      onChange(
        locations.map((loc) =>
          loc.tempId === tempId ? { ...loc, breeding_status_code: code } : loc
        )
      );
    },
    [locations, onChange]
  );

  // Remove an individual
  const handleRemoveLocation = useCallback(
    (tempId: string) => {
      onChange(locations.filter((loc) => loc.tempId !== tempId));
    },
    [locations, onChange]
  );

  // Get helper text based on state
  const getHelperText = () => {
    if (locations.length === 0) {
      return 'Click on the map to add a location.';
    }
    if (isAtMax) {
      return `All ${maxCount} individual${maxCount === 1 ? '' : 's'} have been assigned to locations.`;
    }
    if (remainingCount !== undefined && remainingCount > 0) {
      return `${remainingCount} individual${remainingCount === 1 ? '' : 's'} remaining. Click on the map to add another location.`;
    }
    return 'Click on the map to add more locations.';
  };

  // Get progress text
  const getProgressText = () => {
    if (maxCount === undefined) {
      return `${totalCount} individual${totalCount === 1 ? '' : 's'} across ${locations.length} location${locations.length === 1 ? '' : 's'}`;
    }
    return `${totalCount} of ${maxCount} across ${locations.length} location${locations.length === 1 ? '' : 's'}`;
  };

  return (
    <Box>
      {/* Header with progress */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">
          Individuals ({getProgressText()})
        </Typography>
        <Stack direction="row" spacing={1}>
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
      </Stack>

      {/* Map */}
      <Paper
        elevation={2}
        className="fullscreen-map-container"
        sx={{ mb: 2, overflow: 'hidden', position: 'relative', ...fullscreenContainerSx }}
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

        <Box sx={{ height: { xs: '250px', sm: '300px' }, width: '100%', ...fullscreenMapSx }}>
          <MapContainer center={mapCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
            {mapType === 'satellite' ? (
              <TileLayer
                key="satellite"
                attribution='Tiles &copy; Esri'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
            ) : (
              <TileLayer
                key="street"
                attribution='&copy; OpenStreetMap'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
            )}
            <MapClickHandler onClick={handleMapClick} disabled={disabled || isAtMax} />
            <FitBoundsToMarkers locations={locations} surveyLocationId={surveyLocationId} locationsWithBoundaries={locationsWithBoundaries} />
            <MapResizeHandler isFullscreen={isFullscreen} />
            <MapStopOnUnmount />

            {/* Field boundaries layer (rendered before markers so markers appear on top) */}
            {locationsWithBoundaries && locationsWithBoundaries.length > 0 && (
              <FieldBoundaryOverlay locations={locationsWithBoundaries} />
            )}

            {locations.map((loc, index) => (
              <CircleMarker
                key={loc.tempId}
                center={[loc.latitude, loc.longitude]}
                radius={10}
                pathOptions={{
                  fillColor: getMarkerColor(loc.breeding_status_code, breedingCodes),
                  fillOpacity: 0.9,
                  color: '#fff',
                  weight: 2,
                }}
              >
                <Popup>
                  <Box sx={{ minWidth: 120 }}>
                    <Typography variant="body2" fontWeight={600}>
                      Individual {index + 1}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}
                    </Typography>
                  </Box>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </Box>

        {/* Overlay message when at max */}
        {isAtMax && (
          <Box
            sx={{
              position: 'absolute',
              bottom: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              bgcolor: 'rgba(0,0,0,0.7)',
              color: 'white',
              px: 2,
              py: 0.5,
              borderRadius: 1,
              fontSize: '0.75rem',
            }}
          >
            Maximum {maxCount} individual{maxCount === 1 ? '' : 's'} reached
          </Box>
        )}
      </Paper>

      {/* Individual Cards */}
      {locations.length > 0 && (
        <Stack spacing={1.5} sx={{ mb: 2 }}>
          {locations.map((loc, index) => (
            <Paper
              key={loc.tempId}
              elevation={1}
              sx={{
                p: 1.5,
                borderLeft: 4,
                borderLeftColor: getMarkerColor(loc.breeding_status_code, breedingCodes),
              }}
            >
              <Stack spacing={1.5}>
                {/* Header row: Location # and delete button */}
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="subtitle2" fontWeight={600}>
                    Location {index + 1}
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={() => handleRemoveLocation(loc.tempId)}
                    disabled={disabled}
                    sx={{ color: 'error.main' }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>

                {/* Coordinates */}
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <LocationOnIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Typography variant="body2" color="text.secondary">
                    {loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}
                  </Typography>
                </Stack>

                {/* Count input */}
                <Stack direction="row" alignItems="center" spacing={1}>
                  <TextField
                    size="small"
                    type="number"
                    label="Count"
                    value={loc.count || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleCountChange(loc.tempId, val === '' ? 0 : parseInt(val, 10) || 0);
                    }}
                    onBlur={() => handleCountBlur(loc.tempId, loc.count)}
                    disabled={disabled}
                    inputProps={{ min: 1 }}
                    sx={{ width: 100 }}
                  />
                  {maxCount !== undefined && (
                    <Typography variant="caption" color="text.secondary">
                      {remainingCount !== undefined && remainingCount > 0 ? `${remainingCount} remaining` : 'max reached'}
                    </Typography>
                  )}
                </Stack>

                {/* Breeding Status (birds only) */}
                {showBreedingStatus && (
                  <FormControl size="small" fullWidth>
                    <InputLabel id={`breeding-${loc.tempId}`}>Breeding Status</InputLabel>
                    <Select
                      labelId={`breeding-${loc.tempId}`}
                      value={loc.breeding_status_code || ''}
                      onChange={(e) => handleBreedingStatusChange(loc.tempId, e.target.value || null)}
                      label="Breeding Status"
                      disabled={disabled}
                      renderValue={(value) => {
                        if (!value) return <em style={{ color: '#666' }}>Not set</em>;
                        const code = breedingCodes.find((c) => c.code === value);
                        if (!code) return value;
                        return (
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <Chip
                              label={code.code}
                              size="small"
                              sx={{
                                bgcolor: CATEGORY_COLORS[code.category],
                                color: 'white',
                                fontWeight: 600,
                                height: 20,
                                minWidth: 28,
                                '& .MuiChip-label': { px: 0.75 },
                              }}
                            />
                            <span>{code.description}</span>
                          </Stack>
                        );
                      }}
                    >
                      <MenuItem value="">
                        <em>Not set</em>
                      </MenuItem>
                      {(Object.keys(groupedCodes) as BreedingCategory[]).map((category) => {
                        const codes = groupedCodes[category];
                        if (codes.length === 0) return null;
                        return [
                          <ListSubheader
                            key={`header-${category}`}
                            sx={{
                              bgcolor: CATEGORY_COLORS[category],
                              color: 'white',
                              fontWeight: 600,
                              lineHeight: '32px',
                            }}
                          >
                            {CATEGORY_LABELS[category]}
                          </ListSubheader>,
                          ...codes.map((code) => (
                            <MenuItem key={code.code} value={code.code} sx={{ py: 1 }}>
                              <Stack direction="column" spacing={0.5} sx={{ width: '100%' }}>
                                <Stack direction="row" alignItems="center" spacing={1}>
                                  <Chip
                                    label={code.code}
                                    size="small"
                                    sx={{
                                      bgcolor: CATEGORY_COLORS[category],
                                      color: 'white',
                                      fontWeight: 600,
                                      height: 20,
                                      minWidth: 28,
                                      '& .MuiChip-label': { px: 0.75 },
                                    }}
                                  />
                                  <span style={{ fontWeight: 500 }}>{code.description}</span>
                                </Stack>
                                {code.full_description && code.full_description !== code.description && (
                                  <Box
                                    sx={{
                                      fontSize: '0.75rem',
                                      color: 'text.secondary',
                                      ml: 5,
                                      lineHeight: 1.4,
                                      whiteSpace: 'normal',
                                      wordBreak: 'break-word',
                                      maxWidth: 400,
                                    }}
                                  >
                                    {code.full_description}
                                  </Box>
                                )}
                              </Stack>
                            </MenuItem>
                          )),
                        ];
                      })}
                    </Select>
                  </FormControl>
                )}
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      {/* Empty state */}
      {locations.length === 0 && (
        <Paper
          elevation={0}
          sx={{
            p: 3,
            mb: 2,
            textAlign: 'center',
            border: '2px dashed',
            borderColor: 'divider',
            bgcolor: 'grey.50',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            No individual locations added yet.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Click on the map to add locations.
          </Typography>
        </Paper>
      )}

      {/* Legend (birds only) */}
      {showBreedingStatus && locations.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
          {(Object.keys(CATEGORY_LABELS) as BreedingCategory[]).map((category) => (
            <Box
              key={category}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                fontSize: '0.7rem',
                color: 'text.secondary',
              }}
            >
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: CATEGORY_COLORS[category],
                }}
              />
              {CATEGORY_LABELS[category]}
            </Box>
          ))}
        </Box>
      )}

      {/* Helper text */}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {getHelperText()}
      </Typography>
    </Box>
  );
}
