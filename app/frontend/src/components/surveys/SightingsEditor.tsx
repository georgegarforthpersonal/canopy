import { useState, useMemo, useEffect } from 'react';
import { Box, Typography, TextField, Autocomplete, IconButton, Alert, Stack, Card, CardContent, Button, Chip, Tooltip, ToggleButtonGroup, ToggleButton } from '@mui/material';
import { Delete, Edit, Add, LocationOnOutlined, PinDrop, StickyNote2Outlined, ViewList, Map as MapIcon, PhotoCamera, Close } from '@mui/icons-material';
import type { Species, BreedingStatusCode, LocationWithBoundary, Location, CameraTrapImage } from '../../services/api';
import { imagesAPI } from '../../services/api';
import { AddSightingModal } from './AddSightingModal';
import type { SightingData } from './AddSightingModal';
import { LocationModal } from './LocationModal';
import { MapModeSightings } from './MapModeSightings';
import { getSpeciesIcon } from '../../config';
import { useResponsive } from '../../hooks/useResponsive';
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

export interface DraftSighting {
  tempId: string;
  species_id: number | null;
  count: number;
  id?: number;
  // Per-individual location points with breeding status
  individuals?: DraftIndividualLocation[];
  // Location ID when location is at sighting level
  location_id?: number | null;
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
  allowSightingNotes?: boolean; // Whether notes can be entered for individual sightings
  allowSightingPhotoUpload?: boolean; // Whether photos can be attached to individual sightings
  surveyLocationId?: number | null; // Survey-level location ID for initial map zoom
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
  allowSightingNotes = true,
  allowSightingPhotoUpload = false,
  surveyLocationId,
}: SightingsEditorProps) {
  const { isMobile } = useResponsive();

  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTempId, setEditingTempId] = useState<string | null>(null);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [locationEditingTempId, setLocationEditingTempId] = useState<string | null>(null);

  // Sort species by type first, then by name within each type
  const sortedSpecies = useMemo(() => {
    return [...species].sort((a, b) => {
      if (a.type !== b.type) {
        return a.type.localeCompare(b.type);
      }
      const nameA = a.name || a.scientific_name || '';
      const nameB = b.name || b.scientific_name || '';
      return nameA.localeCompare(nameB);
    });
  }, [species]);

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
              notes: sightingData.notes,
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
          notes: sightingData.notes,
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
        species_id: null,
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

    const updatedSightings = sightings.map((s) =>
      s.tempId === tempId ? { ...s, [field]: value } : s
    );

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
    return loc?.name || '';
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

  const viewModeToggle = allowGeolocation ? (
    <ToggleButtonGroup
      value={viewMode}
      exclusive
      onChange={(_, newValue) => newValue && setViewMode(newValue)}
      size="small"
      sx={{ height: 32 }}
    >
      <ToggleButton value="list" aria-label="list mode">
        <Tooltip title="List Mode">
          <ViewList fontSize="small" />
        </Tooltip>
      </ToggleButton>
      <ToggleButton value="map" aria-label="map mode">
        <Tooltip title="Map Mode">
          <MapIcon fontSize="small" />
        </Tooltip>
      </ToggleButton>
    </ToggleButtonGroup>
  ) : null;

  // Map mode UI (shared between mobile and desktop)
  if (viewMode === 'map' && allowGeolocation) {
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
          species={species}
          breedingCodes={breedingCodes}
          onSightingsChange={onSightingsChange}
          locationsWithBoundaries={locationsWithBoundaries}
          surveyLocationId={surveyLocationId}
        />
      </>
    );
  }

  // Mobile UI: Cards + Modal
  if (isMobile) {
    return (
      <>
        <Box sx={{ mb: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Sightings ({validSightings.length})
              </Typography>
              {viewModeToggle}
            </Stack>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={handleAddClick}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                boxShadow: 'none',
                '&:hover': { boxShadow: 'none' }
              }}
            >
              Add Sighting
            </Button>
          </Stack>

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
                              label={`Count: ${sighting.count}`}
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
                No sightings added yet. Click "Add Sighting" to get started.
              </Typography>
            </Box>
          )}
        </Box>

        <AddSightingModal
          open={modalOpen}
          onClose={handleModalClose}
          onSave={handleModalSave}
          species={species}
          breedingCodes={breedingCodes}
          initialData={
            editingSighting
              ? {
                  species_id: editingSighting.species_id,
                  count: editingSighting.count,
                  individuals: editingSighting.individuals,
                  location_id: editingSighting.location_id,
                  notes: editingSighting.notes,
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
          allowSightingNotes={allowSightingNotes}
          allowSightingPhotoUpload={allowSightingPhotoUpload}
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
        // Build grid columns dynamically: Species, [Location], [GPS/Spacer], Count, [Notes], Delete
        const getGridColumns = () => {
          const cols: string[] = [];

          // Species column - flexible
          cols.push(locationAtSightingLevel ? '2fr' : '2.5fr');

          // Location column (if at sighting level)
          if (locationAtSightingLevel) {
            cols.push('1.2fr');
          }

          // GPS column (if allowed) or spacer (if no location and no GPS)
          if (allowGeolocation) {
            cols.push('70px');
          } else if (!locationAtSightingLevel) {
            cols.push('70px'); // spacer
          }

          // Count column - fixed small width
          cols.push('60px');

          // Notes column (if allowed) - flexible
          if (allowSightingNotes) {
            cols.push('2fr');
          }

          // Photos column (if sighting photo upload is allowed)
          if (allowSightingPhotoUpload) {
            cols.push('80px');
          }

          // Delete button - fixed small width
          cols.push('40px');

          return cols.join(' ');
        };
        const gridColumns = getGridColumns();

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
            {locationAtSightingLevel && (
              <Typography variant="body2" fontWeight={600} color="text.secondary">
                LOCATION *
              </Typography>
            )}
            {allowGeolocation && (
              <Typography variant="body2" fontWeight={600} color="text.secondary" textAlign="center">
                GPS
              </Typography>
            )}
            {!allowGeolocation && !locationAtSightingLevel && (
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

                {/* Location Dropdown Column - when location is at sighting level */}
                {locationAtSightingLevel && (
                  <Autocomplete
                    options={locations}
                    getOptionLabel={(option) => option.name}
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
                {allowGeolocation && (
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
                {!allowGeolocation && !locationAtSightingLevel && (
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
                    if (sighting.count < 1) {
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
                      <Box
                        component="img"
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                        sx={{ width: 48, height: 36, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }}
                      />
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
      />

    </>
  );
}
