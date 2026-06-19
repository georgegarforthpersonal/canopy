import { DivIcon } from 'leaflet';

/**
 * Curated registry of device-type marker icons, keyed by ``icon_key``.
 *
 * Device types reference an icon by key (stored on the device_type registry row);
 * the SVGs themselves stay in code. Colour comes from the device-type record, so
 * these icons are drawn with a white stroke to sit on a coloured circle.
 */

// Inner SVG content per icon key (24x24 viewBox, white stroke). Wrapped by `wrapSvg`.
const SVG_INNER: Record<string, string> = {
  camera: `<path d="M12 16C13.6569 16 15 14.6569 15 13C15 11.3431 13.6569 10 12 10C10.3431 10 9 11.3431 9 13C9 14.6569 10.3431 16 12 16Z"/><path d="M3 16.8V9.2C3 8.0799 3 7.51984 3.21799 7.09202C3.40973 6.71569 3.71569 6.40973 4.09202 6.21799C4.51984 6 5.0799 6 6.2 6H7.25464C7.37758 6 7.43905 6 7.49576 5.9935C7.79166 5.95961 8.05705 5.79559 8.21969 5.54609C8.25086 5.49827 8.27836 5.44328 8.33333 5.33333C8.44329 5.11342 8.49827 5.00346 8.56062 4.90782C8.8859 4.40882 9.41668 4.08078 10.0085 4.01299C10.1219 4 10.2448 4 10.4907 4H13.5093C13.7552 4 13.8781 4 13.9915 4.01299C14.5833 4.08078 15.1141 4.40882 15.4394 4.90782C15.5017 5.00345 15.5567 5.11345 15.6667 5.33333C15.7216 5.44329 15.7491 5.49827 15.7803 5.54609C15.943 5.79559 16.2083 5.95961 16.5042 5.9935C16.561 6 16.6224 6 16.7454 6H17.8C18.9201 6 19.4802 6 19.908 6.21799C20.2843 6.40973 20.5903 6.71569 20.782 7.09202C21 7.51984 21 8.0799 21 9.2V16.8C21 17.9201 21 18.4802 20.782 18.908C20.5903 19.2843 20.2843 19.5903 19.908 19.782C19.4802 20 18.9201 20 17.8 20H6.2C5.0799 20 4.51984 20 4.09202 19.782C3.71569 19.5903 3.40973 19.2843 3.21799 18.908C3 18.4802 3 17.9201 3 16.8Z"/>`,
  microphone: `<path d="M19 10V12C19 15.866 15.866 19 12 19M5 10V12C5 15.866 8.13401 19 12 19M12 19V22M8 22H16M12 15C10.3431 15 9 13.6569 9 12V5C9 3.34315 10.3431 2 12 2C13.6569 2 15 3.34315 15 5V12C15 13.6569 13.6569 15 12 15Z"/>`,
  house: `<path d="M3 10L12 3L21 10V20C21 20.5523 20.5523 21 20 21H15V14H9V21H4C3.44772 21 3 20.5523 3 20V10Z"/>`,
  leaf: `<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>`,
  eye: `<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>`,
  bug: `<path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6Z"/><path d="M12 20v-9"/><path d="M9 7.13v-1a3 3 0 1 1 6 0v1"/><path d="M6 13H3"/><path d="M21 13h-3"/><path d="M6.5 8.5 4 6"/><path d="M17.5 8.5 20 6"/>`,
  radio: `<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>`,
  thermometer: `<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>`,
  droplet: `<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7Z"/>`,
  sensor: `<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>`,
  pin: `<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>`,
};

function wrapSvg(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/** Full marker SVG strings keyed by icon_key (white stroke, for use on a colour fill). */
export const DEVICE_ICON_SVG: Record<string, string> = Object.fromEntries(
  Object.entries(SVG_INNER).map(([key, inner]) => [key, wrapSvg(inner)]),
);

/** Icon keys offered in the device-type editor, with human labels. */
export const ICON_KEYS: { key: string; label: string }[] = [
  { key: 'microphone', label: 'Microphone' },
  { key: 'camera', label: 'Camera' },
  { key: 'house', label: 'Shelter' },
  { key: 'leaf', label: 'Leaf' },
  { key: 'eye', label: 'Eye' },
  { key: 'bug', label: 'Insect' },
  { key: 'radio', label: 'Radio' },
  { key: 'sensor', label: 'Sensor' },
  { key: 'thermometer', label: 'Temperature' },
  { key: 'droplet', label: 'Water' },
  { key: 'pin', label: 'Pin' },
];

/** Fallback icon for an unknown icon key. */
const FALLBACK_ICON_KEY = 'pin';

/** Resolve an icon_key to its marker SVG, falling back to a generic pin. */
export function getIconSvg(iconKey: string): string {
  return DEVICE_ICON_SVG[iconKey] ?? DEVICE_ICON_SVG[FALLBACK_ICON_KEY];
}

const INACTIVE_COLOR = '#9e9e9e';
const deviceIconCache = new Map<string, DivIcon>();

interface DeviceIconOptions {
  iconKey: string;
  color: string;
  isActive: boolean;
}

/**
 * Build a Leaflet marker icon for a device: a coloured circle containing the
 * device type's icon. Inactive devices are greyed and dimmed.
 */
export function getDeviceIcon({ iconKey, color, isActive }: DeviceIconOptions): DivIcon {
  const key = `${iconKey}-${color}-${isActive}`;
  let icon = deviceIconCache.get(key);
  if (!icon) {
    const fill = isActive ? color : INACTIVE_COLOR;
    const svg = getIconSvg(iconKey);
    const opacity = isActive ? 1 : 0.4;
    const size = 32;

    icon = new DivIcon({
      html: `<div style="
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background-color: ${fill};
        border: 2px solid #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        opacity: ${opacity};
        cursor: pointer;
      ">${svg}</div>`,
      className: '',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    deviceIconCache.set(key, icon);
  }
  return icon;
}
