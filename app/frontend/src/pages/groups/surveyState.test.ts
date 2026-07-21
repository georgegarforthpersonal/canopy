import { describe, it, expect } from 'vitest';
import type { ScheduledSurvey } from '../../services/api';
import { deriveSlotState, buildWorklist, nextScheduledSurvey, formatWeekRange, recordedThisWeek } from './surveyState';

const TODAY = '2026-06-25';

function slot(partial: Partial<ScheduledSurvey> & { id: number; window_start: string }): ScheduledSurvey {
  return {
    survey_type_id: 1,
    location_id: null,
    location_name: null,
    window_end: partial.window_start,
    notes: null,
    status: 'open',
    surveyor_ids: [],
    linked_surveys: [],
    created_at: '2026-06-01T00:00:00',
    ...partial,
  };
}

const recordedSlot = (partial: Partial<ScheduledSurvey> & { id: number; window_start: string }) =>
  slot({ linked_surveys: [{ id: 100 + partial.id, date: partial.window_start }], ...partial });

describe('deriveSlotState', () => {
  it('classifies a future day-precise slot as upcoming', () => {
    expect(deriveSlotState(slot({ id: 1, window_start: '2026-07-01' }), TODAY)).toBe('upcoming');
  });

  it('classifies a past unfulfilled slot as needs-survey', () => {
    expect(deriveSlotState(slot({ id: 2, window_start: '2026-06-20' }), TODAY)).toBe('needs-survey');
  });

  it('classifies a fulfilled slot as recorded, whatever its window', () => {
    expect(
      deriveSlotState(recordedSlot({ id: 3, window_start: '2026-06-20' }), TODAY),
    ).toBe('recorded');
  });

  it('classifies a cancelled slot as cancelled, even fulfilled', () => {
    expect(
      deriveSlotState(recordedSlot({ id: 4, window_start: '2026-06-20', status: 'cancelled' }), TODAY),
    ).toBe('cancelled');
  });

  it('treats a day-precise slot dated today as due-this-week (window is inclusive)', () => {
    expect(deriveSlotState(slot({ id: 5, window_start: TODAY }), TODAY)).toBe('due-this-week');
  });

  it('classifies a weekly slot before its window as upcoming', () => {
    expect(
      deriveSlotState(
        slot({ id: 6, window_start: '2026-06-29', window_end: '2026-07-05' }),
        TODAY,
      ),
    ).toBe('upcoming');
  });

  it('classifies a weekly slot during its window as due-this-week (not overdue)', () => {
    expect(
      deriveSlotState(
        slot({ id: 7, window_start: '2026-06-22', window_end: '2026-06-28' }),
        TODAY,
      ),
    ).toBe('due-this-week');
  });

  it('treats today == window_start as due-this-week (window is inclusive)', () => {
    expect(
      deriveSlotState(slot({ id: 8, window_start: TODAY, window_end: '2026-07-01' }), TODAY),
    ).toBe('due-this-week');
  });

  it('treats today == window_end as due-this-week (window is inclusive)', () => {
    expect(
      deriveSlotState(slot({ id: 9, window_start: '2026-06-19', window_end: TODAY }), TODAY),
    ).toBe('due-this-week');
  });

  it('classifies a weekly slot after its window as needs-survey (overdue)', () => {
    expect(
      deriveSlotState(
        slot({ id: 10, window_start: '2026-06-15', window_end: '2026-06-21' }),
        TODAY,
      ),
    ).toBe('needs-survey');
  });

  it('a fulfilled slot is recorded even mid-window (fulfilment outranks due)', () => {
    expect(
      deriveSlotState(
        recordedSlot({ id: 11, window_start: '2026-06-22', window_end: '2026-06-28' }),
        TODAY,
      ),
    ).toBe('recorded');
  });
});

