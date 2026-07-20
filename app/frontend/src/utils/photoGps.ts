/**
 * Photo GPS Extraction
 *
 * Reads EXIF GPS coordinates from photo files so sighting locations can be
 * taken straight from the surveyor's camera photos.
 */

import exifr from 'exifr';

export interface PhotoGpsCoords {
  latitude: number;
  longitude: number;
}

// Cache the promise per File so concurrent callers share one parse and
// reopening a modal never re-reads the file; removed files GC naturally.
const gpsCache = new WeakMap<File, Promise<PhotoGpsCoords | null>>();

async function extractGps(file: File): Promise<PhotoGpsCoords | null> {
  try {
    const gps = await exifr.gps(file);
    if (!gps) return null;
    const { latitude, longitude } = gps;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    // (0, 0) is a common bogus value written by cameras without a fix
    if (latitude === 0 && longitude === 0) return null;
    return { latitude, longitude };
  } catch {
    return null;
  }
}

/** GPS coordinates from a photo's EXIF, or null if absent/unreadable. */
export function getPhotoGps(file: File): Promise<PhotoGpsCoords | null> {
  let promise = gpsCache.get(file);
  if (!promise) {
    promise = extractGps(file);
    gpsCache.set(file, promise);
  }
  return promise;
}
