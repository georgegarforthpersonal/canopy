/**
 * Detect "dead" File objects before they poison an upload.
 *
 * Photos attached in the field are persisted into the IndexedDB draft, and
 * iOS can evict the blob data behind a stored File while its metadata (name,
 * size) survives. Such a File looks intact in JS, but reading it fails — and
 * when it is serialized into a multipart body, WebKit silently drops the
 * part, so the server receives no `files` field at all and rejects the
 * upload with a 422 that no retry can ever get past.
 *
 * Probing a single byte forces a real read without pulling whole photos
 * into memory.
 */

function readProbe(blob: Blob): Promise<void> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().then(() => undefined);
  }
  if (typeof FileReader === 'undefined') {
    // No way to probe — fail open rather than block every save with photos.
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(blob);
  });
}

export async function isFileReadable(file: File): Promise<boolean> {
  try {
    await readProbe(file.slice(0, 1));
    return true;
  } catch {
    return false;
  }
}

/** The subset of `files` whose data can no longer be read, in order. */
export async function findUnreadableFiles(files: File[]): Promise<File[]> {
  const readable = await Promise.all(files.map(isFileReadable));
  return files.filter((_, i) => !readable[i]);
}

/** User-facing explanation naming the lost photos and how to recover. */
export function unreadablePhotosMessage(unreadable: File[]): string {
  const names = unreadable.map((f) => f.name).join(', ');
  const [subject, pronoun] =
    unreadable.length === 1
      ? [`A photo (${names}) is`, 'it']
      : [`${unreadable.length} photos (${names}) are`, 'them'];
  return (
    `${subject} no longer readable on this device — the image data was lost ` +
    `when the browser reclaimed storage. Remove ${pronoun} or re-attach ` +
    `${pronoun} from your photo library, then save again. Everything else ` +
    `you entered is safe.`
  );
}
