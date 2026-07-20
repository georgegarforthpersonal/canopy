import type { Location, LocationWithBoundary } from '../services/api';

/**
 * Restrict map boundary overlays to a survey type's Available Locations.
 *
 * `available` is the type's assigned location set (from /locations/by-survey-type),
 * which may include sectors; boundary geometry is only served on top-level
 * locations, so a route is kept when the route itself OR any of its sectors is
 * assigned. An empty `available` list means the survey type doesn't restrict
 * locations (the location field is omitted from its surveys), so every boundary
 * is kept as map reference.
 */
export function scopeBoundariesToLocations(
  boundaries: LocationWithBoundary[],
  available: Location[],
): LocationWithBoundary[] {
  if (available.length === 0) return boundaries;
  const allowed = new Set(available.map((l) => l.id));
  return boundaries.filter(
    (b) => allowed.has(b.id) || (b.sectors ?? []).some((s) => allowed.has(s.id)),
  );
}
