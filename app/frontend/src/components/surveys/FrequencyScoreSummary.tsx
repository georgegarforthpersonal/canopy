/**
 * Read-only one-liner for a sighting's botanical frequency score, shown on
 * the survey detail page (same role as StageCountsSummary for BDS counts).
 */

import { Typography } from '@mui/material';

import { summariseFrequencyScore, type FrequencyScore } from '../../config/frequencyScore';

export default function FrequencyScoreSummary({ score }: { score: FrequencyScore }) {
  const summary = summariseFrequencyScore(score);
  if (!summary) return null;
  return (
    <Typography variant="body2" color="text.secondary">
      {summary}
    </Typography>
  );
}
