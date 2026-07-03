import { describe, it, expect } from 'vitest';
import { spaceSlug, spacePath } from './spaceMeta';

describe('spaceSlug', () => {
  it('lowercases and hyphenates a multi-word name', () => {
    expect(spaceSlug('Breeding Birds')).toBe('breeding-birds');
  });

  it('collapses punctuation and surrounding whitespace into single hyphens', () => {
    expect(spaceSlug('  Moth (Light Trap)  ')).toBe('moth-light-trap');
  });

  it('strips leading and trailing hyphens', () => {
    expect(spaceSlug('!Butterfly!')).toBe('butterfly');
  });

  it('returns an empty string for a name with no sluggable characters', () => {
    expect(spaceSlug('!!!')).toBe('');
  });
});

describe('spacePath', () => {
  it('uses the name slug', () => {
    expect(spacePath({ id: 3, name: 'Butterfly' })).toBe('/spaces/butterfly');
  });

  it('falls back to the id when the name has no sluggable characters', () => {
    expect(spacePath({ id: 3, name: '!!!' })).toBe('/spaces/3');
  });
});
