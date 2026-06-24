/**
 * Sentry Error Monitoring
 *
 * Initialised from main.tsx. No-ops entirely when VITE_SENTRY_DSN is not set
 * (e.g. local development), so it is always safe to call the helpers here.
 */

import * as Sentry from '@sentry/react';

/**
 * Initialise Sentry. Call once at app startup, before rendering.
 */
export function initSentry(orgSlug: string): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    initialScope: {
      tags: { org: orgSlug },
    },
    beforeSend(event) {
      // Sentry's fetch instrumentation captures network-level TypeErrors before
      // application catch blocks run. Suppress them here — transient server
      // outages (e.g. deploy restarts) are not actionable application bugs, and
      // the app already surfaces an error state to the user.
      if (
        event.exception?.values?.some(
          (v) => v.type === 'TypeError' && v.value?.includes('Failed to fetch')
        )
      ) {
        return null;
      }
      return event;
    },
  });
}

interface ApiErrorContext {
  endpoint: string;
  method: string;
  status?: number;
}

/**
 * Report an API-layer error to Sentry with request context.
 *
 * Skips errors that are expected and not actionable:
 * - aborted requests (user navigated away / component unmounted)
 * - network-level failures with no HTTP status (offline or server unreachable)
 * - 4xx responses (validation, auth, not-found — surfaced to the user in-app)
 *
 * Sentry marks each error object it captures, so an error reported here will
 * not be double-counted if it later also escapes as an unhandled rejection.
 */
export function reportApiError(error: unknown, context: ApiErrorContext): void {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return;
  }
  if (context.status !== undefined && context.status < 500) {
    return;
  }
  // A fetch that rejects with no HTTP status is a network-level failure
  // (offline, or server temporarily unreachable, e.g. during a deploy restart).
  // navigator.onLine only checks for a network interface, not whether this
  // specific host is reachable, so treat all no-status TypeErrors the same way.
  if (context.status === undefined && error instanceof TypeError) {
    return;
  }

  Sentry.captureException(error, {
    tags: {
      'api.endpoint': context.endpoint,
      'api.method': context.method,
      ...(context.status !== undefined && { 'api.status': String(context.status) }),
    },
  });
}
