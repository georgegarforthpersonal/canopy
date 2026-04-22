import { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Autocomplete, Stack, Box, Typography, IconButton } from '@mui/material';
import { Close, PhotoCamera, CloudUpload } from '@mui/icons-material';
import type { Species, BreedingStatusCode, LocationWithBoundary, Location, Device } from '../../services/api';
import { imagesAPI } from '../../services/api';
import { getSpeciesIcon } from '../../config';
import MultiLocationMapPicker, { type DraftIndividualLocation } from './MultiLocationMapPicker';

export interface SightingData {
  species_id: number | null;
  count: number;
  individuals?: DraftIndividualLocation[];
  location_id?: number | null; // Location ID when location is at sighting level
  device_id?: number | null; // Device ID when sighting inherits location from a device
  notes?: string | null; // Optional notes for this sighting
  pendingPhotos?: File[];
  existingImageIds?: number[];
  removedImageIds?: number[];
}

interface AddSightingModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (sighting: SightingData) => void;
  species: Species[];
  breedingCodes?: BreedingStatusCode[];
  initialData?: SightingData;
  mode: 'add' | 'edit';
  locationsWithBoundaries?: LocationWithBoundary[]; // Optional locations with boundaries to display on the map
  // Survey type configuration
  locationAtSightingLevel?: boolean; // When true, show location dropdown
  locations?: Location[]; // Available locations for sighting-level selection
  allowGeolocation?: boolean; // Whether GPS location picker is shown
  allowSightingNotes?: boolean; // Whether notes field is shown
  allowSightingPhotoUpload?: boolean; // Whether photo upload is shown
  allowSightingDeviceSelection?: boolean; // When true, show device dropdown that supplies the sighting's location
  devices?: Device[]; // Available devices for sighting-level selection
  surveyLocationId?: number | null; // Survey-level location ID for initial map zoom
}

/**
 * AddSightingModal - Full-screen modal for adding/editing individual sightings
 *
 * Features:
 * - Full-screen on mobile for maximum autocomplete space
 * - Grouped species list with icons
 * - Simple two-field interface: species + count
 */
