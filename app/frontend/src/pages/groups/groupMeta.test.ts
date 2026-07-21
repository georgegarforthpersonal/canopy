import { describe, it, expect } from 'vitest';
import { groupSlug, groupPath, betaGroupNames, orgHasGroups } from './groupMeta';

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

  it('hides Groups for orgs not in the beta', () => {
    expect(betaGroupNames('ecotopia')).toEqual([]);
    expect(orgHasGroups('ecotopia')).toBe(false);
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
