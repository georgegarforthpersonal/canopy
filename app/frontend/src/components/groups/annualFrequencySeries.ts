/**
 * Series-shaping for the Annual frequency chart (pure functions, no
 * fetching): one species' percent-of-quadrats through the years, one line
 * per location, from the flat /dashboard/sward-composition rows.
 *
 * Years scored only with a relative-frequency band (no percentage — the 2020
 * and 2025 Cannwood reports) are kept honest as min–max ranges rather than
 * invented point values; the line connects measured years across them.
 */
import type { SwardCompositionRow } from '../../services/api';
import { percentAsNumber } from '../../config/frequencyScore';
import { YEAR_SERIES_COLORS } from './seasonalSeries';

/** What each band promises about quadrat share, as a [lo, hi] % range. */
export const BAND_RANGES: Record<string, [number, number]> = {
  '+': [0, 1],
  '1': [1, 10],
  '1+': [11, 20],
  '2': [21, 40],
  '3': [41, 60],
  '4': [61, 80],
  '5': [81, 100],
};

/** A line's worth of locations is legible; beyond that we drop the rarest. */
export const MAX_ANNUAL_LOCATIONS = YEAR_SERIES_COLORS.length;

export interface AnnualSpeciesOption {
  id: number;
  name: string;
  /** How many surveys recorded it — the picker's sort and hint number. */
  records: number;
}

/** Distinct species in the rows, most-recorded first (ties alphabetical). */
export function annualSpeciesOptions(rows: SwardCompositionRow[]): AnnualSpeciesOption[] {
  const byId = new Map<number, AnnualSpeciesOption>();
  for (const row of rows) {
    const entry = byId.get(row.species_id) ?? {
      id: row.species_id,
      name: row.species_name || row.species_scientific_name || 'Unknown',
      records: 0,
    };
    entry.records += 1;
    byId.set(row.species_id, entry);
  }
  return [...byId.values()].sort((a, b) => b.records - a.records || a.name.localeCompare(b.name));
}

export interface AnnualLocationOption {
  id: number | null;
  name: string;
  /** Surveys of this location carrying any frequency score. */
  surveys: number;
}

/**
 * Locations the picker offers, alphabetical. Every location with frequency
 * data appears, whether or not the selected species was recorded there, so
 * the list does not reshuffle as the species changes.
 */
export function annualLocationOptions(rows: SwardCompositionRow[]): AnnualLocationOption[] {
  const byName = new Map<string, { id: number | null; surveys: Set<number> }>();
  for (const row of rows) {
    const name = row.location_name ?? 'No location';
    const entry = byName.get(name) ?? { id: row.location_id, surveys: new Set<number>() };
    entry.surveys.add(row.survey_id);
    byName.set(name, entry);
  }
  return [...byName.entries()]
    .map(([name, v]) => ({ id: v.id, name, surveys: v.surveys.size }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface AnnualLocationSeries {
  id: number | null;
  name: string;
  color: string;
}

export interface AnnualRangeMark {
  year: number;
  locationName: string;
  color: string;
  lo: number;
  hi: number;
  band: string;
}

export interface AnnualSeries {
  /** Every survey year in the dataset (not just this species'), ascending. */
  years: number[];
  /** Locations drawn, most-recorded first; capped only in "all" mode. */
  locations: AnnualLocationSeries[];
  /** One row per year; per-location percents keyed by location name. */
  rows: Array<Record<string, number | null> & { year: number }>;
  /** Band-only records, drawn as min–max ranges instead of points. */
  ranges: AnnualRangeMark[];
  /** Names dropped by the cap, so the chart can say which, not just how many. */
  droppedNames: string[];
  /** How many locations recorded this species at all. */
  recordedLocations: number;
  /** How many locations this survey type has any frequency data for. */
  totalLocations: number;
  /** Set when the caller pinned the chart to a single location. */
  singleLocation: boolean;
}

/**
 * Pivot one species' rows into per-location year series. Returns null when
 * the species has no rows at all. Percent wins where both a percent and band
 * were recorded; band-only records become ranges. Should a location ever
 * carry two measured surveys in one year, the higher percent stands.
 *
 * Pass a locationId (null means "all locations") to pin the chart to one
 * location: the palette cap then does not apply, so a species recorded in
 * more locations than the palette has colours is still fully reachable.
 */
export function buildAnnualSeries(
  allRows: SwardCompositionRow[],
  speciesId: number,
  locationId?: number | null,
): AnnualSeries | null {
  const yearSet = new Set(allRows.map((row) => Number(row.survey_date.slice(0, 4))));
  const years = [...yearSet].sort((a, b) => a - b);

  const speciesRows = allRows.filter((row) => row.species_id === speciesId);
  if (speciesRows.length === 0) return null;

  const counts = new Map<string, { id: number | null; records: number }>();
  for (const row of speciesRows) {
    const name = row.location_name ?? 'No location';
    const entry = counts.get(name) ?? { id: row.location_id, records: 0 };
    entry.records += 1;
    counts.set(name, entry);
  }
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1].records - a[1].records || a[0].localeCompare(b[0]),
  );
  const pinned = locationId != null ? ranked.filter(([, v]) => v.id === locationId) : null;
  if (pinned && pinned.length === 0) return null;   // species never recorded there
  const kept = pinned ?? ranked.slice(0, MAX_ANNUAL_LOCATIONS);
  const locations: AnnualLocationSeries[] = kept.map(([name, entry], index) => ({
    id: entry.id,
    name,
    color: YEAR_SERIES_COLORS[index],
  }));
  const colorOf = new Map(locations.map((location) => [location.name, location.color]));

  const rows: AnnualSeries['rows'] = years.map((year) => ({ year }));
  const rowOf = new Map(rows.map((row) => [row.year, row]));
  const ranges: AnnualRangeMark[] = [];

  for (const row of speciesRows) {
    const name = row.location_name ?? 'No location';
    const color = colorOf.get(name);
    if (!color) continue; // beyond the location cap
    const year = Number(row.survey_date.slice(0, 4));
    const percent = percentAsNumber(row.percent_frequency);
    if (percent !== null) {
      const target = rowOf.get(year)!;
      target[name] = Math.max(percent, (target[name] as number | null) ?? 0);
    } else if (row.frequency_band && BAND_RANGES[row.frequency_band]) {
      const [lo, hi] = BAND_RANGES[row.frequency_band];
      ranges.push({ year, locationName: name, color, lo, hi, band: row.frequency_band });
    }
  }
  for (const row of rows) {
    for (const location of locations) {
      if (!(location.name in row)) row[location.name] = null;
    }
  }

  const totalLocations = new Set(
    allRows.map((row) => row.location_id ?? row.location_name ?? 'none'),
  ).size;
  return {
    years,
    locations,
    rows,
    ranges,
    droppedNames: pinned ? [] : ranked.slice(MAX_ANNUAL_LOCATIONS).map(([name]) => name),
    recordedLocations: ranked.length,
    totalLocations,
    singleLocation: !!pinned,
  };
}
