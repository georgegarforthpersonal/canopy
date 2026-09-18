/**
 * Sward composition series-shaping (pure functions, no fetching).
 *
 * Pivots the flat /dashboard/sward-composition rows into the panel's
 * species x survey heatmap for one location, plus per-survey richness and a
 * winners/losers comparison between the two most recent surveys.
 */

import { deriveBand, percentAsNumber } from '../../config/frequencyScore';

/** Mirrors the API's SwardCompositionRow (percent arrives as a string). */
export interface SwardRow {
  location_id: number | null;
  location_name: string | null;
  survey_id: number;
  survey_date: string; // ISO date
  species_id: number;
  species_name: string | null;
  species_scientific_name: string | null;
  conservation_status: string | null;
  percent_frequency: number | string | null;
  frequency_band: string | null;
}

export interface SwardLocationOption {
  id: number | null;
  name: string;
  surveyCount: number;
}

export interface SwardCell {
  band: string | null;
  percent: number | null;
}

export interface SwardSurveyColumn {
  id: number;
  date: string;
  label: string;
}

export interface SwardSpeciesRow {
  id: number;
  name: string;
  notable: boolean;
  /** One cell per survey column; null = not recorded in that survey. */
  cells: (SwardCell | null)[];
}

export interface SwardMatrix {
  surveys: SwardSurveyColumn[];
  species: SwardSpeciesRow[];
  /** Species recorded per survey column (any band or percent). */
  richness: number[];
}

export interface SwardChange {
  speciesId: number;
  name: string;
  from: number;
  to: number;
  delta: number;
}

/** Numeric weight of a cell for ordering rows; percent wins over band. */
function cellWeight(cell: SwardCell | null): number {
  if (!cell) return 0;
  if (cell.percent !== null) return cell.percent;
  switch (cell.band) {
    case '5': return 90;
    case '4': return 70;
    case '3': return 50;
    case '2': return 30;
    case '1+': return 15;
    case '1': return 5;
    case '+': return 0.5;
    default: return 0;
  }
}

/** Distinct locations present in the rows, busiest (most surveys) first. */
export function swardLocations(rows: SwardRow[]): SwardLocationOption[] {
  const byId = new Map<number | null, { name: string; surveys: Set<number> }>();
  for (const row of rows) {
    const entry = byId.get(row.location_id) ?? {
      name: row.location_name ?? 'No location',
      surveys: new Set<number>(),
    };
    entry.surveys.add(row.survey_id);
    byId.set(row.location_id, entry);
  }
  return [...byId.entries()]
    .map(([id, entry]) => ({ id, name: entry.name, surveyCount: entry.surveys.size }))
    .sort((a, b) => b.surveyCount - a.surveyCount || a.name.localeCompare(b.name));
}

/** Column label: the year alone unless two surveys share one. */
function surveyLabels(surveys: { id: number; date: string }[]): SwardSurveyColumn[] {
  const yearCounts = new Map<string, number>();
  for (const survey of surveys) {
    const year = survey.date.slice(0, 4);
    yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
  }
  return surveys.map((survey) => {
    const year = survey.date.slice(0, 4);
    const label = (yearCounts.get(year) ?? 0) > 1
      ? new Date(survey.date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
      : year;
    return { ...survey, label };
  });
}

/**
 * Pivot one location's rows into the heatmap matrix. Surveys are columns in
 * date order; species are rows ordered by their strongest showing (latest
 * survey first, then overall weight), so the current sward reads top-down.
 */
export function buildSwardMatrix(rows: SwardRow[], locationId: number | null): SwardMatrix {
  const scoped = rows.filter((row) => row.location_id === locationId);

  const surveyById = new Map<number, string>();
  for (const row of scoped) surveyById.set(row.survey_id, row.survey_date);
  const orderedSurveys = [...surveyById.entries()]
    .map(([id, date]) => ({ id, date }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const surveys = surveyLabels(orderedSurveys);
  const columnIndex = new Map(surveys.map((survey, index) => [survey.id, index]));

  const speciesById = new Map<number, SwardSpeciesRow>();
  for (const row of scoped) {
    let species = speciesById.get(row.species_id);
    if (!species) {
      species = {
        id: row.species_id,
        name: row.species_name || row.species_scientific_name || 'Unknown',
        notable: !!row.conservation_status,
        cells: surveys.map(() => null),
      };
      speciesById.set(row.species_id, species);
    }
    const percent = percentAsNumber(row.percent_frequency);
    const band = row.frequency_band ?? (percent !== null && percent > 0 ? deriveBand(percent) : null);
    species.cells[columnIndex.get(row.survey_id)!] = { band, percent };
  }

  const species = [...speciesById.values()].sort((a, b) => {
    const latest = surveys.length - 1;
    const latestDiff = cellWeight(b.cells[latest]) - cellWeight(a.cells[latest]);
    if (latestDiff !== 0) return latestDiff;
    const totalOf = (s: SwardSpeciesRow) => s.cells.reduce((sum, cell) => sum + cellWeight(cell), 0);
    const totalDiff = totalOf(b) - totalOf(a);
    if (totalDiff !== 0) return totalDiff;
    return a.name.localeCompare(b.name);
  });

  const richness = surveys.map((_survey, index) =>
    species.reduce((count, row) => count + (row.cells[index] ? 1 : 0), 0),
  );

  return { surveys, species, richness };
}

/**
 * Biggest percent-frequency changes between the two most recent surveys.
 * Only species with a percent in at least one of the pair take part (a
 * missing side counts as 0); band-only records are skipped rather than
 * given invented numbers. Returns risers and fallers, biggest first.
 */
export function winnersLosers(
  matrix: SwardMatrix,
  limit = 5,
): { risers: SwardChange[]; fallers: SwardChange[] } {
  if (matrix.surveys.length < 2) return { risers: [], fallers: [] };
  const previous = matrix.surveys.length - 2;
  const latest = matrix.surveys.length - 1;

  const changes: SwardChange[] = [];
  for (const species of matrix.species) {
    const from = species.cells[previous]?.percent ?? null;
    const to = species.cells[latest]?.percent ?? null;
    if (from === null && to === null) continue;
    // A recorded band with no percent is not zero; skip rather than invent.
    if (from === null && species.cells[previous]) continue;
    if (to === null && species.cells[latest]) continue;
    const delta = (to ?? 0) - (from ?? 0);
    if (delta === 0) continue;
    changes.push({ speciesId: species.id, name: species.name, from: from ?? 0, to: to ?? 0, delta });
  }

  const risers = changes.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, limit);
  const fallers = changes.filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, limit);
  return { risers, fallers };
}

/** Heatmap cell background per band (light to dark green). */
export const BAND_COLORS: Record<string, string> = {
  '+': '#eef4ec',
  '1': '#dce9d8',
  '1+': '#c5dcbc',
  '2': '#a4cb96',
  '3': '#7db26c',
  '4': '#579847',
  '5': '#3a7d2c',
};

/** Bands dark enough to need white text. */
export const BAND_DARK = new Set(['3', '4', '5']);
