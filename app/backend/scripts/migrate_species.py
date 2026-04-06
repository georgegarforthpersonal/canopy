"""
Match NBN Atlas species against database and migrate with interactive approval.

Usage:
    ./dev-run migrate_species.py -s butterflies              # Dry-run (preview only)
    ./dev-run migrate_species.py -s butterflies --no-dry-run # Apply to database
    ./dev-run migrate_species.py -s birds --export file.json --no-dry-run
    ./dev-run migrate_species.py -s spiders                  # Dry-run for spiders and harvestmen
    ./dev-run migrate_species.py -s spiders --add-only --no-dry-run  # Only add new species, skip updates
    ./dev-run migrate_species.py -s mammals                  # Dry-run for mammals
    ./dev-run migrate_species.py -s bats                     # Dry-run for bats
    ./dev-run migrate_species.py -s reptiles                 # Dry-run for reptiles
    ./dev-run migrate_species.py -s amphibians               # Dry-run for amphibians
    ./dev-run migrate_species.py -s moths                    # Dry-run for moths
    ./dev-run migrate_species.py -s beetles                  # Dry-run for beetles (Coleoptera)
    ./dev-run migrate_species.py -s flies                    # Dry-run for true flies (Diptera)
    ./dev-run migrate_species.py -s bees-wasps-ants          # Dry-run for Hymenoptera
    ./dev-run migrate_species.py -s bugs                     # Dry-run for bugs (Hemiptera)
    ./dev-run migrate_species.py -s dragonflies-damselflies  # Dry-run for Odonata
    ./dev-run migrate_species.py -s grasshoppers-crickets    # Dry-run for Orthoptera
    ./dev-run migrate_species.py -s insects                  # Dry-run for other insects not in above categories
    ./dev-run migrate_species.py -s mites                    # Dry-run for mites (Acari)
    ./dev-run migrate_species.py -s fungi                    # Dry-run for fungi and lichens
    ./dev-run migrate_species.py -s woodlice                 # Dry-run for woodlice (Isopoda)

Defaults to dry-run mode. Use --no-dry-run to write to database.
"""

import logging
import sys
import json
import csv
from dataclasses import dataclass
from typing import Optional
from pathlib import Path
from datetime import datetime

from rapidfuzz import fuzz, process

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from clients.nbn_atlas import NBNAtlasClient
from database.connection import get_db_cursor
from script_utils import get_arg_parser


logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s'
)
logger = logging.getLogger(__name__)


# ============================================================================
# CONFIGURATION
# ============================================================================

MATCH_THRESHOLD_HIGH = 90  # High confidence match (auto-approved)
MATCH_THRESHOLD_LOW = 70   # Low confidence match (requires approval)

# Species type configuration
SPECIES_CONFIG = {
    "birds": {
        "db_type": "bird",
        "api_filter": "taxonGroup_s:bird",
        "display_name": "Birds",
        "min_occurrence": 100,
        "allowed_ranks": ["species"]  # Only species-level records
    },
    "butterflies": {
        "db_type": "butterfly",
        "api_filter": "taxonGroup_s:\"insect - butterfly\"",
        "display_name": "Butterflies",
        "min_occurrence": 100,
        "allowed_ranks": ["species"]  # Only species-level records
    },
    "spiders": {
        "db_type": "spider",
        "display_name": "Spiders and Harvestmen",
        "allowed_ranks": ["species"],  # Include family/genus (e.g., "crab spiders", "Zebra Spider")
        # Subgroups allow different filter criteria for spiders vs harvestmen
        "subgroups": [
            {
                "name": "Spiders",
                "api_filter": "taxonGroup_s:\"spider (Araneae)\"",
                "min_occurrence": 0,
                "require_common_name": False  # Include spiders without common names
            },
            {
                "name": "Harvestmen",
                "api_filter": "taxonGroup_s:\"harvestman (Opiliones)\"",
                "min_occurrence": 0,  # Include all (NBN API returns 0 for occurrence counts in filtered queries)
                "require_common_name": False,  # Harvestmen don't have common names in NBN
                "allowed_ranks": ["species"]  # Only species-level records
            }
        ]
    },
    "mammals": {
        "db_type": "mammal",
        "api_filter": "taxonGroup_s:\"terrestrial mammal\"",
        "display_name": "Mammals",
        "min_occurrence": 1000,  # Include all mammals with common names
        "allowed_ranks": ["species"]  # Only species-level records
    },
    "bats": {
        "db_type": "bat",
        "api_filter": "taxonGroup_s:\"terrestrial mammal\"",  # Bats are included under terrestrial mammal
        "display_name": "Bats",
        "min_occurrence": 100,  # Include all bats with common names
        "allowed_ranks": ["species"]  # Only species-level records
    },
    "reptiles": {
        "db_type": "reptile",
        "api_filter": "taxonGroup_s:reptile",
        "display_name": "Reptiles",
        "min_occurrence": 1000,  # Include all reptiles with common names
        "allowed_ranks": ["species"]  # Only species-level records
    },
    "amphibians": {
        "db_type": "amphibian",
        "api_filter": "taxonGroup_s:amphibian",
        "display_name": "Amphibians",
        "min_occurrence": 1000,  # Include all amphibians with common names
        "allowed_ranks": ["species"]  # Only species-level records
    },
    "moths": {
        "db_type": "moth",
        "api_filter": "taxonGroup_s:\"insect - moth\"",
        "display_name": "Moths",
        "min_occurrence": 0,  # Include moths with 1000+ occurrences
        "allowed_ranks": ["species"]  # Only species-level records
    },
    "beetles": {
        "db_type": "beetle",
        "api_filter": "taxonGroup_s:insect*",
        "api_filter_exclude": ["taxonGroup_s:\"insect - butterfly\"", "taxonGroup_s:\"insect - moth\""],
        "filter_by_order": "Coleoptera",
        "display_name": "Beetles (Coleoptera)",
        "min_occurrence": 100,
        "allowed_ranks": ["species"],
        "require_common_name": False
    },
    "flies": {
        "db_type": "fly",
        "api_filter": "taxonGroup_s:\"insect - true fly (Diptera)\"",
        "display_name": "True Flies (Diptera)",
        "min_occurrence": 0,  # NBN Atlas bulk queries don't return reliable occurrence counts
        "allowed_ranks": ["species"],
        "require_common_name": False
    },
    "bees-wasps-ants": {
        "db_type": "bee-wasp-ant",
        "api_filter": "taxonGroup_s:insect*",
        "api_filter_exclude": ["taxonGroup_s:\"insect - butterfly\"", "taxonGroup_s:\"insect - moth\""],
        "filter_by_order": "Hymenoptera",
        "display_name": "Bees, Wasps and Ants (Hymenoptera)",
        "min_occurrence": 0,
        "allowed_ranks": ["species"],
        "require_common_name": False
    },
    "bugs": {
        "db_type": "bug",
        "api_filter": "taxonGroup_s:insect*",
        "api_filter_exclude": ["taxonGroup_s:\"insect - butterfly\"", "taxonGroup_s:\"insect - moth\""],
        "filter_by_order": "Hemiptera",
        "display_name": "Bugs (Hemiptera)",
        "min_occurrence": 100,
        "allowed_ranks": ["species"],
        "require_common_name": False
    },
    "dragonflies-damselflies": {
        "db_type": "dragonfly-damselfly",
        "api_filter": "taxonGroup_s:insect*",
        "api_filter_exclude": ["taxonGroup_s:\"insect - butterfly\"", "taxonGroup_s:\"insect - moth\""],
        "filter_by_order": "Odonata",
        "display_name": "Dragonflies and Damselflies (Odonata)",
        "min_occurrence": 100,
        "allowed_ranks": ["species"],
        "require_common_name": False
    },
    "grasshoppers-crickets": {
        "db_type": "grasshopper-cricket",
        "api_filter": "taxonGroup_s:insect*",
        "api_filter_exclude": ["taxonGroup_s:\"insect - butterfly\"", "taxonGroup_s:\"insect - moth\""],
        "filter_by_order": "Orthoptera",
        "display_name": "Grasshoppers and Crickets (Orthoptera)",
        "min_occurrence": 100,
        "allowed_ranks": ["species"],
        "require_common_name": False
    },
    "insects": {
        "db_type": "insect",
        "api_filter": "taxonGroup_s:insect*",
        "api_filter_exclude": [
            "taxonGroup_s:\"insect - butterfly\"",
            "taxonGroup_s:\"insect - moth\"",
            "order_s:Coleoptera",
            "order_s:Diptera",
            "order_s:Hymenoptera",
            "order_s:Hemiptera",
            "order_s:Odonata",
            "order_s:Orthoptera"
        ],
        "display_name": "Insects (Other)",
        "min_occurrence": 100,
        "allowed_ranks": ["species"],
        "require_common_name": False
    },
    "mites": {
        "db_type": "mite",
        "api_filter": "taxonGroup_s:\"acarine (Acari)\"",
        "display_name": "Mites (Acari)",
        "min_occurrence": 0,
        "allowed_ranks": ["species"],
        "require_common_name": False
    },
    "fungi": {
        "db_type": "fungus",
        "display_name": "Fungi and Lichens",
        "allowed_ranks": ["species"],
        "subgroups": [
            {
                "name": "Fungi",
                "api_filter": "taxonGroup_s:fungus",
                "min_occurrence": 0,
                "require_common_name": False
            },
            {
                "name": "Lichens",
                "api_filter": "taxonGroup_s:lichen",
                "min_occurrence": 0,
                "require_common_name": False
            }
        ]
    },
    "woodlice": {
        "db_type": "woodlouse",
        "api_filter": "taxonGroup_s:crustacean",
        "filter_by_order": "Isopoda",
        "display_name": "Woodlice (Isopoda)",
        "min_occurrence": 0,
        "allowed_ranks": ["species"],
        "require_common_name": False
    }
}

