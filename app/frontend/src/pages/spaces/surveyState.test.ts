import { describe, it, expect } from 'vitest';
import type { Survey } from '../../services/api';
import { deriveSurveyState, buildWorklist, nextScheduledSurvey, formatWeekRange, recordedThisWeek } from './surveyState';

const TODAY = '2026-06-25';

function survey(partial: Partial<Survey> & { id: number; date: string }): Survey {
  return {
    status: 'scheduled',
    scheduled_window_start: null,
    scheduled_window_end: null,
    start_time: null,
    end_time: null,
    sun_percentage: null,
    temperature_celsius: null,
    conditions_met: null,
    notes: null,
    location_id: null,
    location_name: null,
    device_id: null,
    surveyor_ids: [],
    sightings_count: 0,
    species_breakdown: [],
    survey_type_id: 1,
    survey_type_name: 'Butterfly',
    survey_type_icon: null,
    survey_type_color: null,
    ...partial,
  };
}

describe('deriveSurveyState', () => {
  it('classifies a scheduled future-dated survey as upcoming', () => {
    expect(deriveSurveyState(survey({ id: 1, date: '2026-07-01', status: 'scheduled' }), TODAY)).toBe('upcoming');
  });

  it('classifies a scheduled past survey as needs-survey', () => {
    expect(deriveSurveyState(survey({ id: 2, date: '2026-06-20', status: 'scheduled' }), TODAY)).toBe('needs-survey');
  });

  it('classifies a completed survey as recorded, even with zero sightings (nil count)', () => {
    expect(
      deriveSurveyState(survey({ id: 3, date: '2026-06-20', status: 'completed', sightings_count: 0 }), TODAY),
    ).toBe('recorded');
  });

  it('classifies a cancelled survey as cancelled', () => {
    expect(
      deriveSurveyState(survey({ id: 4, date: '2026-06-20', status: 'cancelled' }), TODAY),
    ).toBe('cancelled');
  });

  it('treats a scheduled survey dated today as needs-survey (not upcoming)', () => {
    expect(deriveSurveyState(survey({ id: 5, date: TODAY, status: 'scheduled' }), TODAY)).toBe('needs-survey');
  });

  it('classifies a weekly survey before its window as upcoming', () => {
    expect(
      deriveSurveyState(
        survey({ id: 6, date: '2026-06-29', scheduled_window_start: '2026-06-29', scheduled_window_end: '2026-07-05' }),
        TODAY,
      ),
    ).toBe('upcoming');
  });

  it('classifies a weekly survey during its window as due-this-week (not overdue)', () => {
    expect(
      deriveSurveyState(
        survey({ id: 7, date: '2026-06-22', scheduled_window_start: '2026-06-22', scheduled_window_end: '2026-06-28' }),
        TODAY,
      ),
    ).toBe('due-this-week');
  });

  it('treats today == window_start as due-this-week (window is inclusive)', () => {
    expect(
      deriveSurveyState(
        survey({ id: 8, date: TODAY, scheduled_window_start: TODAY, scheduled_window_end: '2026-07-01' }),
        TODAY,
      ),
    ).toBe('due-this-week');
  });

  it('treats today == window_end as due-this-week (window is inclusive)', () => {
    expect(
      deriveSurveyState(
        survey({ id: 9, date: '2026-06-19', scheduled_window_start: '2026-06-19', scheduled_window_end: TODAY }),
        TODAY,
      ),
    ).toBe('due-this-week');
  });

  it('classifies a weekly survey after its window as needs-survey (overdue)', () => {
    expect(
      deriveSurveyState(
        survey({ id: 10, date: '2026-06-15', scheduled_window_start: '2026-06-15', scheduled_window_end: '2026-06-21' }),
        TODAY,
      ),
    ).toBe('needs-survey');
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
  const surveys = [
    survey({ id: 1, date: '2026-06-21', status: 'scheduled' }), // needs-survey
    survey({ id: 2, date: '2026-06-18', status: 'scheduled' }), // needs-survey
    survey({ id: 3, date: '2026-06-10', status: 'scheduled' }), // needs-survey
    survey({ id: 4, date: '2026-06-05', status: 'scheduled' }), // needs-survey (4th, still shown)
    survey({ id: 5, date: '2026-06-15', status: 'completed', sightings_count: 2 }), // recorded (excluded)
    survey({ id: 10, date: '2026-06-08', status: 'cancelled' }), // cancelled (excluded)
    survey({ id: 6, date: '2026-06-27', status: 'scheduled' }), // upcoming
    survey({ id: 7, date: '2026-07-01', status: 'scheduled' }), // upcoming
    survey({ id: 8, date: '2026-07-11', status: 'scheduled' }), // upcoming
    survey({ id: 9, date: '2026-07-19', status: 'scheduled' }), // upcoming (4th, dropped)
  ];

  it('never caps overdue, most recent first', () => {
    const { overdue } = buildWorklist(surveys, TODAY);
    expect(overdue.map((s) => s.id)).toEqual([1, 2, 3, 4]);
  });

  it('caps upcoming at 3 (soonest first) but reports the true total', () => {
    const { upcoming, upcomingTotal } = buildWorklist(surveys, TODAY);
    expect(upcoming.map((s) => s.id)).toEqual([6, 7, 8]);
    expect(upcomingTotal).toBe(4);
  });

  it('places a due-this-week (in-window) survey in its own bucket, not overdue or upcoming', () => {
    const weekly = survey({
      id: 20,
      date: '2026-06-24',
      scheduled_window_start: '2026-06-24',
      scheduled_window_end: '2026-06-30',
    });
    const { dueThisWeek, overdue, upcoming } = buildWorklist([weekly], TODAY);
    expect(dueThisWeek.map((s) => s.id)).toEqual([20]);
    expect(overdue).toEqual([]);
    expect(upcoming).toEqual([]);
  });
});

describe('recordedThisWeek', () => {
  it('keeps a completed weekly survey whose window contains today', () => {
    const s = survey({
      id: 1,
      date: '2026-06-23',
      status: 'completed',
      scheduled_window_start: '2026-06-22',
      scheduled_window_end: '2026-06-28',
    });
    expect(recordedThisWeek([s], TODAY).map((x) => x.id)).toEqual([1]);
  });

  it('drops a completed weekly survey from a past window', () => {
    const s = survey({
      id: 2,
      date: '2026-06-16',
      status: 'completed',
      scheduled_window_start: '2026-06-15',
      scheduled_window_end: '2026-06-21',
    });
    expect(recordedThisWeek([s], TODAY)).toEqual([]);
  });

  it('keeps a day-precise completed survey only when recorded for today', () => {
    const today = survey({ id: 3, date: TODAY, status: 'completed' });
    const yesterday = survey({ id: 4, date: '2026-06-24', status: 'completed' });
    expect(recordedThisWeek([today, yesterday], TODAY).map((x) => x.id)).toEqual([3]);
  });

  it('ignores non-completed surveys even inside the current window', () => {
    const s = survey({
      id: 5,
      date: '2026-06-22',
      status: 'scheduled',
      scheduled_window_start: '2026-06-22',
      scheduled_window_end: '2026-06-28',
    });
    expect(recordedThisWeek([s], TODAY)).toEqual([]);
  });
});

describe('nextScheduledSurvey', () => {
  it('returns the soonest upcoming survey', () => {
    const surveys = [
      survey({ id: 1, date: '2026-07-11' }),
      survey({ id: 2, date: '2026-06-27' }),
      survey({ id: 3, date: '2026-06-20' }), // past
    ];
    expect(nextScheduledSurvey(surveys, TODAY)?.id).toBe(2);
  });

  it('returns null when nothing is scheduled', () => {
    expect(nextScheduledSurvey([survey({ id: 1, date: '2026-06-01' })], TODAY)).toBeNull();
  });
});
