/**
 * Annual frequency chart for a single species on a frequency-scored
 * (botanical) survey type: percent-of-quadrats by survey year, one colour
 * per location — the annual sibling of SeasonalCountChart, sharing its
 * visual language. Years scored only with a relative-frequency band render
 * as translucent min–max ranges rather than invented point values; lines
 * connect the measured years across them.
 */
import { useState } from 'react';
import { Box, Paper, Tooltip as MuiTooltip, Typography } from '@mui/material';
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
import { FREQUENCY_BAND_MEANINGS } from '../../config/frequencyScore';
import type { AnnualRangeMark, AnnualSeries } from '../groups/annualFrequencySeries';

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
          {/* Keyed by position: one location can carry two band-only surveys
              in a year (a quadrat table and a walkabout list), so location and
              year alone do not identify a mark. */}
          {series.ranges.map((range, index) => (
            <ReferenceArea
              key={`${range.locationName}-${range.year}-${index}`}
              x1={range.year - 0.14}
              x2={range.year + 0.14}
              y1={range.lo}
              y2={range.hi}
              // ReferenceArea sits outside the recharts Tooltip, so the mark
              // draws its own rect wrapped in an MUI Tooltip instead.
              shape={(shapeProps: RangeShapeGeometry) => (
                <RangeMark geometry={shapeProps} range={range} />
              )}
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
      </Box>
      {/* Always state the coverage. Silence here used to be ambiguous between
          "only these recorded it" and "the rest were capped away". */}
      <Typography sx={{ fontSize: 12, color: '#888', textAlign: 'center', mt: 0.75 }}>
        {coverageText(series)}
        {series.droppedNames.length > 0 && (
          <MuiTooltip title={series.droppedNames.join(', ')} placement="top" arrow>
            <Box component="span" sx={{ ml: 0.5, textDecoration: 'underline dotted', cursor: 'default' }}>
              {series.droppedNames.length} not shown
            </Box>
          </MuiTooltip>
        )}
      </Typography>
    </>
  );
}

/**
 * "Recorded at 5 of 17 locations", so the reader always knows the species'
 * whole footprint, even when the chart is pinned to one location or the
 * palette cap is holding some back.
 */
function coverageText(series: AnnualSeries): string {
  const base = `Recorded at ${series.recordedLocations} of ${series.totalLocations} locations`;
  if (series.singleLocation) {
    return `${base}, showing ${series.locations[0]?.name ?? 'one'}`;
  }
  const shown = series.locations.length;
  return shown < series.recordedLocations ? `${base}, showing ${shown}` : base;
}

/** The computed pixel rect recharts hands a ReferenceArea's shape prop. */
interface RangeShapeGeometry {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/**
 * A band-only range mark: the same translucent rounded rect ReferenceArea
 * would draw itself, but wrapped in an MUI Tooltip (recharts' own Tooltip
 * ignores reference elements) that spells out which survey the band came
 * from and what it means.
 */
function RangeMark({ geometry, range }: { geometry: RangeShapeGeometry; range: AnnualRangeMark }) {
  const [hovered, setHovered] = useState(false);
  const { x, y, width, height } = geometry;
  if (x == null || y == null || width == null || height == null) return <g />;
  // A "+" band spans 0-1%, which is a sub-pixel sliver on a 0-100 axis: the
  // record would read as missing rather than as a trace. Floor the mark so a
  // trace record is still visibly a record, growing upward from its own top.
  const MIN_MARK = 6;
  const drawHeight = Math.max(height, MIN_MARK);
  const drawY = y + height - drawHeight;
  const meaning = FREQUENCY_BAND_MEANINGS[range.band];
  const parts = [range.locationName, String(range.year), `band ${range.band}`];
  if (meaning) parts.push(meaning.charAt(0).toLowerCase() + meaning.slice(1));
  return (
    <MuiTooltip title={parts.join(' · ')} placement="top" arrow>
      <rect
        x={x}
        y={drawY}
        width={width}
        height={drawHeight}
        rx={3}
        ry={3}
        fill={range.color}
        fillOpacity={hovered ? 0.45 : 0.3}
        stroke="none"
        style={{ cursor: 'default' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
    </MuiTooltip>
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
