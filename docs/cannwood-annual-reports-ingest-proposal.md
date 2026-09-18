# Cannwood annual monitoring reports: ingest, analysis and presentation proposal

Six PDFs from `~/Desktop/cannwood/reports`: Cannwood 2020, 2021, 2023, 2024, 2025, 2026.
Author: Dr Chris Smith (Farm & Countryside Liaison Services), one report per year. A 2022
report exists (cited as "Smith, C.J. (2022). Ecological Monitoring Report 2022") but is not
in the folder. Worth asking Ben or Chris Smith for a copy: it would close the gap between the
2021 Lark Farm baseline and the 2023 resurvey.

## 1. What the data actually is

The quantitative core of every report is repeat botanical quadrat/transect surveys of named
field parcels, recording, per species per parcel per year:

- **Percentage frequency**: % of sampling quadrats containing the species (decimal, 0-100).
- **Relative frequency band**: the report's own convention, derived from %:
  `5` = 81-100%, `4` = 61-80, `3` = 41-60, `2` = 21-40, `1+` = 11-20, `1` = 1-10,
  `+` = seen in the parcel (walkabout) but never caught by a quadrat.

Sampling design varies by year (3 replicates x 16 quadrats, 3 transects x 12 quadrats,
15 random quadrats per plot, etc.) and is stated in each table's caption. Species codes
(AC, SNQ, LC...) are stable across all six years. Nomenclature is Stace (2019) throughout.

### Table inventory (the ingestable data)

| Year | Table | Parcels | Metric | Extraction |
|---|---|---|---|---|
| 2020 | T1 | SSSI (2991), 2207, 1417, 1970, 4483, 5474 | band only | **scanned image** (p.7), legible, needs visual transcription |
| 2020 | T2 | 7494 ("pond spoil"/Animal House) | % + band | clean text |
| 2021 | T1 | Lark Farm baseline: 0269, 1765, 0845, 6046, 7937, 7826 | % only | clean text |
| 2021 | T2 | 7494 (2021 column; 2020 repeated) | % only | clean text |
| 2023 | T1 | SSSI, 1417, 2207 | % | clean text |
| 2023 | T2 | 7494 (rewilded area) | % | clean text |
| 2024 | T1 | SSSI | % + band | clean text |
| 2025 | T1 | Farmhouse plots A, B | band only | clean text |
| 2026 | T1 | SSSI (with 2024 columns repeated) | % + band | clean text |
| 2026 | T2 | 2207, 1417 (mown areas) | % + band | clean text |
| 2026 | T3 | Plots A, B (2025 cols repeated) | presence + "dominant" (red text) | text loses the red; needs visual pass for dominance flags |

Plus presence-only species lists: Lark 0259 walkabout (2025, 8 recruits from SSSI hay
strewing), West End Wood flora (2021, 2023). Roughly **1,000 observation rows** and
**130-140 distinct plant species** in total. All recoverable; only 2020 T1 and the 2026 T3
red-flags need eyes-on transcription rather than text parsing.

### Known data quirks to normalise at ingest

- Parcel number inconsistencies: 2021 T1 says `0269`/`7826`; every later report says
  `0259`/`9826`. Verify against the 2021 PDF page image; almost certainly the same fields.
