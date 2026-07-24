/**
 * Locations panel for a group: every location assigned to the survey type
 * (routes, sectors, areas, points) plus its allocated devices (a camera trap
 * type's cameras, an audio type's recorders), as either a map or a list
 * (local toggle, default Map). Routes and sectors sort first — volunteers
 * use them to understand where to walk; devices list after locations.
 */
import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import {
  Map as MapIcon,
  ViewList,
  Route as RouteIcon,
  Pentagon as AreaIcon,
  Place as PlaceIcon,
  PhotoCamera,
  Mic,
  Sensors,
} from '@mui/icons-material';
import { locationDisplayName } from '../../services/api';
import type { Device, LocationWithBoundary } from '../../services/api';
import { geometryLengthM, formatLength, geometryAreaSqm, formatArea } from '../../utils/geometry';
import { groupCardSx, groupColors } from '../../pages/groups/groupsTokens';
import DeviceMap from '../admin/DeviceMap';

interface LocationsPanelProps {
  /** All locations assigned to the survey type. */
  locations: LocationWithBoundary[];
  /** Devices allocated to the survey type (empty for most types). */
  devices?: Device[];
}

const DEVICE_TYPE_LABELS: Record<Device['device_type'], string> = {
  camera_trap: 'Camera trap',
  audio_recorder: 'Audio recorder',
  refugia: 'Refugia',
  moth_light_trap: 'Moth light trap',
};

function DeviceRowIcon({ type }: { type: Device['device_type'] }) {
  if (type === 'camera_trap') return <PhotoCamera sx={{ fontSize: 16 }} />;
  if (type === 'audio_recorder') return <Mic sx={{ fontSize: 16 }} />;
  return <Sensors sx={{ fontSize: 16 }} />;
}

function deviceDetail(device: Device): string {
  const parts = [DEVICE_TYPE_LABELS[device.device_type]];
  if (device.location_name) parts.push(device.location_name);
  if (!device.is_active) parts.push('inactive');
  return parts.join(' · ');
}

function locationDetail(loc: LocationWithBoundary): string {
  if (loc.location_type === 'sector') {
    const len = geometryLengthM(loc.geometry);
    return len > 0 ? `Transect sector · ${formatLength(len)}` : 'Transect sector';
  }
  if (loc.location_type === 'route') {
    const len = geometryLengthM(loc.geometry);
    const sectorCount = loc.sectors?.length ?? 0;
    const parts = ['Transect'];
    if (sectorCount > 0) parts.push(`${sectorCount} ${sectorCount === 1 ? 'sector' : 'sectors'}`);
    if (len > 0) parts.push(formatLength(len));
    return parts.join(' · ');
  }
  if (loc.location_type === 'point') return 'Point';
  if (loc.location_type === 'area') {
    const area = formatArea(geometryAreaSqm(loc.geometry));
    return area ? `Area · ${area}` : 'Area';
  }
  return '';
}

function LocationRowIcon({ type }: { type: LocationWithBoundary['location_type'] }) {
  if (type === 'area') return <AreaIcon sx={{ fontSize: 16 }} />;
  if (type === 'route' || type === 'sector') return <RouteIcon sx={{ fontSize: 16 }} />;
  return <PlaceIcon sx={{ fontSize: 16 }} />;
}

export default function LocationsPanel({ locations, devices = [] }: LocationsPanelProps) {
  const [view, setView] = useState<'map' | 'list'>('map');

  // Routes first, then sectors assigned in their own right, then the rest.
  const order = (l: LocationWithBoundary) =>
    l.location_type === 'route' ? 0 : l.location_type === 'sector' ? 1 : 2;
  const visible = [...locations].sort((a, b) => order(a) - order(b));
  const empty = visible.length === 0 && devices.length === 0;

  return (
    <Paper sx={groupCardSx}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          px: 2.25,
          py: 1.5,
          borderBottom: `1px solid ${groupColors.divider}`,
        }}
      >
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: groupColors.textPrimary, whiteSpace: 'nowrap' }}>
          {devices.length > 0 ? 'Locations & devices' : 'Locations'}
        </Typography>
        <ToggleButtonGroup
          value={view}
          exclusive
          size="small"
          onChange={(_, v) => v && setView(v)}
          sx={{
            bgcolor: '#f1f3f1',
            borderRadius: '7px',
            p: '3px',
            '& .MuiToggleButton-root': {
              border: 'none',
              borderRadius: '5px !important',
              px: 1.25,
              py: 0.4,
              color: '#8a8a8a',
              textTransform: 'none',
              fontSize: 12.5,
              gap: 0.5,
            },
            '& .Mui-selected': {
              bgcolor: '#fff !important',
              color: `${groupColors.textPrimary} !important`,
              boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
            },
          }}
        >
          <ToggleButton value="map">
            <MapIcon sx={{ fontSize: 15 }} /> Map
          </ToggleButton>
          <ToggleButton value="list">
            <ViewList sx={{ fontSize: 15 }} /> List
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {empty ? (
        <Box sx={{ px: 2.25, py: 3 }}>
          <Typography sx={{ fontSize: 13.5, color: groupColors.textMuted }}>
            No locations assigned to this survey type yet.
          </Typography>
        </Box>
      ) : view === 'map' ? (
        <DeviceMap
          locationsWithBoundaries={visible}
          devices={devices}
          readOnly
          height={360}
        />
      ) : (
        <Box>
          {visible.map((location) => (
            <Box
              key={location.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2.25,
                py: 1.3,
                borderTop: `1px solid ${groupColors.dividerInner}`,
              }}
            >
              <Box
                sx={{
                  width: 26,
                  height: 26,
                  borderRadius: '7px',
                  bgcolor: '#DBEDDB',
                  color: '#2E6B42',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <LocationRowIcon type={location.location_type} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: groupColors.textPrimary }} noWrap>
                  {locationDisplayName(location)}
                </Typography>
                {locationDetail(location) !== '' && (
                  <Typography sx={{ fontSize: 11.5, color: groupColors.textMuted }}>
                    {locationDetail(location)}
                  </Typography>
                )}
              </Box>
            </Box>
          ))}
          {devices.map((device) => (
            <Box
              key={`device-${device.id}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2.25,
                py: 1.3,
                borderTop: `1px solid ${groupColors.dividerInner}`,
              }}
            >
              <Box
                sx={{
                  width: 26,
                  height: 26,
                  borderRadius: '7px',
                  bgcolor: '#EBECED',
                  color: '#454648',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <DeviceRowIcon type={device.device_type} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: groupColors.textPrimary }} noWrap>
                  {device.name}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: groupColors.textMuted }}>
                  {deviceDetail(device)}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
}
