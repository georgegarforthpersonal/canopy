import { useState, useMemo, useEffect, useRef } from 'react';
import { Box, Typography, TextField, Autocomplete, IconButton, Alert, Stack, Card, CardContent, Button, Chip, Tooltip } from '@mui/material';
import { Delete, Edit, Add, LocationOnOutlined, PinDrop, StickyNote2Outlined, PhotoCamera, Close } from '@mui/icons-material';
import type { Species, BreedingStatusCode, LocationWithBoundary, Location, Device } from '../../services/api';
import { imagesAPI, locationDisplayName } from '../../services/api';
import { AddSightingModal } from './AddSightingModal';
import type { SightingData } from './AddSightingModal';
import { LocationModal } from './LocationModal';
import { MapModeSightings } from './MapModeSightings';
import ViewModeToggle from '../ViewModeToggle';
import { getSightingsGridConfig } from './sightingsGridConfig';
import { hasPositiveStageCounts, pickStageCounts, recordsStageCounts, type StageCounts } from '../../config/stageCounts';
import { hasFrequencyScore, pickFrequencyScore, type FrequencyScore } from '../../config/frequencyScore';
import StageCountsFields from './StageCountsFields';
import StageCountsSummary from './StageCountsSummary';
import FrequencyScoreFields from './FrequencyScoreFields';
import FrequencyScoreSummary from './FrequencyScoreSummary';
import { getSpeciesIcon } from '../../config';
import { useResponsive } from '../../hooks/useResponsive';
import { orderSpeciesForEntry, recentSpeciesIds } from '../../utils/speciesOrder';
import type { DraftIndividualLocation } from './MultiLocationMapPicker';

/** Small thumbnail that lazily loads a presigned URL for an existing image */
function ExistingPhotoThumbnail({ imageId }: { imageId: number }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    imagesAPI.getPreviewUrl(imageId).then((res) => {
      if (mounted) setUrl(res.preview_url);
    }).catch(() => { /* ignore */ });
    return () => { mounted = false; };
  }, [imageId]);

  if (!url) return <Box sx={{ width: 48, height: 36, bgcolor: 'grey.200', borderRadius: 0.5, flexShrink: 0 }} />;

  return (
    <Box
      component="img"
      src={url}
      alt=""
      sx={{ width: 48, height: 36, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }}
    />
  );
}

/** Thumbnail for a pending (not yet uploaded) file, with proper URL lifecycle */
function PendingPhotoThumbnail({ file }: { file: File }) {
  const urlRef = useRef<string | null>(null);
  if (!urlRef.current) {
    urlRef.current = URL.createObjectURL(file);
  }

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  return (
    <Box
      component="img"
      src={urlRef.current}
      alt={file.name}
      sx={{ width: 48, height: 36, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }}
    />
  );
}

export interface DraftSighting extends StageCounts, FrequencyScore {
  tempId: string;
  species_id: number | null;
  count: number;
  id?: number;
  // Client-minted idempotency uuid, set when a save first attempts to create
  // this sighting; retries reuse it so the server never duplicates the row
  client_uuid?: string;
  // Per-individual location points with breeding status
  individuals?: DraftIndividualLocation[];
  // Location ID when location is at sighting level
  location_id?: number | null;
  // Device ID when sighting inherits location from a device
  device_id?: number | null;
  // Optional notes for this sighting
  notes?: string | null;
  // Pending photo files to upload on save
  pendingPhotos?: File[];
  // Existing image IDs already linked to this sighting (for edit mode)
  existingImageIds?: number[];
  // Image IDs to remove on save (subset of existingImageIds)
  removedImageIds?: number[];
}

interface SightingsEditorProps {
  sightings: DraftSighting[];
  species: Species[];
  breedingCodes?: BreedingStatusCode[];
  onSightingsChange: (sightings: DraftSighting[]) => void;
  validationError?: string;
  locationsWithBoundaries?: LocationWithBoundary[]; // Optional locations with boundaries to display on maps
  // Survey type configuration
  locationAtSightingLevel?: boolean; // When true, show location dropdown per sighting
  locations?: Location[]; // Available locations for sighting-level selection
  allowGeolocation?: boolean; // Whether geolocation is allowed (controls geolocation button visibility)
  allowCoordinateEntry?: boolean; // Whether typed coordinates can place sighting locations
  allowSightingNotes?: boolean; // Whether notes can be entered for individual sightings
  allowSightingPhotoUpload?: boolean; // Whether photos can be attached to individual sightings
  allowFrequencyScore?: boolean; // Whether sightings carry a botanical frequency score
  allowSightingDeviceSelection?: boolean; // When true, each sighting picks a device that supplies its location
  devices?: Device[]; // Available devices (already filtered by configured device type) when device selection is on
  surveyLocationId?: number | null; // Survey-level location ID for initial map zoom
  // The survey type's default entry surface: surveys open in this view and
  // the list/map toggle stays available everywhere.
  recordMode?: 'list' | 'map';
}

