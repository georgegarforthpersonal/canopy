/**
 * Return-to-origin navigation helper tests.
 */

import { describe, it, expect } from 'vitest';
import type { Location } from 'react-router-dom';
import { readReturnTo, returnAfterAction, SURVEYS_RETURN } from './returnTo';

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
    const returnTo = { pathname: '/teams/12', label: 'Heal Butterflies' };
    expect(readReturnTo(locationWith({ returnTo }))).toEqual(returnTo);
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

  it('returns to a space plainly and toasts from the acting page', () => {
    const space = { pathname: '/teams/12', label: 'Heal Butterflies' };
    expect(returnAfterAction(space, 'edited', 947)).toEqual({
      to: '/teams/12',
      toastHere: true,
    });
  });
});
