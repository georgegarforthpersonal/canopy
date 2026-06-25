import { describe, it, expect } from 'vitest';
import type { Survey } from '../../services/api';
import { deriveSurveyState, buildWorklist, nextSessionDate } from './surveyState';

const TODAY = '2026-06-25';

function survey(partial: Partial<Survey> & { id: number; date: string }): Survey {
  return {
    status: 'scheduled',
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
});

describe('buildWorklist', () => {
  const surveys = [
    survey({ id: 1, date: '2026-06-21', status: 'scheduled' }), // needs-survey
    survey({ id: 2, date: '2026-06-18', status: 'scheduled' }), // needs-survey
    survey({ id: 3, date: '2026-06-10', status: 'scheduled' }), // needs-survey
    survey({ id: 4, date: '2026-06-05', status: 'scheduled' }), // needs-survey (4th, dropped)
    survey({ id: 5, date: '2026-06-15', status: 'completed', sightings_count: 2 }), // recorded (excluded)
    survey({ id: 10, date: '2026-06-08', status: 'cancelled' }), // cancelled (excluded)
    survey({ id: 6, date: '2026-06-27', status: 'scheduled' }), // upcoming
    survey({ id: 7, date: '2026-07-01', status: 'scheduled' }), // upcoming
    survey({ id: 8, date: '2026-07-11', status: 'scheduled' }), // upcoming
    survey({ id: 9, date: '2026-07-19', status: 'scheduled' }), // upcoming (4th, dropped)
  ];

  it('caps needs-survey at 3, most recent first', () => {
    const { needsSurvey } = buildWorklist(surveys, TODAY);
    expect(needsSurvey.map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it('caps upcoming at 3, soonest first', () => {
    const { upcoming } = buildWorklist(surveys, TODAY);
    expect(upcoming.map((s) => s.id)).toEqual([6, 7, 8]);
  });
});

describe('nextSessionDate', () => {
  it('returns the soonest upcoming date', () => {
    const surveys = [
      survey({ id: 1, date: '2026-07-11' }),
      survey({ id: 2, date: '2026-06-27' }),
      survey({ id: 3, date: '2026-06-20' }), // past
    ];
    expect(nextSessionDate(surveys, TODAY)).toBe('2026-06-27');
  });

  it('returns null when nothing is scheduled', () => {
    expect(nextSessionDate([survey({ id: 1, date: '2026-06-01' })], TODAY)).toBeNull();
  });
});
