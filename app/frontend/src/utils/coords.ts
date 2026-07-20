/**
 * Coordinate Parsing Utilities
 *
 * Parses manually-entered WGS84 decimal coordinates ("lat, lng") for
 * precise sighting location entry.
 */

export type ParseLatLngResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; error: string };

const LAT_LNG_PATTERN = /^([+-]?\d{1,3}(?:\.\d+)?)(?:\s*,\s*|\s+)([+-]?\d{1,3}(?:\.\d+)?)$/;

/**
 * Parse a coordinate pair like "51.12345, -2.34567" (comma and/or
 * whitespace separated decimal degrees, latitude first).
 */
export function parseLatLng(input: string): ParseLatLngResult {
  const match = input.trim().match(LAT_LNG_PATTERN);
  if (!match) {
    return { ok: false, error: 'Use decimal coordinates, e.g. 51.12345, -2.34567' };
  }

  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);

  if (lat < -90 || lat > 90) {
    return { ok: false, error: 'Latitude must be between -90 and 90' };
  }
  if (lng < -180 || lng > 180) {
    return { ok: false, error: 'Longitude must be between -180 and 180' };
  }

  return { ok: true, lat, lng };
}
