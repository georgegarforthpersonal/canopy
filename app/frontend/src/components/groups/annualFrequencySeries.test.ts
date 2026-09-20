import { describe, expect, it } from 'vitest';
import type { SwardCompositionRow } from '../../services/api';
import {
  annualLocationOptions,
  annualSpeciesOptions,
  buildAnnualSeries,
  MAX_ANNUAL_LOCATIONS,
} from './annualFrequencySeries';

function row(overrides: Partial<SwardCompositionRow>): SwardCompositionRow {
  return {
    location_id: 1,
    location_name: 'SSSI (2991)',
    survey_id: 10,
    survey_date: '2024-06-10',
    species_id: 100,
    species_name: "Devil's-bit Scabious",
    species_scientific_name: 'Succisa pratensis',
    percent_frequency: null,
    frequency_band: null,
    ...overrides,
  };
}

describe('annualSpeciesOptions', () => {
  it('orders species by record count, then name', () => {
    const options = annualSpeciesOptions([
      row({ species_id: 1, species_name: 'Betony' }),
      row({ species_id: 1, species_name: 'Betony', survey_id: 11 }),
      row({ species_id: 2, species_name: 'Aardvark Grass' }),
    ]);
    expect(options.map((o) => o.name)).toEqual(['Betony', 'Aardvark Grass']);
    expect(options[0].records).toBe(2);
  });
});

describe('buildAnnualSeries', () => {
  const rows: SwardCompositionRow[] = [
    // Devil's-bit in the SSSI: band-only 2020, measured 2023/2024/2026.
    row({ survey_id: 1, survey_date: '2020-07-28', frequency_band: '1+' }),
    row({ survey_id: 2, survey_date: '2023-07-06', percent_frequency: '13.89', frequency_band: '1+' }),
    row({ survey_id: 3, survey_date: '2024-06-10', percent_frequency: 53.3, frequency_band: '3' }),
    row({ survey_id: 4, survey_date: '2026-06-05', percent_frequency: 4.2, frequency_band: '1' }),
    // ...and in 2207.
    row({ location_id: 2, location_name: 'Field 2207', survey_id: 5, survey_date: '2023-07-06', percent_frequency: 13.89 }),
    row({ location_id: 2, location_name: 'Field 2207', survey_id: 6, survey_date: '2026-07-16', percent_frequency: 20.8 }),
    // Another species' 2021 survey widens the year domain.
    row({ species_id: 200, species_name: 'Yorkshire Fog', survey_id: 7, survey_date: '2021-07-01', percent_frequency: 92 }),
  ];

  it('returns null for an unknown species', () => {
    expect(buildAnnualSeries(rows, 999)).toBeNull();
  });

  it('spans every survey year in the dataset, not just the species years', () => {
    const series = buildAnnualSeries(rows, 100)!;
    expect(series.years).toEqual([2020, 2021, 2023, 2024, 2026]);
  });

  it('builds one line per location with nulls for unmeasured years', () => {
    const series = buildAnnualSeries(rows, 100)!;
    expect(series.locations.map((l) => l.name)).toEqual(['SSSI (2991)', 'Field 2207']);
    const y2024 = series.rows.find((r) => r.year === 2024)!;
    expect(y2024['SSSI (2991)']).toBe(53.3);
    expect(y2024['Field 2207']).toBeNull();
    const y2023 = series.rows.find((r) => r.year === 2023)!;
    expect(y2023['SSSI (2991)']).toBe(13.89);
    expect(y2023['Field 2207']).toBe(13.89);
  });

  it('keeps band-only records as ranges, not point values', () => {
    const series = buildAnnualSeries(rows, 100)!;
    expect(series.ranges).toHaveLength(1);
    expect(series.ranges[0]).toMatchObject({ year: 2020, band: '1+', lo: 11, hi: 20 });
    const y2020 = series.rows.find((r) => r.year === 2020)!;
    expect(y2020['SSSI (2991)']).toBeNull();
  });

  it('caps the location count and names what it dropped', () => {
    const many: SwardCompositionRow[] = [];
    for (let i = 0; i < MAX_ANNUAL_LOCATIONS + 2; i++) {
      many.push(row({
        location_id: i, location_name: `Field ${i}`,
        survey_id: 100 + i, percent_frequency: 10 + i,
      }));
      // A second record for the first few keeps ranking deterministic.
      if (i < MAX_ANNUAL_LOCATIONS) {
        many.push(row({
          location_id: i, location_name: `Field ${i}`,
          survey_id: 200 + i, survey_date: '2026-06-05', percent_frequency: 5,
        }));
      }
    }
    const series = buildAnnualSeries(many, 100)!;
    expect(series.locations).toHaveLength(MAX_ANNUAL_LOCATIONS);
    expect(series.droppedNames).toHaveLength(2);
    expect(series.recordedLocations).toBe(MAX_ANNUAL_LOCATIONS + 2);
    expect(series.singleLocation).toBe(false);
    // Every dropped name must be selectable, which is the whole point of
    // naming them rather than counting them.
    for (const name of series.droppedNames) {
      expect(buildAnnualSeries(many, 100, name)!.locations[0].name).toBe(name);
    }
  });

  it('pins to one location, ignoring the cap', () => {
    const series = buildAnnualSeries(rows, 100, 'Field 2207')!;
    expect(series.locations.map((l) => l.name)).toEqual(['Field 2207']);
    expect(series.singleLocation).toBe(true);
    expect(series.droppedNames).toEqual([]);
    expect(series.recordedLocations).toBe(2);
  });

  it('pins the "No location" bucket, which has no id', () => {
    const withNone = [
      ...rows,
      row({ location_id: null, location_name: null, survey_id: 8, survey_date: '2024-06-10', percent_frequency: 30 }),
    ];
    const series = buildAnnualSeries(withNone, 100, 'No location')!;
    expect(series.locations.map((l) => l.name)).toEqual(['No location']);
    const y2024 = series.rows.find((r) => r.year === 2024)!;
    expect(y2024['No location']).toBe(30);
  });

  it('returns null when the species was never recorded at the pinned location', () => {
    expect(buildAnnualSeries(rows, 100, 'Field 9999')).toBeNull();
  });

  it('counts every location with data, recorded or not', () => {
    // Yorkshire Fog's location is in the dataset but has no Devil's-bit.
    const series = buildAnnualSeries(rows, 100)!;
    expect(series.recordedLocations).toBe(2);
    expect(series.totalLocations).toBe(2);
  });
});


describe('annualLocationOptions', () => {
  it('lists every location with data, alphabetically, with survey counts', () => {
    const options = annualLocationOptions([
      row({ location_id: 2, location_name: 'Field 2207', survey_id: 5 }),
      row({ location_id: 1, location_name: 'SSSI (2991)', survey_id: 1 }),
      row({ location_id: 1, location_name: 'SSSI (2991)', survey_id: 1, species_id: 200 }),
      row({ location_id: 1, location_name: 'SSSI (2991)', survey_id: 2 }),
    ]);
    expect(options.map((o) => o.name)).toEqual(['Field 2207', 'SSSI (2991)']);
    // Two distinct surveys, not three rows.
    expect(options.find((o) => o.name === 'SSSI (2991)')!.surveys).toBe(2);
  });
});
