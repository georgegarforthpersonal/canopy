/**
 * API Service Tests
 *
 * Tests for the API client utility functions, particularly
 * the org slug extraction logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Helper to mock window.location
const mockLocation = (hostname: string, search = '') => {
  Object.defineProperty(window, 'location', {
    value: {
      hostname,
      search,
    },
    writable: true,
  });
};

// Store original location
const originalLocation = window.location;

describe('getOrgSlug', () => {
  beforeEach(() => {
    // Reset modules to get fresh imports with mocked location
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original location
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
  });

  it('should return "heal" for localhost', async () => {
    mockLocation('localhost');
    const { getOrgSlug } = await import('./api');
    expect(getOrgSlug()).toBe('heal');
  });

  it('should return "heal" for 127.0.0.1', async () => {
    mockLocation('127.0.0.1');
    const { getOrgSlug } = await import('./api');
    expect(getOrgSlug()).toBe('heal');
  });

  it('should allow org override via URL param on localhost', async () => {
    mockLocation('localhost', '?org=cannwood');
    const { getOrgSlug } = await import('./api');
    expect(getOrgSlug()).toBe('cannwood');
  });

  it('should extract org from canopydata.app domain', async () => {
    mockLocation('heal.canopydata.app');
    const { getOrgSlug } = await import('./api');
    expect(getOrgSlug()).toBe('heal');
  });

  it('should extract org from different canopydata.app subdomain', async () => {
    mockLocation('cannwood.canopydata.app');
    const { getOrgSlug } = await import('./api');
    expect(getOrgSlug()).toBe('cannwood');
  });

  it('should extract org from legacy Railway domain', async () => {
    mockLocation('healdata.up.railway.app');
    const { getOrgSlug } = await import('./api');
    expect(getOrgSlug()).toBe('heal');
  });

  it('should extract org from different Railway subdomain', async () => {
    mockLocation('cannwooddata.up.railway.app');
    const { getOrgSlug } = await import('./api');
    expect(getOrgSlug()).toBe('cannwood');
  });

  it('should fallback to org pattern for other domains', async () => {
    mockLocation('healdata.example.com');
    const { getOrgSlug } = await import('./api');
    expect(getOrgSlug()).toBe('heal');
  });

  it('should default to "heal" for unknown domains', async () => {
    mockLocation('unknown.example.com');
    const { getOrgSlug } = await import('./api');
    expect(getOrgSlug()).toBe('heal');
  });
});

describe('session expiry handling', () => {
  const TOKEN_KEY = 'canopy_session_token';
  const sessionExpiredEvents: Event[] = [];
  const recordEvent = (e: Event) => sessionExpiredEvents.push(e);

  // Mock fetch to return an error response with the given status
  const mockFetchError = (status: number, detail: string) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: async () => ({ detail }),
      text: async () => detail,
    }));
  };

  beforeEach(() => {
    vi.resetModules();
    mockLocation('localhost');
    localStorage.setItem(TOKEN_KEY, 'stale-token');
    sessionExpiredEvents.length = 0;
    window.addEventListener('canopy:session-expired', recordEvent);
  });

  afterEach(() => {
    window.removeEventListener('canopy:session-expired', recordEvent);
    localStorage.clear();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
  });

  it('should clear the token and dispatch session-expired on a 401', async () => {
    mockFetchError(401, 'Invalid or expired session');
    const { authAPI } = await import('./api');

    await expect(authAPI.me()).rejects.toThrowError('Invalid or expired session');

    expect(sessionExpiredEvents).toHaveLength(1);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('should not treat a failed login (401) as session expiry', async () => {
    mockFetchError(401, 'Invalid password');
    const { authAPI } = await import('./api');

    await expect(authAPI.login('jane@example.org', 'wrong-password')).rejects.toThrowError('Invalid password');

    expect(sessionExpiredEvents).toHaveLength(0);
    expect(localStorage.getItem(TOKEN_KEY)).toBe('stale-token');
  });

  it('should not dispatch session-expired for non-401 errors', async () => {
    mockFetchError(500, 'Internal server error');
    const { authAPI } = await import('./api');

    await expect(authAPI.me()).rejects.toThrowError('Internal server error');

    expect(sessionExpiredEvents).toHaveLength(0);
    expect(localStorage.getItem(TOKEN_KEY)).toBe('stale-token');
  });
});