describe('formatWeekRange', () => {
  it('formats a same-month window compactly', () => {
    expect(formatWeekRange('2026-06-01', '2026-06-07')).toBe('1–7 Jun 2026');
  });

  it('formats a window spanning two months', () => {
    expect(formatWeekRange('2026-06-29', '2026-07-05')).toBe('29 Jun – 5 Jul 2026');
  });

  it('formats a window spanning two years', () => {
    expect(formatWeekRange('2025-12-29', '2026-01-04')).toBe('29 Dec 2025 – 4 Jan 2026');
  });
});

describe('buildWorklist', () => {
  const slots = [
    slot({ id: 1, window_start: '2026-06-21' }), // needs-survey
    slot({ id: 2, window_start: '2026-06-18' }), // needs-survey
    slot({ id: 3, window_start: '2026-06-10' }), // needs-survey
    slot({ id: 4, window_start: '2026-06-05' }), // needs-survey (4th, still shown)
    recordedSlot({ id: 5, window_start: '2026-06-15' }), // recorded (excluded)
    slot({ id: 10, window_start: '2026-06-08', status: 'cancelled' }), // cancelled (excluded)
    slot({ id: 6, window_start: '2026-06-27' }), // upcoming
    slot({ id: 7, window_start: '2026-07-01' }), // upcoming
    slot({ id: 8, window_start: '2026-07-11' }), // upcoming
    slot({ id: 9, window_start: '2026-07-19' }), // upcoming (4th, dropped)
  ];

  it('never caps overdue, oldest first so the panel reads chronologically', () => {
    const { overdue } = buildWorklist(slots, TODAY);
    expect(overdue.map((s) => s.id)).toEqual([4, 3, 2, 1]);
  });

  it('caps upcoming at 3 (soonest first) but reports the true total', () => {
    const { upcoming, upcomingTotal } = buildWorklist(slots, TODAY);
    expect(upcoming.map((s) => s.id)).toEqual([6, 7, 8]);
    expect(upcomingTotal).toBe(4);
  });

  it('places a due-this-week (in-window) slot in its own bucket, not overdue or upcoming', () => {
    const weekly = slot({ id: 20, window_start: '2026-06-24', window_end: '2026-06-30' });
    const { dueThisWeek, overdue, upcoming } = buildWorklist([weekly], TODAY);
    expect(dueThisWeek.map((s) => s.id)).toEqual([20]);
    expect(overdue).toEqual([]);
    expect(upcoming).toEqual([]);
  });
});

describe('recordedThisWeek', () => {
  it('keeps a fulfilled weekly slot whose window contains today', () => {
    const s = recordedSlot({ id: 1, window_start: '2026-06-22', window_end: '2026-06-28' });
    expect(recordedThisWeek([s], TODAY).map((x) => x.id)).toEqual([1]);
  });

  it('drops a fulfilled weekly slot from a past window', () => {
    const s = recordedSlot({ id: 2, window_start: '2026-06-15', window_end: '2026-06-21' });
    expect(recordedThisWeek([s], TODAY)).toEqual([]);
  });

  it('keeps a fulfilled day-precise slot only when it is for today', () => {
    const today = recordedSlot({ id: 3, window_start: TODAY });
    const yesterday = recordedSlot({ id: 4, window_start: '2026-06-24' });
    expect(recordedThisWeek([today, yesterday], TODAY).map((x) => x.id)).toEqual([3]);
  });

  it('ignores unfulfilled slots even inside the current window', () => {
    const s = slot({ id: 5, window_start: '2026-06-22', window_end: '2026-06-28' });
    expect(recordedThisWeek([s], TODAY)).toEqual([]);
  });
});

describe('nextScheduledSurvey', () => {
  it('returns the soonest upcoming slot', () => {
    const slots = [
      slot({ id: 1, window_start: '2026-07-11' }),
      slot({ id: 2, window_start: '2026-06-27' }),
      slot({ id: 3, window_start: '2026-06-20' }), // past
    ];
    expect(nextScheduledSurvey(slots, TODAY)?.id).toBe(2);
  });

  it('returns null when nothing is scheduled', () => {
    expect(nextScheduledSurvey([slot({ id: 1, window_start: '2026-06-01' })], TODAY)).toBeNull();
  });
});