# Initial hardcoded mappings for species with different names between DB and API
# Format: {species_type: {DB common name: API common name}}
# These will be extended during interactive session
HARDCODED_MAPPINGS = {
    "birds": {
        "Feral Pigeon": "Rock Dove",
    },
    "butterflies": {
        # Add butterfly mappings here as needed
    },
    "spiders": {
        # Add spider mappings here as needed
    },
    "mammals": {
        # Add mammal mappings here as needed
    },
    "bats": {
        # Add bat mappings here as needed
    },
    "reptiles": {
        # Add reptile mappings here as needed
    },
    "amphibians": {
        # Add amphibian mappings here as needed
    },
    "moths": {
        # Add moth mappings here as needed
    },
    "beetles": {
        # Add beetle mappings here as needed
    },
    "flies": {
        # Add fly mappings here as needed
    },
    "bees-wasps-ants": {
        # Add bee/wasp/ant mappings here as needed
    },
    "bugs": {
        # Add bug mappings here as needed
    },
    "dragonflies-damselflies": {
        # Add dragonfly/damselfly mappings here as needed
    },
    "grasshoppers-crickets": {
        # Add grasshopper/cricket mappings here as needed
    },
    "insects": {
        # Add other insect mappings here as needed
    },
    "mites": {
        # Add mite mappings here as needed
    },
    "fungi": {
        # Add fungi/lichen mappings here as needed
    }
}


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class APISpecies:
    """Species from NBN Atlas API"""
    common_name: str
    scientific_name: str
    occurrence_count: int
    guid: Optional[str] = None


@dataclass
class DBSpecies:
    """Species from database"""
    id: int
    name: Optional[str]
    scientific_name: Optional[str]
    conservation_status: Optional[str]


@dataclass
class MatchCandidate:
    """A potential match candidate"""
    api_species: APISpecies
    score: float
    field: str


@dataclass
class MatchResult:
    """Result of matching a DB species with API species"""
    db_species: DBSpecies
    api_species: Optional[APISpecies]
    match_score: float
    match_type: str  # "high_confidence", "low_confidence", "no_match"
    matched_field: Optional[str]
    top_candidates: list[MatchCandidate] = None


# ============================================================================
# PHASE 1: DATA FETCHING
# ============================================================================

def fetch_api_species(species_type: str) -> list[APISpecies]:
    """Fetch species from NBN Atlas API (once per run)."""
    config = SPECIES_CONFIG[species_type]
    allowed_ranks = config.get('allowed_ranks', ['species'])

    logger.info(f"Fetching {config['display_name']} from NBN Atlas API...")
    logger.info(f"Allowed ranks: {', '.join(allowed_ranks)}")

    # For 'insects' type, fetch existing species from specific insect groups to avoid duplicates
    exclude_existing = set()
    if species_type == "insects":
        specific_insect_types = ['beetle', 'fly', 'bee-wasp-ant', 'bug', 'dragonfly-damselfly', 'grasshopper-cricket']
        exclude_existing = fetch_existing_species_scientific_names(specific_insect_types)
        if exclude_existing:
            logger.info(f"Will exclude {len(exclude_existing)} species already in specific insect groups")

    # Check if config uses subgroups (for different filter criteria per taxon group)
    subgroups = config.get('subgroups')
    if subgroups:
        return _fetch_api_species_with_subgroups(config, subgroups, allowed_ranks, exclude_existing, species_type)

    # Standard single-group fetch
    min_occurrence = config.get('min_occurrence', 100)
    require_common_name = config.get('require_common_name', True)

    logger.info(f"Minimum occurrence threshold: {min_occurrence}")
    if not require_common_name:
        logger.info(f"Including species without common names")

    # Build filter query list (include base filter + exclusions if any)
    filter_queries = [config['api_filter']]
    if 'api_filter_exclude' in config:
        for exclude_filter in config['api_filter_exclude']:
            filter_queries.append(f"-{exclude_filter}")
        logger.info(f"Excluding: {', '.join(config['api_filter_exclude'])}")

    client = NBNAtlasClient()
    try:
        raw_records = client.search_all(
            query="*:*",
            filter_query=filter_queries if len(filter_queries) > 1 else config['api_filter'],
            page_size=100
        )

        api_species = _filter_records(
            raw_records, allowed_ranks, min_occurrence, require_common_name,
            config, species_type
        )

        # For 'insects' type, filter out species that already exist in other specific groups
        if species_type == "insects" and exclude_existing:
            original_count = len(api_species)
            api_species = [s for s in api_species if s.scientific_name not in exclude_existing]
            filtered_count = original_count - len(api_species)
            if filtered_count > 0:
                logger.info(f"Excluded {filtered_count} species that already exist in other insect groups")

        logger.info(f"Found {len(api_species)} {config['display_name'].lower()} from API")

        return api_species

    finally:
        client.close()