- Nomenclature slips to correct against a canonical list: "Myosotis arvemsis",
  *Hypochaeris maculata* (2023, should be *radicata* for Cat's-ear), *Carex hirsuta* vs
  *hirta*, *Lathyrus linifolia/linifolius*, *Scrophularia aquatica* (now *auriculata*),
  "Red Closer".
- Aggregate records that never resolve to one species: *Dactylorhiza fuchsii/maculata*
  (+ hybrids), *Agrostis capillaris/stolonifera* (some years), LC/LUG combined (2023 T2),
  *Phleum pratense/bertolonii* (2021). Create aggregate species rows (e.g. "Common/Heath
  Spotted Orchid (agg.)") where the report only ever records the aggregate, rather than
  guessing a split.
- 2020 SSSI survey started late (Covid): early-flowering species under-recorded that year.
  Keep as a caveat annotation, not a data change.

## 2. Storage: mapping onto the existing schema

The guiding principle: this is ordinary Canopy data (Survey -> Sightings against Species at
a Location), plus one small, precedented extension for the frequency metric. It follows the
BDS Odonata pattern exactly (nullable domain columns on `sighting` + an `allow_*` flag on
`survey_type`), not a new method abstraction.

### 2.1 Species (the "species of type plant" bit)

- `species_type` row `plant` already exists and is empty (`refactor_species_types.py`).
- Create ~130-140 `species` rows: `name` (common), `scientific_name` (Stace),
  `species_code` = the report's own code (fits the 10-char column), `species_type_id` =
  plant. Match `nbn_atlas_guid` via the existing NBN tooling (`migrate_species.py`
  precedent) so records are join-able to national data later.
- Conservation flags worth carrying into `conservation_status`: the reports' "Somerset
  Notable" species (Dyer's Greenweed, Saw-wort, Meadow Thistle, Sneezewort, Corky-fruited
  Water Dropwort, Fragrant Orchid).

### 2.2 Sighting extension (one migration)

```
sighting.percent_frequency   NUMERIC(5,2) NULL   -- % of quadrats containing the species
sighting.frequency_band      VARCHAR(2)   NULL   -- '+','1','1+','2','3','4','5'
survey_type.allow_frequency_score BOOLEAN DEFAULT FALSE
```

- When the source gives %, store it and derive the band; when the source gives only a band
  (2020 T1, 2025 T1), store the band alone. Presence-only records ("+" or walkabout lists)
  get `frequency_band='+'`.
- `count` stays 1 for all botanical sightings (presence); it is meaningless for quadrat
  data and nothing downstream should sum it. Same spirit as BDS's zero-count rule.
- "Dominant" flags from 2026 T3 go in `sighting.notes`, not into invented band values.
- Gotcha from the fixed-species work: the survey-type details endpoint builds its field
  list by hand, so the new `allow_frequency_score` flag must be added there too.

### 2.3 Survey type, surveys, locations

- One new Cannwood survey type, e.g. **"Botanical"** (species types: plant;
  `location_at_sighting_level=false`, `record_mode=list`, `allow_sighting_notes=true`,
  `allow_frequency_score=true`, no geolocation per sighting). Both quadrat surveys and
  walkabouts live in this one type; the sightings' fields distinguish them.
- One `survey` row per (parcel, visit date, method). Visit dates are mostly stated in the
  reports (e.g. SSSI: 28 Jul 2020, 5 Jun 2026); where only a month is known, use the
  report's stated survey window and say so in `survey.notes`. Notes also carry methodology
  and provenance, e.g. "3 transects x 12 quadrats. Source: Annual Monitoring Report 2023,
  Table 1."
- Surveyor row: "Chris Smith".
- Locations: area locations for each parcel, named with both the friendly name and RPA
  number, e.g. "SSSI meadow (2991)", "Animal House field (7494)", "Lark Farm docky east
  (7937)". Boundary polygons via the existing `add_field_boundaries.py` +
  `scripts/data/field_coordinates.json` path; geometry digitised from the reports'
  Appendix II field-number maps / RPA data (some Cannwood work already produced
  `docs/cannwood-boundary.geojson`). The farmhouse plots A/B/C are small area locations too.
- Attach the six report PDFs to the survey type via the existing `survey_type_file`
  reference-files feature, so the source documents live next to the data.

### 2.4 Ingest pipeline

1. **Transcribe** every table into one canonical CSV
   (`year, source_table, parcel, species_code, common_name, scientific_name,
   percent_frequency, band, note`). Text-extracted tables are machine-parseable per-table;
   2020 T1 and 2026 T3 dominance flags are transcribed from the page images.
2. **Normalise**: species-code cross-check across years, nomenclature fixes, parcel-number
   reconciliation. Spot-check totals against the reports' own "total species per parcel"
   rows (they publish these, which gives us a free checksum per table).
3. **Import script** `scripts/import_cannwood_botanical.py`: dry-run by default (house
   style), idempotent (natural key: survey + species), creates species/locations/surveys/
   sightings. Run on staging first, then prod (migrations are manual on prod).

## 3. Interesting conclusions the data supports

These are the stories the charts should be built around; all are directly supported by the
tables, not just the prose.

1. **Management vs abandonment, a natural experiment.** Three treatments, one farm:
   - SSSI (continuous traditional hay cut + aftermath grazing): richness 50 (2020, late
     start) -> 56 (2023) -> 66 (2024) -> 71 (2026). Rising.
   - 2207/1417 (mowing lapsed after drain break-up, partially restored 2024): richness rose
     to 2023 (38->46, 38->56), then the unmown margins scrub up (oak, hazel, bramble in the
     2026 tables) while restored mown areas recover.
   - 7494 (rewilded, ungrazed): 42 -> 42 -> 31 species, with Soft Rush 2.4% -> 8.8% ->
     **86.1%**. The single most dramatic trajectory in the dataset.
   The reports say this in prose every year; the app can show it in one chart.
2. **Devil's-bit Scabious x Marsh Fritillary.** SSSI frequency: 13.9% (2023) -> 53.3%
   (2024) -> 4.2% (2026), and Marsh Fritillary returned in 2025 after 20 years (3 adults,
   20 May 2025), larval webs found Aug 2026. Devil's-bit is its only larval food plant, and
   uncut refuge strips were agreed with Natural England in 2025 and 2026. This is the
   flagship conservation story: one annotated timeline chart.
3. **Marsh Ragwort watch.** The farm's running management concern: 7494 21.4% (2020) ->
   53.8% (2021) -> 8.3% (2023); persistent in 1417 (33.3% in 2026); plus the 2026
   gall-infected specimen (second UK record after Orkney). Trackable per parcel.
4. **Lark Farm restoration from a measured baseline.** 2021 quadrats show the starting
   poverty (15-20 species per field, "grassy" vs "docky" field types); by 2025 the first
   SSSI species (Sneezewort, Knapweed, Bird's-foot Trefoil...) recruit into 0259 after hay
   strewing. Future quadrats land on top of a proper baseline already in the app.
5. **Wildflower plot succession, live.** Plots A/B 2025 -> 2026: annual ruderals collapse
   (Fat Hen, Scarlet Pimpernel, Chickweed out), biennials take over (Bristly Ox-tongue
   explosion), Milk Thistle and Chicory appear. A textbook succession sequence in two rows
   of data, and it continues from 2027.
6. **Functional composition.** Every table separates ferns/grasses-sedges-rushes/herbs, so
   grass:forb balance per parcel per year is computable, which is the report's own measure
   of "coarsening" under abandonment.
7. **Indicator/notable species tracking.** Presence of the MG5 meadow indicators and
   Somerset Notables per parcel per year as an SSSI-condition proxy (Natural England
   condition assessments are mentioned as overdue in two reports; this gives the farm its
   own evidence base).

Context annotations worth storing with surveys (in notes) because every trend needs them:
2020 Covid late start, 2023 drought/deluge see-saw, 2024 record wet + national butterfly
crash, 2025 cold-then-bumper, 2026 heat and drought.

## 4. Presentation: charts and app surfaces

The Botanical group page (Groups feature, per-survey-type overview) gets a bespoke
"Sward composition" section; survey detail pages render the sightings as the report's own
table style. Concretely:

1. **Species x year frequency heatmap** (per parcel). Rows = species grouped
   ferns/grasses/herbs, columns = survey years, cell colour = band (with % on hover).
   The whole 6-year story of a meadow on one screen; this is the signature chart.
2. **Richness trend lines** per parcel, with event annotations (Covid, drains broken,
   mowing restored, drought years).
3. **Winners and losers** diverging bars between any two survey years of a parcel
   (e.g. SSSI 2024 -> 2026: Common Bent +72.9, Devil's-bit -49.1).
4. **Single-species trajectory** small multiples: one species' % across all parcels over
   time (Devil's-bit, Marsh Ragwort, Soft Rush are the obvious presets).
5. **Parcel choropleth with year scrubber** on the existing group map: parcels coloured by
   species richness (or a selected species' frequency) per year. Location polygons make
   this nearly free once boundaries exist.
6. **Story panel** for Marsh Fritillary: Devil's-bit frequency line + butterfly event
   markers (2005 last seen, 2025 return, 2026 larval webs).

Charts 1-4 are pure derivations of the sightings table; 5 needs boundaries; 6 needs the
fauna incidentals (phase 3).

## 5. Phasing

- **Phase 1, data in**: migration (2 columns + flag), plant species creation with NBN
  matching, parcel locations + boundaries, transcription CSV, import script, PDF
  attachments. Everything else depends on this.
- **Phase 2, presentation**: sward composition panel (heatmap + richness trend +
  winners/losers), survey detail table rendering, frequency entry UI for future botanical
  surveys (so Chris Smith's 2027 survey can be entered directly, which is the real payoff:
  the series continues in the app instead of in PDFs).
- **Phase 3, enrichment**: incidental fauna from the reports as ad hoc sightings
  (Marsh Fritillary dates, Wasp Spider, Clouded Yellow, the 2026 Stork...), map choropleth,
  and possibly Nick Adams' breeding bird survey reports (2021-2023, referenced but not in
  hand) given the same treatment for birds.

## 6. Open questions

1. Can we get the 2022 report (and Nick Adams' bird reports) from Ben/Chris Smith?
2. Parcel boundary source: digitise from the report maps, or is RPA parcel geometry
   available for the holding?
3. Should walkabout presence-only records ("+") appear in richness counts and charts, or
   only quadrat-derived records? (Proposal: include, but visually distinguish, since the
   reports' own totals include them.)
4. One "Botanical" survey type, or split quadrat vs walkabout? (Proposal: one.)
