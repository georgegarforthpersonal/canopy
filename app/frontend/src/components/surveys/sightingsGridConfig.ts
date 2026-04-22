/**
 * Shared column layout for the sightings table (edit + view modes).
 *
 * The table has four optional columns (device, location, GPS, notes) that are
 * mutually-exclusive in some combinations. Centralising the three-way branching
 * keeps SightingsEditor and SurveyDetailPage in lockstep.
 *
 * Columns: SPECIES, [DEVICE | LOCATION], [GPS | spacer], COUNT, [NOTES], DELETE
 */
export interface SightingsGridOptions {
  locationAtSightingLevel: boolean;
  allowGeolocation: boolean;
  allowSightingDeviceSelection: boolean;
  /**
   * Whether the notes column should render. In edit mode this follows
   * allow_sighting_notes; in view mode callers additionally require at least one
   * sighting to actually carry notes, to avoid an empty column.
   */
  showNotesColumn: boolean;
  /** When true, include the photos column (edit mode only, when sighting photo upload is on). */
  showPhotosColumn?: boolean;
  /** When true, include a trailing delete column (edit mode only). */
  includeDeleteColumn: boolean;
}

export interface SightingsGridConfig {
  gridColumns: string;
  showDevice: boolean;
  showLocation: boolean;
  showGps: boolean;
  showSpacer: boolean;
  showNotes: boolean;
}

export function getSightingsGridConfig(opts: SightingsGridOptions): SightingsGridConfig {
  const {
    locationAtSightingLevel,
    allowGeolocation,
    allowSightingDeviceSelection,
    showNotesColumn,
    includeDeleteColumn,
  } = opts;

  // Device selection is mutually exclusive with location and GPS.
  const showDevice = allowSightingDeviceSelection;
  const showLocation = !allowSightingDeviceSelection && locationAtSightingLevel;
  const showGps = !allowSightingDeviceSelection && allowGeolocation;
  const showSpacer = !showDevice && !showLocation && !showGps;

  const cols: string[] = [];
  // Species column — narrower when a device/location column is also present.
  cols.push(showDevice || showLocation ? '2fr' : '2.5fr');

  if (showDevice) cols.push('1.5fr');
  else if (showLocation) cols.push('1.2fr');

  if (showGps || showSpacer) cols.push('70px');

  cols.push('60px'); // COUNT

  if (showNotesColumn) cols.push('2fr');

  if (opts.showPhotosColumn) cols.push('80px');

  if (includeDeleteColumn) cols.push('40px');

  return {
    gridColumns: cols.join(' '),
    showDevice,
    showLocation,
    showGps,
    showSpacer,
    showNotes: showNotesColumn,
  };
}