def _fetch_api_species_with_subgroups(
    config: dict,
    subgroups: list[dict],
    allowed_ranks: list[str],
    exclude_existing: set,
    species_type: str
) -> list[APISpecies]:
    """Fetch species using subgroups with different filter criteria."""
    all_species = []
    seen_guids = set()  # Avoid duplicates across subgroups

    client = NBNAtlasClient()
    try:
        for subgroup in subgroups:
            subgroup_name = subgroup.get('name', 'Unknown')
            api_filter = subgroup['api_filter']
            min_occurrence = subgroup.get('min_occurrence', 100)
            require_common_name = subgroup.get('require_common_name', True)
            # Use subgroup-specific allowed_ranks if provided, otherwise fall back to top-level
            subgroup_allowed_ranks = subgroup.get('allowed_ranks', allowed_ranks)

            logger.info(f"  Fetching {subgroup_name}...")
            logger.info(f"    Filter: {api_filter}")
            logger.info(f"    Min occurrence: {min_occurrence}")
            logger.info(f"    Allowed ranks: {', '.join(subgroup_allowed_ranks)}")
            if not require_common_name:
                logger.info(f"    Including species without common names")

            raw_records = client.search_all(
                query="*:*",
                filter_query=api_filter,
                page_size=100
            )

            subgroup_species = _filter_records(
                raw_records, subgroup_allowed_ranks, min_occurrence, require_common_name,
                config, species_type
            )

            # Add only unique species (by GUID)
            added_count = 0
            for species in subgroup_species:
                if species.guid not in seen_guids:
                    seen_guids.add(species.guid)
                    all_species.append(species)
                    added_count += 1

            logger.info(f"    Found {added_count} {subgroup_name.lower()}")

        # For 'insects' type, filter out species that already exist in other specific groups
        if species_type == "insects" and exclude_existing:
            original_count = len(all_species)
            all_species = [s for s in all_species if s.scientific_name not in exclude_existing]
            filtered_count = original_count - len(all_species)
            if filtered_count > 0:
                logger.info(f"Excluded {filtered_count} species that already exist in other insect groups")

        logger.info(f"Found {len(all_species)} {config['display_name'].lower()} from API (total)")

        return all_species

    finally:
        client.close()


def _filter_records(
    raw_records: list[dict],
    allowed_ranks: list[str],
    min_occurrence: int,
    require_common_name: bool,
    config: dict,
    species_type: str
) -> list[APISpecies]:
    """Filter raw API records and convert to APISpecies objects."""
    # Exclusion keywords for mammals category
    MARINE_MAMMAL_KEYWORDS = [
        'seal', 'whale', 'dolphin', 'porpoise', 'walrus', 'orca'
    ]
    BAT_KEYWORDS = [
        'bat', 'pipistrelle', 'noctule', 'horseshoe', 'barbastelle',
        'serotine', 'myotis', 'plecotus', 'nyctalus'
    ]
    MARINE_REPTILE_KEYWORDS = [
        'turtle', 'terrapin'
    ]

    api_species = []
    excluded_count = 0

    # Get order filter if specified
    filter_by_order = config.get('filter_by_order')

    for record in raw_records:
        rank = record.get('rank')
        common_name = record.get('commonNameSingle', '')
        order = record.get('order', '')

        # Filter by taxonomic order if specified
        if filter_by_order:
            if order != filter_by_order:
                excluded_count += 1
                continue

        # For mammals type, exclude marine mammals and bats
        if species_type == "mammals" and common_name:
            is_marine = any(kw.lower() in common_name.lower() for kw in MARINE_MAMMAL_KEYWORDS)
            is_bat = any(kw.lower() in common_name.lower() for kw in BAT_KEYWORDS)

            if is_marine or is_bat:
                excluded_count += 1
                continue

        # For bats type, include ONLY bats
        if species_type == "bats" and common_name:
            is_bat = any(kw.lower() in common_name.lower() for kw in BAT_KEYWORDS)

            if not is_bat:
                excluded_count += 1
                continue

        # For reptiles type, exclude marine reptiles (turtles, terrapins)
        if species_type == "reptiles" and common_name:
            is_marine = any(kw.lower() in common_name.lower() for kw in MARINE_REPTILE_KEYWORDS)

            if is_marine:
                excluded_count += 1
                continue

        # Standard filtering
        has_common_name = bool(record.get('commonNameSingle'))
        meets_common_name_requirement = has_common_name or not require_common_name

        if (
            rank in allowed_ranks and
            meets_common_name_requirement and
            record.get('occurrenceCount', 0) >= min_occurrence
        ):
            api_species.append(APISpecies(
                common_name=record.get('commonNameSingle', ''),
                scientific_name=record['scientificName'],
                occurrence_count=record.get('occurrenceCount', 0),
                guid=record.get('guid')
            ))

    if filter_by_order and excluded_count > 0:
        logger.info(f"Filtered to {filter_by_order} order (excluded {excluded_count} records from other orders)")
    if species_type == "mammals" and excluded_count > 0:
        logger.info(f"Excluded {excluded_count} marine mammals and bats")
    if species_type == "bats" and excluded_count > 0:
        logger.info(f"Excluded {excluded_count} non-bat mammals")
    if species_type == "reptiles" and excluded_count > 0:
        logger.info(f"Excluded {excluded_count} marine reptiles")

    return api_species


def fetch_existing_species_scientific_names(exclude_types: list[str]) -> set[str]:
    """
    Fetch scientific names of species already in the database for given types.
    Used to avoid importing duplicates.
    """
    if not exclude_types:
        return set()

    with get_db_cursor() as cursor:
        cursor.execute("""
            SELECT DISTINCT species.scientific_name
            FROM species
            JOIN species_type ON species.species_type_id = species_type.id
            WHERE species_type.name IN %s
                AND species.scientific_name IS NOT NULL
                AND species.scientific_name != ''
        """, (tuple(exclude_types),))
        rows = cursor.fetchall()

        scientific_names = {row[0] for row in rows}

    return scientific_names


