/**
 * Pure helpers behind offline-resilient survey saving.
 *
 * Field devices retry saves over flaky signal, so every created record
 * carries a client-minted UUID (`client_uuid`) the server dedupes on: a
 * retried create returns the existing row instead of inserting a duplicate.
 * The helpers here mint those UUIDs, fingerprint form state for dirty checks,
 * and re-adopt server ids after a partially-failed save.
 */

/** Stable identity for a File across renders (Files aren't JSON-serialisable). */
export const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

/**
 * Mint a v4 UUID. crypto.randomUUID needs a secure context, which local
 * network testing (http://192.168.x.x from a phone) doesn't have — fall back
 * to a Math.random implementation there; dedup only needs uniqueness per
 * survey, not cryptographic strength.
 */
export function mintClientUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface DraftIndividualLike {
  id?: number;
  client_uuid?: string;
}

interface DraftSightingLike {
  id?: number;
  client_uuid?: string;
  species_id: number | null;
  individuals?: DraftIndividualLike[];
}

/**
 * Give every not-yet-created sighting and individual a client_uuid, so the
 * whole save chain can be retried without creating duplicates. Existing rows
 * (with a server id) and already-minted drafts are left alone. Returns new
 * arrays/objects only where something changed.
 */
export function ensureClientUuids<
  I extends DraftIndividualLike,
  T extends DraftSightingLike & { individuals?: I[] },
>(sightings: T[]): T[] {
  return sightings.map((s) => {
    const needsOwn = s.species_id !== null && !s.id && !s.client_uuid;
    const individuals = s.individuals?.map((ind) =>
      !ind.id && !ind.client_uuid ? { ...ind, client_uuid: mintClientUuid() } : ind
    );
    const individualsChanged = individuals?.some((ind, i) => ind !== s.individuals![i]) ?? false;
    if (!needsOwn && !individualsChanged) return s;
    return {
      ...s,
      ...(needsOwn ? { client_uuid: mintClientUuid() } : {}),
      ...(individualsChanged ? { individuals } : {}),
    };
  });
}

interface ServerIndividualLike {
  id?: number;
  client_uuid?: string | null;
}

interface ServerSightingLike {
  id: number;
  client_uuid?: string | null;
  individuals?: ServerIndividualLike[];
}

/**
 * After a partially-failed save, some creates may have reached the server even
 * though their responses were lost. Given a fresh server baseline, adopt the
 * server ids for draft rows whose client_uuid the server already knows, so the
 * retry updates them instead of re-creating. Returns a new array (same object
 * identities where nothing matched).
 */
export function adoptServerIds<
  I extends DraftIndividualLike,
  T extends DraftSightingLike & { individuals?: I[] },
>(drafts: T[], serverSightings: ServerSightingLike[]): T[] {
  const byUuid = new Map<string, ServerSightingLike>();
  for (const s of serverSightings) {
    if (s.client_uuid) byUuid.set(s.client_uuid, s);
  }

  return drafts.map((draft) => {
    const server = draft.client_uuid ? byUuid.get(draft.client_uuid) : undefined;
    // A draft that already has an id keeps it; individuals may still need
    // adopting (added to an existing sighting, response lost).
    const serverIndividuals = server?.individuals ?? [];
    const individualsByUuid = new Map<string, ServerIndividualLike>();
    for (const ind of serverIndividuals) {
      if (ind.client_uuid) individualsByUuid.set(ind.client_uuid, ind);
    }

    const adoptedIndividuals = draft.individuals?.map((ind) => {
      if (ind.id || !ind.client_uuid) return ind;
      const serverInd = individualsByUuid.get(ind.client_uuid);
      return serverInd?.id != null ? { ...ind, id: serverInd.id } : ind;
    });
    const individualsChanged =
      adoptedIndividuals?.some((ind, i) => ind !== draft.individuals![i]) ?? false;
    const adoptId = !draft.id && server != null;

    if (!adoptId && !individualsChanged) return draft;
    return {
      ...draft,
      ...(adoptId ? { id: server!.id } : {}),
      ...(individualsChanged ? { individuals: adoptedIndividuals } : {}),
    };
  });
}

/**
 * Fingerprint of the editable survey state, used for dirty checks (draft
 * autosave and the unsaved-changes guard). Pending photo Files are identified
 * by name/size/mtime.
 */
export function draftFingerprint<T extends object>(form: unknown, sightings: T[]): string {
  return JSON.stringify({
    form,
    sightings: sightings.map((s) => {
      const { pendingPhotos, ...rest } = s as { pendingPhotos?: File[] };
      return { ...rest, pendingPhotos: pendingPhotos?.map(fileKey) };
    }),
  });
}
