import type { Map as LeafletMap } from 'leaflet';

/**
 * Cancel any in-flight Leaflet pan/zoom animation from a React effect cleanup,
 * without crashing when the map has already been torn down.
 *
 * Background: every `FitBounds`-style child calls `map.fitBounds()` / `setView()`,
 * which can start an animated pan. To stop a queued animation frame from firing
 * after the map unmounts (Sentry 127735662) the cleanup cancels the animation.
 *
 * `map.stop()` is unsafe to call unconditionally: it re-enters `setZoom()`, which
 * reaches `_getMapPanePos()` and reads `_leaflet_pos` off the map pane. Once
 * react-leaflet has removed the map, Leaflet has already `delete`d that pane, so
 * the read throws `Cannot read properties of undefined (reading '_leaflet_pos')`
 * (Sentry 127823393). The throw surfaces inside the effect cleanup and blanks the
 * whole page via the error boundary.
 *
 * `getPane('mapPane')` returns `undefined` once the map is removed, so we use it to
 * detect a still-live map. When the map is already gone there is nothing to do:
 * Leaflet's own `map.remove()` cancels the animation internally (it calls
 * `_stop()`) before deleting the panes.
 */
export function stopMapAnimation(map: LeafletMap): void {
  if (map.getPane('mapPane')) {
    map.stop();
  }
}
