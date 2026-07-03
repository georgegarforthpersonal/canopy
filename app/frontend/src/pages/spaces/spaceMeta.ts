/**
 * Helpers mapping a survey type to its Spaces presentation: the accent colour
 * for its icon tile, the species type that drives its wildlife icon/charts,
 * and the name-slug URLs that make spaces addressable as /spaces/butterfly.
 */
import { notionColors } from '../../theme';
import { surveyTypesAPI, type SurveyType, type SurveyTypeWithDetails } from '../../services/api';

export interface AccentColors {
  bg: string;
  fg: string;
}

// Default accent when a survey type has no notion colour set (butterfly pink).
const DEFAULT_ACCENT: AccentColors = { bg: notionColors.pink.background, fg: notionColors.pink.text };

/** Accent colours for a survey type's icon tile, from its notion colour key. */
export function accentColors(surveyType: Pick<SurveyType, 'color'>): AccentColors {
  const key = surveyType.color as keyof typeof notionColors | null;
  if (key && key in notionColors) {
    return { bg: notionColors[key].background, fg: notionColors[key].text };
  }
  return DEFAULT_ACCENT;
}

/**
 * The species type that drives a space's icon and charts. Uses the survey
 * type's first linked species type, falling back to "butterfly" for the beta.
 */
export function primarySpeciesType(surveyType: SurveyTypeWithDetails): string {
  return surveyType.species_types[0]?.name ?? 'butterfly';
}

/** URL slug for a survey type name, e.g. "Breeding Birds" → "breeding-birds". */
export function spaceSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Canonical path for a space — the name slug, or the id if the name has no
 * sluggable characters. */
export function spacePath(surveyType: Pick<SurveyType, 'id' | 'name'>): string {
  return `/spaces/${spaceSlug(surveyType.name) || surveyType.id}`;
}

/**
 * Resolve a /spaces/:typeId route param — a name slug or a numeric id (old
 * links keep working) — to the survey type id, or null when nothing matches.
 * Slugs are matched against the full survey type list; if two names ever
 * slugify identically the first wins, and the numeric URL stays canonical.
 */
export async function resolveSpaceTypeId(param: string): Promise<number | null> {
  if (/^\d+$/.test(param)) return Number(param);
  const slug = param.toLowerCase();
  const types = await surveyTypesAPI.getAll();
  return types.find((t) => spaceSlug(t.name) === slug)?.id ?? null;
}
