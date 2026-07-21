/**
 * Transform per-survey occurrence counts into a season-over-season series:
 * every survey is placed on a shared Jan–Dec axis by its month/day, with one
 * series per year. Points are only ever joined within a year, so a winter gap
 * between field seasons never draws a misleading connecting line, and a year
 * with a single survey still shows as a dot.
 */
import type { SpeciesOccurrenceDataPoint } from '../../services/api';

/** Fixed non-leap year used to place month/day on the shared x axis. */
const REF_YEAR = 2001;

/** Colour per year series, most recent year first (validated categorical set —
 * the brand green stays on the current season). */
export const YEAR_SERIES_COLORS = ['#3D8B56', '#4E7CC7', '#C2703A', '#955FC0', '#99862A'] as const;

/** Older seasons beyond this many years are dropped from the chart. */
export const MAX_SEASON_YEARS = YEAR_SERIES_COLORS.length;

export interface SeasonalRow {
  /** Timestamp of the survey's month/day in the reference year. */
  x: number;
  /** Per-year counts, keyed by the year as a string (e.g. "2026"). */
  [year: string]: number;
}

export interface SeasonalSeries {
  rows: SeasonalRow[];
  /** Years shown, most recent first (at most MAX_SEASON_YEARS). */
  years: number[];
  /** True when older years were dropped to stay within MAX_SEASON_YEARS. */
  truncated: boolean;
  /** The most recent year with at least one survey. */
  latestYear: number | null;
  /** Total individuals counted across the latest year's surveys. */
  latestYearTotal: number;
  /** Number of surveys carried out in the latest year. */
  latestYearSurveys: number;
  /** First-of-month tick timestamps spanning the surveyed months. */
  monthTicks: number[];
  /** Padded x-axis domain: start/end of the surveyed months. */
  domain: [number, number];
}

function refTimestamp(isoDate: string): { x: number; year: number } {
  const [y, m, d] = isoDate.split('-').map(Number);
  // 29 Feb has no slot in the non-leap reference year; use 28 Feb.
  const day = m === 2 && d === 29 ? 28 : d;
  return { x: new Date(REF_YEAR, m - 1, day).getTime(), year: y };
}

export function buildSeasonalSeries(data: SpeciesOccurrenceDataPoint[]): SeasonalSeries | null {
  if (data.length === 0) return null;

  const allYears = Array.from(new Set(data.map((d) => Number(d.survey_date.slice(0, 4)))))
    .sort((a, b) => b - a);
  const years = allYears.slice(0, MAX_SEASON_YEARS);
  const shown = new Set(years);

  // Two surveys of the same year on the same day merge into one point (sum).
  const byX = new Map<number, SeasonalRow>();
  let latestYearTotal = 0;
  let latestYearSurveys = 0;
  for (const point of data) {
    const { x, year } = refTimestamp(point.survey_date);
    if (!shown.has(year)) continue;
    if (year === years[0]) {
      latestYearTotal += point.occurrence_count;
      latestYearSurveys += 1;
    }
    const row = byX.get(x) ?? { x };
    const key = String(year);
    row[key] = (row[key] ?? 0) + point.occurrence_count;
    byX.set(x, row);
  }

  const rows = Array.from(byX.values()).sort((a, b) => a.x - b.x);

  // Month-start ticks from the first to the last surveyed month, and a domain
  // padded to whole months so the field season fills the chart.
  const first = new Date(rows[0].x);
  const last = new Date(rows[rows.length - 1].x);
  const monthTicks: number[] = [];
  for (let m = first.getMonth(); m <= last.getMonth(); m++) {
    monthTicks.push(new Date(REF_YEAR, m, 1).getTime());
  }
  const domain: [number, number] = [
    new Date(REF_YEAR, first.getMonth(), 1).getTime(),
    new Date(REF_YEAR, last.getMonth() + 1, 0).getTime(),
  ];

  return {
    rows,
    years,
    truncated: allYears.length > years.length,
    latestYear: years[0] ?? null,
    latestYearTotal,
    latestYearSurveys,
    monthTicks,
    domain,
  };
}
