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

/** Date label for a recorded survey row, e.g. "Sat 27 Jun 2026". */
export function formatRecordedDate(dateIso: string): string {
  return dayjs(dateIso).format('ddd D MMM YYYY');
}

/**
 * Caption for a gallery photo. Sighting photos are named after their species
 * ("Unidentified" when the species row has no name); survey-level photos have
 * no species at all, and are named after the survey's location.
 */
export function photoLabel(photo: { species_id: number | null; species_name: string | null }): string {
  if (photo.species_name) return photo.species_name;
  return photo.species_id === null ? 'Survey photo' : 'Unidentified';
}

/**
 * Compact date labels for the group card's schedule line, which is capped at
 * one line: the year is dropped when the date falls in the current year (the
 * common case for a next/last survey) and kept when it genuinely differs.
 */
export function formatSurveyDateShort(slot: ScheduledSurvey, today: string = todayIso()): string {
  const year = today.slice(0, 4);
  if (hasWindow(slot)) {
    const start = dayjs(slot.window_start);
    const end = dayjs(slot.window_end);
    if (start.format('YYYY') !== year || end.format('YYYY') !== year) {
      return formatWeekRange(slot.window_start, slot.window_end);
    }
    if (start.isSame(end, 'month')) {
      return `${start.format('D')}–${end.format('D')} ${end.format('MMM')}`;
    }
    return `${start.format('D MMM')} – ${end.format('D MMM')}`;
  }
  const day = dayjs(slot.window_start);
  return day.format('YYYY') === year ? day.format('ddd D MMM') : day.format('ddd D MMM YYYY');
}

/**
 * Compact recorded-date label — same year-dropping rule as
 * formatSurveyDateShort. `weekday: false` is the group card's variant, and
 * matches precision to recency: which Tuesday a past survey fell on is of no
 * use to anyone, so the day name goes, and once the date is a year old the
 * day-of-month goes with it ("Nov 2025") — that's what keeps the value the
 * width of a card column instead of truncating.
 */
export function formatRecordedDateShort(
  dateIso: string,
  today: string = todayIso(),
  { weekday = true }: { weekday?: boolean } = {},
): string {
  const day = dayjs(dateIso);
  if (day.format('YYYY') === today.slice(0, 4)) {
    return day.format(weekday ? 'ddd D MMM' : 'D MMM');
  }
  return day.format(weekday ? 'ddd D MMM YYYY' : 'MMM YYYY');
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
 * The Schedule filter's rows on the All surveys page: open and cancelled
 * slots (fulfilled slots are represented by their recorded surveys under
 * Past), soonest first — the same oldest-overdue-to-furthest-future order
 * as the group page worklist.
 */
export function scheduleSlots(slots: ScheduledSurvey[]): ScheduledSurvey[] {
  return slots.filter((s) => s.linked_surveys.length === 0).sort(byWindowStart);
}

/**
 * The next survey still to be carried out: this week's if one is due (a slot
 * whose window contains today hasn't happened yet, so it outranks anything
 * later), otherwise the soonest upcoming one. Null when nothing is scheduled.
 * Overdue slots are deliberately excluded — they're the group page's business,
 * not a "next up" date.
 */
export function nextScheduledSurvey(slots: ScheduledSurvey[], today: string = todayIso()): ScheduledSurvey | null {
  const pending = slots
    .filter((s) => {
      const state = deriveSlotState(s, today);
      return state === 'due-this-week' || state === 'upcoming';
    })
    // window_start ascending puts a due-this-week slot (started on or before
    // today) ahead of every upcoming one for free.
    .sort(byWindowStart);
  return pending[0] ?? null;
}
