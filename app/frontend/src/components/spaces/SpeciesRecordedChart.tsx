/**
 * "Species recorded" panel for a space: a headline count + "+N this season"
 * over the shared all-time cumulative-species area chart (rendered in brand
 * green). The chart itself is the same component the Dashboards page uses.
 */
import { useState } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import CumulativeSpeciesChart, { type CumulativeSummary } from '../dashboard/CumulativeSpeciesChart';
import { spaceCardSx, spaceColors } from '../../pages/spaces/spacesTokens';

interface SpeciesRecordedChartProps {
  speciesType: string;
}

export default function SpeciesRecordedChart({ speciesType }: SpeciesRecordedChartProps) {
  const [summary, setSummary] = useState<CumulativeSummary>({ total: 0, seasonDelta: 0 });

  return (
    <Paper sx={{ ...spaceCardSx, p: 2.25 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.4px', color: '#999' }}>
            SPECIES RECORDED
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mt: 0.5 }}>
            <Typography sx={{ fontSize: 28, fontWeight: 700, color: spaceColors.textPrimary, lineHeight: 1 }}>
              {summary.total}
            </Typography>
            {summary.seasonDelta > 0 && (
              <Typography sx={{ fontSize: 12, color: spaceColors.brand }}>
                +{summary.seasonDelta} this season
              </Typography>
            )}
          </Box>
        </Box>
        <Typography sx={{ fontSize: 12, color: spaceColors.textMuted }}>Cumulative</Typography>
      </Box>

      <Box sx={{ mt: 1.5 }}>
        <CumulativeSpeciesChart
          speciesType={speciesType}
          color={spaceColors.brand}
          height={140}
          emptyMessage="No data yet"
          onSummary={setSummary}
        />
      </Box>
    </Paper>
  );
}
