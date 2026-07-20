import { useEffect, useState } from 'react';
import { getPhotoGps, type PhotoGpsCoords } from '../utils/photoGps';

export interface PhotoGpsSuggestion extends PhotoGpsCoords {
  file: File;
}

/**
 * Extract EXIF GPS coordinates from the given photo files. Photos without
 * GPS data are silently omitted.
 */
export function usePhotoGpsSuggestions(files?: File[]): PhotoGpsSuggestion[] {
  const [suggestions, setSuggestions] = useState<PhotoGpsSuggestion[]>([]);

  useEffect(() => {
    if (!files || files.length === 0) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      files.map(async (file) => {
        const gps = await getPhotoGps(file);
        return gps ? { file, ...gps } : null;
      })
    ).then((results) => {
      if (!cancelled) {
        setSuggestions(results.filter((r): r is PhotoGpsSuggestion => r !== null));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [files]);

  return suggestions;
}
