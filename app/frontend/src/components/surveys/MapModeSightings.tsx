import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import { LatLng, DivIcon } from 'leaflet';
import {
  Box,
  Stack,
  Paper,
  IconButton,
  Tooltip,
  Alert,
  Typography,
  Chip,
} from '@mui/material';
import LayersIcon from '@mui/icons-material/Layers';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import 'leaflet/dist/leaflet.css';
import { useMapFullscreen, MapResizeHandler } from '../../hooks';
import { DEFAULT_MAP_CENTER } from '../../config';

import type { Species, BreedingStatusCode, LocationWithBoundary, Device } from '../../services/api';
import type { DraftSighting } from './SightingsEditor';
import type { DraftIndividualLocation } from './MultiLocationMapPicker';
import {
  getMarkersFromSightings,
  groupMarkersByLocation,
  addSpeciesAtLocation,
  updateMarker,
  removeMarker,
  getDeviceGroupsFromSightings,
} from './mapModeUtils';
import type { DeviceGroup } from './mapModeUtils';
import { MarkerPopupContent, GroupedMarkerPopupContent } from './MarkerPopupContent';
import FieldBoundaryOverlay from './FieldBoundaryOverlay';
import { getDeviceIcon } from '../../utils/deviceIcon';

interface MapModeSightingsProps {
  sightings: DraftSighting[];
  species: Species[];
  breedingCodes?: BreedingStatusCode[];
  onSightingsChange?: (sightings: DraftSighting[]) => void;
  locationsWithBoundaries?: LocationWithBoundary[];
  readOnly?: boolean;
  surveyLocationId?: number | null;
  devices?: Device[];
  allowSightingDeviceSelection?: boolean;
}

function MapClickHandler({ onClick }: { onClick?: (latlng: LatLng) => void }) {
  const map = useMap();

  useMapEvents({
    click(e) {
      // Check if a popup is currently open and visible (closeOnClick is
      // disabled on our popups so Leaflet won't close them on map click).
      // We must check isOpen() because _popup can hold a stale reference
      // after React unmounts a Popup component.
      const currentPopup = (map as any)._popup;
      if (currentPopup && currentPopup.isOpen()) {
        map.closePopup();
        return;
      }
      // Only trigger onClick if provided (not in read-only mode)
      if (onClick) {
        onClick(e.latlng);
      }
    },
  });
  return null;
}

function FitBoundsToPoints({ points, surveyLocationId, locationsWithBoundaries }: { points: Array<{ latitude: number; longitude: number }>; surveyLocationId?: number | null; locationsWithBoundaries?: LocationWithBoundary[] }) {
  const map = useMap();
  const hadInitialPointsRef = useRef(points.length > 0);
  const hasFittedRef = useRef(false);

  useEffect(() => {
    if (!hasFittedRef.current && hadInitialPointsRef.current && points.length > 0) {
      const bounds = points.map((p) => [p.latitude, p.longitude] as [number, number]);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      hasFittedRef.current = true;
    }

    if (!hasFittedRef.current && !hadInitialPointsRef.current && surveyLocationId && locationsWithBoundaries) {
      const location = locationsWithBoundaries.find(l => l.id === surveyLocationId);
      if (location?.boundary_geometry && location.boundary_geometry.length > 0) {
        const bounds = location.boundary_geometry.map(([lng, lat]: [number, number]) => [lat, lng] as [number, number]);
        map.fitBounds(bounds, { padding: [20, 20], maxZoom: 17 });
        hasFittedRef.current = true;
      }
    }
  }, [points, map, surveyLocationId, locationsWithBoundaries]);

  return null;
}

function createSpeciesCodeIcon(speciesCode: string | null): DivIcon {
  const displayText = speciesCode || '•';
  const fontSize = speciesCode ? '10px' : '14px';
  const size = speciesCode ? Math.max(20, speciesCode.length * 8 + 8) : 20;

  return new DivIcon({
    className: 'species-code-marker',
    html: `<div style="
      display: flex;
      align-items: center;
      justify-content: center;
      width: ${size}px;
      height: 20px;
      background-color: rgba(255, 255, 255, 0.9);
      border-radius: 10px;
      border: 1px solid rgba(0, 0, 0, 0.3);
      color: #000;
      font-weight: bold;
      font-size: ${fontSize};
      font-family: sans-serif;
      white-space: nowrap;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    ">${displayText}</div>`,
    iconSize: [size, 20],
    iconAnchor: [size / 2, 10],
  });
}

