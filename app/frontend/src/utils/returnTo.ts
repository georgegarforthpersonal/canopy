/**
 * "Return-to-origin" navigation for the survey detail page.
 *
 * The survey detail page is reached from several places: the main surveys list
 * (`/surveys`) and, within Groups, a group overview or its all-surveys
 * list. Its back button and post-save/delete navigation should land back where
 * the user came from — not always dump them on the main list.
 *
 * The origin is passed in via React Router's `location.state`. On a deep link
 * or hard refresh there is no state, so we fall back to the main surveys list.
 */
import type { Location } from 'react-router-dom';

export interface ReturnTo {
  /** Route to return to (back button + after save/delete). */
  pathname: string;
  /**
   * Query string (with leading `?`) restoring the origin list's view state —
   * filters, page — so returning doesn't reset what the user had on screen.
   */
  search?: string;
  /** Noun for the back-button label, e.g. "Surveys" → "Back to Surveys". */
  label: string;
}

/** Default origin: the main surveys listing. */
export const SURVEYS_RETURN: ReturnTo = { pathname: '/surveys', label: 'Surveys' };

/** Read the origin from navigation state, defaulting to the surveys list. */
export function readReturnTo(location: Location): ReturnTo {
  const state = location.state as { returnTo?: ReturnTo } | null;
  return state?.returnTo ?? SURVEYS_RETURN;
}

/** Full navigable href for the origin, including its view-state query string. */
export function returnToHref(returnTo: ReturnTo): string {
  return `${returnTo.pathname}${returnTo.search ?? ''}`;
}

/**
 * Where to navigate after editing or deleting a survey.
 *
 * The main surveys list announces the change itself (toast + row highlight)
 * via a query param it already consumes, so we keep that battle-tested flow
 * untouched. Any other origin (e.g. a Group page) has no such announcer, so the
 * acting page shows the toast and we navigate there plainly.
 */
export function returnAfterAction(
  returnTo: ReturnTo,
  action: 'edited' | 'deleted',
  surveyId: number,
): { to: string; toastHere: boolean } {
  if (returnTo.pathname === SURVEYS_RETURN.pathname) {
    const params = new URLSearchParams(returnTo.search);
    params.set(action, String(surveyId));
    return { to: `/surveys?${params.toString()}`, toastHere: false };
  }
  return { to: returnToHref(returnTo), toastHere: true };
}
