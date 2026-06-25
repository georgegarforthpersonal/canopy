/**
 * Per-survey occurrence bar chart for a single species.
 *
 * Self-contained: fetches the occurrence series for a species id and renders
 * bars positioned ordinally with a year label at each year's first survey.
 * Shared by the Dashboards page and the Survey Spaces "Species abundance"
 * panel; the caller owns the species picker and passes the chosen id.
 */
import { useEffect, useState } from 'react';
import { Box, CircularProgress, Paper, Typography } from '@mui/material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import dayjs from 'dayjs';
import { dashboardAPI } from '../../services/api';
import type { SpeciesOccurrenceResponse } from '../../services/api';
import { brandColors } from '../../theme';

interface SpeciesOccurrenceChartProps {
  speciesId: number | null;
  color?: string;
  height?: number;
  emptyMessage?: string;
  placeholderMessage?: string;
}

const CHART_MARGIN = { top: 10, right: 10, left: 0, bottom: 0 };

export default function SpeciesOccurrenceChart({
  speciesId,
  color = brandColors.main,
  height = 300,
  emptyMessage = 'No occurrence data available',
  placeholderMessage = 'Select a species to view occurrences',
}: SpeciesOccurrenceChartProps) {
  const [data, setData] = useState<SpeciesOccurrenceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (speciesId == null) {
      setData(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    dashboardAPI
      .getSpeciesOccurrences(speciesId)
      .then((res) => active && setData(res))
      .catch((err) => active && setError(err instanceof Error ? err.message : 'Failed to load occurrence data'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [speciesId]);

  const centeredSx = { height, display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;

  if (speciesId == null) {
    return (
      <Box sx={centeredSx}>
        <Typography variant="body2" color="text.secondary">
          {placeholderMessage}
        </Typography>
      </Box>
    );
  }
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
  if (!data || data.data.length === 0) {
    return (
      <Box sx={centeredSx}>
        <Typography variant="body2" color="text.secondary">
          {emptyMessage}
        </Typography>
      </Box>
    );
  }

  const chartData = data.data.map((d, index) => ({
    index,
    surveyId: d.survey_id,
    dateStr: d.survey_date,
    count: d.occurrence_count,
  }));

  // One year label at the first survey of each year.
  const yearFirstSurvey = new Map<number, number>();
  data.data.forEach((d, index) => {
    const year = new Date(d.survey_date).getFullYear();
    if (!yearFirstSurvey.has(year)) yearFirstSurvey.set(year, index);
  });
  const yearTicks = Array.from(yearFirstSurvey.values());

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
        <XAxis
          dataKey="index"
          type="category"
          ticks={yearTicks}
          tickFormatter={(tickValue) => {
            const survey = data.data[tickValue as number];
            return survey ? String(new Date(survey.survey_date).getFullYear()) : '';
          }}
          tick={{ fontSize: 12, fill: '#666' }}
          tickLine={false}
          axisLine={{ stroke: '#e0e0e0' }}
        />
        <YAxis hide />
        <RechartsTooltip
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;
            const d = payload[0].payload as { dateStr: string; surveyId: number; count: number };
            return (
              <Paper elevation={3} sx={{ p: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  {dayjs(d.dateStr).format('MMM DD, YYYY')}
                </Typography>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  Survey #{d.surveyId}
                </Typography>
                <Typography variant="body2">Count: {d.count} individuals</Typography>
              </Paper>
            );
          }}
        />
        <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
