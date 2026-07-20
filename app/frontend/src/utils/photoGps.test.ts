/**
 * Photo GPS Extraction Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import exifr from 'exifr';
import { getPhotoGps } from './photoGps';

vi.mock('exifr', () => ({
  default: { gps: vi.fn() },
}));

const mockGps = vi.mocked(exifr.gps);

function makeFile(name: string): File {
  return new File(['fake-bytes'], name, { type: 'image/jpeg' });
}

beforeEach(() => {
  mockGps.mockReset();
});

describe('getPhotoGps', () => {
  it('returns coordinates when EXIF GPS is present', async () => {
    mockGps.mockResolvedValue({ latitude: 51.1, longitude: -2.3 });
    await expect(getPhotoGps(makeFile('a.jpg'))).resolves.toEqual({
      latitude: 51.1,
      longitude: -2.3,
    });
  });

  it('returns null when no GPS data exists', async () => {
    mockGps.mockResolvedValue(undefined as unknown as { latitude: number; longitude: number });
    await expect(getPhotoGps(makeFile('b.jpg'))).resolves.toBeNull();
  });

  it('returns null when parsing throws', async () => {
    mockGps.mockRejectedValue(new Error('corrupt file'));
    await expect(getPhotoGps(makeFile('c.jpg'))).resolves.toBeNull();
  });

  it('returns null for the bogus (0, 0) fix', async () => {
    mockGps.mockResolvedValue({ latitude: 0, longitude: 0 });
    await expect(getPhotoGps(makeFile('d.jpg'))).resolves.toBeNull();
  });

  it('returns null for non-finite coordinates', async () => {
    mockGps.mockResolvedValue({ latitude: NaN, longitude: -2.3 });
    await expect(getPhotoGps(makeFile('e.jpg'))).resolves.toBeNull();
  });

  it('parses each file only once', async () => {
    mockGps.mockResolvedValue({ latitude: 51.1, longitude: -2.3 });
    const file = makeFile('f.jpg');
    await getPhotoGps(file);
    await getPhotoGps(file);
    expect(mockGps).toHaveBeenCalledTimes(1);

    await getPhotoGps(makeFile('g.jpg'));
    expect(mockGps).toHaveBeenCalledTimes(2);
  });
});
