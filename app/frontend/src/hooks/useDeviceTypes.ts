/**
 * useDeviceTypes
 *
 * Fetches the device types available to the current organisation (built-in system
 * types + this org's custom types) and exposes a slug→record lookup. Single source
 * for device-type selects, the device map legend, and marker/label rendering.
 *
 * Follows the app's useEffect+state data pattern (no React Query).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { deviceTypesAPI } from '../services/api';
import type { DeviceTypeRecord } from '../services/api';

interface UseDeviceTypesResult {
  deviceTypes: DeviceTypeRecord[];
  bySlug: Map<string, DeviceTypeRecord>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useDeviceTypes(includeInactive: boolean = false): UseDeviceTypesResult {
  const [deviceTypes, setDeviceTypes] = useState<DeviceTypeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await deviceTypesAPI.getAll(includeInactive);
      setDeviceTypes(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load device types');
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    reload();
  }, [reload]);

  const bySlug = useMemo(
    () => new Map(deviceTypes.map((dt) => [dt.slug, dt])),
    [deviceTypes],
  );

  return { deviceTypes, bySlug, loading, error, reload };
}
