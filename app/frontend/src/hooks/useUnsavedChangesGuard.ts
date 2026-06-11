import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import type { BlockerFunction } from 'react-router-dom';

/**
 * Guards in-progress work against accidental loss.
 *
 * While `when` is (or returns) true:
 * - warns via the native browser dialog on refresh / tab close (beforeunload)
 * - blocks in-app navigation (links, browser back, programmatic navigate)
 *   using react-router's useBlocker
 *
 * Returns the blocker so the page can render a confirmation dialog and call
 * `blocker.proceed()` (leave anyway) or `blocker.reset()` (stay).
 *
 * `when` may be a function so pages can read refs that change synchronously,
 * e.g. a "save just completed" ref flipped immediately before the post-save
 * `navigate()` call — that navigation must not be blocked, and a state-based
 * flag would still be one render stale when the blocker runs.
 */
export function useUnsavedChangesGuard(when: boolean | (() => boolean)) {
  const whenRef = useRef(when);
  whenRef.current = when;

  const isDirty = useCallback(() => {
    const current = whenRef.current;
    return typeof current === 'function' ? current() : current;
  }, []);

  // (a) Browser refresh / tab close
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // (b) In-app navigation
  return useBlocker(
    useCallback<BlockerFunction>(
      ({ currentLocation, nextLocation }) =>
        isDirty() && currentLocation.pathname !== nextLocation.pathname,
      [isDirty],
    ),
  );
}
