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
 * Report an API-layer error to Sentry with request context.
 *
 * Skips errors that are expected and not actionable:
 * - aborted requests (user navigated away / component unmounted)
 * - network failures while the browser knows it is offline
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
  // A fetch that rejects (no status) is a network-level failure — either the
  // browser is offline, the server is temporarily unreachable, or (rarely) a
  // stream-read error. None of these are actionable in app code.
  // navigator.onLine is insufficient: it returns true whenever the device has
  // local network connectivity, even when the target server is down. CORS
  // misconfigurations (also TypeError) are consistent across many requests and
  // will surface through user reports and DevTools rather than a single event.
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
