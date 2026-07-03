/**
 * Survey state derivation for Survey Spaces.
 *
 * There is no separate "session" concept: every Survey row carries an explicit
 * lifecycle `status`, and we map it (plus the date for scheduled rows) to a
 * worklist state. The status is authoritative — a completed survey with a nil
 * count of zero is still "recorded", not "needs a survey".
 *   - upcoming      : scheduled, date/window in the future
 *   - due-this-week : scheduled weekly cadence, today falls inside the window
 *                     (due to be carried out, but NOT yet overdue)
 *   - needs-survey  : scheduled, date/window today or past (overdue, not recorded)
 *   - recorded      : completed (any sighting count, including zero)
 *   - cancelled     : scheduled survey that did not take place
 */
import dayjs from 'dayjs';
import type { Survey } from '../../services/api';

export type SurveyState = 'recorded' | 'upcoming' | 'due-this-week' | 'needs-survey' | 'cancelled';

/** Today's date as an ISO YYYY-MM-DD string (local time). */
function todayIso(): string {
  return dayjs().format('YYYY-MM-DD');
}

export function deriveSurveyState(survey: Survey, today: string = todayIso()): SurveyState {
  if (survey.status === 'completed') return 'recorded';
  if (survey.status === 'cancelled') return 'cancelled';
  // Weekly cadence: the survey may be carried out any day within the inclusive
  // [start, end] window, so it is "due this week" (not overdue) while today is
  // inside the window, and only becomes overdue once the window has passed.
  const { scheduled_window_start: windowStart, scheduled_window_end: windowEnd } = survey;
  if (windowStart && windowEnd) {
    if (today < windowStart) return 'upcoming';
    if (today <= windowEnd) return 'due-this-week';
    return 'needs-survey';
  }
  // Day-precise cadence: ISO date strings compare correctly lexicographically.
  return survey.date > today ? 'upcoming' : 'needs-survey';
}

/** Compact "next session" label, e.g. "Sat 27 Jun". */
export function formatSessionDate(isoDate: string): string {
  return dayjs(isoDate).format('ddd D MMM');
}

/** Whether a survey is scheduled for a whole week (weekly cadence) rather than a day. */
export function hasWindow(survey: Survey): boolean {
  return Boolean(survey.scheduled_window_start && survey.scheduled_window_end);
}

/**
 * The date label that heads a survey row: a week range for weekly cadence, or a
 * single dated day, both carrying the year — e.g. "1–7 Jul 2026" / "Sat 27 Jun 2026".
 */
export function formatSurveyDate(survey: Survey): string {
  if (survey.scheduled_window_start && survey.scheduled_window_end) {
    return formatWeekRange(survey.scheduled_window_start, survey.scheduled_window_end);
  }
  return dayjs(survey.date).format('ddd D MMM YYYY');
}

/**
 * Compact inclusive week-range label from two ISO dates, e.g.
 *   same month  → "1–7 Jun 2026"
 *   cross month → "29 Jun – 5 Jul 2026"
 *   cross year  → "29 Dec 2025 – 4 Jan 2026"
 */
export function formatWeekRange(startIso: string, endIso: string): string {
  const start = dayjs(startIso);
  const end = dayjs(endIso);
  if (start.isSame(end, 'year')) {
    if (start.isSame(end, 'month')) {
      return `${start.format('D')}–${end.format('D')} ${end.format('MMM YYYY')}`;
    }
    return `${start.format('D MMM')} – ${end.format('D MMM YYYY')}`;
  }
  return `${start.format('D MMM YYYY')} – ${end.format('D MMM YYYY')}`;
}

/**
 * Build the worklist for the Surveys panel: every row that needs doing (overdue
 * and due-this-week, most recent first — the actionable backlog is never hidden)
 * followed by the next 3 upcoming rows (soonest first; future weeks are
 * effectively endless, so they stay capped). `upcomingTotal` carries the true
 * upcoming count so the panel can say how many the cap hid. A due-this-week
 * (weekly, in-window) survey is actionable now, so it sits with needs-survey
 * rather than being filtered out as upcoming.
 */
export function buildWorklist(surveys: Survey[], today: string = todayIso()) {
  const needsSurvey = surveys
    .filter((s) => {
      const state = deriveSurveyState(s, today);
      return state === 'needs-survey' || state === 'due-this-week';
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const allUpcoming = surveys
    .filter((s) => deriveSurveyState(s, today) === 'upcoming')
    .sort((a, b) => a.date.localeCompare(b.date));

  return { needsSurvey, upcoming: allUpcoming.slice(0, 3), upcomingTotal: allUpcoming.length };
}

/** Soonest upcoming survey, or null if none scheduled. */
export function nextScheduledSurvey(surveys: Survey[], today: string = todayIso()): Survey | null {
  const upcoming = surveys
    .filter((s) => deriveSurveyState(s, today) === 'upcoming')
    .sort((a, b) => a.date.localeCompare(b.date));
  return upcoming[0] ?? null;
}
