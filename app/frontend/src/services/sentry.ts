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
  });
}

interface ApiErrorContext {
  endpoint: string;
  method: string;
  status?: number;
  // Set when fetch() itself rejected, before any response was received —
  // the device or the specific host was unreachable (offline, DNS failure,
  // server down, CORS preflight rejected). Not the same as a 4xx/5xx.
  unreachable?: boolean;
}

/**
 * Report an API-layer error to Sentry with request context.
 *
 * Skips errors that are expected and not actionable:
 * - aborted requests (user navigated away / component unmounted)
 * - connectivity failures (device offline, or the target host unreachable)
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
  // The request never reached a server, so there is nothing actionable in
  // the frontend — the outage (or offline device) is the thing to fix.
  if (context.unreachable) {
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