export function AddSightingModal({
  open,
  onClose,
  onSave,
  species,
  breedingCodes = [],
  initialData,
  mode,
  locationsWithBoundaries,
  locationAtSightingLevel = false,
  locations = [],
  allowGeolocation = true,
  allowSightingNotes = true,
  allowSightingPhotoUpload = false,
  allowSightingDeviceSelection = false,
  devices = [],
  surveyLocationId,
}: AddSightingModalProps) {
  const [selectedSpeciesId, setSelectedSpeciesId] = useState<number | null>(initialData?.species_id || null);
  const [count, setCount] = useState<number>(initialData?.count || 1);
  const [individuals, setIndividuals] = useState<DraftIndividualLocation[]>(
    initialData?.individuals || []
  );
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(
    initialData?.location_id || null
  );
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(
    initialData?.device_id || null
  );
  const [notes, setNotes] = useState<string>(initialData?.notes || '');
  const [pendingPhotos, setPendingPhotos] = useState<File[]>(initialData?.pendingPhotos || []);
  const [existingImageIds, setExistingImageIds] = useState<number[]>(initialData?.existingImageIds || []);
  const [removedImageIds, setRemovedImageIds] = useState<number[]>(initialData?.removedImageIds || []);
  const [existingImageUrls, setExistingImageUrls] = useState<Map<number, string>>(new Map());

  // Load preview URLs for existing images
  useEffect(() => {
    if (existingImageIds.length === 0) return;
    const loadUrls = async () => {
      const urls = new Map<number, string>();
      await Promise.all(
        existingImageIds.map(async (imgId) => {
          try {
            const res = await imagesAPI.getPreviewUrl(imgId);
            urls.set(imgId, res.preview_url);
          } catch { /* ignore */ }
        })
      );
      setExistingImageUrls(urls);
    };
    loadUrls();
  }, [existingImageIds]);

  // Check if selected species is a bird (for breeding status codes)
  const isBirdSpecies = useMemo(() => {
    const sp = species.find((s) => s.id === selectedSpeciesId);
    return sp?.type === 'bird';
  }, [selectedSpeciesId, species]);

  // Update local state when initialData changes (for edit mode)
  useEffect(() => {
    if (initialData) {
      setSelectedSpeciesId(initialData.species_id);
      setCount(initialData.count);
      setIndividuals(initialData.individuals || []);
      setSelectedLocationId(initialData.location_id || null);
      setSelectedDeviceId(initialData.device_id || null);
      setNotes(initialData.notes || '');
      setPendingPhotos(initialData.pendingPhotos || []);
      setExistingImageIds(initialData.existingImageIds || []);
      setRemovedImageIds(initialData.removedImageIds || []);
    } else {
      setSelectedSpeciesId(null);
      setCount(1);
      setIndividuals([]);
      setSelectedLocationId(null);
      setSelectedDeviceId(null);
      setNotes('');
      setPendingPhotos([]);
      setExistingImageIds([]);
      setRemovedImageIds([]);
    }
  }, [initialData, open]);

  // Sort species by type first, then by name within each type
  const sortedSpecies = [...species].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type.localeCompare(b.type);
    }
    const nameA = a.name || a.scientific_name || '';
    const nameB = b.name || b.scientific_name || '';
    return nameA.localeCompare(nameB);
  });

  // Format category name for display
  const formatCategoryName = (category: string): string => {
    return category.charAt(0).toUpperCase() + category.slice(1);
  };

  const handleSave = () => {
    if (selectedSpeciesId) {
      onSave({
        species_id: selectedSpeciesId,
        count: Math.max(1, count),
        individuals: individuals.length > 0 ? individuals : undefined,
        location_id: locationAtSightingLevel ? selectedLocationId : undefined,
        device_id: allowSightingDeviceSelection ? selectedDeviceId : undefined,
        notes: notes.trim() || null,
        pendingPhotos: pendingPhotos.length > 0 ? pendingPhotos : undefined,
        existingImageIds: existingImageIds.length > 0 ? existingImageIds : undefined,
        removedImageIds: removedImageIds.length > 0 ? removedImageIds : undefined,
      });
      // Reset for next entry
      setSelectedSpeciesId(null);
      setCount(1);
      setIndividuals([]);
      setSelectedLocationId(null);
      setSelectedDeviceId(null);
      setNotes('');
      setPendingPhotos([]);
      setExistingImageIds([]);
      setRemovedImageIds([]);
      onClose();
    }
  };

  const handleCancel = () => {
    // Reset form
    setSelectedSpeciesId(initialData?.species_id || null);
    setCount(initialData?.count || 1);
    setIndividuals(initialData?.individuals || []);
    setSelectedLocationId(initialData?.location_id || null);
    setSelectedDeviceId(initialData?.device_id || null);
    setNotes(initialData?.notes || '');
    setPendingPhotos(initialData?.pendingPhotos || []);
    setExistingImageIds(initialData?.existingImageIds || []);
    setRemovedImageIds(initialData?.removedImageIds || []);
    onClose();
  };

  const handlePhotoFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const validExtensions = ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp'];
    const validFiles = Array.from(files).filter((f) => {
      const ext = f.name.toLowerCase().substring(f.name.lastIndexOf('.'));
      return validExtensions.includes(ext);
    });
    if (validFiles.length > 0) {
      setPendingPhotos((prev) => [...prev, ...validFiles]);
    }
    event.target.value = '';
  };

  // Create and manage object URLs for pending photo previews to avoid memory leaks
  const pendingPhotoUrls = useRef<Map<File, string>>(new Map());
  const getPendingPhotoUrl = (file: File): string => {
    let url = pendingPhotoUrls.current.get(file);
    if (!url) {
      url = URL.createObjectURL(file);
      pendingPhotoUrls.current.set(file, url);
    }
    return url;
  };
  // Revoke URLs for files no longer in pendingPhotos
  useEffect(() => {
    const currentFiles = new Set(pendingPhotos);
    for (const [file, url] of pendingPhotoUrls.current) {
      if (!currentFiles.has(file)) {
        URL.revokeObjectURL(url);
        pendingPhotoUrls.current.delete(file);
      }
    }
  }, [pendingPhotos]);
  // Revoke all URLs on unmount
  useEffect(() => {
    return () => {
      for (const url of pendingPhotoUrls.current.values()) {
        URL.revokeObjectURL(url);
      }
      pendingPhotoUrls.current.clear();
    };
  }, []);

  const activeExistingIds = existingImageIds.filter((id) => !removedImageIds.includes(id));

  const selectedSpecies = species.find(s => s.id === selectedSpeciesId);
  const selectedLocation = locations.find(l => l.id === selectedLocationId);
  const selectedDevice = devices.find(d => d.id === selectedDeviceId);
  // Require location / device when their respective mode is on
  const canSave = selectedSpeciesId !== null && count > 0 &&
    (!locationAtSightingLevel || selectedLocationId !== null) &&
    (!allowSightingDeviceSelection || selectedDeviceId !== null);

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      fullScreen
      sx={{
        '& .MuiDialog-paper': {
          bgcolor: 'background.default',
        }
      }}
    >
      {/* Header */}
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid',
          borderColor: 'divider',
          py: 2,
          mb: 2,
        }}
      >
        <Typography variant="h6" fontWeight={600}>
          {mode === 'add' ? 'Add Sighting' : 'Edit Sighting'}
        </Typography>
        <IconButton onClick={handleCancel} edge="end">
          <Close />
        </IconButton>
      </DialogTitle>

      {/* Content */}
      <DialogContent sx={{ pt: 4, pb: 3, overflow: 'visible' }}>
        <Stack spacing={3}>
          {/* Species Autocomplete - Takes up most of the space */}
          <Box>
            <Autocomplete
              options={sortedSpecies}
              groupBy={(option) => formatCategoryName(option.type)}
              renderGroup={(params) => {
                const type = params.group.toLowerCase();
                const SpeciesIcon = getSpeciesIcon(type);

                return (
                  <li key={params.key}>
                    <Box sx={{ px: 2, py: 1.5, bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <SpeciesIcon sx={{ fontSize: '18px', color: 'text.secondary' }} />
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
              value={selectedSpecies || null}
              onChange={(_, newValue) => setSelectedSpeciesId(newValue?.id || null)}
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
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Species *"
                  InputLabelProps={{ ...params.InputLabelProps, shrink: true }}
                  autoFocus
                  sx={{
                    '& .MuiInputBase-input': {
                      fontSize: '16px',
                    }
                  }}
                />
              )}
              ListboxProps={{
                sx: {
                  maxHeight: { xs: '50vh', sm: '400px' },
                  '& .MuiAutocomplete-option': {
                    py: 1.5,
                    px: 2,
                    fontSize: '16px',
                  }
                }
              }}
            />
          </Box>

          {/* Count Input */}
          <TextField
            label="Count *"
            type="number"
            value={count || ''}
            onChange={(e) => {
              const val = e.target.value;
              setCount(val === '' ? 0 : Math.max(0, parseInt(val) || 0));
            }}
            onBlur={() => {
              if (count < 1) setCount(1);
            }}
            inputProps={{ min: 1 }}
            fullWidth
            sx={{
              '& .MuiInputBase-input': {
                fontSize: '16px',
              }
            }}
          />

          {/* Device Dropdown - when device selection is on */}
          {allowSightingDeviceSelection && (
            <Autocomplete
              options={devices}
              getOptionLabel={(d) => d.name}
              value={selectedDevice || null}
              onChange={(_, newValue) => setSelectedDeviceId(newValue?.id || null)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Device *"
                  placeholder="Select device"
                  sx={{
                    '& .MuiInputBase-input': {
                      fontSize: '16px',
                    }
                  }}
                />
              )}
              ListboxProps={{
                sx: {
                  maxHeight: { xs: '40vh', sm: '300px' },
                  '& .MuiAutocomplete-option': {
                    py: 1.5,
                    px: 2,
                    fontSize: '16px',
                  }
                }
              }}
            />
          )}

          {/* Location Dropdown - when location is at sighting level */}
          {!allowSightingDeviceSelection && locationAtSightingLevel && (
            <Autocomplete
              options={locations}
              getOptionLabel={(option) => option.name}
              value={selectedLocation || null}
              onChange={(_, newValue) => setSelectedLocationId(newValue?.id || null)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Location *"
                  placeholder="Select location"
                  sx={{
                    '& .MuiInputBase-input': {
                      fontSize: '16px',
                    }
                  }}
                />
              )}
              ListboxProps={{
                sx: {
                  maxHeight: { xs: '40vh', sm: '300px' },
                  '& .MuiAutocomplete-option': {
                    py: 1.5,
                    px: 2,
                    fontSize: '16px',
                  }
                }
              }}
            />
          )}

          {/* Individual GPS Locations - only show if geolocation is allowed */}
          {allowGeolocation && !allowSightingDeviceSelection && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>GPS Location (Optional)</Typography>
              <MultiLocationMapPicker
                locations={individuals}
                onChange={setIndividuals}
                breedingCodes={breedingCodes}
                showBreedingStatus={isBirdSpecies}
                maxCount={count}
                locationsWithBoundaries={locationsWithBoundaries}
                surveyLocationId={surveyLocationId}
              />
            </Box>
          )}

          {/* Notes Input */}
          {allowSightingNotes && (
            <TextField
              label="Notes (Optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              multiline
              minRows={2}
              maxRows={4}
              fullWidth
              placeholder="Add any notes about this sighting..."
              sx={{
                '& .MuiInputBase-input': {
                  fontSize: '16px',
                }
              }}
            />
          )}

          {/* Photo Upload */}
          {allowSightingPhotoUpload && (
            <Box>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="subtitle2">Photos (Optional)</Typography>
                <Button
                  component="label"
                  variant="outlined"
                  size="small"
                  startIcon={<CloudUpload />}
                  sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                  Add Photos
                  <input
                    type="file"
                    hidden
                    multiple
                    accept=".jpg,.jpeg,.png,.tiff,.tif,.bmp"
                    onChange={handlePhotoFileSelect}
                  />
                </Button>
              </Stack>

              {(activeExistingIds.length > 0 || pendingPhotos.length > 0) ? (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {activeExistingIds.map((imgId) => (
                    <Box key={`existing-${imgId}`} sx={{ position: 'relative' }}>
                      <Box
                        component="img"
                        src={existingImageUrls.get(imgId) || ''}
                        alt=""
                        sx={{
                          width: 72,
                          height: 54,
                          objectFit: 'cover',
                          borderRadius: 0.5,
                          bgcolor: 'grey.200',
                        }}
                      />
                      <IconButton
                        size="small"
                        onClick={() => setRemovedImageIds((prev) => [...prev, imgId])}
                        sx={{
                          position: 'absolute',
                          top: -6,
                          right: -6,
                          bgcolor: 'error.main',
                          color: 'white',
                          width: 18,
                          height: 18,
                          '&:hover': { bgcolor: 'error.dark' },
                        }}
                      >
                        <Close sx={{ fontSize: 12 }} />
                      </IconButton>
                    </Box>
                  ))}
                  {pendingPhotos.map((file, idx) => (
                    <Box key={`pending-${idx}`} sx={{ position: 'relative' }}>
                      <Box
                        component="img"
                        src={getPendingPhotoUrl(file)}
                        alt={file.name}
                        sx={{
                          width: 72,
                          height: 54,
                          objectFit: 'cover',
                          borderRadius: 0.5,
                        }}
                      />
                      <IconButton
                        size="small"
                        onClick={() => setPendingPhotos((prev) => prev.filter((_, i) => i !== idx))}
                        sx={{
                          position: 'absolute',
                          top: -6,
                          right: -6,
                          bgcolor: 'error.main',
                          color: 'white',
                          width: 18,
                          height: 18,
                          '&:hover': { bgcolor: 'error.dark' },
                        }}
                      >
                        <Close sx={{ fontSize: 12 }} />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Box sx={{ textAlign: 'center', py: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
                  <PhotoCamera sx={{ fontSize: 32, color: 'text.disabled', mb: 0.5 }} />
                  <Typography variant="body2" color="text.secondary">
                    No photos added yet
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </Stack>
      </DialogContent>

      {/* Actions */}
      <DialogActions
        sx={{
          borderTop: '1px solid',
          borderColor: 'divider',
          p: 2,
          gap: 1,
        }}
      >
        <Button
          onClick={handleCancel}
          variant="outlined"
          fullWidth
          sx={{
            textTransform: 'none',
            fontWeight: 600,
            fontSize: '16px',
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          fullWidth
          disabled={!canSave}
          sx={{
            textTransform: 'none',
            fontWeight: 600,
            fontSize: '16px',
          }}
        >
          {mode === 'add' ? 'Add' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