def fetch_db_species(species_type: str) -> list[DBSpecies]:
    """Fetch species from database (once per run)."""
    config = SPECIES_CONFIG[species_type]
    logger.info(f"Fetching {config['display_name'].lower()} from database...")

    with get_db_cursor() as cursor:
        cursor.execute("""
            SELECT species.id, species.name, species.scientific_name, species.conservation_status
            FROM species
            JOIN species_type ON species.species_type_id = species_type.id
            WHERE species_type.name = %s
            ORDER BY species.name
        """, (config['db_type'],))
        rows = cursor.fetchall()

        db_species = [
            DBSpecies(
                id=row[0],
                name=row[1],
                scientific_name=row[2],
                conservation_status=row[3]
            )
            for row in rows
        ]

    logger.info(f"Found {len(db_species)} {config['display_name'].lower()} in database")
    return db_species


# ============================================================================
# PHASE 2: MATCHING
# ============================================================================

def fuzzy_match_species(
    db_species: DBSpecies,
    api_species_list: list[APISpecies],
    hardcoded_mappings: dict,
    species_type: str,
    top_n: int = 3
) -> MatchResult:
    """
    Find the best match for a DB species in the API species list.

    Matches against both common names and scientific names.
    Returns the best match with score and type, plus top N candidates.
    """
    # Handle species with no name and no scientific name
    if not db_species.name and not db_species.scientific_name:
        logger.warning(f"Species ID {db_species.id} has no name and no scientific name, skipping match")
        return MatchResult(
            db_species=db_species,
            api_species=None,
            match_score=0,
            match_type="no_match",
            matched_field=None,
            top_candidates=[]
        )

    # Check for hardcoded mapping first (only for common names)
    search_name = db_species.name
    used_hardcoded_mapping = False
    if db_species.name and db_species.name in hardcoded_mappings:
        search_name = hardcoded_mappings[db_species.name]
        used_hardcoded_mapping = True

    # Build search lists
    api_common_names = [s.common_name for s in api_species_list]
    api_scientific_names = [s.scientific_name for s in api_species_list]

    # Get top matches on common name (if we have one)
    common_matches = []
    if search_name:
        common_matches = process.extract(
            search_name,
            api_common_names,
            scorer=fuzz.ratio,
            limit=top_n
        )

    # Try matching on scientific name
    db_scientific_matches = []
    common_as_scientific_matches = []

    # Match on DB scientific name if available
    if db_species.scientific_name:
        db_scientific_matches = process.extract(
            db_species.scientific_name,
            api_scientific_names,
            scorer=fuzz.ratio,
            limit=top_n
        )

    # Also try matching common name against scientific names if it looks scientific
    if search_name:
        words = search_name.split()
        is_scientific = len(words) >= 2 and words[0][0].isupper()
        if is_scientific:
            common_as_scientific_matches = process.extract(
                search_name,
                api_scientific_names,
                scorer=fuzz.ratio,
                limit=top_n
            )

    # Collect all candidates
    all_candidates = []

    for match in common_matches:
        all_candidates.append(MatchCandidate(
            api_species=api_species_list[match[2]],
            score=match[1],
            field="common_name"
        ))

    for match in db_scientific_matches:
        all_candidates.append(MatchCandidate(
            api_species=api_species_list[match[2]],
            score=match[1],
            field="db_scientific_name"
        ))

    for match in common_as_scientific_matches:
        all_candidates.append(MatchCandidate(
            api_species=api_species_list[match[2]],
            score=match[1],
            field="scientific_name"
        ))

    # Sort by score and get top N unique candidates
    all_candidates.sort(key=lambda x: x.score, reverse=True)

    # Remove duplicates (keep highest score for each species)
    seen_species = set()
    unique_candidates = []
    for candidate in all_candidates:
        species_key = candidate.api_species.scientific_name
        if species_key not in seen_species:
            seen_species.add(species_key)
            unique_candidates.append(candidate)
            if len(unique_candidates) >= top_n:
                break

    # Best match is the top candidate
    best_candidate = unique_candidates[0] if unique_candidates else None
    best_match = best_candidate.api_species if best_candidate else None
    best_score = best_candidate.score if best_candidate else 0
    matched_field = best_candidate.field if best_candidate else None

    # Add hardcoded mapping indicator
    if used_hardcoded_mapping and matched_field:
        matched_field = f"{matched_field} (hardcoded: '{db_species.name}' → '{search_name}')"

    # Determine match type
    if best_score >= MATCH_THRESHOLD_HIGH:
        match_type = "high_confidence"
    elif best_score >= MATCH_THRESHOLD_LOW:
        match_type = "low_confidence"
    else:
        match_type = "no_match"

    return MatchResult(
        db_species=db_species,
        api_species=best_match if best_score >= MATCH_THRESHOLD_LOW else None,
        match_score=best_score,
        match_type=match_type,
        matched_field=matched_field,
        top_candidates=unique_candidates
    )


def match_all_species(
    db_species: list[DBSpecies],
    api_species: list[APISpecies],
    hardcoded_mappings: dict,
    species_type: str
) -> list[MatchResult]:
    """Match all DB species against API species."""
    logger.info("Matching DB species against API species...")

    results = []
    for db_sp in db_species:
        result = fuzzy_match_species(db_sp, api_species, hardcoded_mappings, species_type)
        results.append(result)

    return results


def find_new_species(
    api_species: list[APISpecies],
    results: list[MatchResult]
) -> list[APISpecies]:
    """Find API species that are not matched to any DB species."""
    matched_api_guids = set()
    for result in results:
        if result.api_species:
            matched_api_guids.add(result.api_species.guid)

    new_species = [
        species for species in api_species
        if species.guid not in matched_api_guids
    ]

    return new_species


# ============================================================================
# PHASE 3: REPORTING & INTERACTIVE REVIEW
# ============================================================================

def get_db_species_display_name(db_species: DBSpecies) -> str:
    """Get display name for a DB species (name or scientific name)."""
    if db_species.name:
        return db_species.name
    elif db_species.scientific_name:
        return f"[{db_species.scientific_name}]"
    else:
        return f"[ID: {db_species.id}]"


