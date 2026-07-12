import { useCallback, useEffect, useRef } from 'react';
import { saveSurveyDraft, deleteSurveyDraft } from '../services/draftStore';
import type { SurveyDraftRecord } from '../services/draftStore';
import { draftFingerprint, fileKey } from '../utils/surveyDraftSync';

const AUTOSAVE_DEBOUNCE_MS = 1200;

/** Content identity of a draft, ignoring savedAt (which changes every write). */
const contentFingerprint = (record: SurveyDraftRecord): string =>
  draftFingerprint(
    {
      key: record.key,
      mode: record.mode,
      form: record.form,
      surveyClientUuid: record.surveyClientUuid,
      pendingImageFiles: record.pendingImageFiles?.map(fileKey),
    },
    record.sightings
  );

/**
 * Continuously back up in-progress survey entry to IndexedDB.
 *
 * Pass the current draft record (rebuilt each render), or null when there is
 * nothing worth saving (not editing / not dirty / just saved). Writes are
 * debounced on change and flushed when the page is hidden — on mobile,
 * `visibilitychange → hidden` is the last reliable moment before the OS may
 * kill the tab (beforeunload does not fire there) — and again on unmount,
 * which covers the session-expiry redirect tearing the form down.
 *
 * `clearDraft` deletes the stored record and stops further writes for the
 * current editing session (so a re-render between save-success and navigation
 * can't resurrect it); a new session (draft going null then non-null again)
 * re-enables saving.
 */
export function useDraftAutosave(
  draft: SurveyDraftRecord | null,
  onSaved?: (at: number) => void
): { clearDraft: () => void; flushDraft: () => void } {
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const stoppedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fingerprint of the last write, so re-renders that don't change the draft
  // (including the one caused by onSaved itself) don't schedule more writes.
  const lastWrittenRef = useRef<string | null>(null);

  const cancelTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const flushDraft = useCallback(() => {
    cancelTimer();
    const record = draftRef.current;
    if (stoppedRef.current || !record) return;
    const fingerprint = contentFingerprint(record);
    if (fingerprint === lastWrittenRef.current) return;
    lastWrittenRef.current = fingerprint;
    const savedAt = Date.now();
    saveSurveyDraft({ ...record, savedAt })
      .then(() => onSavedRef.current?.(savedAt))
      .catch(() => {
        // Best-effort (private mode, quota); the form keeps working from memory.
      });
  }, []);

  // Debounced write whenever the draft changes. The draft object is rebuilt
  // by the parent on every render, so this effect re-runs per render; the
  // timer reset makes it a debounce over the user's edits.
  useEffect(() => {
    if (draft === null) {
      // Editing session over (or clean). Lift any stop so the next session
      // (e.g. Cancel then Edit again) autosaves normally.
      stoppedRef.current = false;
      lastWrittenRef.current = null;
      cancelTimer();
      return;
    }
    if (stoppedRef.current) return;
    if (contentFingerprint(draft) === lastWrittenRef.current) return;
    cancelTimer();
    timerRef.current = setTimeout(flushDraft, AUTOSAVE_DEBOUNCE_MS);
  }, [draft, flushDraft]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushDraft();
    };
    window.addEventListener('pagehide', flushDraft);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushDraft);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [flushDraft]);

  // Unmount flush (session-expiry redirect, in-app navigation the guard let
  // through). clearDraft's stop flag keeps deliberate exits from re-saving.
  useEffect(() => () => flushDraft(), [flushDraft]);

  const clearDraft = useCallback(() => {
    stoppedRef.current = true;
    cancelTimer();
    const key = draftRef.current?.key;
    if (key) deleteSurveyDraft(key).catch(() => {});
  }, []);

  return { clearDraft, flushDraft };
}
