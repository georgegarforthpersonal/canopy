/**
 * Helpers mapping a survey type to its Spaces presentation: the accent colour
 * for its icon tile and the species type that drives its wildlife icon/charts.
 */
import { notionColors } from '../../theme';
import type { SurveyType, SurveyTypeWithDetails } from '../../services/api';

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
