import { describe, it, expect } from 'vitest';
import { collectRecentPhotos, collectRecentClips } from './recentMedia';
import type { Sighting, SightingAudioClip, Survey } from '../../services/api';

function survey(id: number, date: string): Survey {
  return { id, date } as Survey;
}

function sighting(surveyId: number, extra: Partial<Sighting>): Sighting {
  return { id: 0, survey_id: surveyId, species_id: 1, count: 1, ...extra } as Sighting;
}

function clip(recordingId: number): SightingAudioClip {
  return { confidence: 0.9, audio_recording_id: recordingId, start_time: '00:00:01', end_time: '00:00:04' };
}

describe('collectRecentPhotos', () => {
  it('flattens image ids in survey order, carrying species name and survey date', () => {
    const surveys = [survey(2, '2026-07-20'), survey(1, '2026-07-01')];
    const bySurvey = new Map([
      [2, [sighting(2, { species_name: 'Wildcat', image_ids: [10, 11] })]],
      [1, [sighting(1, { species_name: 'Badger', image_ids: [5] })]],
    ]);
    expect(collectRecentPhotos(surveys, bySurvey)).toEqual([
      { imageId: 10, speciesName: 'Wildcat', date: '2026-07-20' },
      { imageId: 11, speciesName: 'Wildcat', date: '2026-07-20' },
      { imageId: 5, speciesName: 'Badger', date: '2026-07-01' },
    ]);
  });

  it('caps the strip and skips sightings without images', () => {
    const surveys = [survey(1, '2026-07-01')];
    const bySurvey = new Map([
      [1, [sighting(1, { image_ids: [1, 2, 3] }), sighting(1, { notes: 'no images' })]],
    ]);
    expect(collectRecentPhotos(surveys, bySurvey, 2)).toHaveLength(2);
  });

  it('handles surveys with no fetched sightings', () => {
    expect(collectRecentPhotos([survey(1, '2026-07-01')], new Map())).toEqual([]);
  });
});

describe('collectRecentClips', () => {
  it('flattens audio clips in survey order, carrying species name and survey date', () => {
    const surveys = [survey(2, '2026-07-20'), survey(1, '2026-07-01')];
    const bySurvey = new Map([
      [2, [sighting(2, { species_name: 'Turtle Dove', audio_clips: [clip(7)] })]],
      [1, [sighting(1, { species_name: 'Skylark', audio_clips: [clip(3)] })]],
    ]);
    expect(collectRecentClips(surveys, bySurvey)).toEqual([
      { clip: clip(7), speciesName: 'Turtle Dove', date: '2026-07-20' },
      { clip: clip(3), speciesName: 'Skylark', date: '2026-07-01' },
    ]);
  });

  it('caps the strip', () => {
    const surveys = [survey(1, '2026-07-01')];
    const bySurvey = new Map([
      [1, [sighting(1, { audio_clips: [clip(1), clip(2), clip(3)] })]],
    ]);
    expect(collectRecentClips(surveys, bySurvey, 2)).toHaveLength(2);
  });
});