export function MapModeSightings({
  sightings,
  species,
  breedingCodes = [],
  onSightingsChange,
  locationsWithBoundaries,
  readOnly = false,
  surveyLocationId,
  devices = [],
  allowSightingDeviceSelection = false,
}: MapModeSightingsProps) {
  const [mapType, setMapType] = useState<'street' | 'satellite'>('satellite');
  const [mapCenter] = useState<LatLng>(new LatLng(DEFAULT_MAP_CENTER[0], DEFAULT_MAP_CENTER[1]));
  const [addPopupPosition, setAddPopupPosition] = useState<{ lat: number; lng: number } | null>(null);
  const { isFullscreen, toggleFullscreen, fullscreenContainerSx, fullscreenMapSx } = useMapFullscreen();

  // Device-attach mode: markers are driven by the attached device's coordinates.
  // Non-device mode: markers are driven by per-individual GPS points.
  const deviceGrouping = useMemo(
    () => (allowSightingDeviceSelection ? getDeviceGroupsFromSightings(sightings, devices) : { groups: [] as DeviceGroup[], unmappable: 0 }),
    [allowSightingDeviceSelection, sightings, devices]
  );
  const markers = useMemo(
    () => (allowSightingDeviceSelection ? [] : getMarkersFromSightings(sightings)),
    [allowSightingDeviceSelection, sightings]
  );
  const groupedMarkers = useMemo(() => groupMarkersByLocation(markers), [markers]);

  // In device-attach mode the map is always read-only for map-click add.
  const mapIsReadOnly = readOnly || allowSightingDeviceSelection;

  const fitPoints = useMemo(
    () =>
      allowSightingDeviceSelection
        ? deviceGrouping.groups.map((g) => ({ latitude: g.latitude, longitude: g.longitude }))
        : markers.map((m) => ({ latitude: m.latitude, longitude: m.longitude })),
    [allowSightingDeviceSelection, deviceGrouping.groups, markers]
  );

  // Count sightings that can't be placed on the map for the info banner.
  const sightingsWithoutGps = useMemo(() => {
    if (allowSightingDeviceSelection) {
      return deviceGrouping.unmappable;
    }
    return sightings.filter(
      (s) => s.species_id !== null && (!s.individuals || s.individuals.length === 0)
    ).length;
  }, [allowSightingDeviceSelection, deviceGrouping.unmappable, sightings]);

  const handleMapClick = useCallback((latlng: LatLng) => {
    setAddPopupPosition({ lat: latlng.lat, lng: latlng.lng });
  }, []);

  const handleAddFromPopup = useCallback(
    (speciesId: number, count: number, breedingStatusCode?: string | null) => {
      if (!addPopupPosition) return;
      const updated = addSpeciesAtLocation(
        sightings,
        addPopupPosition.lat,
        addPopupPosition.lng,
        speciesId,
        count,
        breedingStatusCode
      );
      onSightingsChange?.(updated);
      setAddPopupPosition(null);
    },
    [addPopupPosition, sightings, onSightingsChange]
  );

  const handleAddPopupClose = useCallback(() => {
    setAddPopupPosition(null);
  }, []);

  const handleMarkerUpdate = useCallback(
    (sightingTempId: string, individualTempId: string, updates: Partial<Pick<DraftIndividualLocation, 'count' | 'breeding_status_code'>>) => {
      const updated = updateMarker(sightings, sightingTempId, individualTempId, updates);
      onSightingsChange?.(updated);
    },
    [sightings, onSightingsChange]
  );

  const handleMarkerDelete = useCallback(
    (sightingTempId: string, individualTempId: string) => {
      const updated = removeMarker(sightings, sightingTempId, individualTempId);
      onSightingsChange?.(updated);
    },
    [sightings, onSightingsChange]
  );

  return (
    <Box>
      {/* Map */}
      <Paper
        elevation={2}
        className="fullscreen-map-container"
        sx={{ mb: 2, overflow: 'hidden', position: 'relative', ...fullscreenContainerSx }}
      >
        <Box sx={{ height: { xs: '350px', sm: '400px', md: '500px' }, width: '100%', ...fullscreenMapSx }}>
          {/* Map controls overlaid on the map */}
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
            <Tooltip title={mapType === 'satellite' ? 'Switch to street map' : 'Switch to satellite'}>
              <IconButton
                size="small"
                onClick={() => setMapType(mapType === 'satellite' ? 'street' : 'satellite')}
                sx={{
                  bgcolor: 'white',
                  boxShadow: 2,
                  '&:hover': { bgcolor: 'grey.100' },
                }}
              >
                <LayersIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
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
            <MapClickHandler onClick={mapIsReadOnly ? undefined : handleMapClick} />
            <FitBoundsToPoints points={fitPoints} surveyLocationId={surveyLocationId} locationsWithBoundaries={locationsWithBoundaries} />
            <MapResizeHandler isFullscreen={isFullscreen} />

            {locationsWithBoundaries && locationsWithBoundaries.length > 0 && (
              <FieldBoundaryOverlay locations={locationsWithBoundaries} />
            )}

            {/* Device-attach mode: one marker per device, popup lists species observed there */}
            {allowSightingDeviceSelection && deviceGrouping.groups.map((group) => {
              const icon = getDeviceIcon(group.device);
              const totalIndividuals = group.entries.reduce((sum, e) => sum + e.count, 0);
              return (
                <Marker
                  key={`device-${group.device.id}`}
                  position={[group.latitude, group.longitude]}
                  icon={icon}
                >
                  <Popup
                    closeOnClick={false}
                    autoPan={true}
                    minWidth={200}
                    maxWidth={320}
                    className="map-mode-popup"
                  >
                    <Box sx={{ minWidth: 180, p: 0.5 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.25 }}>
                        {group.device.name || group.device.device_id}
                      </Typography>
                      {group.device.name && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', display: 'block', mb: 0.75 }}>
                          {group.device.device_id}
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                        {group.entries.length} species · {totalIndividuals} individual{totalIndividuals === 1 ? '' : 's'}
                      </Typography>
                      <Stack spacing={0.5}>
                        {group.entries.map((entry) => {
                          const sp = species.find((s) => s.id === entry.species_id);
                          const label = sp?.name || sp?.scientific_name || 'Unknown';
                          return (
                            <Stack key={entry.sightingTempId} direction="row" alignItems="center" spacing={0.75}>
                              <Chip
                                label={entry.count}
                                size="small"
                                sx={{ height: 18, fontSize: '0.7rem', minWidth: 28 }}
                              />
                              <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                                {label}
                              </Typography>
                            </Stack>
                          );
                        })}
                      </Stack>
                    </Box>
                  </Popup>
                </Marker>
              );
            })}

            {/* Existing markers - grouped by location */}
            {!allowSightingDeviceSelection && groupedMarkers.map((group) => {
              // For icon, use first species code or show count if multiple species
              const firstMarker = group.markers[0];
              const firstSpecies = species.find((s) => s.id === firstMarker.species_id);
              const speciesCode = group.markers.length === 1
                ? (firstSpecies?.species_code || null)
                : `${group.markers.length}`;  // Show count when multiple species
              const icon = createSpeciesCodeIcon(speciesCode);

              return (
                <Marker
                  key={group.locationKey}
                  position={[group.latitude, group.longitude]}
                  icon={icon}
                >
                  <Popup
                    closeOnClick={false}
                    autoPan={true}
                    minWidth={readOnly ? 200 : 260}
                    maxWidth={320}
                    className="map-mode-popup"
                  >
                    {group.markers.length === 1 ? (
                      // Single marker - show normal popup
                      readOnly ? (
                        <MarkerPopupContent
                          mode="view"
                          species={species}
                          breedingCodes={breedingCodes}
                          marker={firstMarker}
                        />
                      ) : (
                        <MarkerPopupContent
                          mode="edit"
                          species={species}
                          breedingCodes={breedingCodes}
                          marker={firstMarker}
                          onUpdate={(updates) =>
                            handleMarkerUpdate(firstMarker.sightingTempId, firstMarker.individualTempId, updates)
                          }
                          onDelete={() =>
                            handleMarkerDelete(firstMarker.sightingTempId, firstMarker.individualTempId)
                          }
                        />
                      )
                    ) : (
                      // Multiple markers at same location - show grouped popup
                      <GroupedMarkerPopupContent
                        markers={group.markers}
                        species={species}
                        breedingCodes={breedingCodes}
                        readOnly={readOnly}
                        onUpdate={handleMarkerUpdate}
                        onDelete={handleMarkerDelete}
                      />
                    )}
                  </Popup>
                </Marker>
              );
            })}

            {/* Add popup (opens directly at click location, no marker needed) */}
            {!allowSightingDeviceSelection && addPopupPosition && (
              <Popup
                position={[addPopupPosition.lat, addPopupPosition.lng]}
                closeOnClick={false}
                autoPan={true}
                minWidth={260}
                maxWidth={320}
                className="map-mode-popup"
                eventHandlers={{
                  remove: handleAddPopupClose,
                }}
              >
                <MarkerPopupContent
                  mode="add"
                  species={species}
                  breedingCodes={breedingCodes}
                  onAdd={handleAddFromPopup}
                  onDiscard={handleAddPopupClose}
                />
              </Popup>
            )}
          </MapContainer>
        </Box>
      </Paper>

      {/* Info banner for sightings that can't be placed on the map */}
      {sightingsWithoutGps > 0 && (
        <Alert severity="info" sx={{ mb: 1 }}>
          {allowSightingDeviceSelection
            ? `${sightingsWithoutGps} sighting${sightingsWithoutGps > 1 ? 's have' : ' has'} no mappable device and ${sightingsWithoutGps > 1 ? 'are' : 'is'} only visible in list mode.`
            : `${sightingsWithoutGps} sighting${sightingsWithoutGps > 1 ? 's have' : ' has'} no GPS location and ${sightingsWithoutGps > 1 ? 'are' : 'is'} only visible in list mode.`}
        </Alert>
      )}
    </Box>
  );
}
