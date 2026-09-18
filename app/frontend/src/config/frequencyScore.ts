/**
 * Botanical frequency score (quadrat survey convention).
 *
 * Botanical surveys score each species by how often it lands in a sampling
 * quadrat rather than by a head count: a percentage frequency (share of
 * quadrats containing the species, 0-100, up to 2dp) and/or a relative
 * frequency band. The band scale is the one used across the Cannwood annual
 * monitoring reports (after Goldsmith 1991):
 *
 *   5 = 81-100% of quadrats, 4 = 61-80, 3 = 41-60, 2 = 21-40, 1+ = 11-20,
 *   1 = 1-10, + = present in the parcel (walkabout) but not caught by a
 *   quadrat.
 *
 * Entry is gated by the survey type's `allow_frequency_score` flag (a
 * deliberate contrast with the BDS stage counts, which key off the species
 * type): frequency scoring is a survey methodology, not a property of the
 * taxon.
 */

/** The two frequency fields beyond the presence count. */
export interface FrequencyScore {
  percent_frequency?: number | string | null;
  frequency_band?: string | null;
}

export type FrequencyScoreKey = keyof FrequencyScore;

export const FREQUENCY_SCORE_KEYS: readonly FrequencyScoreKey[] = [
  'percent_frequency',
  'frequency_band',
];

/** Valid band values, low to high (display order). */
export const FREQUENCY_BANDS: readonly string[] = ['+', '1', '1+', '2', '3', '4', '5'];

/** Human meaning of each band, for tooltips and helper text. */
export const FREQUENCY_BAND_MEANINGS: Record<string, string> = {
  '+': 'Present, but not caught by a quadrat',
  '1': 'In 1-10% of quadrats',
  '1+': 'In 11-20% of quadrats',
  '2': 'In 21-40% of quadrats',
  '3': 'In 41-60% of quadrats',
  '4': 'In 61-80% of quadrats',
  '5': 'In 81-100% of quadrats',
};

/**
 * The API serialises NUMERIC as a string; normalise to a number (or null).
 */
export function percentAsNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Copy just the frequency fields off any sighting-shaped object. Always
 * returns both keys (null when not recorded) so the result can be spread both
 * to build a payload and to clear values off a draft — the same contract as
 * pickStageCounts, and it protects the same modal-to-editor handoff seam.
 */
export function pickFrequencyScore(source: FrequencyScore | null | undefined): FrequencyScore {
  return {
    percent_frequency: source?.percent_frequency ?? null,
    frequency_band: source?.frequency_band ?? null,
  };
}

/** True when either frequency field has been recorded. */
export function hasFrequencyScore(score: FrequencyScore | null | undefined): boolean {
  if (!score) return false;
  return (
    percentAsNumber(score.percent_frequency) !== null ||
    (score.frequency_band !== null && score.frequency_band !== undefined && score.frequency_band !== '')
  );
}

/**
 * Derive the band from a percent, using the reports' own convention: round to
 * the whole percent first (so 20.8% prints as band 2, exactly as the source
 * tables do), then apply the ranges.
 */
export function deriveBand(percent: number): string {
  const rounded = Math.round(percent);
  if (rounded >= 81) return '5';
  if (rounded >= 61) return '4';
  if (rounded >= 41) return '3';
  if (rounded >= 21) return '2';
  if (rounded >= 11) return '1+';
  return '1';
}

/**
 * Blocking errors for typed entry: percent out of range or over 2dp, or a
 * band off the scale. Both fields optional; an empty score is fine.
 */
export function frequencyScoreErrors(score: FrequencyScore | null | undefined): string[] {
  const errors: string[] = [];
  if (!score) return errors;
  const raw = score.percent_frequency;
  if (raw !== null && raw !== undefined && raw !== '') {
    const percent = percentAsNumber(raw);
    if (percent === null) {
      errors.push('Frequency % must be a number between 0 and 100.');
    } else if (percent < 0 || percent > 100) {
      errors.push('Frequency % must be between 0 and 100.');
    } else if (Math.round(percent * 100) !== percent * 100) {
      errors.push('Frequency % can have at most 2 decimal places.');
    }
  }
  const band = score.frequency_band;
  if (band !== null && band !== undefined && band !== '' && !FREQUENCY_BANDS.includes(band)) {
    errors.push(`Band must be one of ${FREQUENCY_BANDS.join(', ')}.`);
  }
  return errors;
}

/**
 * One line for read-only summaries: "41.7% of quadrats (band 3)", "band +",
 * or null when nothing was recorded.
 */
export function summariseFrequencyScore(score: FrequencyScore | null | undefined): string | null {
  if (!hasFrequencyScore(score)) return null;
  const percent = percentAsNumber(score?.percent_frequency);
  const band = score?.frequency_band ?? null;
  if (percent !== null && band) return `${percent}% of quadrats (band ${band})`;
  if (percent !== null) return `${percent}% of quadrats`;
  return `band ${band}`;
}

/** Compact table-cell text: "3 · 41.66%", "41.66%", or "+". */
export function formatFrequencyCell(score: FrequencyScore | null | undefined): string {
  const percent = percentAsNumber(score?.percent_frequency);
  const band = score?.frequency_band ?? null;
  if (percent !== null && band) return `${band} \u00b7 ${percent}%`;
  if (percent !== null) return `${percent}%`;
  return band ?? '';
}
