import { describe, it, expect } from 'vitest';
import { findUnreadableFiles, isFileReadable, unreadablePhotosMessage } from './fileHealth';

/**
 * A File whose data can no longer be read — mimics iOS restoring a File from
 * an IndexedDB draft after the blob data behind it was evicted: metadata
 * (name, size) survives, but any actual read fails.
 */
const deadFile = (name: string): File => {
  const file = new File([new Uint8Array(1024)], name, { type: 'image/jpeg' });
  Object.defineProperty(file, 'slice', {
    value: () => ({
      arrayBuffer: () => Promise.reject(new DOMException('The requested file could not be read')),
    }),
  });
  return file;
};

describe('isFileReadable', () => {
  it('accepts a live file', async () => {
    const file = new File([new Uint8Array(1024)], 'IMG_0001.jpg', { type: 'image/jpeg' });
    expect(await isFileReadable(file)).toBe(true);
  });

  it('accepts an empty file — empty is not dead', async () => {
    const file = new File([], 'empty.jpg', { type: 'image/jpeg' });
    expect(await isFileReadable(file)).toBe(true);
  });

  it('rejects a file whose data read fails', async () => {
    expect(await isFileReadable(deadFile('IMG_0002.jpg'))).toBe(false);
  });
});

describe('findUnreadableFiles', () => {
  it('returns only the dead files, preserving order', async () => {
    const live = new File(['x'], 'live.jpg', { type: 'image/jpeg' });
    const dead1 = deadFile('dead1.jpg');
    const dead2 = deadFile('dead2.jpg');
    const result = await findUnreadableFiles([dead1, live, dead2]);
    expect(result).toEqual([dead1, dead2]);
  });

  it('returns empty for no files', async () => {
    expect(await findUnreadableFiles([])).toEqual([]);
  });
});

describe('unreadablePhotosMessage', () => {
  it('names a single photo', () => {
    const msg = unreadablePhotosMessage([deadFile('IMG_0003.jpg')]);
    expect(msg).toContain('A photo (IMG_0003.jpg)');
    expect(msg).toContain('re-attach');
  });

  it('counts and names multiple photos', () => {
    const msg = unreadablePhotosMessage([deadFile('a.jpg'), deadFile('b.jpg')]);
    expect(msg).toContain('2 photos (a.jpg, b.jpg)');
  });
});