/**
 * SightingsEditor - Responsive editor for survey sightings
 *
 * Mobile (xs/sm): Card-based UI with modal for add/edit
 * Desktop (md+): Inline table editing with all fields visible
 */
export function SightingsEditor({
  sightings,
  species,
  breedingCodes = [],
  onSightingsChange,
  validationError,
  locationsWithBoundaries,
  locationAtSightingLevel = false,
  locations = [],
  allowGeolocation = true,
  allowCoordinateEntry = false,
  allowSightingNotes = true,
  allowSightingPhotoUpload = false,
  allowFrequencyScore = false,
  allowSightingDeviceSelection = false,
  devices = [],
  surveyLocationId,
  recordMode,
}: SightingsEditorProps) {
  const { isMobile } = useResponsive();

  // 'map' is only honoured when the type can actually show a map.
  const mapCapable = allowGeolocation || allowSightingDeviceSelection;
  const effectiveRecordMode: 'list' | 'map' =
    recordMode === 'map' && mapCapable ? 'map' : 'list';

  const [viewMode, setViewMode] = useState<'list' | 'map'>(effectiveRecordMode);

  // The survey type (and with it the mode) can change without a remount —
  // e.g. picking a different type on the new-survey page.
  useEffect(() => {
    setViewMode(effectiveRecordMode);
  }, [effectiveRecordMode]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTempId, setEditingTempId] = useState<string | null>(null);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [locationEditingTempId, setLocationEditingTempId] = useState<string | null>(null);

  // Order for entry: grouped by type, then recently-used this session, then
  // most-recorded for this survey type, then alphabetical. This ordered list
  // is what the modal, map popups and grid all present.
  const sortedSpecies = useMemo(
    () => orderSpeciesForEntry(species, recentSpeciesIds(sightings)),
    [species, sightings]
  );

  // Fixed-species survey types offer exactly one species: the selector is
  // hidden and every sighting is that species.
  const singleSpecies = species.length === 1 ? species[0] : null;

  // Format category name for display
  const formatCategoryName = (category: string): string => {
    return category.charAt(0).toUpperCase() + category.slice(1);
  };

  // Modal handlers (for mobile)
  const handleAddClick = () => {
    setEditingTempId(null);
    setModalOpen(true);
  };

  const handleEditClick = (tempId: string) => {
    setEditingTempId(tempId);
    setModalOpen(true);
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setEditingTempId(null);
  };

  const handleModalSave = (sightingData: SightingData) => {
    if (editingTempId) {
      const updatedSightings = sightings.map((s) =>
        s.tempId === editingTempId
          ? {
              ...s,
              species_id: sightingData.species_id,
              count: sightingData.count,
              individuals: sightingData.individuals,
              location_id: sightingData.location_id,
              device_id: sightingData.device_id,
              notes: sightingData.notes,
              // All keys, nulls included, so cleared values clear here too.
              ...pickStageCounts(sightingData),
              ...pickFrequencyScore(sightingData),
              pendingPhotos: sightingData.pendingPhotos,
              existingImageIds: sightingData.existingImageIds,
              removedImageIds: sightingData.removedImageIds,
            }
          : s
      );
      onSightingsChange(updatedSightings);
    } else {
      onSightingsChange([
        ...sightings,
        {
          tempId: `temp-${Date.now()}`,
          species_id: sightingData.species_id,
          count: sightingData.count,
          individuals: sightingData.individuals,
          location_id: sightingData.location_id,
          device_id: sightingData.device_id,
          notes: sightingData.notes,
          ...pickStageCounts(sightingData),
          ...pickFrequencyScore(sightingData),
          pendingPhotos: sightingData.pendingPhotos,
        },
      ]);
    }
  };

  // Inline editing handlers (for desktop)
  const addSightingRow = () => {
    onSightingsChange([
      ...sightings,
      {
        tempId: `temp-${Date.now()}`,
        species_id: singleSpecies?.id ?? null,
        count: 1,
      },
    ]);
  };

  const removeSightingRow = (tempId: string) => {
    if (sightings.length > 1) {
      onSightingsChange(sightings.filter((s) => s.tempId !== tempId));
    }
  };

  const updateSighting = (tempId: string, field: keyof DraftSighting, value: any) => {
    const isLastRow = sightings[sightings.length - 1].tempId === tempId;
    const shouldAutoAdd = field === 'species_id' && value !== null && isLastRow;

    const updatedSightings = sightings.map((s) => {
      if (s.tempId !== tempId) return s;
      const next = { ...s, [field]: value };
      // Changing to a species that isn't recorded with the BDS matrix must not
      // leave counts behind from the species that was selected before.
      if (field === 'species_id' && !recordsStageCounts(getSpeciesType(value))) {
        return { ...next, ...pickStageCounts(null) };
      }
      return next;
    });

    if (shouldAutoAdd) {
      onSightingsChange([
        ...updatedSightings,
        {
          tempId: `temp-${Date.now()}`,
          species_id: null,
          count: 1,
        },
      ]);
    } else {
      onSightingsChange(updatedSightings);
    }
  };

  const getSpeciesDisplayName = (speciesId: number | null): string => {
    const sp = species.find((s) => s.id === speciesId);
    if (!sp) return 'Unknown';
    if (sp.name) {
      return sp.scientific_name ? `${sp.name} (${sp.scientific_name})` : sp.name;
    }
    return sp.scientific_name || 'Unknown';
  };

  const getSpeciesType = (speciesId: number | null): string => {
    const sp = species.find((s) => s.id === speciesId);
    return sp?.type || 'insect';
  };

  const getLocationName = (locationId: number | null | undefined): string => {
    if (!locationId) return '';
    const loc = locations.find((l) => l.id === locationId);
    return loc ? locationDisplayName(loc) : '';
  };

  const getDeviceDisplayName = (deviceId: number | null | undefined): string => {
    if (!deviceId) return '';
    return devices.find((x) => x.id === deviceId)?.name || '';
  };

  // Location modal handlers
  const handleLocationClick = (tempId: string) => {
    setLocationEditingTempId(tempId);
    setLocationModalOpen(true);
  };

  const handleLocationModalClose = () => {
    setLocationModalOpen(false);
    setLocationEditingTempId(null);
  };

  const handleLocationSave = (individuals: DraftIndividualLocation[]) => {
    if (locationEditingTempId) {
      const updatedSightings = sightings.map((s) =>
        s.tempId === locationEditingTempId
          ? {
              ...s,
              individuals: individuals,
            }
          : s
      );
      onSightingsChange(updatedSightings);
    }
  };

  // Photo handling
  const handlePhotoSelect = (tempId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const validExtensions = ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp'];
    const validFiles = Array.from(files).filter((f) => {
      const ext = f.name.toLowerCase().substring(f.name.lastIndexOf('.'));
      return validExtensions.includes(ext);
    });
    if (validFiles.length === 0) return;
    const updatedSightings = sightings.map((s) =>
      s.tempId === tempId
        ? { ...s, pendingPhotos: [...(s.pendingPhotos || []), ...validFiles] }
        : s
    );
    onSightingsChange(updatedSightings);
    event.target.value = '';
  };

  const handleRemovePendingPhoto = (tempId: string, fileIndex: number) => {
    const updatedSightings = sightings.map((s) =>
      s.tempId === tempId
        ? { ...s, pendingPhotos: (s.pendingPhotos || []).filter((_, i) => i !== fileIndex) }
        : s
    );
    onSightingsChange(updatedSightings);
  };

  const handleRemoveExistingPhoto = (tempId: string, imageId: number) => {
    const updatedSightings = sightings.map((s) =>
      s.tempId === tempId
        ? { ...s, removedImageIds: [...(s.removedImageIds || []), imageId] }
        : s
    );
    onSightingsChange(updatedSightings);
  };

  const getPhotoCount = (sighting: DraftSighting): number => {
    const existing = (sighting.existingImageIds?.length || 0) - (sighting.removedImageIds?.length || 0);
    const pending = sighting.pendingPhotos?.length || 0;
    return existing + pending;
  };

  const validSightings = sightings.filter((s) => s.species_id !== null);
  const editingSighting = editingTempId ? sightings.find((s) => s.tempId === editingTempId) : null;
  const locationEditingSighting = locationEditingTempId ? sightings.find((s) => s.tempId === locationEditingTempId) : null;

  const canShowMap = allowGeolocation || allowSightingDeviceSelection;

  const viewModeToggle = canShowMap ? (
    <ViewModeToggle value={viewMode} onChange={setViewMode} />
  ) : null;

  // Map mode UI (shared between mobile and desktop)
  if (viewMode === 'map' && canShowMap) {
    return (
      <>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Sightings ({validSightings.length})
          </Typography>
          {viewModeToggle}
        </Stack>

        {validationError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {validationError}
          </Alert>
        )}

        <MapModeSightings
          sightings={sightings}
          species={sortedSpecies}
          breedingCodes={breedingCodes}
          onSightingsChange={onSightingsChange}
          locationsWithBoundaries={locationsWithBoundaries}
          surveyLocationId={surveyLocationId}
          devices={devices}
          allowSightingDeviceSelection={allowSightingDeviceSelection}
          allowSightingPhotoUpload={allowSightingPhotoUpload}
        />
      </>
    );
  }

  // Mobile UI: Cards + Modal
  if (isMobile) {
    return (
      <>
        <Box sx={{ mb: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: viewModeToggle ? 1 : 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Sightings
            </Typography>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={handleAddClick}
              size="small"
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                boxShadow: 'none',
                '&:hover': { boxShadow: 'none' }
              }}
            >
              Add
            </Button>
          </Stack>
          {viewModeToggle && (
            <Box sx={{ mb: 2 }}>
              {viewModeToggle}
            </Box>
          )}

          {validationError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {validationError}
            </Alert>
          )}

          {validSightings.length > 0 ? (
            <Stack spacing={1.5}>
              {validSightings.map((sighting) => {
                const SpeciesIcon = getSpeciesIcon(getSpeciesType(sighting.species_id));
                const speciesName = getSpeciesDisplayName(sighting.species_id);
                // For BDS taxa the count IS "Adults (total)" — echo the
                // modal's vocabulary so the card confirms what was entered.
                const stageCountSpecies = recordsStageCounts(getSpeciesType(sighting.species_id));

                return (
                  <Card
                    key={sighting.tempId}
                    variant="outlined"
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      boxShadow: 'none',
                    }}
                  >
                    <CardContent
                      sx={{
                        p: 1.5,
                        '&:last-child': { pb: 1.5 },
                      }}
                    >
                      <Stack direction="row" alignItems="center" spacing={2}>
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 40,
                            height: 40,
                            borderRadius: 1,
                            bgcolor: 'grey.100',
                            flexShrink: 0,
                          }}
                        >
                          <SpeciesIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
                        </Box>

                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography
                            variant="body1"
                            sx={{
                              fontWeight: 500,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'normal',
                              fontSize: '0.95rem',
                            }}
                          >
                            {speciesName}
                          </Typography>
                          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                            <Chip
                              label={stageCountSpecies ? `Adults: ${sighting.count}` : `Count: ${sighting.count}`}
                              size="small"
                              sx={{
                                height: 24,
                                fontSize: '0.75rem',
                                bgcolor: 'primary.main',
                                color: 'white',
                                fontWeight: 600,
                              }}
                            />
                            {locationAtSightingLevel && sighting.location_id && (
                              <Chip
                                label={getLocationName(sighting.location_id)}
                                size="small"
                                sx={{
                                  height: 24,
                                  fontSize: '0.75rem',
                                  bgcolor: 'grey.200',
                                  color: 'text.primary',
                                  fontWeight: 500,
                                }}
                              />
                            )}
                            {allowSightingDeviceSelection && sighting.device_id && (
                              <Chip
                                label={getDeviceDisplayName(sighting.device_id)}
                                size="small"
                                sx={{
                                  height: 24,
                                  fontSize: '0.75rem',
                                  bgcolor: 'grey.200',
                                  color: 'text.primary',
                                  fontWeight: 500,
                                }}
                              />
                            )}
                            {allowSightingNotes && sighting.notes && (
                              <Tooltip title={sighting.notes} arrow>
                                <Chip
                                  icon={<StickyNote2Outlined sx={{ fontSize: 14 }} />}
                                  label="Notes"
                                  size="small"
                                  sx={{
                                    height: 24,
                                    fontSize: '0.75rem',
                                    bgcolor: 'warning.light',
                                    color: 'warning.contrastText',
                                    fontWeight: 500,
                                    '& .MuiChip-icon': {
                                      color: 'inherit',
                                    },
                                  }}
                                />
                              </Tooltip>
                            )}
                            {allowSightingPhotoUpload && getPhotoCount(sighting) > 0 && (
                              <Chip
                                icon={<PhotoCamera sx={{ fontSize: 14 }} />}
                                label={`${getPhotoCount(sighting)} photo${getPhotoCount(sighting) > 1 ? 's' : ''}`}
                                size="small"
                                sx={{
                                  height: 24,
                                  fontSize: '0.75rem',
                                  bgcolor: 'info.light',
                                  color: 'info.contrastText',
                                  fontWeight: 500,
                                  '& .MuiChip-icon': { color: 'inherit' },
                                }}
                              />
                            )}
                          </Stack>
                          {stageCountSpecies && hasPositiveStageCounts(pickStageCounts(sighting)) && (
                            <Box sx={{ mt: 0.5 }}>
                              <StageCountsSummary counts={pickStageCounts(sighting)} />
                            </Box>
                          )}
                          {allowFrequencyScore && hasFrequencyScore(sighting) && (
                            <Box sx={{ mt: 0.5 }}>
                              <FrequencyScoreSummary score={pickFrequencyScore(sighting)} />
                            </Box>
                          )}
                        </Box>

                        <Stack direction="row" spacing={0.5}>
                          <IconButton
                            size="small"
                            onClick={() => handleEditClick(sighting.tempId)}
                            sx={{ color: 'primary.main' }}
                          >
                            <Edit fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={() => removeSightingRow(sighting.tempId)}
                            sx={{ color: 'error.main' }}
                          >
                            <Delete fontSize="small" />
                          </IconButton>
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                );
              })}
            </Stack>
          ) : (
            <Box
              sx={{
                p: 4,
                textAlign: 'center',
                border: '2px dashed',
                borderColor: 'divider',
                borderRadius: 1,
                bgcolor: 'grey.50',
              }}
            >
              <Typography variant="body2" color="text.secondary">
                No sightings added yet. Tap "Add" to record your first sighting.
              </Typography>
            </Box>
          )}
        </Box>

        <AddSightingModal
          open={modalOpen}
          onClose={handleModalClose}
          onSave={handleModalSave}
          species={sortedSpecies}
          breedingCodes={breedingCodes}
          initialData={
            editingSighting
              ? {
                  species_id: editingSighting.species_id,
                  count: editingSighting.count,
                  individuals: editingSighting.individuals,
                  location_id: editingSighting.location_id,
                  device_id: editingSighting.device_id,
                  notes: editingSighting.notes,
                  ...pickStageCounts(editingSighting),
                  ...pickFrequencyScore(editingSighting),
                  pendingPhotos: editingSighting.pendingPhotos,
                  existingImageIds: editingSighting.existingImageIds,
                  removedImageIds: editingSighting.removedImageIds,
                }
              : undefined
          }
          mode={editingTempId ? 'edit' : 'add'}
          locationsWithBoundaries={locationsWithBoundaries}
          locationAtSightingLevel={locationAtSightingLevel}
          locations={locations}
          allowGeolocation={allowGeolocation}
          allowCoordinateEntry={allowCoordinateEntry}
          allowSightingNotes={allowSightingNotes}
          allowSightingPhotoUpload={allowSightingPhotoUpload}
          allowFrequencyScore={allowFrequencyScore}
          allowSightingDeviceSelection={allowSightingDeviceSelection}
          devices={devices}
          surveyLocationId={surveyLocationId}
        />
      </>
    );
  }

  // Desktop UI: Inline Table Editing
  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Sightings ({validSightings.length})
        </Typography>
        {viewModeToggle}
      </Stack>

      {validationError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {validationError}
        </Alert>
      )}

      {/* Calculate grid columns based on which fields are shown */}
      {(() => {
        const gridConfig = getSightingsGridConfig({
          locationAtSightingLevel,
          allowGeolocation,
          allowSightingDeviceSelection,
          showNotesColumn: allowSightingNotes,
          showPhotosColumn: allowSightingPhotoUpload,
          includeDeleteColumn: true,
        });
        const { gridColumns } = gridConfig;

        return sightings.length > 0 ? (
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: gridColumns,
              gap: 2,
              p: 1.5,
              bgcolor: 'grey.50',
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Typography variant="body2" fontWeight={600} color="text.secondary">
              SPECIES *
            </Typography>
            {gridConfig.showDevice && (
              <Typography variant="body2" fontWeight={600} color="text.secondary">
                DEVICE *
              </Typography>
            )}
            {gridConfig.showLocation && (
              <Typography variant="body2" fontWeight={600} color="text.secondary">
                LOCATION *
              </Typography>
            )}
            {gridConfig.showGps && (
              <Typography variant="body2" fontWeight={600} color="text.secondary" textAlign="center">
                GPS
              </Typography>
            )}
            {gridConfig.showSpacer && (
              <Box /> // Empty spacer to maintain grid alignment
            )}
            <Typography variant="body2" fontWeight={600} color="text.secondary">
              COUNT *
            </Typography>
            {allowSightingNotes && (
              <Typography variant="body2" fontWeight={600} color="text.secondary">
                NOTES
              </Typography>
            )}
            {allowSightingPhotoUpload && (
              <Typography variant="body2" fontWeight={600} color="text.secondary" textAlign="center">
                PHOTOS
              </Typography>
            )}
            <Box /> {/* Actions column - no header needed */}
          </Box>

          {sightings.map((sighting, index) => {
            const isLastRow = index === sightings.length - 1;
            const isEmpty = sighting.species_id === null;
            const isEmptyLastRow = isLastRow && isEmpty;

            const individualCount = sighting.individuals?.reduce((sum, ind) => sum + ind.count, 0) || 0;
            const locationCount = sighting.individuals?.length || 0;
            const hasLocations = locationCount > 0;
            const locationTooltip = hasLocations
              ? `${individualCount} of ${sighting.count} individual${sighting.count > 1 ? 's' : ''} across ${locationCount} location${locationCount > 1 ? 's' : ''}`
              : `Click to add locations (0 of ${sighting.count})`;

            const photoCount = getPhotoCount(sighting);
            const activeExistingIds = (sighting.existingImageIds || []).filter(
              (imgId) => !(sighting.removedImageIds || []).includes(imgId)
            );

            return (
              <Box
                key={sighting.tempId}
                sx={{
                  borderBottom: index < sightings.length - 1 ? '1px solid' : 'none',
                  borderColor: 'divider',
                }}
              >
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: gridColumns,
                    gap: 2,
                    p: 1.5,
                    alignItems: 'center',
                    bgcolor: isEmptyLastRow ? 'grey.50' : 'transparent',
                    transition: 'background-color 0.2s',
                  }}
                >
                {singleSpecies ? (
                  isEmpty ? (
                    <Button
                      startIcon={<Add />}
                      onClick={() => updateSighting(sighting.tempId, 'species_id', singleSpecies.id)}
                      sx={{ justifyContent: 'flex-start', textTransform: 'none', fontWeight: 600 }}
                    >
                      Add {singleSpecies.name || singleSpecies.scientific_name} sighting
                    </Button>
                  ) : (
                    <Box sx={{ display: 'flex', alignItems: 'center', fontSize: '0.875rem', px: 1.75 }}>
                      {singleSpecies.name ? (
                        <>
                          {singleSpecies.name}
                          {singleSpecies.scientific_name && (
                            <i style={{ color: '#666', marginLeft: '0.25rem' }}>{singleSpecies.scientific_name}</i>
                          )}
                        </>
                      ) : (
                        <i style={{ color: '#666' }}>{singleSpecies.scientific_name}</i>
                      )}
                    </Box>
                  )
                ) : (
                <Autocomplete
                  options={sortedSpecies}
                  groupBy={(option) => formatCategoryName(option.type)}
                  renderGroup={(params) => {
                    const type = params.group.toLowerCase();
                    const SpeciesIcon = getSpeciesIcon(type);

                    return (
                      <li key={params.key}>
                        <Box sx={{ px: 2, py: 1, bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider' }}>
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <SpeciesIcon sx={{ fontSize: '16px', color: 'text.secondary' }} />
                            <Typography variant="body2" fontWeight={600} color="text.secondary">
                              {params.group}
                            </Typography>
                          </Stack>
                        </Box>
                        <ul style={{ padding: 0, margin: 0 }}>{params.children}</ul>
                      </li>
                    );
                  }}
                  getOptionLabel={(option) => {
                    if (option.name) {
                      return `${option.name} ${option.scientific_name || ''}`.trim();
                    }
                    return option.scientific_name || '';
                  }}
                  value={species.find((s) => s.id === sighting.species_id) || null}
                  onChange={(_, newValue) =>
                    updateSighting(sighting.tempId, 'species_id', newValue?.id || null)
                  }
                  renderOption={(props, option) => (
                    <li {...props}>
                      {option.name ? (
                        <>
                          {option.name}
                          {option.scientific_name && (
                            <i style={{ color: '#666', marginLeft: '0.5rem' }}>{option.scientific_name}</i>
                          )}
                        </>
                      ) : (
                        <i style={{ color: '#666' }}>{option.scientific_name}</i>
                      )}
                    </li>
                  )}
                  renderInput={(params) => {
                    const selectedSpecies = species.find((s) => s.id === sighting.species_id);
                    const hasSelection = selectedSpecies !== undefined && selectedSpecies !== null;

                    return (
                      <TextField
                        {...params}
                        placeholder={isEmptyLastRow ? 'Start typing to add sighting...' : 'Select species'}
                        size="small"
                        InputProps={{
                          ...params.InputProps,
                          startAdornment: hasSelection && params.inputProps.value ? (
                            <Box
                              component="span"
                              sx={{
                                position: 'absolute',
                                left: 14,
                                pointerEvents: 'none',
                                fontSize: '0.875rem',
                                color: 'text.primary',
                              }}
                            >
                              {selectedSpecies.name ? (
                                <>
                                  {selectedSpecies.name}
                                  {selectedSpecies.scientific_name && (
                                    <i style={{ color: '#666', marginLeft: '0.25rem' }}> {selectedSpecies.scientific_name}</i>
                                  )}
                                </>
                              ) : (
                                <i style={{ color: '#666' }}>{selectedSpecies.scientific_name}</i>
                              )}
                            </Box>
                          ) : null,
                        }}
                        sx={{
                          '& .MuiInputBase-input': {
                            fontSize: '0.875rem',
                            padding: '8.5px 14px',
                            color: hasSelection && params.inputProps.value ? 'transparent' : 'inherit',
                          }
                        }}
                      />
                    );
                  }}
                  size="small"
                />
                )}

                {/* Device Dropdown Column - when device selection is on */}
                {gridConfig.showDevice && (
                  <Autocomplete
                    options={devices}
                    getOptionLabel={(d) => d.name}
                    value={devices.find((d) => d.id === sighting.device_id) || null}
                    onChange={(_, newValue) =>
                      updateSighting(sighting.tempId, 'device_id', newValue?.id || null)
                    }
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        placeholder={isEmptyLastRow ? '' : 'Select device'}
                        size="small"
                        sx={{
                          '& .MuiInputBase-input': {
                            fontSize: '0.875rem',
                            padding: '8.5px 14px'
                          }
                        }}
                      />
                    )}
                    size="small"
                    disabled={isEmptyLastRow}
                  />
                )}

                {/* Location Dropdown Column - when location is at sighting level */}
                {gridConfig.showLocation && (
                  <Autocomplete
                    options={locations}
                    getOptionLabel={locationDisplayName}
                    value={locations.find((l) => l.id === sighting.location_id) || null}
                    onChange={(_, newValue) =>
                      updateSighting(sighting.tempId, 'location_id', newValue?.id || null)
                    }
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        placeholder={isEmptyLastRow ? '' : 'Select location'}
                        size="small"
                        sx={{
                          '& .MuiInputBase-input': {
                            fontSize: '0.875rem',
                            padding: '8.5px 14px'
                          }
                        }}
                      />
                    )}
                    size="small"
                    disabled={isEmptyLastRow}
                  />
                )}

                {/* GPS Location Column - for individual geolocation */}
                {gridConfig.showGps && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                    <Tooltip title={locationTooltip} arrow>
                      <IconButton
                        size="small"
                        onClick={() => handleLocationClick(sighting.tempId)}
                        disabled={isEmptyLastRow}
                        sx={{
                          color: hasLocations ? 'primary.main' : 'text.disabled',
                          '&:hover': {
                            bgcolor: hasLocations ? 'primary.light' : 'action.hover',
                          },
                        }}
                      >
                        {hasLocations ? (
                          <PinDrop sx={{ fontSize: 24 }} />
                        ) : (
                          <LocationOnOutlined sx={{ fontSize: 24 }} />
                        )}
                      </IconButton>
                    </Tooltip>
                  </Box>
                )}
                {gridConfig.showSpacer && (
                  <Box /> // Empty spacer to maintain grid alignment
                )}

                <TextField
                  type="number"
                  value={sighting.count || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateSighting(sighting.tempId, 'count', val === '' ? 0 : Math.max(0, parseInt(val) || 0));
                  }}
                  onBlur={() => {
                    // 0 adults stands when positive breeding evidence carries
                    // the row (exuviae-only visits are real BDS records).
                    const zeroAllowed =
                      recordsStageCounts(getSpeciesType(sighting.species_id)) &&
                      hasPositiveStageCounts(pickStageCounts(sighting));
                    if (sighting.count < 1 && !zeroAllowed) {
                      updateSighting(sighting.tempId, 'count', 1);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && sighting.species_id !== null) {
                      e.preventDefault();
                      addSightingRow();
                    }
                    if (e.key === 'Tab' && !e.shiftKey && isLastRow && sighting.species_id !== null) {
                      if (isEmpty) {
                        addSightingRow();
                      }
                    }
                  }}
                  size="small"
                  inputProps={{ min: 1 }}
                  placeholder="#"
                  sx={{
                    '& .MuiInputBase-input': {
                      fontSize: '0.875rem',
                      padding: '8.5px 14px'
                    }
                  }}
                />

                {allowSightingNotes && (
                  <TextField
                    value={sighting.notes || ''}
                    onChange={(e) => updateSighting(sighting.tempId, 'notes', e.target.value || null)}
                    size="small"
                    placeholder="Notes..."
                    disabled={isEmptyLastRow}
                    sx={{
                      '& .MuiInputBase-input': {
                        fontSize: '0.875rem',
                        padding: '8.5px 14px'
                      }
                    }}
                  />
                )}

                {allowSightingPhotoUpload && (
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                    {photoCount > 0 && (
                      <Chip
                        label={photoCount}
                        size="small"
                        sx={{ height: 20, fontSize: '0.7rem', minWidth: 24 }}
                      />
                    )}
                    <IconButton
                      component="label"
                      size="small"
                      disabled={isEmptyLastRow}
                      sx={{ color: photoCount > 0 ? 'primary.main' : 'text.disabled' }}
                    >
                      <PhotoCamera sx={{ fontSize: 20 }} />
                      <input
                        type="file"
                        hidden
                        multiple
                        accept=".jpg,.jpeg,.png,.tiff,.tif,.bmp"
                        onChange={(e) => handlePhotoSelect(sighting.tempId, e)}
                      />
                    </IconButton>
                  </Box>
                )}

                <IconButton
                  size="small"
                  color="error"
                  onClick={() => removeSightingRow(sighting.tempId)}
                  disabled={sightings.length === 1}
                  sx={{
                    justifySelf: 'center',
                    opacity: isEmptyLastRow ? 0.3 : 1,
                    width: 36,
                    height: 36,
                  }}
                >
                    <Delete sx={{ fontSize: 20 }} />
                  </IconButton>
                </Box>

                {/* Life stage & behaviour matrix, full width beneath the row */}
                {recordsStageCounts(getSpeciesType(sighting.species_id)) && (
                  <Box sx={{ px: 1.5, pb: 2 }}>
                    <StageCountsFields
                      value={sighting}
                      adultTotal={sighting.count}
                      onChange={(key, next) => updateSighting(sighting.tempId, key, next)}
                    />
                  </Box>
                )}

                {/* Botanical frequency score, full width beneath the row */}
                {allowFrequencyScore && !isEmptyLastRow && (
                  <Box sx={{ px: 1.5, pb: 2 }}>
                    <FrequencyScoreFields
                      value={sighting}
                      onChange={(key, next) => updateSighting(sighting.tempId, key, next)}
                    />
                  </Box>
                )}

                {/* Photo preview strip */}
                {allowSightingPhotoUpload && (activeExistingIds.length > 0 || (sighting.pendingPhotos?.length || 0) > 0) && (
                  <Box sx={{ display: 'flex', gap: 0.5, px: 1.5, pb: 1, flexWrap: 'wrap' }}>
                    {activeExistingIds.map((imgId) => (
                      <Box key={`existing-${imgId}`} sx={{ position: 'relative' }}>
                        <ExistingPhotoThumbnail imageId={imgId} />
                        <IconButton
                          size="small"
                          onClick={() => handleRemoveExistingPhoto(sighting.tempId, imgId)}
                          sx={{
                            position: 'absolute',
                            top: -6,
                            right: -6,
                            bgcolor: 'error.main',
                            color: 'white',
                            width: 16,
                            height: 16,
                            '&:hover': { bgcolor: 'error.dark' },
                          }}
                        >
                          <Close sx={{ fontSize: 10 }} />
                        </IconButton>
                      </Box>
                    ))}
                    {(sighting.pendingPhotos || []).map((file, fileIdx) => (
                      <Box key={`pending-${fileIdx}`} sx={{ position: 'relative' }}>
                        <PendingPhotoThumbnail file={file} />
                        <IconButton
                          size="small"
                          onClick={() => handleRemovePendingPhoto(sighting.tempId, fileIdx)}
                          sx={{
                            position: 'absolute',
                            top: -6,
                            right: -6,
                            bgcolor: 'error.main',
                            color: 'white',
                            width: 16,
                            height: 16,
                            '&:hover': { bgcolor: 'error.dark' },
                          }}
                        >
                          <Close sx={{ fontSize: 10 }} />
                        </IconButton>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      ) : null;
      })()}

      {/* Location Modal */}
      <LocationModal
        open={locationModalOpen}
        onClose={handleLocationModalClose}
        onSave={handleLocationSave}
        initialIndividuals={locationEditingSighting?.individuals}
        speciesName={
          locationEditingSighting?.species_id
            ? getSpeciesDisplayName(locationEditingSighting.species_id)
            : undefined
        }
        speciesType={
          locationEditingSighting?.species_id
            ? getSpeciesType(locationEditingSighting.species_id)
            : undefined
        }
        breedingCodes={breedingCodes}
        count={locationEditingSighting?.count || 1}
        locationsWithBoundaries={locationsWithBoundaries}
        surveyLocationId={surveyLocationId}
        allowCoordinateEntry={allowCoordinateEntry}
      />

    </>
  );
}