def report_results(results: list[MatchResult], show_details: bool = True):
    """Print formatted report of matching results."""
    high_confidence = [r for r in results if r.match_type == "high_confidence"]
    low_confidence = [r for r in results if r.match_type == "low_confidence"]
    no_match = [r for r in results if r.match_type == "no_match"]

    # Print summary
    logger.info("\n" + "="*80)
    logger.info("MATCHING RESULTS SUMMARY")
    logger.info("="*80)
    logger.info(f"Total DB species: {len(results)}")
    logger.info(f"High confidence matches: {len(high_confidence)} ({len(high_confidence)/len(results)*100:.1f}%)")
    logger.info(f"Low confidence matches: {len(low_confidence)} ({len(low_confidence)/len(results)*100:.1f}%)")
    logger.info(f"No match found: {len(no_match)} ({len(no_match)/len(results)*100:.1f}%)")

    if show_details:
        # Show high confidence matches (sample)
        if high_confidence:
            logger.info("\n" + "-"*80)
            logger.info(f"HIGH CONFIDENCE MATCHES ({len(high_confidence)})")
            logger.info("-"*80)
            for r in high_confidence[:5]:
                db_name = get_db_species_display_name(r.db_species)
                api_name = r.api_species.common_name or r.api_species.scientific_name
                logger.info(f"✓ {db_name} → {api_name}")
                logger.info(f"  Score: {r.match_score:.1f} | Field: {r.matched_field}")
            if len(high_confidence) > 5:
                logger.info(f"  ... and {len(high_confidence) - 5} more")

        # Show low confidence matches (all)
        if low_confidence:
            logger.info("\n" + "-"*80)
            logger.info(f"LOW CONFIDENCE MATCHES ({len(low_confidence)}) - WILL REQUIRE APPROVAL")
            logger.info("-"*80)
            for r in low_confidence:
                db_name = get_db_species_display_name(r.db_species)
                api_name = r.api_species.common_name or r.api_species.scientific_name
                logger.info(f"⚠ {db_name} → {api_name}")
                logger.info(f"  Score: {r.match_score:.1f} | Field: {r.matched_field}")

        # Show no matches (all) - these are problems!
        if no_match:
            logger.info("\n" + "-"*80)
            logger.info(f"NO MATCHES FOUND ({len(no_match)}) - ACTION REQUIRED")
            logger.info("-"*80)
            for r in no_match:
                db_name = get_db_species_display_name(r.db_species)
                logger.info(f"✗ {db_name} (ID: {r.db_species.id})")
                logger.info(f"  Best score: {r.match_score:.1f} (below threshold of {MATCH_THRESHOLD_LOW})")
                if r.top_candidates:
                    logger.info(f"  Top candidates:")
                    for i, candidate in enumerate(r.top_candidates[:3], 1):
                        cand_name = candidate.api_species.common_name or candidate.api_species.scientific_name
                        logger.info(f"    {i}. {cand_name} ({candidate.score:.1f})")

    logger.info("\n" + "="*80)


def get_no_matches(results: list[MatchResult]) -> list[MatchResult]:
    """Get list of species with no matches."""
    return [r for r in results if r.match_type == "no_match"]


def collect_hardcoded_mappings(
    no_matches: list[MatchResult],
    species_type: str
) -> dict:
    """
    Interactively collect hardcoded mappings for no-match species.
    Returns dict of {db_name: api_name}
    """
    logger.info("\n" + "="*80)
    logger.info("ADD HARDCODED MAPPINGS")
    logger.info("="*80)
    logger.info(f"Found {len(no_matches)} species with no matches.")
    logger.info("For each species, you can:")
    logger.info("  - Select a candidate by number [1-N]")
    logger.info("  - Enter a custom API name")
    logger.info("  - Skip with [s]")
    logger.info("="*80 + "\n")

    new_mappings = {}

    for i, no_match in enumerate(no_matches, 1):
        db_name = get_db_species_display_name(no_match.db_species)
        logger.info(f"\n[{i}/{len(no_matches)}] No match for: {db_name}")
        logger.info(f"     Best score: {no_match.match_score:.1f}")

        # Skip species with no common name - they can only be matched by scientific name
        if not no_match.db_species.name:
            logger.info(f"     (No common name - matched by scientific name only)")
            logger.info(f"     Scientific name: {no_match.db_species.scientific_name}")
            logger.info(f"     Skipping - cannot add hardcoded mapping without common name")
            continue

        logger.info(f"     Top candidates:")

        for j, candidate in enumerate(no_match.top_candidates[:5], 1):
            cand_name = candidate.api_species.common_name or "[no common name]"
            logger.info(f"       [{j}] {cand_name} "
                       f"({candidate.api_species.scientific_name}) - Score: {candidate.score:.1f}")

        while True:
            response = input(f"\n  Choice [1-{len(no_match.top_candidates[:5])}/custom/s]: ").strip()

            if response.lower() == 's':
                logger.info(f"  Skipped: {db_name}")
                break
            elif response.isdigit():
                idx = int(response)
                if 1 <= idx <= len(no_match.top_candidates[:5]):
                    selected = no_match.top_candidates[idx - 1].api_species.common_name
                    new_mappings[no_match.db_species.name] = selected
                    logger.info(f"  ✓ Added mapping: '{no_match.db_species.name}' → '{selected}'")
                    break
                else:
                    logger.info(f"  Invalid number. Please enter 1-{len(no_match.top_candidates[:5])}")
            else:
                # Custom name
                if response:
                    new_mappings[no_match.db_species.name] = response
                    logger.info(f"  ✓ Added mapping: '{no_match.db_species.name}' → '{response}'")
                    break
                else:
                    logger.info("  Please enter a valid name or 's' to skip")

    logger.info(f"\n{'='*80}")
    logger.info(f"Added {len(new_mappings)} new mappings")
    logger.info("="*80 + "\n")

    return new_mappings


def prompt_after_matching(has_no_matches: bool) -> str:
    """
    Prompt user after matching phase.
    Returns: 'mappings', 'continue', 'abort'
    """
    if has_no_matches:
        logger.info("\n" + "="*80)
        logger.info("⚠️  UNMATCHED SPECIES FOUND")
        logger.info("="*80)
        logger.info("Some species could not be matched automatically.")
        logger.info("Options:")
        logger.info("  [m] Add hardcoded mappings and re-run matching")
        logger.info("  [c] Continue anyway (not recommended)")
        logger.info("  [a] Abort")
        logger.info("="*80)

        while True:
            response = input("\nChoice [m/c/a]: ").strip().lower()
            if response == 'm':
                return 'mappings'
            elif response == 'c':
                return 'continue'
            elif response == 'a':
                return 'abort'
            else:
                logger.info("Invalid choice. Please enter 'm', 'c', or 'a'")
    else:
        logger.info("\n" + "="*80)
        logger.info("✓ ALL SPECIES MATCHED")
        logger.info("="*80)
        logger.info("All database species have been successfully matched.")
        logger.info("Ready to proceed to migration.")
        logger.info("="*80)

        while True:
            response = input("\nProceed to migration? [y/n]: ").strip().lower()
            if response in ['y', 'yes']:
                return 'continue'
            elif response in ['n', 'no']:
                return 'abort'
            else:
                logger.info("Invalid choice. Please enter 'y' or 'n'")


# ============================================================================
# PHASE 4: MIGRATION PREVIEW
# ============================================================================

