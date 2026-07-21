import { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  TextField,
  Autocomplete,
  IconButton,
  Button,
  Stack,
  Chip,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';

import type { Species, BreedingStatusCode, BreedingCategory } from '../../services/api';
import type { MapMarker } from './mapModeUtils';
import type { DraftIndividualLocation } from './MultiLocationMapPicker';
import { getSpeciesIcon } from '../../config';
import { CATEGORY_COLORS, CATEGORY_LABELS } from './breedingConstants';

interface MarkerPopupContentAddProps {
  mode: 'add';
  species: Species[];
  breedingCodes: BreedingStatusCode[];
  onAdd: (speciesId: number, count: number, breedingStatusCode?: string | null) => void;
  onDiscard: () => void;
  marker?: undefined;
  onUpdate?: undefined;
  onDelete?: undefined;
}

interface MarkerPopupContentEditProps {
  mode: 'edit';
  species: Species[];
  breedingCodes: BreedingStatusCode[];
  marker: MapMarker;
  onUpdate: (updates: Partial<Pick<DraftIndividualLocation, 'count' | 'breeding_status_code'>>) => void;
  onDelete: () => void;
  onAdd?: undefined;
}

interface MarkerPopupContentViewProps {
  mode: 'view';
  species: Species[];
  breedingCodes: BreedingStatusCode[];
  marker: MapMarker;
  onAdd?: undefined;
  onDiscard?: undefined;
  onUpdate?: undefined;
  onDelete?: undefined;
}

type MarkerPopupContentProps = MarkerPopupContentAddProps | MarkerPopupContentEditProps | MarkerPopupContentViewProps;

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

function stopPropagation(e: React.SyntheticEvent) {
  e.stopPropagation();
}

export function MarkerPopupContent(props: MarkerPopupContentProps) {
  const { mode, species, breedingCodes } = props;

  // Sort species by type then name
  const sortedSpecies = useMemo(() => {
    return [...species].sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      const nameA = a.name || a.scientific_name || '';
      const nameB = b.name || b.scientific_name || '';
      return nameA.localeCompare(nameB);
    });
  }, [species]);

  const formatCategoryName = (category: string): string => {
    return category.charAt(0).toUpperCase() + category.slice(1);
  };

  if (mode === 'add') {
    return (
      <AddPopupForm
        species={species}
        sortedSpecies={sortedSpecies}
        breedingCodes={breedingCodes}
        onAdd={props.onAdd}
        onDiscard={props.onDiscard}
        formatCategoryName={formatCategoryName}
      />
    );
  }

  if (mode === 'view') {
    return (
      <ViewPopupContent
        species={species}
        breedingCodes={breedingCodes}
        marker={props.marker}
      />
    );
  }

  return (
    <EditPopupForm
      species={species}
      breedingCodes={breedingCodes}
      marker={props.marker}
      onUpdate={props.onUpdate}
      onDelete={props.onDelete}
    />
  );
}

