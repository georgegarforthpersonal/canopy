import { describe, it, expect } from 'vitest';
import { groupSlug, groupPath, betaGroupNames, orgHasGroups, groupActivity, recordSurveyPath } from './groupMeta';

describe('groupSlug', () => {
  it('lowercases and hyphenates a multi-word name', () => {
    expect(groupSlug('Breeding Birds')).toBe('breeding-birds');
  });

  it('collapses punctuation and surrounding whitespace into single hyphens', () => {
    expect(groupSlug('  Moth (Light Trap)  ')).toBe('moth-light-trap');
  });

  it('strips leading and trailing hyphens', () => {
    expect(groupSlug('!Butterfly!')).toBe('butterfly');
  });

  it('returns an empty string for a name with no sluggable characters', () => {
    expect(groupSlug('!!!')).toBe('');
  });
});

describe('betaGroupNames / orgHasGroups', () => {
  it('gives Heal its butterfly and dragonfly groups', () => {
    expect(betaGroupNames('heal')).toEqual(['butterfly', 'dragonfly']);
    expect(orgHasGroups('heal')).toBe(true);
  });

  it('gives Cannwood bird (old and new type names), marsh fritillary and turtle dove', () => {
    expect(betaGroupNames('cannwood')).toContain('walking');
    expect(betaGroupNames('cannwood')).toContain('walking survey');
    expect(betaGroupNames('cannwood')).toContain('bird');
    expect(betaGroupNames('cannwood')).toContain('marsh fritillary');
    expect(betaGroupNames('cannwood')).toContain('turtledove');
    expect(betaGroupNames('cannwood')).toContain('turtle dove');
    expect(orgHasGroups('cannwood')).toBe(true);
  });

  it('gives Cannwood its unscheduled ad hoc, audio and camera trap groups', () => {
    expect(betaGroupNames('cannwood')).toContain('ad hoc');
    expect(betaGroupNames('cannwood')).toContain('audio');
    expect(betaGroupNames('cannwood')).toContain('camera trap');
  });

  it('hides Groups for orgs not in the beta', () => {
    expect(betaGroupNames('ecotopia')).toEqual([]);
    expect(orgHasGroups('ecotopia')).toBe(false);
  });
});

describe('groupActivity', () => {
  it('marks slot-scheduled types as worklist groups', () => {
    expect(groupActivity('Bird', 'cannwood')).toBe('worklist');
    expect(groupActivity('Marsh Fritillary', 'cannwood')).toBe('worklist');
    expect(groupActivity('Butterfly', 'heal')).toBe('worklist');
  });

  it('marks unscheduled types as record groups, matching names case-insensitively', () => {
    expect(groupActivity('Ad hoc', 'cannwood')).toBe('record');
    expect(groupActivity('  Audio  ', 'cannwood')).toBe('record');
    expect(groupActivity('Camera Trap', 'cannwood')).toBe('record');
  });

  it('defaults unknown names to worklist', () => {
    expect(groupActivity('Moth', 'cannwood')).toBe('worklist');
  });
});

describe('recordSurveyPath', () => {
  it('sends camera trap types to the camera trap wizard', () => {
    expect(recordSurveyPath({ id: 7, allow_image_upload: true, allow_audio_upload: false })).toBe(
      '/surveys/new/camera-trap?type=7',
    );
  });

  it('sends audio types to the audio wizard', () => {
    expect(recordSurveyPath({ id: 8, allow_image_upload: false, allow_audio_upload: true })).toBe(
      '/surveys/new/audio?type=8',
    );
  });

  it('sends plain types to the standard form with the type preselected', () => {
    expect(recordSurveyPath({ id: 9, allow_image_upload: false, allow_audio_upload: false })).toBe(
      '/surveys/new?survey_type_id=9',
    );
  });
});

describe('groupPath', () => {
  it('uses the name slug', () => {
    expect(groupPath({ id: 3, name: 'Butterfly' })).toBe('/groups/butterfly');
  });

  it('falls back to the id when the name has no sluggable characters', () => {
    expect(groupPath({ id: 3, name: '!!!' })).toBe('/groups/3');
  });
});
