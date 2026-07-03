/**
 * "Species count" panel for a space: a headline count + "+N this season"
 * over the shared all-time cumulative-species area chart (rendered in brand
 * green). The chart itself is the same component the Dashboards page uses.
 */
import { useState } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import CumulativeSpeciesChart, { type CumulativeSummary } from '../dashboard/CumulativeSpeciesChart';
import { spaceCardSx, spaceColors } from '../../pages/spaces/spacesTokens';

interface SpeciesCountPanelProps {
  speciesType: string;
}

export default function SpeciesCountPanel({ speciesType }: SpeciesCountPanelProps) {
  const [summary, setSummary] = useState<CumulativeSummary>({ total: 0, seasonDelta: 0 });

  return (
    <Paper sx={spaceCardSx}>
      <Box
        sx={{
          px: 2.25,
          py: 1.75,
          borderBottom: `1px solid ${spaceColors.divider}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 1,
        }}
      >
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: spaceColors.textPrimary }}>
          Species count
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          {summary.seasonDelta > 0 && (
            <Typography sx={{ fontSize: 12, color: spaceColors.brand }}>
              +{summary.seasonDelta} this season
            </Typography>
          )}
          <Typography sx={{ fontSize: 20, fontWeight: 700, color: spaceColors.textPrimary, lineHeight: 1 }}>
            {summary.total}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ p: 2.25 }}>
        <CumulativeSpeciesChart
          speciesType={speciesType}
          color={spaceColors.brand}
          height={240}
          emptyMessage="No data yet"
          onSummary={setSummary}
        />
      </Box>
    </Paper>
  );
}
