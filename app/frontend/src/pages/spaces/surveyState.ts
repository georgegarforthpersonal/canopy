/**
 * Survey state derivation for Survey Spaces.
 *
 * There is no separate "session" concept: every Survey row carries an explicit
 * lifecycle `status`, and we map it (plus the date for scheduled rows) to a
 * worklist state. The status is authoritative — a completed survey with a nil
 * count of zero is still "recorded", not "needs a survey".
 *   - upcoming     : scheduled, date in the future
 *   - needs-survey : scheduled, date today/past (overdue, not yet recorded)
 *   - recorded     : completed (any sighting count, including zero)
 *   - cancelled    : scheduled survey that did not take place
 */
import dayjs from 'dayjs';
import type { Survey } from '../../services/api';

export type SurveyState = 'recorded' | 'upcoming' | 'needs-survey' | 'cancelled';

/** Today's date as an ISO YYYY-MM-DD string (local time). */
function todayIso(): string {
  return dayjs().format('YYYY-MM-DD');
}

export function deriveSurveyState(survey: Survey, today: string = todayIso()): SurveyState {
  if (survey.status === 'completed') return 'recorded';
  if (survey.status === 'cancelled') return 'cancelled';
  // scheduled: ISO date strings compare correctly lexicographically.
  return survey.date > today ? 'upcoming' : 'needs-survey';
}

export interface DateBlockParts {
  month: string; // "JUN"
  day: string; // "21"
  weekday: string; // "SAT"
}

export function dateBlockParts(isoDate: string): DateBlockParts {
  const d = dayjs(isoDate);
  return {
    month: d.format('MMM').toUpperCase(),
    day: d.format('D'),
    weekday: d.format('ddd').toUpperCase(),
  };
}

/** Compact "next session" label, e.g. "Sat 27 Jun". */
export function formatSessionDate(isoDate: string): string {
  return dayjs(isoDate).format('ddd D MMM');
}

/**
 * Build the fixed worklist for the Surveys panel: up to 3 needs-survey rows
 * (most recent past first) followed by up to 3 upcoming rows (soonest first).
 */
export function buildWorklist(surveys: Survey[], today: string = todayIso()) {
  const needsSurvey = surveys
    .filter((s) => deriveSurveyState(s, today) === 'needs-survey')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);

  const upcoming = surveys
    .filter((s) => deriveSurveyState(s, today) === 'upcoming')
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);

  return { needsSurvey, upcoming };
}

/** Soonest upcoming survey date, or null if none scheduled. */
export function nextSessionDate(surveys: Survey[], today: string = todayIso()): string | null {
  const upcoming = surveys
    .filter((s) => deriveSurveyState(s, today) === 'upcoming')
    .sort((a, b) => a.date.localeCompare(b.date));
  return upcoming[0]?.date ?? null;
}
