/**
 * "Annual frequency" panel for a frequency-scored (botanical) group: the
 * annual sibling of SeasonalCountPanel, same chrome and species picker, with
 * a per-year percent-of-quadrats chart (one line per location) instead of
 * the Jan–Dec count chart. Appears when the survey type has
 * allow_frequency_score on. Every figure is scoped to this group's surveys.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  CircularProgress,
  MenuItem,
  Paper,
  TextField,
  Typography,
  createFilterOptions,
} from '@mui/material';
import { dashboardAPI, type SwardCompositionRow } from '../../services/api';
import { groupCardSx, groupColors } from '../../pages/groups/groupsTokens';
import AnnualFrequencyChart from '../dashboard/AnnualFrequencyChart';
import {
  annualLocationOptions,
  annualSpeciesOptions,
  buildAnnualSeries,
  type AnnualSpeciesOption,
} from './annualFrequencySeries';

/** Sentinel for the "all locations" option, which is the default view. */
const ALL_LOCATIONS = '__all__';

interface AnnualFrequencyPanelProps {
  /** The group's survey type — every figure comes from its surveys only. */
  surveyTypeId: number;
}

const CHART_HEIGHT = 240;

const filterSpecies = createFilterOptions<AnnualSpeciesOption>({
  stringify: (option) => option.name,
});

export default function AnnualFrequencyPanel({ surveyTypeId }: AnnualFrequencyPanelProps) {
  const [rows, setRows] = useState<SwardCompositionRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [locationKey, setLocationKey] = useState<string>(ALL_LOCATIONS);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setError(false);
    setRows(null);
    dashboardAPI
      .getSwardComposition(surveyTypeId)
      .then((response) => {
        if (!active) return;
        setRows(response.rows);
        setSelectedId(annualSpeciesOptions(response.rows)[0]?.id ?? null);
        setLocationKey(ALL_LOCATIONS);
      })
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [surveyTypeId]);

  const species = useMemo(() => annualSpeciesOptions(rows ?? []), [rows]);
  const selected = species.find((s) => s.id === selectedId) ?? null;
  const locations = useMemo(() => annualLocationOptions(rows ?? []), [rows]);
  // Pinning is by name: the "No location" bucket has no id but is still a
  // pickable series.
  const pinnedName = locationKey === ALL_LOCATIONS ? null : locationKey;
  const series = useMemo(
    () => (rows && selectedId != null ? buildAnnualSeries(rows, selectedId, pinnedName) : null),
    [rows, selectedId, pinnedName],
  );

  return (
    <Paper sx={groupCardSx}>
      <Box
        sx={{
          px: 2.25,
          py: 1.75,
          borderBottom: `1px solid ${groupColors.divider}`,
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'stretch', sm: 'center' },
          gap: 1.25,
        }}
      >
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: groupColors.textPrimary }} noWrap>
          Annual frequency
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.25, flexDirection: { xs: 'column', sm: 'row' }, width: { xs: '100%', sm: 'auto' } }}>
        {locations.length > 1 && (
          <TextField
            select
            size="small"
            label="Location"
            value={locationKey}
            onChange={(e) => setLocationKey(e.target.value)}
            sx={{ width: { xs: '100%', sm: 190 }, flexShrink: 0 }}
          >
            <MenuItem value={ALL_LOCATIONS}>All locations</MenuItem>
            {locations.map((l) => (
              <MenuItem key={l.name} value={l.name}>
                {l.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        {selected ? (
          <Autocomplete
            options={species}
            getOptionLabel={(option) => option.name}
            filterOptions={filterSpecies}
            renderOption={({ key, ...props }, option) => (
              <Box
                component="li"
                key={key}
                {...props}
                sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}
              >
                <span>{option.name}</span>
                <Typography component="span" sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                  {option.records.toLocaleString()}
                </Typography>
              </Box>
            )}
            value={selected}
            onChange={(_event, newValue) => setSelectedId(newValue.id)}
            renderInput={(params) => (
              <TextField {...params} label="Species" placeholder="Type to search..." size="small" />
            )}
            sx={{ width: { xs: '100%', sm: 220 }, flexShrink: 0 }}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            disableClearable
            openOnFocus
            selectOnFocus
            handleHomeEndKeys
            blurOnSelect
            autoHighlight
          />
        ) : null}
        </Box>
      </Box>

      <Box sx={{ p: 2.25 }}>
        {error ? (
          <CenteredMessage>Failed to load frequencies.</CenteredMessage>
        ) : rows !== null && species.length === 0 ? (
          <CenteredMessage>No frequency-scored surveys yet.</CenteredMessage>
        ) : rows === null ? (
          <Box sx={{ height: CHART_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <AnnualFrequencyChart
            series={series}
            height={CHART_HEIGHT}
            emptyMessage={
              pinnedName !== null
                ? `${selected?.name ?? 'This species'} was not recorded at this location.`
                : 'No frequency-scored surveys yet.'
            }
          />
        )}
      </Box>
    </Paper>
  );
}

function CenteredMessage({ children }: { children: string }) {
  return (
    <Typography sx={{ fontSize: 13.5, color: groupColors.textMuted, px: 2.25, py: 3, textAlign: 'center' }}>
      {children}
    </Typography>
  );
}
