/**
 * Admin "Locations & devices" tab: loads all locations and devices for the org
 * and renders LocationsDevicesView.
 */

import { useCallback, useEffect, useState } from 'react';

import { locationsAPI, devicesAPI } from '../../services/api';
import type { Location, LocationWithBoundary, Device } from '../../services/api';
import LocationsDevicesView from './LocationsDevicesView';

export default function LocationsDevicesManager() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [boundaries, setBoundaries] = useState<LocationWithBoundary[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, withBoundaries, deviceList] = await Promise.all([
        locationsAPI.getAll(),
        locationsAPI.getAllWithBoundaries(),
        devicesAPI.getAll(true),
      ]);
      setLocations(list);
      setBoundaries(withBoundaries);
      setDevices(deviceList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load locations and devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <LocationsDevicesView
      locations={locations}
      boundaries={boundaries}
      devices={devices}
      loading={loading}
      loadError={error}
      onReload={load}
    />
  );
}