def preview_migration(
    results: list[MatchResult],
    new_species: list[APISpecies],
    dry_run: bool
):
    """Show preview of what will be changed in migration."""
    high_confidence = [r for r in results if r.match_type == "high_confidence"]
    low_confidence = [r for r in results if r.match_type == "low_confidence"]

    logger.info("\n" + "="*80)
    logger.info("MIGRATION PREVIEW")
    logger.info("="*80)

    # High confidence updates
    logger.info(f"\nHigh-confidence updates ({len(high_confidence)}):")
    logger.info("  These will be auto-approved:")
    for r in high_confidence[:10]:
        db_name = get_db_species_display_name(r.db_species)
        logger.info(f"  • {db_name} (ID: {r.db_species.id})")
        logger.info(f"    → Scientific: {r.api_species.scientific_name}")
        logger.info(f"    → NBN GUID: {r.api_species.guid}")
    if len(high_confidence) > 10:
        logger.info(f"  ... and {len(high_confidence) - 10} more")

    # Low confidence updates
    if low_confidence:
        logger.info(f"\nLow-confidence updates ({len(low_confidence)}):")
        logger.info("  These will require your approval:")
        for r in low_confidence:
            db_name = get_db_species_display_name(r.db_species)
            api_name = r.api_species.common_name or r.api_species.scientific_name
            logger.info(f"  • {db_name} → {api_name} (score: {r.match_score:.1f})")

    # New species
    if new_species:
        logger.info(f"\nNew species to add ({len(new_species)}):")
        logger.info("  These will require your approval:")
        for species in new_species[:10]:
            display_name = species.common_name if species.common_name else species.scientific_name
            suffix = f" ({species.scientific_name})" if species.common_name else ""
            logger.info(f"  • {display_name}{suffix}")
        if len(new_species) > 10:
            logger.info(f"  ... and {len(new_species) - 10} more")

    logger.info("\n" + "="*80)


# ============================================================================
# PHASE 5: INTERACTIVE APPROVALS
# ============================================================================

def review_low_confidence_matches(
    low_confidence: list[MatchResult],
    dry_run: bool
) -> list[MatchResult]:
    """Interactively review and approve/reject low-confidence matches."""
    if not low_confidence:
        return []

    logger.info("\n" + "="*80)
    logger.info(f"REVIEW LOW-CONFIDENCE MATCHES ({len(low_confidence)})")
    logger.info("="*80)
    logger.info(f"Found {len(low_confidence)} species with low-confidence matches (70-90% score).")

    if dry_run:
        logger.info("(Dry-run mode: showing preview only)")
    else:
        logger.info("These require your approval before updating.")

    logger.info("")

    # Show all low-confidence matches
    for i, match in enumerate(low_confidence, 1):
        db_name = get_db_species_display_name(match.db_species)
        api_name = match.api_species.common_name or match.api_species.scientific_name
        logger.info(f"{i}. {db_name} (ID: {match.db_species.id})")
        logger.info(f"   → Matched to: {api_name}")
        logger.info(f"   → Scientific: {match.api_species.scientific_name}")
        logger.info(f"   → Score: {match.match_score:.1f}")
        logger.info(f"   → Field: {match.matched_field}")

        if match.top_candidates and len(match.top_candidates) > 1:
            logger.info(f"   → Alternatives:")
            for j, alt in enumerate(match.top_candidates[1:3], 2):
                alt_name = alt.api_species.common_name or alt.api_species.scientific_name
                logger.info(f"      {j}. {alt_name} "
                           f"({alt.api_species.scientific_name}) - {alt.score:.1f}")
        logger.info("")

    logger.info("="*80)

    if dry_run:
        logger.info("Dry-run mode: Low-confidence matches shown for review.")
        logger.info("Run with --no-dry-run to interactively approve/reject.")
        return []

    # Interactive approval
    while True:
        response = input("\nApprove all low-confidence matches? [y/n/list]: ").strip().lower()

        if response in ['y', 'yes']:
            logger.info(f"✓ Approved: Will update all {len(low_confidence)} low-confidence matches")
            return low_confidence
        elif response in ['n', 'no']:
            logger.info("✗ Rejected: Will not update any low-confidence matches")
            return []
        elif response == 'list':
            # Show condensed list
            for i, match in enumerate(low_confidence, 1):
                db_name = get_db_species_display_name(match.db_species)
                api_name = match.api_species.common_name or match.api_species.scientific_name
                logger.info(f"{i}. {db_name} → {api_name} ({match.match_score:.1f})")
        else:
            logger.info("Invalid response. Please enter 'y', 'n', or 'list'")


def review_new_species(
    new_species: list[APISpecies],
    dry_run: bool
) -> list[APISpecies]:
    """Interactively review and approve/reject new species."""
    if not new_species:
        logger.info("\n" + "="*80)
        logger.info("NO NEW SPECIES")
        logger.info("="*80)
        logger.info("No new species from NBN Atlas to add.")
        logger.info("="*80 + "\n")
        return []

    logger.info("\n" + "="*80)
    logger.info(f"REVIEW NEW SPECIES ({len(new_species)})")
    logger.info("="*80)
    logger.info(f"Found {len(new_species)} species in NBN Atlas not in your database.")

    if dry_run:
        logger.info("(Dry-run mode: showing preview only)")
    else:
        logger.info("These require your approval before adding.")

    logger.info("")

    # Show all new species
    for i, species in enumerate(new_species, 1):
        # Display common name if available, otherwise scientific name
        display_name = species.common_name if species.common_name else species.scientific_name
        logger.info(f"{i}. {display_name}")
        if species.common_name:
            logger.info(f"   Scientific: {species.scientific_name}")
        logger.info(f"   Occurrences: {species.occurrence_count}")
        logger.info(f"   GUID: {species.guid}")
        logger.info("")

    logger.info("="*80)

    if dry_run:
        logger.info("Dry-run mode: New species shown for review.")
        logger.info("Run with --no-dry-run to interactively approve/reject.")
        return []

    # Interactive approval
    while True:
        response = input("\nAdd all these species to the database? [y/n/list]: ").strip().lower()

        if response in ['y', 'yes']:
            logger.info(f"✓ Approved: Will add all {len(new_species)} new species")
            return new_species
        elif response in ['n', 'no']:
            logger.info("✗ Skipped: Will not add any new species")
            return []
        elif response == 'list':
            # Show condensed list
            for i, species in enumerate(new_species, 1):
                display_name = species.common_name if species.common_name else species.scientific_name
                suffix = f" ({species.scientific_name})" if species.common_name else ""
                logger.info(f"{i}. {display_name}{suffix}")
        else:
            logger.info("Invalid response. Please enter 'y', 'n', or 'list'")


# ============================================================================
# PHASE 6: CSV EXPORT FOR REVIEW
# ============================================================================

def export_migration_csv(
    results: list[MatchResult],
    new_species: list[APISpecies],
    output_file: str
):
    """Export migration changes to CSV for review."""
    output_path = Path(output_file)

    with open(output_path, 'w', newline='') as f:
        writer = csv.writer(f)

        # Header
        writer.writerow([
            'Change Type',
            'DB ID',
            'Old Name',
            'New Name',
            'Old Scientific Name',
            'New Scientific Name',
            'Old NBN GUID',
            'New NBN GUID',
            'Occurrences',
            'Match Score',
            'Match Type',
            'Conservation Status'
        ])

        # Updates (high and low confidence matches)
        updates = [r for r in results if r.match_type in ["high_confidence", "low_confidence"]]
        for result in updates:
            writer.writerow([
                'UPDATE',
                result.db_species.id,
                result.db_species.name,
                result.api_species.common_name,
                '-',  # Old scientific name (we don't have this from DB query)
                result.api_species.scientific_name,
                '-',  # Old GUID (we don't have this from DB query)
                result.api_species.guid,
                result.api_species.occurrence_count,
                f"{result.match_score:.1f}",
                result.match_type,
                result.db_species.conservation_status or ''
            ])

        # New species
        for species in new_species:
            writer.writerow([
                'INSERT',
                'NEW',
                '-',
                species.common_name,
                '-',
                species.scientific_name,
                '-',
                species.guid,
                species.occurrence_count,
                '-',
                'new_species',
                ''
            ])

    logger.info(f"\n✓ Migration preview exported to CSV: {output_path.absolute()}")
    return output_path


