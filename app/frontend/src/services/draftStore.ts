/**
 * IndexedDB-backed drafts for in-progress survey entry.
 *
 * Field surveys are typed on phones where the OS can kill a backgrounded tab
 * at any time, so form state must never live only in React memory. Each
 * draft is one record keyed by survey ('survey-<id>' for record/edit,
 * 'new-survey' for the create form) holding the whole editable state —
 * including pending photo Files, which IndexedDB stores natively (and
 * localStorage can't).
 *
 * Storage is best-effort: writes fail silently in e.g. Safari private mode,
 * where the in-memory form state still works as before. Note iOS deletes all
 * site storage after 7 days of Safari use without visiting the site (webapps
 * added to the home screen are exempt) — drafts are a hold-until-uploaded
 * buffer, not an archive.
 */

import type { DraftSighting } from '../components/surveys/SightingsEditor';

export interface SurveyDraftForm {
  date: string | null; // YYYY-MM-DD
  locationId: number | null;
  surveyorIds: number[];
  notes: string;
  startTime: string | null; // HH:mm:ss
  endTime: string | null; // HH:mm:ss
  sunPercentage: string;
  temperatureCelsius: string;
  /** Only used by the new-survey form. */
  surveyTypeId?: number | null;
}

export interface SurveyDraftRecord {
  key: string;
  savedAt: number; // epoch ms
  mode: 'record' | 'edit' | 'new';
  form: SurveyDraftForm;
  sightings: DraftSighting[];
  /** Camera-trap image Files pending upload (new-survey form only). */
  pendingImageFiles?: File[];
  /** Idempotency uuid for the survey create itself (new-survey form only). */
  surveyClientUuid?: string;
}

export const surveyDraftKey = (surveyId: number | string) => `survey-${surveyId}`;
export const NEW_SURVEY_DRAFT_KEY = 'new-survey';

const DB_NAME = 'canopy-drafts';
const DB_VERSION = 1;
const STORE = 'survey-drafts';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // A version change elsewhere (e.g. a future schema bump in another
        // tab) closes this connection; drop the cache so the next call reopens.
        db.onclose = () => {
          dbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function withStore<T>(
  dbMode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, dbMode);
        const request = run(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
      })
  );
}

export function saveSurveyDraft(record: SurveyDraftRecord): Promise<void> {
  return withStore('readwrite', (store) => store.put(record)).then(() => undefined);
}

export function loadSurveyDraft(key: string): Promise<SurveyDraftRecord | undefined> {
  return withStore('readonly', (store) => store.get(key)) as Promise<
    SurveyDraftRecord | undefined
  >;
}

export function deleteSurveyDraft(key: string): Promise<void> {
  return withStore('readwrite', (store) => store.delete(key)).then(() => undefined);
}

/**
 * Ask the browser to exempt this origin's storage from eviction under
 * pressure. Fire-and-forget: the grant is heuristic (no prompt) and drafts
 * must upload promptly regardless.
 */
export function requestPersistentStorage(): void {
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    // Older browsers without the Storage API.
  }
}
