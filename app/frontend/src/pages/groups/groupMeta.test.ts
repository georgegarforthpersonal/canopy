import { describe, it, expect } from 'vitest';
import { groupSlug, groupPath } from './groupMeta';

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

describe('groupPath', () => {
  it('uses the name slug', () => {
    expect(groupPath({ id: 3, name: 'Butterfly' })).toBe('/groups/butterfly');
  });

  it('falls back to the id when the name has no sluggable characters', () => {
    expect(groupPath({ id: 3, name: '!!!' })).toBe('/groups/3');
  });
});
