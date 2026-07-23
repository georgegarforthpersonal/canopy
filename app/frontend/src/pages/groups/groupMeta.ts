/**
 * Helpers mapping a survey type to its Groups presentation: the accent colour
 * for its icon tile, the species type that drives its wildlife icon/charts,
 * and the name-slug URLs that make groups addressable as /groups/butterfly.
 */
import { notionColors } from '../../theme';
import { ORG_SLUG, surveyTypesAPI, type SurveyType, type SurveyTypeWithDetails } from '../../services/api';

/**
 * How a group's activity panel behaves. 'worklist' types are slot-scheduled:
 * the panel is the ScheduledSurvey-driven To record / This week / Upcoming
 * list. 'record' types are unscheduled — surveys arrive opportunistically, so
 * the panel is a record CTA plus recent history instead.
 */
export type GroupActivity = 'worklist' | 'record';

/**
 * Survey types each organisation's Groups beta surfaces, matched
 * case-insensitively against the trimmed survey type name, each mapped to its
 * activity style. Organisations not listed here don't see the Groups tab (or
 * the Scheduled admin tab that feeds it). Cannwood's walking survey is being
 * renamed to "Bird" (data script), so its entry lists the old and new names
 * during the transition.
 */
const BETA_GROUPS: Record<string, Record<string, GroupActivity>> = {
  heal: { butterfly: 'worklist', dragonfly: 'worklist' },
  cannwood: {
    walking: 'worklist',
    'walking survey': 'worklist',
    bird: 'worklist',
    'marsh fritillary': 'worklist',
    turtledove: 'worklist',
    'turtle dove': 'worklist',
    'ad hoc': 'record',
    audio: 'record',
    'camera trap': 'record',
  },
};

/**
 * Beta group survey-type names for the given org. Defaults to ORG_SLUG — the
 * org captured at page load that every API request uses — NOT a fresh URL
 * parse: on localhost the org comes from a ?org= param that client-side
 * navigation drops, so re-deriving it mid-session would disagree with the API.
 */
export function betaGroupNames(orgSlug: string = ORG_SLUG): string[] {
  return Object.keys(BETA_GROUPS[orgSlug] ?? {});
}

/**
 * The activity style for a survey type's group page. Unlisted names default
 * to 'worklist' (they can't be reached — only beta names get group pages).
 */
export function groupActivity(name: string, orgSlug: string = ORG_SLUG): GroupActivity {
  return BETA_GROUPS[orgSlug]?.[name.trim().toLowerCase()] ?? 'worklist';
}

/**
 * Grid ordering (George, 23 Jul 2026): multi-species sightings groups A–Z,
 * then single-species groups A–Z, then the unscheduled utilities in fixed
 * order camera trap → audio → ad hoc.
 */
export function groupTier(surveyType: SurveyTypeWithDetails, orgSlug: string = ORG_SLUG): number {
  if (groupActivity(surveyType.name, orgSlug) === 'record') {
    if (surveyType.allow_image_upload) return 3;
    if (surveyType.allow_audio_upload) return 4;
    return 5;
  }
  return surveyType.species.length === 1 ? 2 : 1;
}

/** Grid comparator: tier order, alphabetical within a tier. */
export function compareGroups(
  a: SurveyTypeWithDetails,
  b: SurveyTypeWithDetails,
  orgSlug: string = ORG_SLUG,
): number {
  return groupTier(a, orgSlug) - groupTier(b, orgSlug) || a.name.localeCompare(b.name);
}

/**
 * Where recording a new survey of this type starts: media types go straight
 * to their wizard (the same dispatch the new-survey form applies on type
 * selection), everything else to the standard form with the type preselected.
 */
export function recordSurveyPath(
  surveyType: Pick<SurveyType, 'id' | 'allow_image_upload' | 'allow_audio_upload'>,
): string {
  if (surveyType.allow_image_upload) return `/surveys/new/camera-trap?type=${surveyType.id}`;
  if (surveyType.allow_audio_upload) return `/surveys/new/audio?type=${surveyType.id}`;
  return `/surveys/new?survey_type_id=${surveyType.id}`;
}

/** Whether the given org (defaults to the current one) has the Groups beta. */
export function orgHasGroups(orgSlug: string = ORG_SLUG): boolean {
  return betaGroupNames(orgSlug).length > 0;
}

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
 * The species type that drives a group's icon and charts. Uses the survey
 * type's first linked species type, falling back to "butterfly" for the beta.
 */
export function primarySpeciesType(surveyType: SurveyTypeWithDetails): string {
  return surveyType.species_types[0]?.name ?? 'butterfly';
}

/** URL slug for a survey type name, e.g. "Breeding Birds" → "breeding-birds". */
export function groupSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Canonical path for a group — the name slug, or the id if the name has no
 * sluggable characters. */
export function groupPath(surveyType: Pick<SurveyType, 'id' | 'name'>): string {
  return `/groups/${groupSlug(surveyType.name) || surveyType.id}`;
}

/**
 * Resolve a /groups/:typeId route param — a name slug or a numeric id (old
 * links keep working) — to the survey type id, or null when nothing matches.
 * Slugs are matched against the full survey type list; if two names ever
 * slugify identically the first wins, and the numeric URL stays canonical.
 */
export async function resolveGroupTypeId(param: string): Promise<number | null> {
  if (/^\d+$/.test(param)) return Number(param);
  const slug = param.toLowerCase();
  const types = await surveyTypesAPI.getAll();
  return types.find((t) => groupSlug(t.name) === slug)?.id ?? null;
}
