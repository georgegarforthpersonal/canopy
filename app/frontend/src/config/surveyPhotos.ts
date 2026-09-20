/**
 * Survey-level photos.
 *
 * A habitat shot, a landscape panorama or a scanned report plate describes the
 * whole visit, not one species, so it hangs off the survey rather than off a
 * sighting. The rows reuse the camera_trap_image table (only filename and
 * r2_key are required of it) and are uploaded with skip_processing so no AI
 * inference is queued. Display is gated by the survey type's
 * `allow_survey_photos` flag.
 *
 * The pure helpers here are the bits worth testing on their own: which dropped
 * files are usable, and what order the grid puts them in.
 */

/** Extensions the images endpoint accepts, mirroring IMAGE_EXTENSIONS on the backend. */
export const SURVEY_PHOTO_EXTENSIONS: readonly string[] = [
  '.jpg',
  '.jpeg',
  '.png',
  '.tiff',
  '.tif',
  '.bmp',
];

/** Value for a file input's `accept` attribute. */
export const SURVEY_PHOTO_ACCEPT = SURVEY_PHOTO_EXTENSIONS.join(',');

/** The minimum shape of a photo the grid can order. */
export interface OrderableSurveyPhoto {
  id: number;
  filename: string;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot).toLowerCase();
}

/**
 * Split a dropped selection into files the upload endpoint will take and the
 * names of the ones it would reject, so the caller can say which were skipped
 * rather than failing the whole batch.
 */
export function partitionSurveyPhotoFiles(files: File[]): {
  accepted: File[];
  rejected: string[];
} {
  const accepted: File[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    if (SURVEY_PHOTO_EXTENSIONS.includes(extensionOf(file.name))) {
      accepted.push(file);
    } else {
      rejected.push(file.name);
    }
  }
  return { accepted, rejected };
}

/** Message naming the files that were left out of an upload, or null if none were. */
export function rejectedPhotosMessage(rejected: string[]): string | null {
  if (rejected.length === 0) return null;
  const noun = rejected.length === 1 ? 'file is not' : 'files are not';
  return `${rejected.length} ${noun} an accepted image type: ${rejected.join(', ')}`;
}

/**
 * Order photos for the grid by filename, comparing runs of digits as numbers so
 * "page-10.jpg" sorts after "page-9.jpg" rather than before it. Ties fall back
 * to id so the order is stable across refetches.
 */
export function orderSurveyPhotos<T extends OrderableSurveyPhoto>(photos: T[]): T[] {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  return [...photos].sort((a, b) => {
    const byName = collator.compare(a.filename, b.filename);
    return byName !== 0 ? byName : a.id - b.id;
  });
}
