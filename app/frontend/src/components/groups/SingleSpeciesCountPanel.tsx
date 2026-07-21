/**
 * Species panel for a group whose survey type is fixed to a single species
 * (e.g. Marsh Fritillary). A cumulative unique-species chart is meaningless
 * here, so instead the Chart view plots the count from each survey as a dot
 * on a shared Jan–Dec axis, one colour per year, joined only within a year —
 * sparse/seasonal data stays honest (no line across the winter gap) and
 * seasons can be compared year-on-year. The List view is the per-survey log.
 * Zero counts are real data: surveyed, none seen.
 */
import { useEffect, useState } from 'react';
import { Box, CircularProgress, Paper, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { BarChart as ChartIcon, ViewList } from '@mui/icons-material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import dayjs from 'dayjs';
import { dashboardAPI, type Species, type SpeciesOccurrenceDataPoint } from '../../services/api';
import { groupCardSx, groupColors } from '../../pages/groups/groupsTokens';
import { buildSeasonalSeries, YEAR_SERIES_COLORS, type SeasonalRow } from './seasonalSeries';

interface SingleSpeciesCountPanelProps {
  surveyTypeId: number;
  species: Species;
}

const CHART_HEIGHT = 240;

const headerCellSx = {
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
  color: groupColors.textMuted,
} as const;

const listGridSx = {
  display: 'grid',
  gridTemplateColumns: '1fr 64px',
  gap: 1,
  px: 2.25,
} as const;

export default function SingleSpeciesCountPanel({ surveyTypeId, species }: SingleSpeciesCountPanelProps) {
  const [view, setView] = useState<'chart' | 'list'>('chart');
  const [data, setData] = useState<SpeciesOccurrenceDataPoint[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(false);
    dashboardAPI
      .getSpeciesOccurrences(species.id, undefined, undefined, surveyTypeId)
      .then((res) => active && setData(res.data))
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [species.id, surveyTypeId]);

  const displayName = species.name ?? species.scientific_name ?? 'Species';
  const series = data ? buildSeasonalSeries(data) : null;

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
        {/* Only the species name may ellipsize on narrow screens — the count
            and its year never truncate. */}
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 600, color: groupColors.textPrimary }} noWrap>
            {displayName}
          </Typography>
          <Typography
            sx={{ fontSize: 20, fontWeight: 700, color: groupColors.textPrimary, lineHeight: 1, flexShrink: 0 }}
          >
            {series?.latestYearTotal ?? 0}
          </Typography>
          {series?.latestYear != null && (
            <Typography sx={{ fontSize: 12.5, color: groupColors.textMuted, whiteSpace: 'nowrap', flexShrink: 0 }}>
              in {series.latestYear}
            </Typography>
          )}
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

      {view === 'chart' && (
        <Box sx={{ p: 2.25 }}>
          {error ? (
            <CenteredMessage>Failed to load counts.</CenteredMessage>
          ) : data === null ? (
            <Box sx={{ height: CHART_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          ) : !series ? (
            <CenteredMessage>No surveys recorded yet.</CenteredMessage>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <LineChart data={series.rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
                  <XAxis
                    dataKey="x"
                    type="number"
                    scale="time"
                    domain={series.domain}
                    ticks={series.monthTicks}
                    tickFormatter={(t: number) => dayjs(t).format('MMM')}
                    tick={{ fontSize: 12, fill: '#666' }}
                    tickLine={false}
                    axisLine={{ stroke: '#e0e0e0' }}
                  />
                  <YAxis
                    width={32}
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#666' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <RechartsTooltip content={<SeasonTooltip />} />
                  {series.years.map((year, i) => (
                    <Line
                      key={year}
                      dataKey={String(year)}
                      stroke={YEAR_SERIES_COLORS[i]}
                      strokeWidth={2}
                      connectNulls
                      dot={{ r: 3.5, fill: YEAR_SERIES_COLORS[i], strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              {series.years.length > 1 && (
                <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap', mt: 1 }}>
                  {series.years.map((year, i) => (
                    <Box key={year} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: YEAR_SERIES_COLORS[i] }} />
                      <Typography sx={{ fontSize: 12, color: groupColors.textSecondary }}>{year}</Typography>
                    </Box>
                  ))}
                  {series.truncated && (
                    <Typography sx={{ fontSize: 12, color: groupColors.textMuted }}>
                      earlier years not shown
                    </Typography>
                  )}
                </Box>
              )}
            </>
          )}
        </Box>
      )}

      {view === 'list' && (
        <Box>
          {error ? (
            <CenteredMessage>Failed to load counts.</CenteredMessage>
          ) : data === null ? (
            <CenteredMessage>Loading…</CenteredMessage>
          ) : data.length === 0 ? (
            <CenteredMessage>No surveys recorded yet.</CenteredMessage>
          ) : (
            <>
              <Box sx={{ ...listGridSx, py: 1 }}>
                <Typography sx={headerCellSx}>Survey</Typography>
                <Typography sx={{ ...headerCellSx, textAlign: 'right' }}>Count</Typography>
              </Box>
              <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
                {[...data].reverse().map((d) => (
                  <Box
                    key={d.survey_id}
                    sx={{
                      ...listGridSx,
                      alignItems: 'center',
                      py: 0.9,
                      borderTop: `1px solid ${groupColors.dividerInner}`,
                    }}
                  >
                    <Typography sx={{ fontSize: 13.5, color: groupColors.textPrimary }}>
                      {dayjs(d.survey_date).format('D MMM YYYY')}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: 13.5,
                        color: d.occurrence_count === 0 ? groupColors.textMuted : groupColors.textPrimary,
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {d.occurrence_count}
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

function CenteredMessage({ children }: { children: string }) {
  return (
    <Typography sx={{ fontSize: 13.5, color: groupColors.textMuted, px: 2.25, py: 3, textAlign: 'center' }}>
      {children}
    </Typography>
  );
}

interface SeasonTooltipProps {
  active?: boolean;
  label?: number;
  payload?: Array<{ dataKey?: string | number; value?: number | string; color?: string; payload: SeasonalRow }>;
}

function SeasonTooltip({ active, label, payload }: SeasonTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <Paper elevation={3} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: groupColors.textPrimary, mb: 0.5 }}>
        {dayjs(label).format('D MMM')}
      </Typography>
      {payload.map((p) => (
        <Box key={String(p.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: p.color }} />
          <Typography sx={{ fontSize: 12.5, color: groupColors.textSecondary }}>
            {p.dataKey}: {p.value}
          </Typography>
        </Box>
      ))}
    </Paper>
  );
}
