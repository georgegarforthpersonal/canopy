/**
 * Cumulative unique-species area chart.
 *
 * Self-contained: fetches the all-time cumulative-species series (optionally
 * filtered to a list of species types; unfiltered = everything the scoped
 * surveys recorded), merges every type into ONE combined series (species sets
 * are disjoint across types, so the sum is the distinct total), and renders a
 * brand-coloured area on a time-scale x-axis. Shared by the Dashboards page
 * and the Groups "Species count" panel — only the colour/height/chrome differ.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, CircularProgress, Paper, Typography } from '@mui/material';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import dayjs from 'dayjs';
import { dashboardAPI } from '../../services/api';
import type { CumulativeSpeciesDataPoint } from '../../services/api';
import { brandColors } from '../../theme';
import { getSpeciesDisplayName } from '../../config';
import { combineCumulative, totalUniqueSpecies, typesInSeries } from './cumulativeSeries';

export interface CumulativeSummary {
  /** Total unique species recorded all-time. */
  total: number;
  /** Species types actually present in the data (for per-type follow-ups). */
  types: string[];
}

interface CumulativeSpeciesChartProps {
  /** Species types to include; undefined or empty = everything recorded. */
  speciesTypes?: string[];
  /** Scope the series to one survey type's surveys (e.g. a group's). */
  surveyTypeId?: number;
  color?: string;
  height?: number;
  emptyMessage?: string;
  /** Fires after each load with headline figures (for an external stat header). */
  onSummary?: (summary: CumulativeSummary) => void;
}

const CHART_MARGIN = { top: 10, right: 10, left: 0, bottom: 0 };

// One tick per year, labelled with just the year — mixed month/year ticks
// read oddly when the data doesn't start in January.
function formatXAxisTick(timestamp: number): string {
  return dayjs(timestamp).format('YYYY');
}

interface PreparedPoint {
  date: number;
  dateStr: string;
  newSpecies: Record<string, string[]>;
  [type: string]: number | string | Record<string, string[]>;
}

/** Aggregate the raw series by date and compute one tick per year. */
function prepareChartData(data: CumulativeSpeciesDataPoint[]): {
  data: PreparedPoint[];
  types: string[];
  customTicks: number[];
} | null {
  if (data.length === 0) return null;

  const types = Array.from(new Set(data.map((d) => d.type)));
  const dateData = new Map<string, { counts: Record<string, number>; species: Record<string, string[]> }>();

  data.forEach(({ date, type, cumulative_count, new_species }) => {
    if (!dateData.has(date)) dateData.set(date, { counts: {}, species: {} });
    const dayData = dateData.get(date)!;
    dayData.counts[type] = Math.max(dayData.counts[type] || 0, cumulative_count);
    if (!dayData.species[type]) dayData.species[type] = [];
    dayData.species[type].push(...new_species);
  });

  const chartArray: PreparedPoint[] = Array.from(dateData.entries())
    .map(([dateKey, d]) => {
      const dedupSpecies: Record<string, string[]> = {};
      Object.entries(d.species).forEach(([type, names]) => {
        dedupSpecies[type] = Array.from(new Set(names));
      });
      return {
        date: new Date(dateKey).getTime(),
        dateStr: dateKey,
        ...d.counts,
        newSpecies: dedupSpecies,
      };
    })
    .sort((a, b) => a.date - b.date);

  // First data point of each year carries that year's tick (the first year's
  // tick sits wherever its data starts, e.g. April for a mid-year launch).
  const customTicks: number[] = [];
  const seenYears = new Set<number>();
  chartArray.forEach((item) => {
    const year = new Date(item.date).getFullYear();
    if (!seenYears.has(year)) {
      customTicks.push(item.date);
      seenYears.add(year);
    }
  });

  return { data: chartArray, types, customTicks };
}

export default function CumulativeSpeciesChart({
  speciesTypes,
  surveyTypeId,
  color = brandColors.main,
  height = 400,
  emptyMessage = 'No data available',
  onSummary,
}: CumulativeSpeciesChartProps) {
  const [data, setData] = useState<CumulativeSpeciesDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest onSummary without retriggering the fetch effect.
  const onSummaryRef = useRef(onSummary);
  onSummaryRef.current = onSummary;

  // A stable key so an inline-array prop doesn't refire the effect each render.
  const typesKey = (speciesTypes ?? []).join(',');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const filter = typesKey === '' ? undefined : typesKey.split(',');
    dashboardAPI
      .getCumulativeSpecies(filter, surveyTypeId)
      .then((res) => {
        if (!active) return;
        setData(combineCumulative(res.data));
        onSummaryRef.current?.({
          total: totalUniqueSpecies(res.data),
          types: typesInSeries(res.data),
        });
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load chart data');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [typesKey, surveyTypeId]);

  const prepared = useMemo(() => prepareChartData(data), [data]);

  const centeredSx = {
    height,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as const;

  if (loading) {
    return (
      <Box sx={centeredSx}>
        <CircularProgress size={24} />
      </Box>
    );
  }
  if (error) {
    return (
      <Box sx={centeredSx}>
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      </Box>
    );
  }
  if (!prepared) {
    return (
      <Box sx={centeredSx}>
        <Typography variant="body2" color="text.secondary">
          {emptyMessage}
        </Typography>
      </Box>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={prepared.data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
        <XAxis
          dataKey="date"
          type="number"
          domain={['dataMin', 'dataMax']}
          scale="time"
          ticks={prepared.customTicks}
          tickFormatter={formatXAxisTick}
          tick={{ fontSize: 12, fill: '#666' }}
          tickLine={false}
          axisLine={{ stroke: '#e0e0e0' }}
        />
        <YAxis hide />
        <RechartsTooltip
          content={
            <CumulativeTooltip
              noun={
                speciesTypes?.length === 1
                  ? getSpeciesDisplayName(speciesTypes[0]).toLowerCase()
                  : 'species'
              }
            />
          }
        />
        {prepared.types.map((type) => (
          <Area
            key={type}
            type="monotone"
            dataKey={type}
            stroke={color}
            fill={color}
            fillOpacity={0.6}
            strokeWidth={2}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: PreparedPoint }>;
  /** "birds" for a single-type chart, "species" for a combined one. */
  noun: string;
}

function CumulativeTooltip({ active, payload, noun }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const date = dayjs(point.dateStr).format('MMM DD, YYYY');
  // The chart plots the combined 'all' series regardless of the filter.
  const newSpeciesList = point.newSpecies?.all ?? [];
  const count = (point.all as number) || 0;

  return (
    <Paper elevation={3} sx={{ p: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', maxWidth: 300 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
        {date}
      </Typography>
      <Typography variant="body2" sx={{ mb: 1 }}>
        Total: {count} {noun}
      </Typography>
      {newSpeciesList.length > 0 ? (
        <>
          <Typography variant="body2" sx={{ fontWeight: 600, mt: 1.5, mb: 0.5 }}>
            New this week:
          </Typography>
          <Box sx={{ maxHeight: 150, overflowY: 'auto' }}>
            {newSpeciesList.map((species, idx) => (
              <Typography key={idx} variant="body2" sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
                • {species}
              </Typography>
            ))}
          </Box>
        </>
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
          No new species this week
        </Typography>
      )}
    </Paper>
  );
}
