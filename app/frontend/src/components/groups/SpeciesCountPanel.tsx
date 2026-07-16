/**
 * "Species count" panel for a group: a headline count with a Chart/List
 * toggle (same control as the Locations & devices panel's Map/List). Chart is the shared all-time cumulative-species area chart;
 * List is every species identified with its occurrence count and the date
 * it was first observed, newest discovery first.
 */
import { useEffect, useState } from 'react';
import { Box, Paper, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { BarChart as ChartIcon, ViewList } from '@mui/icons-material';
import dayjs from 'dayjs';
import { dashboardAPI, type SpeciesWithCount } from '../../services/api';
import CumulativeSpeciesChart, { type CumulativeSummary } from '../dashboard/CumulativeSpeciesChart';
import { groupCardSx, groupColors } from '../../pages/groups/groupsTokens';

interface SpeciesCountPanelProps {
  speciesType: string;
}

const headerCellSx = {
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
  color: groupColors.textMuted,
} as const;

const listGridSx = {
  display: 'grid',
  gridTemplateColumns: '1fr 64px 96px',
  gap: 1,
  px: 2.25,
} as const;

export default function SpeciesCountPanel({ speciesType }: SpeciesCountPanelProps) {
  const [summary, setSummary] = useState<CumulativeSummary>({ total: 0 });
  const [view, setView] = useState<'chart' | 'list'>('chart');
  const [species, setSpecies] = useState<SpeciesWithCount[] | null>(null);

  // Fetch the per-species breakdown the first time the list is shown.
  useEffect(() => {
    if (view !== 'list' || species !== null) return;
    let active = true;
    dashboardAPI
      .getSpeciesByCount(speciesType)
      .then((rows) => {
        if (!active) return;
        // Newest discovery first; species with no date (shouldn't happen for
        // recorded species) sink to the bottom.
        setSpecies(
          [...rows].sort((a, b) =>
            (b.first_observed ?? '').localeCompare(a.first_observed ?? ''),
          ),
        );
      })
      .catch(() => active && setSpecies([]));
    return () => {
      active = false;
    };
  }, [view, species, speciesType]);

  return (
    <Paper sx={groupCardSx}>
      <Box
        sx={{
          px: 2.25,
          py: 1.75,
          borderBottom: `1px solid ${groupColors.divider}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 600, color: groupColors.textPrimary }}>
            Species count
          </Typography>
          <Typography sx={{ fontSize: 20, fontWeight: 700, color: groupColors.textPrimary, lineHeight: 1 }}>
            {summary.total}
          </Typography>
        </Box>
        <ToggleButtonGroup
          value={view}
          exclusive
          size="small"
          onChange={(_, v) => v && setView(v)}
          sx={{
            bgcolor: '#f1f3f1',
            borderRadius: '7px',
            p: '3px',
            flexShrink: 0,
            '& .MuiToggleButton-root': {
              border: 'none',
              borderRadius: '5px !important',
              px: 1.25,
              py: 0.4,
              color: '#8a8a8a',
              textTransform: 'none',
              fontSize: 12.5,
              gap: 0.5,
            },
            '& .Mui-selected': {
              bgcolor: '#fff !important',
              color: `${groupColors.textPrimary} !important`,
              boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
            },
          }}
        >
          <ToggleButton value="chart">
            <ChartIcon sx={{ fontSize: 15 }} /> Chart
          </ToggleButton>
          <ToggleButton value="list">
            <ViewList sx={{ fontSize: 15 }} /> List
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* The chart stays mounted (hidden) while the list is shown so its
          summary keeps feeding the headline count. */}
      <Box sx={{ p: 2.25, display: view === 'chart' ? 'block' : 'none' }}>
        <CumulativeSpeciesChart
          speciesType={speciesType}
          color={groupColors.brand}
          height={240}
          emptyMessage="No data yet"
          onSummary={setSummary}
        />
      </Box>

      {view === 'list' && (
        <Box>
          {species === null ? (
            <Typography sx={{ fontSize: 13.5, color: groupColors.textMuted, px: 2.25, py: 3 }}>
              Loading…
            </Typography>
          ) : species.length === 0 ? (
            <Typography sx={{ fontSize: 13.5, color: groupColors.textMuted, px: 2.25, py: 3 }}>
              No species recorded yet.
            </Typography>
          ) : (
            <>
              <Box sx={{ ...listGridSx, py: 1 }}>
                <Typography sx={headerCellSx}>Species</Typography>
                <Typography sx={{ ...headerCellSx, textAlign: 'right' }}>Count</Typography>
                <Typography sx={{ ...headerCellSx, textAlign: 'right' }}>First seen</Typography>
              </Box>
              <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
                {species.map((s) => (
                  <Box
                    key={s.id}
                    sx={{
                      ...listGridSx,
                      alignItems: 'center',
                      py: 0.9,
                      borderTop: `1px solid ${groupColors.dividerInner}`,
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: 13.5, color: groupColors.textPrimary }} noWrap>
                        {s.name ?? s.scientific_name ?? 'Unknown'}
                      </Typography>
                      {s.name && s.scientific_name && (
                        <Typography
                          sx={{ fontSize: 11.5, color: groupColors.textMuted, fontStyle: 'italic' }}
                          noWrap
                        >
                          {s.scientific_name}
                        </Typography>
                      )}
                    </Box>
                    <Typography
                      sx={{
                        fontSize: 13.5,
                        color: groupColors.textPrimary,
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {s.total_count}
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, color: groupColors.textMuted, textAlign: 'right' }}>
                      {s.first_observed ? dayjs(s.first_observed).format('D MMM YYYY') : '—'}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </>
          )}
        </Box>
      )}
    </Paper>
  );
}
