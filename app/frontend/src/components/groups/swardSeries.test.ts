import { describe, expect, it } from 'vitest';
import {
  buildSwardMatrix,
  swardLocations,
  winnersLosers,
  type SwardRow,
} from './swardSeries';

function row(overrides: Partial<SwardRow>): SwardRow {
  return {
    location_id: 1,
    location_name: 'SSSI (2991)',
    survey_id: 10,
    survey_date: '2024-06-10',
    species_id: 100,
    species_name: 'Betony',
    species_scientific_name: 'Betonica officinalis',
    conservation_status: null,
    percent_frequency: null,
    frequency_band: null,
    ...overrides,
  };
}

describe('swardLocations', () => {
  it('lists distinct locations, busiest first', () => {
    const rows = [
      row({ location_id: 1, survey_id: 10 }),
      row({ location_id: 1, survey_id: 11, survey_date: '2026-06-05' }),
      row({ location_id: 2, location_name: 'Field 2207', survey_id: 12 }),
    ];
    const locations = swardLocations(rows);
    expect(locations.map((l) => l.name)).toEqual(['SSSI (2991)', 'Field 2207']);
    expect(locations[0].surveyCount).toBe(2);
  });
});

describe('buildSwardMatrix', () => {
  const rows: SwardRow[] = [
    row({ survey_id: 10, survey_date: '2024-06-10', species_id: 100, species_name: 'Betony', percent_frequency: '68.30', frequency_band: '4' }),
    row({ survey_id: 10, survey_date: '2024-06-10', species_id: 101, species_name: "Devil's-bit Scabious", percent_frequency: '53.30', frequency_band: '3' }),
    row({ survey_id: 11, survey_date: '2026-06-05', species_id: 100, species_name: 'Betony', percent_frequency: '52.10', frequency_band: '3' }),
    row({ survey_id: 11, survey_date: '2026-06-05', species_id: 101, species_name: "Devil's-bit Scabious", percent_frequency: '4.20', frequency_band: '1' }),
    row({ survey_id: 11, survey_date: '2026-06-05', species_id: 102, species_name: 'Sneezewort', conservation_status: 'Somerset Notable', frequency_band: '+' }),
    // A different parcel must not leak in.
    row({ location_id: 2, location_name: 'Field 2207', survey_id: 12, species_id: 100 , frequency_band: '2' }),
  ];

  it('pivots to chronological survey columns with year labels', () => {
    const matrix = buildSwardMatrix(rows, 1);
    expect(matrix.surveys.map((s) => s.label)).toEqual(['2024', '2026']);
    expect(matrix.species).toHaveLength(3);
  });

  it('fills cells with parsed percents and bands, null when unrecorded', () => {
    const matrix = buildSwardMatrix(rows, 1);
    const scabious = matrix.species.find((s) => s.id === 101)!;
    expect(scabious.cells[0]).toEqual({ band: '3', percent: 53.3 });
    expect(scabious.cells[1]).toEqual({ band: '1', percent: 4.2 });
    const sneezewort = matrix.species.find((s) => s.id === 102)!;
    expect(sneezewort.cells[0]).toBeNull();
    expect(sneezewort.cells[1]).toEqual({ band: '+', percent: null });
    expect(sneezewort.notable).toBe(true);
  });

  it('derives a band when only a percent was recorded', () => {
    const matrix = buildSwardMatrix(
      [row({ percent_frequency: 92, frequency_band: null })],
      1,
    );
    expect(matrix.species[0].cells[0]).toEqual({ band: '5', percent: 92 });
  });

  it('orders species by their latest-survey strength', () => {
    const matrix = buildSwardMatrix(rows, 1);
    expect(matrix.species[0].name).toBe('Betony');
    expect(matrix.species[matrix.species.length - 1].name).toBe('Sneezewort');
  });

  it('counts richness per survey column', () => {
    const matrix = buildSwardMatrix(rows, 1);
    expect(matrix.richness).toEqual([2, 3]);
  });
});

describe('winnersLosers', () => {
  it('compares the two latest surveys by percent', () => {
    const matrix = buildSwardMatrix([
      row({ survey_id: 10, survey_date: '2024-06-10', species_id: 101, species_name: "Devil's-bit Scabious", percent_frequency: 53.3 }),
      row({ survey_id: 11, survey_date: '2026-06-05', species_id: 101, species_name: "Devil's-bit Scabious", percent_frequency: 4.2 }),
      row({ survey_id: 10, survey_date: '2024-06-10', species_id: 103, species_name: 'Common Bent', percent_frequency: null, frequency_band: '+' }),
      row({ survey_id: 11, survey_date: '2026-06-05', species_id: 103, species_name: 'Common Bent', percent_frequency: 72.9 }),
      row({ survey_id: 11, survey_date: '2026-06-05', species_id: 104, species_name: 'Tufted Vetch', percent_frequency: 58.3 }),
    ], 1);
    const { risers, fallers } = winnersLosers(matrix);
    // Common Bent's 2024 record is band-only: skipped, not treated as 0.
    expect(risers.map((r) => r.name)).toEqual(['Tufted Vetch']);
    expect(risers[0]).toMatchObject({ from: 0, to: 58.3 });
    expect(fallers.map((f) => f.name)).toEqual(["Devil's-bit Scabious"]);
    expect(fallers[0].delta).toBeCloseTo(-49.1);
  });

  it('returns nothing with fewer than two surveys', () => {
    const matrix = buildSwardMatrix([row({ percent_frequency: 10 })], 1);
    expect(winnersLosers(matrix)).toEqual({ risers: [], fallers: [] });
  });
});