// Add form for pending markers
function AddPopupForm({
  species: _species,
  sortedSpecies,
  breedingCodes,
  onAdd,
  onDiscard,
  formatCategoryName,
}: {
  species: Species[];
  sortedSpecies: Species[];
  breedingCodes: BreedingStatusCode[];
  onAdd: (speciesId: number, count: number, breedingStatusCode?: string | null) => void;
  onDiscard: () => void;
  formatCategoryName: (category: string) => string;
}) {
  // Fixed-species survey types offer exactly one species: it is preselected
  // and shown as static text instead of the selector.
  const singleSpecies = sortedSpecies.length === 1 ? sortedSpecies[0] : null;

  const [selectedSpecies, setSelectedSpecies] = useState<Species | null>(singleSpecies);
  const [count, setCount] = useState(1);
  const [breedingStatus, setBreedingStatus] = useState<string | null>(null);

  const isBird = selectedSpecies?.type === 'bird';
  const groupedCodes = useMemo(() => groupBreedingCodes(breedingCodes), [breedingCodes]);

  const handleAdd = () => {
    if (!selectedSpecies) return;
    onAdd(selectedSpecies.id, count, breedingStatus);
    // Reset form
    setSelectedSpecies(singleSpecies);
    setCount(1);
    setBreedingStatus(null);
  };

  return (
    <Box
      onMouseDown={stopPropagation}
      onClick={stopPropagation}
      onDoubleClick={stopPropagation}
      onWheel={stopPropagation}
      sx={{ minWidth: 'min(240px, calc(100vw - 112px))', p: 0.5 }}
    >
      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
        Add Sighting
      </Typography>

      <Stack spacing={1.5}>
        {singleSpecies ? (
          <Typography variant="body2" fontWeight={600}>
            {singleSpecies.name || singleSpecies.scientific_name}
            {singleSpecies.name && singleSpecies.scientific_name && (
              <i style={{ color: '#666', marginLeft: '0.3rem', fontWeight: 400 }}>{singleSpecies.scientific_name}</i>
            )}
          </Typography>
        ) : (
        <Autocomplete
          options={sortedSpecies}
          groupBy={(option) => formatCategoryName(option.type)}
          renderGroup={(params) => {
            const type = params.group.toLowerCase();
            const SpeciesIcon = getSpeciesIcon(type);
            return (
              <li key={params.key}>
                <Box sx={{ px: 1.5, py: 0.5, bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <SpeciesIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="caption" fontWeight={600} color="text.secondary">
                      {params.group}
                    </Typography>
                  </Stack>
                </Box>
                <ul style={{ padding: 0, margin: 0 }}>{params.children}</ul>
              </li>
            );
          }}
          getOptionLabel={(option) => {
            if (option.name) return `${option.name} ${option.scientific_name || ''}`.trim();
            return option.scientific_name || '';
          }}
          value={selectedSpecies}
          onChange={(_, newValue) => {
            setSelectedSpecies(newValue);
            if (newValue?.type !== 'bird') setBreedingStatus(null);
          }}
          renderOption={(props, option) => (
            <li {...props}>
              <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                {option.name ? (
                  <>
                    {option.name}
                    {option.scientific_name && (
                      <i style={{ color: '#666', marginLeft: '0.3rem', fontSize: '0.75rem' }}>{option.scientific_name}</i>
                    )}
                  </>
                ) : (
                  <i style={{ color: '#666' }}>{option.scientific_name}</i>
                )}
              </Typography>
            </li>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="Select species..."
              size="small"
              sx={{
                '& .MuiInputBase-input': { fontSize: '0.8rem' },
              }}
            />
          )}
          size="small"
          disablePortal
          slotProps={{
            listbox: { sx: { maxHeight: '200px' } },
          }}
        />
        )}

        <TextField
          type="number"
          label="Count"
          value={count || ''}
          onChange={(e) => {
            const val = e.target.value;
            setCount(val === '' ? 0 : Math.max(0, parseInt(val) || 0));
          }}
          onBlur={() => { if (count < 1) setCount(1); }}
          size="small"
          inputProps={{ min: 1 }}
          sx={{
            width: 100,
            '& .MuiInputBase-input': { fontSize: '0.8rem' },
          }}
        />

        {isBird && (
          <BreedingStatusField
            value={breedingStatus}
            onChange={setBreedingStatus}
            breedingCodes={breedingCodes}
            groupedCodes={groupedCodes}
          />
        )}

        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            size="small"
            onClick={handleAdd}
            disabled={!selectedSpecies}
            sx={{ textTransform: 'none', fontWeight: 600, flex: 1 }}
          >
            Add
          </Button>
          <Button
            variant="outlined"
            size="small"
            color="error"
            onClick={onDiscard}
            sx={{ textTransform: 'none', fontWeight: 600, flex: 1 }}
          >
            Discard
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}

// Edit form for existing markers
function EditPopupForm({
  species,
  breedingCodes,
  marker,
  onUpdate,
  onDelete,
}: {
  species: Species[];
  breedingCodes: BreedingStatusCode[];
  marker: MapMarker;
  onUpdate: (updates: Partial<Pick<DraftIndividualLocation, 'count' | 'breeding_status_code'>>) => void;
  onDelete: () => void;
}) {
  const sp = species.find((s) => s.id === marker.species_id);
  const speciesName = sp?.name || sp?.scientific_name || 'Unknown';
  const isBird = sp?.type === 'bird';
  const groupedCodes = useMemo(() => groupBreedingCodes(breedingCodes), [breedingCodes]);
  const SpeciesIcon = getSpeciesIcon(sp?.type || 'insect');

  return (
    <Box
      onMouseDown={stopPropagation}
      onClick={stopPropagation}
      onDoubleClick={stopPropagation}
      onWheel={stopPropagation}
      sx={{ minWidth: 'min(240px, calc(100vw - 112px))', p: 0.5 }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <SpeciesIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          <Typography variant="subtitle2" fontWeight={600} sx={{ fontSize: '0.85rem' }}>
            {speciesName}
          </Typography>
        </Stack>
        <IconButton size="small" onClick={onDelete} sx={{ color: 'error.main' }}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Stack spacing={1.5}>
        <Typography variant="caption" color="text.secondary">
          {marker.latitude.toFixed(6)}, {marker.longitude.toFixed(6)}
        </Typography>

        <TextField
          type="number"
          label="Count"
          value={marker.count || ''}
          onChange={(e) => {
            const val = e.target.value;
            const newCount = val === '' ? 0 : Math.max(0, parseInt(val) || 0);
            onUpdate({ count: newCount });
          }}
          onBlur={() => {
            if (marker.count < 1) onUpdate({ count: 1 });
          }}
          size="small"
          inputProps={{ min: 1 }}
          sx={{
            width: 100,
            '& .MuiInputBase-input': { fontSize: '0.8rem' },
          }}
        />

        {isBird && (
          <BreedingStatusField
            value={marker.breeding_status_code ?? null}
            onChange={(code) => onUpdate({ breeding_status_code: code })}
            breedingCodes={breedingCodes}
            groupedCodes={groupedCodes}
          />
        )}
      </Stack>
    </Box>
  );
}

// View-only display for markers (read-only mode)
function ViewPopupContent({
  species,
  breedingCodes,
  marker,
}: {
  species: Species[];
  breedingCodes: BreedingStatusCode[];
  marker: MapMarker;
}) {
  const sp = species.find((s) => s.id === marker.species_id);
  const scientificName = sp?.scientific_name;
  const isBird = sp?.type === 'bird';
  const SpeciesIcon = getSpeciesIcon(sp?.type || 'insect');

  // Get breeding status display
  const breedingCode = marker.breeding_status_code
    ? breedingCodes.find((c) => c.code === marker.breeding_status_code)
    : null;

  return (
    <Box
      onMouseDown={stopPropagation}
      onClick={stopPropagation}
      onDoubleClick={stopPropagation}
      onWheel={stopPropagation}
      sx={{ minWidth: 'min(200px, calc(100vw - 112px))', p: 0.5 }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <SpeciesIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
        <Box>
          <Typography variant="subtitle2" fontWeight={600} sx={{ fontSize: '0.85rem' }}>
            {sp?.name || scientificName || 'Unknown'}
          </Typography>
          {sp?.name && scientificName && (
            <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              {scientificName}
            </Typography>
          )}
        </Box>
      </Stack>

      <Stack spacing={0.75}>
        <Typography variant="caption" color="text.secondary">
          {marker.latitude.toFixed(6)}, {marker.longitude.toFixed(6)}
        </Typography>

        <Typography variant="body2">
          Count: <strong>{marker.count}</strong>
        </Typography>

        {isBird && breedingCode && (
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography variant="body2">Breeding:</Typography>
            <Chip
              label={breedingCode.code}
              size="small"
              sx={{
                bgcolor: CATEGORY_COLORS[breedingCode.category],
                color: 'white',
                fontWeight: 600,
                height: 18,
                minWidth: 24,
                '& .MuiChip-label': { px: 0.5, fontSize: '0.7rem' },
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {breedingCode.description}
            </Typography>
          </Stack>
        )}
      </Stack>
    </Box>
  );
}

// Grouped popup content for multiple species at same location
interface GroupedMarkerPopupContentProps {
  markers: MapMarker[];
  species: Species[];
  breedingCodes: BreedingStatusCode[];
  readOnly?: boolean;
  onUpdate?: (sightingTempId: string, individualTempId: string, updates: Partial<Pick<DraftIndividualLocation, 'count' | 'breeding_status_code'>>) => void;
  onDelete?: (sightingTempId: string, individualTempId: string) => void;
}

export function GroupedMarkerPopupContent({
  markers,
  species,
  breedingCodes,
  readOnly = false,
  onUpdate: _onUpdate,
  onDelete,
}: GroupedMarkerPopupContentProps) {
  // Sort markers by species name for consistent display
  const sortedMarkers = [...markers].sort((a, b) => {
    const spA = species.find((s) => s.id === a.species_id);
    const spB = species.find((s) => s.id === b.species_id);
    const nameA = spA?.name || spA?.scientific_name || '';
    const nameB = spB?.name || spB?.scientific_name || '';
    return nameA.localeCompare(nameB);
  });

  const firstMarker = sortedMarkers[0];
  const totalCount = markers.reduce((sum, m) => sum + m.count, 0);

  return (
    <Box
      onMouseDown={stopPropagation}
      onClick={stopPropagation}
      onDoubleClick={stopPropagation}
      onWheel={stopPropagation}
      sx={{ minWidth: 'min(240px, calc(100vw - 112px))', p: 0.5 }}
    >
      {/* Header with location and total */}
      <Stack spacing={0.5} sx={{ mb: 1.5, pb: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle2" fontWeight={600}>
          {markers.length} species at this location
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {firstMarker.latitude.toFixed(6)}, {firstMarker.longitude.toFixed(6)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Total count: {totalCount}
        </Typography>
      </Stack>

      {/* Scrollable list of species */}
      <Box sx={{ maxHeight: 250, overflowY: 'auto', mr: -0.5, pr: 0.5 }}>
        <Stack spacing={1}>
          {sortedMarkers.map((marker) => {
            const sp = species.find((s) => s.id === marker.species_id);
            const SpeciesIcon = getSpeciesIcon(sp?.type || 'insect');
            const breedingCode = marker.breeding_status_code
              ? breedingCodes.find((c) => c.code === marker.breeding_status_code)
              : null;

            return (
              <Box
                key={marker.individualTempId}
                sx={{
                  p: 1,
                  bgcolor: 'grey.50',
                  borderRadius: 1,
                  '&:hover': { bgcolor: 'grey.100' },
                }}
              >
                <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
                  <Stack direction="row" alignItems="center" spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
                    <SpeciesIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        variant="body2"
                        fontWeight={600}
                        sx={{ fontSize: '0.8rem', lineHeight: 1.3 }}
                        noWrap
                      >
                        {sp?.name || sp?.scientific_name || 'Unknown'}
                      </Typography>
                      {sp?.name && sp?.scientific_name && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontStyle: 'italic', fontSize: '0.7rem' }}
                          noWrap
                        >
                          {sp.scientific_name}
                        </Typography>
                      )}
                    </Box>
                  </Stack>

                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <Chip
                      label={marker.count}
                      size="small"
                      sx={{
                        height: 20,
                        minWidth: 24,
                        bgcolor: 'primary.main',
                        color: 'white',
                        fontWeight: 600,
                        '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' },
                      }}
                    />
                    {!readOnly && onDelete && (
                      <IconButton
                        size="small"
                        onClick={() => onDelete(marker.sightingTempId, marker.individualTempId)}
                        sx={{ color: 'error.main', p: 0.25 }}
                      >
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    )}
                  </Stack>
                </Stack>

                {/* Breeding status if present */}
                {breedingCode && (
                  <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.5, ml: 2.75 }}>
                    <Chip
                      label={breedingCode.code}
                      size="small"
                      sx={{
                        bgcolor: CATEGORY_COLORS[breedingCode.category],
                        color: 'white',
                        fontWeight: 600,
                        height: 16,
                        minWidth: 20,
                        '& .MuiChip-label': { px: 0.5, fontSize: '0.65rem' },
                      }}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                      {breedingCode.description}
                    </Typography>
                  </Stack>
                )}
              </Box>
            );
          })}
        </Stack>
      </Box>
    </Box>
  );
}

// Shared breeding status select field
function BreedingStatusField({
  value,
  onChange,
  breedingCodes,
}: {
  value: string | null;
  onChange: (code: string | null) => void;
  breedingCodes: BreedingStatusCode[];
  groupedCodes: Record<BreedingCategory, BreedingStatusCode[]>;
}) {
  const selectedCode = value ? breedingCodes.find((c) => c.code === value) || null : null;

  return (
    <Autocomplete
      options={breedingCodes}
      groupBy={(option) => CATEGORY_LABELS[option.category]}
      getOptionLabel={(option) => `${option.code} - ${option.description}`}
      value={selectedCode}
      onChange={(_, newValue) => onChange(newValue?.code || null)}
      isOptionEqualToValue={(option, val) => option.code === val.code}
      renderGroup={(params) => (
        <li key={params.key}>
          <Box
            sx={{
              px: 1.5,
              py: 0.5,
              bgcolor: CATEGORY_COLORS[breedingCodes.find((c) => CATEGORY_LABELS[c.category] === params.group)?.category || 'non_breeding'],
              color: 'white',
              fontWeight: 600,
              fontSize: '0.75rem',
            }}
          >
            {params.group}
          </Box>
          <ul style={{ padding: 0, margin: 0 }}>{params.children}</ul>
        </li>
      )}
      renderOption={(props, option) => (
        <li {...props}>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Chip
              label={option.code}
              size="small"
              sx={{
                bgcolor: CATEGORY_COLORS[option.category],
                color: 'white',
                fontWeight: 600,
                height: 18,
                minWidth: 24,
                '& .MuiChip-label': { px: 0.5, fontSize: '0.7rem' },
              }}
            />
            <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
              {option.description}
            </Typography>
          </Stack>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Breeding Status"
          placeholder="Not set"
          size="small"
          sx={{
            '& .MuiInputBase-input': { fontSize: '0.8rem' },
          }}
        />
      )}
      size="small"
      disablePortal
      slotProps={{
        listbox: { sx: { maxHeight: '200px' } },
      }}
    />
  );
}