# ============================================================================
# PHASE 7: EXPORT
# ============================================================================

def export_results(
    results: list[MatchResult],
    new_species: list[APISpecies],
    output_file: str,
    species_type: str
):
    """Export matching results to JSON file for audit trail."""
    export_data = {
        "species_type": species_type,
        "timestamp": datetime.utcnow().isoformat(),
        "summary": {
            "total_db_species": len(results),
            "high_confidence": len([r for r in results if r.match_type == "high_confidence"]),
            "low_confidence": len([r for r in results if r.match_type == "low_confidence"]),
            "no_match": len([r for r in results if r.match_type == "no_match"]),
            "new_api_species": len(new_species)
        },
        "matches": [],
        "new_species": []
    }

    for result in results:
        match_data = {
            "db_species_id": result.db_species.id,
            "db_species_name": result.db_species.name,
            "db_conservation_status": result.db_species.conservation_status,
            "match_type": result.match_type,
            "match_score": result.match_score,
            "matched_field": result.matched_field,
            "api_species": None
        }

        if result.api_species:
            match_data["api_species"] = {
                "common_name": result.api_species.common_name,
                "scientific_name": result.api_species.scientific_name,
                "occurrence_count": result.api_species.occurrence_count,
                "guid": result.api_species.guid
            }

        if result.match_type == "low_confidence" and result.top_candidates:
            match_data["alternatives"] = [
                {
                    "common_name": c.api_species.common_name,
                    "scientific_name": c.api_species.scientific_name,
                    "score": c.score,
                    "field": c.field,
                    "guid": c.api_species.guid
                }
                for c in result.top_candidates[:3]
            ]

        export_data["matches"].append(match_data)

    for species in new_species:
        export_data["new_species"].append({
            "common_name": species.common_name,
            "scientific_name": species.scientific_name,
            "occurrence_count": species.occurrence_count,
            "guid": species.guid
        })

    output_path = Path(output_file)
    with open(output_path, 'w') as f:
        json.dump(export_data, f, indent=2)

    logger.info(f"\n✓ Results exported to: {output_path.absolute()}")


# ============================================================================
# PHASE 8: APPLY MIGRATION
# ============================================================================

def final_confirmation(dry_run: bool, update_count: int, insert_count: int) -> bool:
    """Get final confirmation before applying migration."""
    if dry_run:
        return True

    logger.info("\n" + "="*80)
    logger.info("⚠️  FINAL CONFIRMATION REQUIRED")
    logger.info("="*80)
    logger.info("You are about to MODIFY THE DATABASE:")
    if update_count > 0:
        logger.info(f"  • Update {update_count} existing species with NBN Atlas data")
    logger.info(f"  • Insert {insert_count} new species")
    logger.info("")
    logger.info("This operation will commit changes to the database.")
    logger.info("All changes are transactional (will rollback on error).")
    logger.info("="*80)

    response = input("\nType 'yes' to confirm and proceed: ").strip().lower()
    return response == 'yes'


def apply_migration(
    results: list[MatchResult],
    approved_low_confidence: list[MatchResult],
    approved_new_species: list[APISpecies],
    species_type: str,
    dry_run: bool,
    add_only: bool = False
) -> bool:
    """Apply migration to database (or show dry-run summary)."""
    high_confidence = [r for r in results if r.match_type == "high_confidence"]
    updates = [] if add_only else high_confidence + approved_low_confidence
    update_count = len(updates)
    insert_count = len(approved_new_species)

    if dry_run:
        logger.info("\n" + "="*80)
        logger.info("DRY-RUN MODE - SUMMARY")
        logger.info("="*80)
        logger.info("No changes were made to the database.")
        logger.info("")
        logger.info("Summary of changes that would be applied:")
        logger.info(f"  • Update {update_count} existing species:")
        logger.info(f"    - {len(high_confidence)} high-confidence matches (auto-approved)")
        logger.info(f"    - {len(approved_low_confidence)} low-confidence matches (reviewed)")
        logger.info(f"  • Insert {insert_count} new species")
        logger.info("")
        logger.info("To apply these changes, run with --no-dry-run flag.")
        logger.info("="*80 + "\n")
        return True

    # Final confirmation
    if not final_confirmation(dry_run, update_count, insert_count):
        logger.info("\n✗ Migration cancelled by user")
        return False

    logger.info("\n" + "="*80)
    logger.info("APPLYING MIGRATION")
    logger.info("="*80)

    try:
        with get_db_cursor() as cursor:
            # Update existing species
            updated_count = 0
            for match in updates:
                # Use common name if available, otherwise leave as NULL
                common_name = match.api_species.common_name if match.api_species.common_name else None
                cursor.execute("""
                    UPDATE species
                    SET
                        name = %s,
                        scientific_name = %s,
                        nbn_atlas_guid = %s
                    WHERE id = %s
                """, (
                    common_name,
                    match.api_species.scientific_name,
                    match.api_species.guid,
                    match.db_species.id
                ))
                updated_count += 1

            logger.info(f"✓ Updated {updated_count} existing species")

            # Insert new species
            inserted_count = 0
            config = SPECIES_CONFIG[species_type]
            db_type = config['db_type']

            # Look up species_type_id for this type
            cursor.execute("""
                SELECT id FROM species_type WHERE name = %s
            """, (db_type,))
            species_type_row = cursor.fetchone()
            if not species_type_row:
                raise ValueError(f"species_type '{db_type}' not found in species_type table")
            species_type_id = species_type_row[0]

            for species in approved_new_species:
                # Use common name if available, otherwise leave as NULL
                common_name = species.common_name if species.common_name else None
                cursor.execute("""
                    INSERT INTO species (name, species_type_id, scientific_name, nbn_atlas_guid)
                    VALUES (%s, %s, %s, %s)
                """, (
                    common_name,
                    species_type_id,
                    species.scientific_name,
                    species.guid
                ))
                inserted_count += 1

            logger.info(f"✓ Inserted {inserted_count} new species")

            logger.info("\n" + "="*80)
            logger.info("✓ MIGRATION SUCCESSFUL")
            logger.info("="*80)
            logger.info(f"Updated: {updated_count} species")
            logger.info(f"  • {len(high_confidence)} high-confidence")
            logger.info(f"  • {len(approved_low_confidence)} low-confidence (approved)")
            logger.info(f"Inserted: {inserted_count} new species")
            logger.info("="*80 + "\n")

            return True

    except Exception as e:
        logger.error(f"\n✗ Migration failed: {e}")
        logger.error("All changes have been rolled back.")
        raise


# ============================================================================
# MAIN ORCHESTRATION
# ============================================================================

