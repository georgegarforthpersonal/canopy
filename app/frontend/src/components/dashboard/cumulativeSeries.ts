/**
 * Combining per-species-type cumulative series into one "unique species"
 * series. A survey type can record several species types (Ad hoc, Jenny), and
 * counting only the first linked type reads 0 on the very groups with the
 * most variety. Species sets are disjoint across types, so summing each
 * type's running cumulative IS the distinct total.
 */
import type { CumulativeSpeciesDataPoint } from '../../services/api';

/** The per-date combined series (tagged type 'all'), dates ascending. */
export function combineCumulative(data: CumulativeSpeciesDataPoint[]): CumulativeSpeciesDataPoint[] {
  const byDate = new Map<string, CumulativeSpeciesDataPoint[]>();
  for (const d of data) {
    if (!byDate.has(d.date)) byDate.set(d.date, []);
    byDate.get(d.date)!.push(d);
  }
  const running: Record<string, number> = {};
  return Array.from(byDate.keys())
    .sort()
    .map((date) => {
      const newSpecies: string[] = [];
      for (const d of byDate.get(date)!) {
        // Forward-fill: a type without a point on this date keeps its last
        // cumulative, so the sum never dips.
        running[d.type] = Math.max(running[d.type] ?? 0, d.cumulative_count);
        newSpecies.push(...d.new_species);
      }
      return {
        date,
        type: 'all',
        cumulative_count: Object.values(running).reduce((a, b) => a + b, 0),
        new_species: newSpecies,
      };
    });
}

/** Total distinct species across every type in the series. */
export function totalUniqueSpecies(data: CumulativeSpeciesDataPoint[]): number {
  const maxPerType = new Map<string, number>();
  for (const d of data) {
    maxPerType.set(d.type, Math.max(maxPerType.get(d.type) ?? 0, d.cumulative_count));
  }
  return Array.from(maxPerType.values()).reduce((a, b) => a + b, 0);
}

/** The species types actually present in a series (for per-type follow-ups). */
export function typesInSeries(data: CumulativeSpeciesDataPoint[]): string[] {
  return Array.from(new Set(data.map((d) => d.type)));
}
