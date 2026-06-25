/**
 * "Species abundance" panel for a space: a compact species picker over the
 * shared per-survey occurrence bar chart (rendered in brand green). The picker
 * is space-specific; the chart is the same component the Dashboards page uses.
 */
import { useEffect, useState } from 'react';
import { Box, Paper, Typography, Button, Menu, MenuItem } from '@mui/material';
import { ArrowDropDown } from '@mui/icons-material';
import { dashboardAPI, type SpeciesWithCount } from '../../services/api';
import SpeciesOccurrenceChart from '../dashboard/SpeciesOccurrenceChart';
import { spaceCardSx, spaceColors } from '../../pages/spaces/spacesTokens';

interface SpeciesAbundanceChartProps {
  speciesType: string;
}

export default function SpeciesAbundanceChart({ speciesType }: SpeciesAbundanceChartProps) {
  const [species, setSpecies] = useState<SpeciesWithCount[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadingSpecies, setLoadingSpecies] = useState(true);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  useEffect(() => {
    let active = true;
    setLoadingSpecies(true);
    dashboardAPI
      .getSpeciesByCount(speciesType)
      .then((list) => {
        if (!active) return;
        setSpecies(list);
        setSelectedId(list[0]?.id ?? null);
      })
      .catch(() => active && setSpecies([]))
      .finally(() => active && setLoadingSpecies(false));
    return () => {
      active = false;
    };
  }, [speciesType]);

  const selected = species.find((s) => s.id === selectedId) ?? null;

  return (
    <Paper sx={{ ...spaceCardSx, p: 2.25 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.4px', color: '#999', mt: 0.5 }}>
          SPECIES ABUNDANCE
        </Typography>
        <Button
          onClick={(e) => setAnchorEl(e.currentTarget)}
          disabled={loadingSpecies || species.length === 0}
          endIcon={<ArrowDropDown />}
          sx={{
            textTransform: 'none',
            border: `1px solid ${spaceColors.divider}`,
            borderRadius: '7px',
            px: 1.25,
            py: 0.5,
            color: spaceColors.textPrimary,
            minWidth: 0,
            maxWidth: 220,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: spaceColors.brandLight, flexShrink: 0 }} />
            <Typography sx={{ fontSize: 12.5, fontWeight: 600 }} noWrap>
              {selected?.name ?? '—'}
            </Typography>
            {selected && (
              <Typography sx={{ fontSize: 12, color: spaceColors.textMuted, flexShrink: 0 }}>
                {selected.total_count.toLocaleString()}
              </Typography>
            )}
          </Box>
        </Button>
        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
          {species.map((s) => (
            <MenuItem
              key={s.id}
              selected={s.id === selectedId}
              onClick={() => {
                setSelectedId(s.id);
                setAnchorEl(null);
              }}
              sx={{ fontSize: 13 }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 2 }}>
                <span>{s.name}</span>
                <Box component="span" sx={{ color: spaceColors.textMuted }}>
                  {s.total_count.toLocaleString()}
                </Box>
              </Box>
            </MenuItem>
          ))}
        </Menu>
      </Box>

      <Box sx={{ mt: 1.5 }}>
        <SpeciesOccurrenceChart
          speciesId={selectedId}
          color={spaceColors.brandLight}
          height={112}
          emptyMessage="No data yet"
          placeholderMessage="No data yet"
        />
      </Box>
    </Paper>
  );
}
