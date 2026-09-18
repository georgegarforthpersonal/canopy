/**
 * Botanical frequency score entry (quadrat survey convention).
 *
 * Two controls: a band picker (the +, 1, 1+, 2, 3, 4, 5 scale) and a typed
 * percent (0-100, up to 2dp). The percent is the primary measurement where
 * quadrats were counted; typing one auto-fills the band from the scale (the
 * band stays editable, matching how the source reports occasionally deviate).
 * A walkabout record is just the + band with no percent.
 *
 * Shown only for survey types with allow_frequency_score, which is a survey
 * methodology flag, not a species-type gate like the BDS stage counts.
 */

import { Box, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';

import {
  deriveBand,
  FREQUENCY_BANDS,
  FREQUENCY_BAND_MEANINGS,
  frequencyScoreErrors,
  percentAsNumber,
  type FrequencyScore,
  type FrequencyScoreKey,
} from '../../config/frequencyScore';

interface FrequencyScoreFieldsProps {
  value: FrequencyScore;
  onChange: (key: FrequencyScoreKey, next: number | string | null) => void;
  disabled?: boolean;
}

export default function FrequencyScoreFields({
  value,
  onChange,
  disabled = false,
}: FrequencyScoreFieldsProps) {
  const errors = frequencyScoreErrors(value);
  const band = value.frequency_band ?? null;
  // Keep the raw string while typing so "41." isn't destroyed mid-entry.
  const percentRaw =
    value.percent_frequency === null || value.percent_frequency === undefined
      ? ''
      : String(value.percent_frequency);

  const handlePercentChange = (raw: string) => {
    if (raw === '') {
      onChange('percent_frequency', null);
      return;
    }
    if (!/^\d{0,3}(\.\d{0,2})?$/.test(raw)) return;
    onChange('percent_frequency', raw);
    const parsed = percentAsNumber(raw);
    if (parsed !== null && parsed > 0 && parsed <= 100) {
      onChange('frequency_band', deriveBand(parsed));
    }
  };

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Frequency
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap' }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={band}
          onChange={(_e, next: string | null) => onChange('frequency_band', next)}
          disabled={disabled}
          aria-label="Frequency band"
        >
          {FREQUENCY_BANDS.map((option) => (
            <Tooltip key={option} title={FREQUENCY_BAND_MEANINGS[option]} enterDelay={400}>
              <ToggleButton value={option} aria-label={`Band ${option}`} sx={{ px: 1.25, minWidth: 36 }}>
                {option}
              </ToggleButton>
            </Tooltip>
          ))}
        </ToggleButtonGroup>
        <TextField
          size="small"
          label="% of quadrats"
          value={percentRaw}
          onChange={(e) => handlePercentChange(e.target.value)}
          disabled={disabled}
          error={errors.length > 0}
          helperText={errors[0]}
          inputProps={{ inputMode: 'decimal', 'aria-label': 'Percent of quadrats' }}
          sx={{ width: 140 }}
        />
      </Box>
    </Box>
  );
}
