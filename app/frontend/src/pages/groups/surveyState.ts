/**
 * Slot state derivation for Groups.
 *
 * A ScheduledSurvey (slot) is a plan; recorded Survey rows link to it via
 * scheduled_survey_id. Fulfilment is derived from the linked surveys the API
 * embeds — a fulfilled slot is "recorded" even when its surveys carry a nil
 * count of zero.
 *   - recorded      : the slot has at least one linked recorded survey
 *   - cancelled     : the plan was called off (kept links notwithstanding)
 *   - upcoming      : open, window entirely in the future
 *   - due-this-week : open, today falls inside the window (due, NOT overdue)
 *   - needs-survey  : open, window has passed with nothing recorded
 */
import dayjs from 'dayjs';
import type { ScheduledSurvey } from '../../services/api';

export type SlotState = 'recorded' | 'upcoming' | 'due-this-week' | 'needs-survey' | 'cancelled';

/** Today's date as an ISO YYYY-MM-DD string (local time). */
function todayIso(): string {
  return dayjs().format('YYYY-MM-DD');
}

export function deriveSlotState(slot: ScheduledSurvey, today: string = todayIso()): SlotState {
  if (slot.status === 'cancelled') return 'cancelled';
  if (slot.linked_surveys.length > 0) return 'recorded';
  // The survey may be carried out any day within the inclusive [start, end]
  // window, so the slot is "due this week" (not overdue) while today is inside
  // it, and only becomes overdue once the window has passed. Day-precise slots
  // (start === end) fall out of the same comparison. ISO date strings compare
  // correctly lexicographically.
  if (today < slot.window_start) return 'upcoming';
  if (today <= slot.window_end) return 'due-this-week';
  return 'needs-survey';
}

/** Whether a slot spans a whole week (weekly cadence) rather than a day. */
export function hasWindow(slot: ScheduledSurvey): boolean {
  return slot.window_start !== slot.window_end;
}

/**
 * The date label that heads a slot row: a week range for weekly cadence, or a
 * single dated day, both carrying the year — e.g. "1–7 Jul 2026" / "Sat 27 Jun 2026".
 */
export function formatSurveyDate(slot: ScheduledSurvey): string {
  if (hasWindow(slot)) {
    return formatWeekRange(slot.window_start, slot.window_end);
  }
  return dayjs(slot.window_start).format('ddd D MMM YYYY');
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

function byWindowStart(a: ScheduledSurvey, b: ScheduledSurvey): number {
  return a.window_start.localeCompare(b.window_start) || a.id - b.id;
}

/**
 * Build the worklist for the Surveys panel, split by section and ordered so
 * the panel reads chronologically top to bottom: every overdue row
 * (`overdue`, oldest first — the actionable backlog is never hidden), the
 * current week's still-due rows (`dueThisWeek`), then the next 3 upcoming
 * rows (soonest first; future weeks are effectively endless, so they stay
 * capped). `upcomingTotal` carries the true upcoming count so the panel can
 * say how many the cap hid.
 */
export function buildWorklist(slots: ScheduledSurvey[], today: string = todayIso()) {
  const dueThisWeek = slots
    .filter((s) => deriveSlotState(s, today) === 'due-this-week')
    .sort(byWindowStart);

  const overdue = slots
    .filter((s) => deriveSlotState(s, today) === 'needs-survey')
    .sort(byWindowStart);

  const allUpcoming = slots
    .filter((s) => deriveSlotState(s, today) === 'upcoming')
    .sort(byWindowStart);

  return { dueThisWeek, overdue, upcoming: allUpcoming.slice(0, 3), upcomingTotal: allUpcoming.length };
}

/**
 * The fulfilled slots that belong to the current week, so the panel can keep
 * showing this week's survey after it has been recorded rather than letting it
 * vanish from the worklist.
 */
export function recordedThisWeek(slots: ScheduledSurvey[], today: string = todayIso()): ScheduledSurvey[] {
  return slots
    .filter(
      (s) =>
        deriveSlotState(s, today) === 'recorded' &&
        today >= s.window_start &&
        today <= s.window_end,
    )
    .sort(byWindowStart);
}

/** Soonest upcoming slot, or null if none scheduled. */
export function nextScheduledSurvey(slots: ScheduledSurvey[], today: string = todayIso()): ScheduledSurvey | null {
  const upcoming = slots
    .filter((s) => deriveSlotState(s, today) === 'upcoming')
    .sort(byWindowStart);
  return upcoming[0] ?? null;
}