def print_mode_banner(dry_run: bool):
    """Print banner showing current mode."""
    if dry_run:
        logger.info("\n" + "="*80)
        logger.info("DRY-RUN MODE (Default)")
        logger.info("="*80)
        logger.info("No database changes will be made.")
        logger.info("This is a safe preview of what would happen.")
        logger.info("Use --no-dry-run to apply changes to the database.")
        logger.info("="*80 + "\n")
    else:
        logger.info("\n" + "="*80)
        logger.info("⚠️  LIVE MODE - DATABASE WRITES ENABLED")
        logger.info("="*80)
        logger.info("This will make changes to the database!")
        logger.info("Multiple confirmations will be required.")
        logger.info("="*80 + "\n")


def main(species_type: str, dry_run: bool = True, export_file: Optional[str] = None, add_only: bool = False):
    """
    Main script execution with full workflow.

    Args:
        species_type: Type of species ('birds' or 'butterflies')
        dry_run: If True, preview only (no DB writes). Default True.
        export_file: Optional path for JSON export. Auto-generated if not provided.

    Returns:
        Exit code: 0 for success, 1 for error
    """
    try:
        # Print mode banner
        print_mode_banner(dry_run)

        if add_only:
            logger.info("ADD-ONLY MODE: Will only insert new species, existing species will not be updated.")
            logger.info("")

        config = SPECIES_CONFIG[species_type]
        logger.info(f"Processing: {config['display_name']}")
        logger.info("")

        # Phase 1: Fetch data (once)
        logger.info("="*80)
        logger.info("PHASE 1: FETCHING DATA")
        logger.info("="*80)
        api_species = fetch_api_species(species_type)
        db_species = fetch_db_species(species_type)

        if not api_species:
            logger.error("Cannot proceed without API species data")
            return 1

        if not db_species:
            logger.warning(f"No {config['display_name'].lower()} found in database")
            logger.info("Skipping matching phase - will only add new species")

        # Keep hardcoded mappings in memory for this session
        session_mappings = HARDCODED_MAPPINGS.get(species_type, {}).copy()
        logger.info(f"Starting with {len(session_mappings)} hardcoded mappings\n")

        # Phase 2: Matching loop (iterative refinement)
        results = []
        new_species = []

        if db_species:
            logger.info("="*80)
            logger.info("PHASE 2: MATCHING & REFINEMENT")
            logger.info("="*80 + "\n")

            iteration = 1
            while True:
                if iteration > 1:
                    logger.info(f"\n--- Matching Iteration {iteration} ---\n")

                results = match_all_species(db_species, api_species, session_mappings, species_type)
                new_species = find_new_species(api_species, results)

                # Report results
                report_results(results, show_details=(iteration == 1))

                # Check for no-matches
                no_matches = get_no_matches(results)

                if no_matches:
                    action = prompt_after_matching(has_no_matches=True)

                    if action == 'mappings':
                        new_mappings = collect_hardcoded_mappings(no_matches, species_type)
                        if new_mappings:
                            session_mappings.update(new_mappings)
                            logger.info(f"Added {len(new_mappings)} new mappings. Re-running match...\n")
                            iteration += 1
                            continue
                        else:
                            logger.info("No mappings added. Exiting.\n")
                            return 0

                    elif action == 'continue':
                        logger.warning("⚠️  Proceeding with unmatched species (not recommended)\n")
                        break

                    else:  # abort
                        logger.info("Migration aborted by user\n")
                        return 0
                else:
                    action = prompt_after_matching(has_no_matches=False)

                    if action == 'continue':
                        break
                    else:
                        logger.info("Migration aborted by user\n")
                        return 0
        else:
            # No DB species - all API species are "new"
            logger.info("\n" + "="*80)
            logger.info("PHASE 2: SKIPPING MATCHING (NO DB SPECIES)")
            logger.info("="*80)
            logger.info("All API species will be treated as new species to add.\n")
            new_species = api_species

        # Phase 3: Export results
        logger.info("\n" + "="*80)
        logger.info("PHASE 3: EXPORTING RESULTS")
        logger.info("="*80)

        if not export_file:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            export_file = f"{species_type}_migration_{timestamp}.json"

        export_results(results, new_species, export_file, species_type)

        # Phase 4: Preview migration
        logger.info("\n" + "="*80)
        logger.info("PHASE 4: MIGRATION PREVIEW")
        logger.info("="*80)
        preview_migration(results, new_species, dry_run)

        # Offer CSV export
        logger.info("\n" + "-"*80)
        while True:
            response = input("\nExport migration changes to CSV for review? [y/n]: ").strip().lower()
            if response in ['y', 'yes']:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                csv_file = f"{species_type}_migration_preview_{timestamp}.csv"
                csv_path = export_migration_csv(results, new_species, csv_file)
                logger.info(f"Review the CSV at: {csv_path.absolute()}")

                # Wait for user to review
                input("\nPress Enter to continue after reviewing the CSV...")
                break
            elif response in ['n', 'no']:
                logger.info("Skipping CSV export")
                break
            else:
                logger.info("Invalid response. Please enter 'y' or 'n'")

        # Phase 5: Interactive approvals
        logger.info("\n" + "="*80)
        logger.info("PHASE 5: INTERACTIVE APPROVALS")
        logger.info("="*80)

        low_confidence = [r for r in results if r.match_type == "low_confidence"]
        approved_low_confidence = review_low_confidence_matches(low_confidence, dry_run)

        approved_new_species = review_new_species(new_species, dry_run)

        # Phase 6: Apply migration
        logger.info("\n" + "="*80)
        logger.info("PHASE 6: APPLY MIGRATION")
        logger.info("="*80)

        success = apply_migration(
            results,
            approved_low_confidence,
            approved_new_species,
            species_type,
            dry_run,
            add_only
        )

        return 0 if success else 1

    except KeyboardInterrupt:
        logger.info("\n\n✗ Interrupted by user (Ctrl+C)\n")
        return 1
    except Exception as e:
        logger.error(f"\n✗ Error: {e}", exc_info=True)
        return 1


if __name__ == "__main__":
    parser = get_arg_parser(description=__doc__)
    parser.add_argument(
        "--species-type", "-s",
        required=True,
        choices=[
            "birds", "butterflies", "spiders", "mammals", "bats",
            "reptiles", "amphibians", "moths",
            "beetles", "flies", "bees-wasps-ants", "bugs",
            "dragonflies-damselflies", "grasshoppers-crickets", "insects",
            "mites", "fungi", "woodlice"
        ],
        help="Type of species to process"
    )
    parser.add_argument(
        "--export", "-e",
        type=str,
        help="Export results to specific JSON file (default: auto-generated with timestamp)"
    )
    parser.add_argument(
        "--add-only",
        action="store_true",
        default=False,
        help="Only add new species, skip updating existing species"
    )

    args = parser.parse_args()

    # The arg_parser already provides args.dry_run
    exit_code = main(args.species_type, dry_run=args.dry_run, export_file=args.export, add_only=args.add_only)
    sys.exit(exit_code)
