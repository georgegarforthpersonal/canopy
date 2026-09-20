# Cannwood botanical monitoring data (2020-2026)

Hand-transcribed quantitative data from the Cannwood/Lark Farm annual monitoring reports
by Dr C.J. Smith (Farm & Countryside Liaison Services): PDFs `Cannwood 2020/2021/2023/
2024/2025/2026.pdf`. A 2022 report exists (cited in the 2023 report) but was not available
at transcription time. Transcribed September 2026; every table checksummed against the
report's own published per-parcel species totals (see `expected_totals` in each table and
`scripts/verify_cannwood_botanical.py`).

## Files

- `species.json`: canonical plant species registry (slug, common/scientific name, report
  code, group, Somerset Notable flag). Slugs are what the table files reference.
- `locations.json`: field parcels, sown plots and West End Wood, keyed for the tables.
- `tables_YYYY.json`: the quadrat/transect tables, one file per report year.
- `presence_lists.json`: walkabout presence-only species lists the reports enumerate.
- `fauna.json`: curated notable fauna records (imported only when the species already
  exists in the database).

## Value encoding

- Number = percentage frequency (% of quadrats containing the species).
- `"+"`, `"1"`, `"1+"`, `"2"`, `"3"`, `"4"`, `"5"` = relative frequency band, the
  reports' convention: 5 = 81-100% of quadrats, 4 = 61-80, 3 = 41-60, 2 = 21-40,
  1+ = 11-20, 1 = 1-10, + = present in the parcel (walkabout) but not caught by a quadrat.
- `"D"` = present and flagged dominant (printed in red in the 2026 Table 3; stored as
  band `"+"` with a "dominant" note on import).
- `null` = not recorded in that parcel.
- A cell may be an object `{"value": ..., "note": "...", "extra": true?}`. `note` becomes
  the sighting note; `extra` marks records added from prose/captions that are not part of
  the printed table (excluded from checksums).

## Editorial decisions and source quirks

1. **Parcel numbers.** The 2021 Table 1 header prints `0269` and `7826`; the same
   report's prose and all later reports use `0259` and `9826`. Canonicalised to
   0259/9826 with the printed variants kept as aliases.
2. **Aggregates.** `spotted-orchid-agg` (Dactylorhiza fuchsii/maculata + hybrids) is used
   from 2023 on, where the reports record the aggregate; the 2020 table scores the two
   species separately and is kept that way. `common-creeping-bent-agg` (Agrostis
   capillaris/stolonifera) is used only for the 2021 tables, which are labelled as the
   aggregate; other years score Common Bent (A. capillaris). The 2021 `PHX`
   (Phleum pratense/bertolonii) row and the 2023 `LC/LUG` row are assigned to Timothy and
   Bird's-foot Trefoil respectively, with the combination noted on the sighting.
3. **Nomenclature corrections** (canonical name <- as printed somewhere in the series):
   Carex hirta <- "Carex hirsuta" (2023/2024/2026); Hypochaeris radicata <-
   "Hypochaeris maculata" (2023); Ajuga reptans <- "Ajuga repens" (2023);
   Lathyrus linifolius <- "Lathyrus linifolia" (2024/2026); Scrophularia auriculata
   (Water Figwort/Water Betony) <- "Scrophularia aquatica" (2023); Myosotis arvensis <-
   "Myosotis arvemsis" (2021); Senecio vulgaris <- "Senecio vulgare" (2021).
   "Flea Sedge Carex pilulifera" (2024) is kept as printed (the name pairing is the
   report's; C. pilulifera is conventionally Pill Sedge).
   Bitter Vetch is coded LLF (2023) and LMO (2024/2026) in the source; LLF is kept.
4. **Published totals that count aggregates as two.** 2021 T1 (46 total, counting
   Agrostis as 2), 2021 T2 (42, counting Agrostis and Phleum as 2 each), 2023 T2
   (31, counting LC/LUG as 2), 2024 T1 (66, counting DZF/DMC as 2). `expected_totals`
   in the table files hold the row-count equivalents; `count_rule` documents the source
   convention.
5. **2020 Table 1** is a scanned image in the PDF (no text layer); transcribed visually
   at 300dpi and checksummed against all six published parcel totals (50/38/38/36/31/30,
   all matching). The 2020 prose says Devil's-bit was a newcomer in 5474; the printed
   table scores it in 4483 (+) and not 5474. The table is followed.
6. **Restated columns are not re-imported**: the 2020 column of 2021 T2, the 2024
   columns of 2026 T1, and the 2025 columns of 2026 T3 (which differ marginally from the
   2025 report's own Table 1: the 2026 restatement adds Common Vetch to plot B and counts
   39 where the 2025 report printed 38; the 2025 report's own table is used for 2025).
7. **Dates.** Where the report states the survey date it is used (`date_precision:
   "day"`); otherwise the closest stated visit/window is used with `date_precision:
   "month"` and the approximation is noted on the imported survey. 2026 T2's caption says
   16 July where the report text says 29 June; the caption is followed.
8. **Sneezewort 2024** prints F% 1.7 with RF "+" (inconsistent in the source); the
   percent is stored.
9. **Weather/effort context** (annotate any trend reading): 2020 field work started mid
   July only (Covid lockdown), so early-flowering species are under-recorded that year;
   2023 was drought/deluge see-saw; 2024 was exceptionally wet (national butterfly crash);
   2025 cold spring then a bumper season; 2026 prolonged heat and drought.

## Import

`scripts/import_cannwood_botanical.py` (dry-run by default) creates the plant species,
parcel locations (matched by name/alias first), the Botanical survey type, the Chris
Smith surveyor row, and one survey per (table, parcel) with sightings carrying
`percent_frequency` and/or `frequency_band`. `scripts/verify_cannwood_botanical.py`
re-checks every table against `expected_totals` without touching a database.
