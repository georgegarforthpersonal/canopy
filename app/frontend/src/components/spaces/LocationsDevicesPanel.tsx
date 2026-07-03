/**
 * Locations & devices panel for a space. Lists the locations assigned to the
 * survey type plus the devices sited at them, as either a map or a list (local
 * toggle, default Map). Letters (A/B/C…) tie the two views together. The map is
 * the same shared DeviceMap used by the admin tab, in read-only mode.
 */
import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import { Map as MapIcon, ViewList, Place as PlaceIcon } from '@mui/icons-material';
import { locationDisplayName } from '../../services/api';
import type { Device, LocationWithBoundary } from '../../services/api';
import {
  geometryLengthM,
  geometryAreaSqm,
  formatLength,
  formatArea,
} from '../../utils/geometry';
import { spaceCardSx, spaceColors } from '../../pages/spaces/spacesTokens';
import DeviceMap from '../admin/DeviceMap';

interface LocationsDevicesPanelProps {
  locations: LocationWithBoundary[];
  devices: Device[];
}


function locationDetail(loc: LocationWithBoundary): string {
  if (loc.location_type === 'route') {
    const len = geometryLengthM(loc.geometry);
    const sectorCount = loc.sectors?.length ?? 0;
    const parts = ['Transect'];
    if (sectorCount > 0) parts.push(`${sectorCount} ${sectorCount === 1 ? 'sector' : 'sectors'}`);
    if (len > 0) parts.push(formatLength(len));
    return parts.join(' · ');
  }
  if (loc.location_type === 'area') {
    const area = geometryAreaSqm(loc.geometry);
    return area > 0 ? `Area · ${formatArea(area)}` : 'Area';
  }
  if (loc.location_type === 'sector') {
    const len = geometryLengthM(loc.geometry);
    return len > 0 ? `Transect sector · ${formatLength(len)}` : 'Transect sector';
  }
  if (loc.location_type === 'point') return 'Point';
  return '';
}

function TypeChip({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <Box
      sx={{
        px: 1,
        py: 0.25,
        borderRadius: '6px',
        bgcolor: bg,
        color,
        fontSize: 11.5,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {label}
    </Box>
  );
}

export default function LocationsDevicesPanel({
  locations,
  devices,
}: LocationsDevicesPanelProps) {
  const [view, setView] = useState<'map' | 'list'>('map');

  const isEmpty = locations.length === 0 && devices.length === 0;

  return (
    <Paper sx={spaceCardSx}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          px: 2.25,
          py: 1.5,
          borderBottom: `1px solid ${spaceColors.divider}`,
        }}
      >
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: spaceColors.textPrimary, whiteSpace: 'nowrap' }}>
          Locations &amp; devices
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
              color: `${spaceColors.textPrimary} !important`,
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

      {isEmpty ? (
        <Box sx={{ px: 2.25, py: 3 }}>
          <Typography sx={{ fontSize: 13.5, color: spaceColors.textMuted }}>
            No locations or devices assigned to this survey type yet.
          </Typography>
        </Box>
      ) : view === 'map' ? (
        <DeviceMap
          locationsWithBoundaries={locations}
          devices={devices}
          readOnly
          height={360}
        />
      ) : (
        <Box>
          {locations.map((location) => (
            <Box
              key={`loc-${location.id}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2.25,
                py: 1.3,
                borderTop: `1px solid ${spaceColors.dividerInner}`,
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
                <PlaceIcon sx={{ fontSize: 16 }} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: spaceColors.textPrimary }} noWrap>
                  {locationDisplayName(location)}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: spaceColors.textMuted }}>
                  {locationDetail(location)}
                </Typography>
              </Box>
              <TypeChip label="Location" color="#2E6B42" bg="#DBEDDB" />
            </Box>
          ))}

          {devices.map((d) => (
            <Box
              key={`dev-${d.id}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2.25,
                py: 1.3,
                borderTop: `1px solid ${spaceColors.dividerInner}`,
              }}
            >
              <Box
                sx={{
                  width: 26,
                  height: 26,
                  borderRadius: '7px',
                  bgcolor: '#FBF3DB',
                  color: '#C99A00',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: 12.5,
                  flexShrink: 0,
                }}
              >
                •
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: spaceColors.textPrimary }} noWrap>
                  {d.name}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: spaceColors.textMuted }}>
                  {d.location_name ?? 'Device'}
                </Typography>
              </Box>
              <TypeChip label="Device" color="#C99A00" bg="#FBF3DB" />
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
}
