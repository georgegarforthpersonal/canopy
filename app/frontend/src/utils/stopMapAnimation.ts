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
 *
 * Why we also clear `_animatingZoom` (Sentry 127375999, recurring):
 * `map.stop()` cancels RAF-based flyTo animations but does NOT reliably clear the
 * `_animatingZoom` flag that guards CSS zoom transitions. Leaflet's
 * `_onZoomTransitionEnd` checks `if (!this._animatingZoom) { return; }` before
 * calling `_move()`, which eventually calls `_getMapPanePos(this._mapPane)`. If the
 * flag is still true when `transitionend` fires after `map.remove()` has deleted
 * `_mapPane`, the crash recurs. Directly clearing the flag ensures the guard fires.
 */
export function stopMapAnimation(map: LeafletMap): void {
  if (map.getPane('mapPane')) {
    map.stop();
    // Belt-and-suspenders: clear the CSS zoom-animation flag so that any
    // already-queued transitionend event returns early from _onZoomTransitionEnd
    // instead of proceeding to _move() with a deleted _mapPane.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (map as any)._animatingZoom = false;
  }
}
