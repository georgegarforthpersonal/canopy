import { describe, expect, it } from 'vitest';
import { buildSeasonalSeries, MAX_SEASON_YEARS } from './seasonalSeries';
import type { SpeciesOccurrenceDataPoint } from '../../services/api';

function point(survey_date: string, occurrence_count: number, survey_id = 1): SpeciesOccurrenceDataPoint {
  return { survey_date, occurrence_count, survey_id };
}

describe('buildSeasonalSeries', () => {
  it('returns null with no surveys', () => {
    expect(buildSeasonalSeries([])).toBeNull();
  });

  it('overlays years on a shared month/day axis', () => {
    const series = buildSeasonalSeries([
      point('2025-05-10', 4),
      point('2025-06-01', 9),
      point('2026-05-10', 7),
    ])!;

    expect(series.years).toEqual([2026, 2025]);
    // Same month/day in different years share one row.
    const shared = series.rows.find((r) => r['2025'] === 4);
    expect(shared?.['2026']).toBe(7);
    expect(series.rows).toHaveLength(2);
    // Rows are in day-of-year order.
    expect(series.rows.map((r) => r.x)).toEqual([...series.rows.map((r) => r.x)].sort((a, b) => a - b));
  });

  it('summarises the latest year (totals include zero-count surveys)', () => {
    const series = buildSeasonalSeries([
      point('2025-06-01', 20),
      point('2026-05-10', 7, 2),
      point('2026-05-17', 0, 3),
      point('2026-05-24', 5, 4),
    ])!;

    expect(series.latestYear).toBe(2026);
    expect(series.latestYearTotal).toBe(12);
    expect(series.latestYearSurveys).toBe(3);
  });

  it('merges two same-day surveys in one year by summing', () => {
    const series = buildSeasonalSeries([
      point('2026-05-10', 3, 1),
      point('2026-05-10', 4, 2),
    ])!;
    expect(series.rows).toHaveLength(1);
    expect(series.rows[0]['2026']).toBe(7);
  });

  it('spans month ticks and domain over the surveyed months only', () => {
    const series = buildSeasonalSeries([
      point('2026-05-10', 1),
      point('2026-06-20', 2),
    ])!;
    const tickMonths = series.monthTicks.map((t) => new Date(t).getMonth());
    expect(tickMonths).toEqual([4, 5]); // May, June
    expect(new Date(series.domain[0]).getDate()).toBe(1); // 1 May
    expect(new Date(series.domain[1]).getMonth()).toBe(5); // 30 June
    expect(new Date(series.domain[1]).getDate()).toBe(30);
  });

  it('drops years beyond the colour palette, most recent kept', () => {
    const data = Array.from({ length: MAX_SEASON_YEARS + 2 }, (_, i) =>
      point(`${2020 + i}-05-10`, i + 1, i),
    );
    const series = buildSeasonalSeries(data)!;
    expect(series.years).toHaveLength(MAX_SEASON_YEARS);
    expect(series.years[0]).toBe(2020 + MAX_SEASON_YEARS + 1);
    expect(series.truncated).toBe(true);
    // Dropped years contribute no values to any row.
    for (const row of series.rows) {
      expect(row['2020']).toBeUndefined();
      expect(row['2021']).toBeUndefined();
    }
  });

  it('maps 29 Feb onto the non-leap reference axis without rolling into March', () => {
    const series = buildSeasonalSeries([point('2024-02-29', 2)])!;
    expect(new Date(series.rows[0].x).getMonth()).toBe(1);
    const tickMonths = series.monthTicks.map((t) => new Date(t).getMonth());
    expect(tickMonths).toEqual([1]);
  });
});
