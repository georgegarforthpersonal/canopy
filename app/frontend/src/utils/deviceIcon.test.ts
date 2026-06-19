import { describe, it, expect } from 'vitest';
import { getIconSvg, getDeviceIcon, DEVICE_ICON_SVG, ICON_KEYS } from './deviceIcon';

describe('getIconSvg', () => {
  it('returns the SVG for a known icon key', () => {
    expect(getIconSvg('camera')).toBe(DEVICE_ICON_SVG.camera);
  });

  it('falls back to the pin icon for an unknown key', () => {
    expect(getIconSvg('does-not-exist')).toBe(DEVICE_ICON_SVG.pin);
  });

  it('exposes an icon for every offered ICON_KEY', () => {
    for (const { key } of ICON_KEYS) {
      expect(DEVICE_ICON_SVG[key]).toBeTruthy();
    }
  });
});

describe('getDeviceIcon', () => {
  it('uses the supplied colour when active', () => {
    const icon = getDeviceIcon({ iconKey: 'camera', color: '#123456', isActive: true });
    const html = (icon.options as { html: string }).html;
    expect(html).toContain('#123456');
    expect(html).toContain('opacity: 1');
  });

  it('greys out and dims an inactive device', () => {
    const icon = getDeviceIcon({ iconKey: 'camera', color: '#123456', isActive: false });
    const html = (icon.options as { html: string }).html;
    expect(html).toContain('#9e9e9e');
    expect(html).toContain('opacity: 0.4');
  });

  it('caches icons by key, colour and active state', () => {
    const a = getDeviceIcon({ iconKey: 'leaf', color: '#abcdef', isActive: true });
    const b = getDeviceIcon({ iconKey: 'leaf', color: '#abcdef', isActive: true });
    expect(a).toBe(b);
  });
});
