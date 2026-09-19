/**
 * Annual frequency chart for a single species on a frequency-scored
 * (botanical) survey type: percent-of-quadrats by survey year, one colour
 * per location — the annual sibling of SeasonalCountChart, sharing its
 * visual language. Years scored only with a relative-frequency band render
 * as translucent min–max ranges rather than invented point values; lines
 * connect the measured years across them.
 */
import { Box, Paper, Typography } from '@mui/material';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AnnualSeries } from '../groups/annualFrequencySeries';

interface AnnualFrequencyChartProps {
  series: AnnualSeries | null;
  height?: number;
  emptyMessage?: string;
}

export default function AnnualFrequencyChart({
  series,
  height = 240,
  emptyMessage = 'No frequency-scored surveys yet.',
}: AnnualFrequencyChartProps) {
  if (!series) {
    return (
      <Box sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ fontSize: 13.5, color: '#888' }}>{emptyMessage}</Typography>
      </Box>
    );
  }

  const [firstYear, lastYear] = [series.years[0], series.years[series.years.length - 1]];
  // Half a year of padding keeps endpoint dots and range bars off the frame.
  const domain: [number, number] = [firstYear - 0.5, lastYear + 0.5];

  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={series.rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#eceeec" />
          <XAxis
            dataKey="year"
            type="number"
            domain={domain}
            ticks={series.years}
            tickFormatter={(year: number) => String(year)}
            tick={{ fontSize: 12, fill: '#666' }}
            tickLine={false}
            axisLine={{ stroke: '#eceeec' }}
          />
          <YAxis
            width={40}
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(value: number) => `${value}%`}
            tick={{ fontSize: 11, fill: '#666' }}
            tickLine={false}
            axisLine={false}
          />
          <RechartsTooltip content={<AnnualTooltip />} />
          {series.ranges.map((range) => (
            <ReferenceArea
              key={`${range.locationName}-${range.year}`}
              x1={range.year - 0.14}
              x2={range.year + 0.14}
              y1={range.lo}
              y2={range.hi}
              fill={range.color}
              fillOpacity={0.3}
              stroke="none"
              radius={3}
            />
          ))}
          {series.locations.map((location) => (
            <Line
              key={location.name}
              dataKey={location.name}
              stroke={location.color}
              strokeWidth={2}
              // Band-only years leave nulls in a line's series; the measured
              // years either side must connect across them.
              connectNulls
              dot={{ r: 4, fill: location.color, stroke: '#fff', strokeWidth: 2 }}
              activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap', mt: 1 }}>
        {series.locations.map((location) => (
          <Box key={location.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: location.color }} />
            <Typography sx={{ fontSize: 12, color: '#666' }}>{location.name}</Typography>
          </Box>
        ))}
        {series.truncated > 0 && (
          <Typography sx={{ fontSize: 12, color: '#888' }}>
            {series.truncated} more location{series.truncated > 1 ? 's' : ''} not shown
          </Typography>
        )}
        {series.ranges.length > 0 && (
          <Typography sx={{ fontSize: 12, color: '#888' }}>
            shaded = band-only survey (value within range)
          </Typography>
        )}
      </Box>
    </>
  );
}

interface AnnualTooltipProps {
  active?: boolean;
  label?: number;
  payload?: Array<{ dataKey?: string | number; value?: number | string; color?: string }>;
}

function AnnualTooltip({ active, label, payload }: AnnualTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <Paper elevation={3} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: '#1a1a1a', mb: 0.5 }}>
        {label}
      </Typography>
      {payload.map((p) => (
        <Box key={String(p.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: p.color }} />
          <Typography sx={{ fontSize: 12.5, color: '#666' }}>
            {p.dataKey}: {p.value}% of quadrats
          </Typography>
        </Box>
      ))}
    </Paper>
  );
}
