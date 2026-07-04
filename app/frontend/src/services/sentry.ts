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
}

/**
 * Messages browsers use for an opaque "the request never reached the
 * server" failure (dropped connection, DNS blip, TLS reset, etc.) with no
 * further detail available. These fire even while `navigator.onLine` is
 * true — that flag only reflects whether the device has a network
 * interface, not whether it can actually reach the server — which matters
 * for a field app used over patchy mobile signal.
 */
const OPAQUE_NETWORK_ERROR_MESSAGES = new Set([
  'Load failed', // Safari
  'Failed to fetch', // Chrome/Edge
  'NetworkError when attempting to fetch resource.', // Firefox
]);

/**
 * Report an API-layer error to Sentry with request context.
 *
 * Skips errors that are expected and not actionable:
 * - aborted requests (user navigated away / component unmounted)
 * - network failures while the browser knows it is offline
 * - opaque cross-browser "network unreachable" failures, even when the
 *   browser reports itself as online (see OPAQUE_NETWORK_ERROR_MESSAGES)
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
  // A fetch that rejects (no status) while offline is just "user has no
  // signal" — there is nothing to fix, so don't report it.
  if (context.status === undefined && !navigator.onLine) {
    return;
  }
  if (
    context.status === undefined &&
    error instanceof TypeError &&
    OPAQUE_NETWORK_ERROR_MESSAGES.has(error.message)
  ) {
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
