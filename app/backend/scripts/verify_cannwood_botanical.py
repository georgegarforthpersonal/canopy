"""
Verify the transcribed Cannwood botanical data against the reports' own totals.

Checks every table in scripts/data/cannwood_botanical/ without touching a
database: species slugs resolve in the registry, parcels resolve in the
location registry, cell values are well formed, no species appears twice in a
table, and the per-parcel species counts match the totals printed in the source
reports (`expected_totals`), applying each table's `count_rule` (woody
seedlings are excluded where the report counts herbaceous species only; rows
marked `extra` never count).

Usage:
    python3 scripts/verify_cannwood_botanical.py

Exits non-zero on any failure. No database connection is needed.
"""

import json
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data" / "cannwood_botanical"

BAND_VALUES = {"+", "1", "1+", "2", "3", "4", "5"}
PRESENCE_VALUES = {"+", "D"}

TABLE_FILES = [
    "tables_2020.json",
    "tables_2021.json",
    "tables_2023.json",
    "tables_2024.json",
    "tables_2025.json",
    "tables_2026.json",
    "presence_lists.json",
]


def load(name: str) -> dict:
    with open(DATA_DIR / name) as f:
        return json.load(f)


def cell_parts(cell):
    """Normalise a cell to (value, note, extra)."""
    if isinstance(cell, dict):
        return cell.get("value"), cell.get("note"), bool(cell.get("extra"))
    return cell, None, False


def check_value(table, metric, value, errors):
    if value is None:
        return
    if isinstance(value, (int, float)):
        if metric == "band" or metric == "presence":
            errors.append(f"{table}: numeric value {value} in a {metric} table")
        elif not (0 < value <= 100):
            errors.append(f"{table}: percent {value} out of range")
    elif isinstance(value, str):
        allowed = PRESENCE_VALUES if metric == "presence" else BAND_VALUES
        if metric == "percent":
            allowed = {"+"}  # percent tables may only carry walkabout presence
        if value not in allowed:
            errors.append(f"{table}: bad value {value!r} for metric {metric}")
    else:
        errors.append(f"{table}: unsupported cell type {type(value).__name__}")


def main() -> int:
    errors: list[str] = []

    registry = {s["slug"]: s for s in load("species.json")["species"]}
    codes = [s["code"] for s in load("species.json")["species"] if s["code"]]
    dup_codes = {c for c in codes if codes.count(c) > 1}
    if dup_codes:
        errors.append(f"species.json: duplicate codes {sorted(dup_codes)}")

    location_keys = {loc["key"] for loc in load("locations.json")["locations"]}

    used_slugs: set[str] = set()
    tables = 0
    observations = 0

    for filename in TABLE_FILES:
        for table in load(filename)["tables"]:
            tables += 1
            name = table["table"]
            metric = table["metric"]
            parcels = table["parcels"]
            herbaceous_only = "herbaceous" in table.get("count_rule", "")

            for parcel in parcels:
                if parcel not in location_keys:
                    errors.append(f"{name}: unknown parcel {parcel!r}")

            counts = {p: 0 for p in parcels}
            seen: set[str] = set()
            for row in table["rows"]:
                slug, *cells = row
                if slug not in registry:
                    errors.append(f"{name}: unknown species {slug!r}")
                    continue
                if slug in seen:
                    errors.append(f"{name}: species {slug!r} appears twice")
                seen.add(slug)
                used_slugs.add(slug)
                if len(cells) != len(parcels):
                    errors.append(f"{name}: row {slug!r} has {len(cells)} cells for {len(parcels)} parcels")
                    continue
                group = registry[slug]["group"]
                for parcel, cell in zip(parcels, cells):
                    value, _note, extra = cell_parts(cell)
                    check_value(name, metric, value, errors)
                    if value is None:
                        continue
                    observations += 1
                    if extra or (herbaceous_only and group == "woody"):
                        continue
                    counts[parcel] += 1

            for parcel, expected in table["expected_totals"].items():
                got = counts.get(parcel)
                if got != expected:
                    errors.append(f"{name}: parcel {parcel} has {got} species, report prints {expected}")

    unused = set(registry) - used_slugs
    if unused:
        errors.append(f"species.json: unreferenced species {sorted(unused)}")

    fauna = load("fauna.json")["records"]
    for record in fauna:
        for field in ("date", "species_name", "count", "notes"):
            if record.get(field) in (None, ""):
                errors.append(f"fauna.json: record missing {field}: {record.get('species_name', '?')}")
        loc = record.get("location")
        if loc is not None and loc not in location_keys:
            errors.append(f"fauna.json: unknown location {loc!r}")

    print(f"{tables} tables, {observations} observations, {len(registry)} species, {len(fauna)} fauna records")
    if errors:
        print(f"\n{len(errors)} problem(s):")
        for error in errors:
            print(f"  - {error}")
        return 1
    print("All checks passed: every table matches its report's published totals.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
