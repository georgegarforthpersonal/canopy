/**
 * Routes panel for a group: the transect routes (and their sectors) assigned
 * to the survey type, as either a map or a list (local toggle, default Map).
 * Deliberately routes-only — volunteers use this panel to understand where
 * to walk, so areas, points and devices are filtered out.
 */
import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import { Map as MapIcon, ViewList, Route as RouteIcon } from '@mui/icons-material';
import { locationDisplayName } from '../../services/api';
import type { LocationWithBoundary } from '../../services/api';
import { geometryLengthM, formatLength } from '../../utils/geometry';
import { groupCardSx, groupColors } from '../../pages/groups/groupsTokens';
import DeviceMap from '../admin/DeviceMap';

interface RoutesPanelProps {
  /** All locations assigned to the survey type; non-routes are filtered out here. */
  locations: LocationWithBoundary[];
}

function routeDetail(loc: LocationWithBoundary): string {
  const len = geometryLengthM(loc.geometry);
  if (loc.location_type === 'sector') {
    return len > 0 ? `Transect sector · ${formatLength(len)}` : 'Transect sector';
  }
  const sectorCount = loc.sectors?.length ?? 0;
  const parts = ['Transect'];
  if (sectorCount > 0) parts.push(`${sectorCount} ${sectorCount === 1 ? 'sector' : 'sectors'}`);
  if (len > 0) parts.push(formatLength(len));
  return parts.join(' · ');
}

export default function RoutesPanel({ locations }: RoutesPanelProps) {
  const [view, setView] = useState<'map' | 'list'>('map');

  // Routes first, then any sectors assigned to the type in their own right.
  const routes = locations.filter((l) => l.location_type === 'route');
  const sectors = locations.filter((l) => l.location_type === 'sector');
  const visible = [...routes, ...sectors];

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
          Routes
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

      {visible.length === 0 ? (
        <Box sx={{ px: 2.25, py: 3 }}>
          <Typography sx={{ fontSize: 13.5, color: groupColors.textMuted }}>
            No routes assigned to this survey type yet.
          </Typography>
        </Box>
      ) : view === 'map' ? (
        <DeviceMap
          locationsWithBoundaries={visible}
          devices={[]}
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
                <RouteIcon sx={{ fontSize: 16 }} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: groupColors.textPrimary }} noWrap>
                  {locationDisplayName(location)}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: groupColors.textMuted }}>
                  {routeDetail(location)}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
}
