import { describe, it, expect } from 'vitest';
import {
  mintClientUuid,
  ensureClientUuids,
  adoptServerIds,
  draftFingerprint,
  fileKey,
} from './surveyDraftSync';

interface TestIndividual {
  tempId: string;
  id?: number;
  client_uuid?: string;
}

interface TestSighting {
  tempId: string;
  species_id: number | null;
  id?: number;
  client_uuid?: string;
  individuals?: TestIndividual[];
}

describe('mintClientUuid', () => {
  it('produces v4-shaped, unique uuids', () => {
    const a = mintClientUuid();
    const b = mintClientUuid();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe('ensureClientUuids', () => {
  it('mints uuids for new sightings and their new individuals', () => {
    const sightings: TestSighting[] = [
      {
        tempId: 't1',
        species_id: 5,
        individuals: [{ tempId: 'i1' }, { tempId: 'i2' }],
      },
    ];
    const result = ensureClientUuids(sightings);
    expect(result[0].client_uuid).toBeTruthy();
    expect(result[0].individuals![0].client_uuid).toBeTruthy();
    expect(result[0].individuals![1].client_uuid).toBeTruthy();
    expect(result[0].individuals![0].client_uuid).not.toBe(result[0].individuals![1].client_uuid);
  });

  it('is stable: existing uuids and server rows are untouched', () => {
    const sightings: TestSighting[] = [
      { tempId: 't1', species_id: 5, client_uuid: 'keep-me' },
      { tempId: 't2', species_id: 6, id: 42 }, // already on the server
      { tempId: 't3', species_id: null }, // empty row, never created
    ];
    const result = ensureClientUuids(sightings);
    expect(result[0].client_uuid).toBe('keep-me');
    expect(result[1].client_uuid).toBeUndefined();
    expect(result[2].client_uuid).toBeUndefined();
    // Unchanged rows keep their identity (no needless re-renders)
    expect(result[0]).toBe(sightings[0]);
    expect(result[1]).toBe(sightings[1]);
    expect(result[2]).toBe(sightings[2]);
  });

  it('mints for individuals added to an existing sighting', () => {
    const sightings: TestSighting[] = [
      {
        tempId: 't1',
        species_id: 5,
        id: 42,
        individuals: [{ tempId: 'i1', id: 7 }, { tempId: 'i2' }],
      },
    ];
    const result = ensureClientUuids(sightings);
    expect(result[0].client_uuid).toBeUndefined();
    expect(result[0].individuals![0].client_uuid).toBeUndefined();
    expect(result[0].individuals![1].client_uuid).toBeTruthy();
  });
});

describe('adoptServerIds', () => {
  it('adopts the server id for creates whose responses were lost', () => {
    const drafts: TestSighting[] = [
      { tempId: 't1', species_id: 5, client_uuid: 'uuid-a' },
      { tempId: 't2', species_id: 6, client_uuid: 'uuid-b' },
    ];
    const server = [{ id: 101, client_uuid: 'uuid-a' }];
    const result = adoptServerIds(drafts, server);
    expect(result[0].id).toBe(101);
    expect(result[1].id).toBeUndefined();
    // Unmatched rows keep their identity
    expect(result[1]).toBe(drafts[1]);
  });

  it('adopts individual ids within a matched sighting', () => {
    const drafts: TestSighting[] = [
      {
        tempId: 't1',
        species_id: 5,
        client_uuid: 'uuid-a',
        individuals: [
          { tempId: 'i1', client_uuid: 'ind-a' },
          { tempId: 'i2', client_uuid: 'ind-b' },
        ],
      },
    ];
    const server = [
      { id: 101, client_uuid: 'uuid-a', individuals: [{ id: 201, client_uuid: 'ind-a' }] },
    ];
    const result = adoptServerIds(drafts, server);
    expect(result[0].id).toBe(101);
    expect(result[0].individuals![0].id).toBe(201);
    expect(result[0].individuals![1].id).toBeUndefined();
  });

  it('adopts individuals added to an already-known sighting', () => {
    const drafts: TestSighting[] = [
      {
        tempId: 't1',
        species_id: 5,
        id: 42,
        client_uuid: 'uuid-a',
        individuals: [{ tempId: 'i1', client_uuid: 'ind-a' }],
      },
    ];
    const server = [
      { id: 42, client_uuid: 'uuid-a', individuals: [{ id: 201, client_uuid: 'ind-a' }] },
    ];
    const result = adoptServerIds(drafts, server);
    expect(result[0].id).toBe(42);
    expect(result[0].individuals![0].id).toBe(201);
  });

  it('ignores server rows without client_uuid (pre-existing data)', () => {
    const drafts: TestSighting[] = [{ tempId: 't1', species_id: 5, client_uuid: 'uuid-a' }];
    const server = [{ id: 300, client_uuid: null }];
    const result = adoptServerIds(drafts, server);
    expect(result[0].id).toBeUndefined();
  });
});

describe('draftFingerprint', () => {
  const file = (name: string) => new File(['x'], name, { lastModified: 123 });

  it('is stable for equal state and changes when state changes', () => {
    const form = { notes: 'hello', locationId: 1 };
    const sightings = [{ tempId: 't1', species_id: 5, count: 2 }];
    expect(draftFingerprint(form, sightings)).toBe(draftFingerprint(form, sightings));
    expect(draftFingerprint(form, [{ tempId: 't1', species_id: 5, count: 3 }])).not.toBe(
      draftFingerprint(form, sightings)
    );
    expect(draftFingerprint({ ...form, notes: 'bye' }, sightings)).not.toBe(
      draftFingerprint(form, sightings)
    );
  });

  it('identifies pending photos by name/size/mtime, not object identity', () => {
    const a = draftFingerprint({}, [{ tempId: 't1', pendingPhotos: [file('p.jpg')] }]);
    const b = draftFingerprint({}, [{ tempId: 't1', pendingPhotos: [file('p.jpg')] }]);
    const c = draftFingerprint({}, [{ tempId: 't1', pendingPhotos: [file('q.jpg')] }]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('fileKey combines name, size and mtime', () => {
    expect(fileKey(file('p.jpg'))).toBe('p.jpg:1:123');
  });
});
