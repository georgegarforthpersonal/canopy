import { describe, it, expect } from 'vitest';
import { teamSlug, teamPath } from './teamMeta';

describe('teamSlug', () => {
  it('lowercases and hyphenates a multi-word name', () => {
    expect(teamSlug('Breeding Birds')).toBe('breeding-birds');
  });

  it('collapses punctuation and surrounding whitespace into single hyphens', () => {
    expect(teamSlug('  Moth (Light Trap)  ')).toBe('moth-light-trap');
  });

  it('strips leading and trailing hyphens', () => {
    expect(teamSlug('!Butterfly!')).toBe('butterfly');
  });

  it('returns an empty string for a name with no sluggable characters', () => {
    expect(teamSlug('!!!')).toBe('');
  });
});

describe('teamPath', () => {
  it('uses the name slug', () => {
    expect(teamPath({ id: 3, name: 'Butterfly' })).toBe('/teams/butterfly');
  });

  it('falls back to the id when the name has no sluggable characters', () => {
    expect(teamPath({ id: 3, name: '!!!' })).toBe('/teams/3');
  });
});
