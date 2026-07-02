/**
 * Recurrence expansion for the admin "Schedule surveys" dialog.
 *
 * The dialog lets an admin pick a start date, a frequency and a number of
 * occurrences; this turns that rule into the explicit list of ISO dates that
 * the bulk-schedule endpoint creates one survey per.
 */
import dayjs from 'dayjs';

export type Frequency = 'once' | 'weekly' | 'fortnightly' | 'monthly';

export const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'once', label: 'One-off' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
];

const STEP_DAYS: Record<Exclude<Frequency, 'monthly' | 'once'>, number> = {
  weekly: 7,
  fortnightly: 14,
};

/**
 * Expand a recurrence rule into ISO (YYYY-MM-DD) dates.
 *
 * - `once` always yields a single date (occurrences is ignored).
 * - `monthly` steps by calendar months (dayjs clamps e.g. Jan 31 → Feb 28).
 * - Returns [] for a blank/invalid start date or a non-positive count.
 */
export function generateDates(
  startIso: string,
  frequency: Frequency,
  occurrences: number,
): string[] {
  const start = dayjs(startIso);
  if (!startIso || !start.isValid()) return [];

  const count = frequency === 'once' ? 1 : Math.floor(occurrences);
  if (count < 1) return [];

  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    const d =
      frequency === 'monthly'
        ? start.add(i, 'month')
        : frequency === 'once'
          ? start
          : start.add(i * STEP_DAYS[frequency], 'day');
    dates.push(d.format('YYYY-MM-DD'));
  }
  return dates;
}
