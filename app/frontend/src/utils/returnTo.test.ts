/**
 * Return-to-origin navigation helper tests.
 */

import { describe, it, expect } from 'vitest';
import type { Location } from 'react-router-dom';
import { readReturnTo, returnAfterAction, returnToHref, SURVEYS_RETURN } from './returnTo';

function locationWith(state: unknown): Location {
  return { pathname: '/surveys/947', search: '', hash: '', state, key: 'k' } as Location;
}

describe('readReturnTo', () => {
  it('falls back to the surveys list when there is no state (deep link / refresh)', () => {
    expect(readReturnTo(locationWith(null))).toEqual(SURVEYS_RETURN);
  });

  it('falls back when state carries no returnTo', () => {
    expect(readReturnTo(locationWith({ something: 'else' }))).toEqual(SURVEYS_RETURN);
  });

  it('reads a returnTo passed via navigation state', () => {
    const returnTo = { pathname: '/groups/12', label: 'Heal Butterflies' };
    expect(readReturnTo(locationWith({ returnTo }))).toEqual(returnTo);
  });
});

describe('returnToHref', () => {
  it('is just the pathname when there is no view state', () => {
    expect(returnToHref(SURVEYS_RETURN)).toBe('/surveys');
  });

  it('appends the origin query string so filters and page are restored', () => {
    expect(returnToHref({ ...SURVEYS_RETURN, search: '?type=3&page=2' })).toBe(
      '/surveys?type=3&page=2',
    );
  });
});

describe('returnAfterAction', () => {
  it('keeps the surveys list query-param flow (no local toast)', () => {
    expect(returnAfterAction(SURVEYS_RETURN, 'edited', 947)).toEqual({
      to: '/surveys?edited=947',
      toastHere: false,
    });
    expect(returnAfterAction(SURVEYS_RETURN, 'deleted', 947)).toEqual({
      to: '/surveys?deleted=947',
      toastHere: false,
    });
  });

  it('keeps the origin filter/page params alongside the action param', () => {
    expect(returnAfterAction({ ...SURVEYS_RETURN, search: '?type=3&page=2' }, 'edited', 947)).toEqual({
      to: '/surveys?type=3&page=2&edited=947',
      toastHere: false,
    });
  });

  it('returns to a space plainly and toasts from the acting page', () => {
    const space = { pathname: '/groups/12', label: 'Heal Butterflies' };
    expect(returnAfterAction(space, 'edited', 947)).toEqual({
      to: '/groups/12',
      toastHere: true,
    });
  });
});
