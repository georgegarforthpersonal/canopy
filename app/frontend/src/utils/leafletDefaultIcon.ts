/**
 * Wire Leaflet's default marker images up for the bundler. Without this the
 * default marker — and geoman's point-draw cursor, which instantiates
 * L.Icon.Default — renders as a broken image. Import once for the side effect.
 */
import L from 'leaflet';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

// Icon.Default prepends an auto-detected imagePath to its URLs, which doubles up
// (and breaks) bundled asset URLs. Drop that override so ours are used as-is.
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });
