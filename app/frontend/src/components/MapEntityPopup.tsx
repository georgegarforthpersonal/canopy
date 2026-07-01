/**
 * Shared content shell for a Leaflet map popup describing a map entity
 * (a device or a location) with a title, optional chips/detail, and an action
 * row. Placed inside a react-leaflet <Popup>. Keeps the device and location
 * popups visually identical.
 */

import type { ReactNode } from 'react';
import { Box, Typography, Stack } from '@mui/material';

interface MapEntityPopupProps {
  title: string;
  /** Chip row shown under the title (e.g. type / status). */
  chips?: ReactNode;
  /** Muted detail lines (e.g. coordinates, length). */
  detail?: ReactNode;
  /** Action buttons (Edit, Delete, …). */
  actions: ReactNode;
}

export default function MapEntityPopup({ title, chips, detail, actions }: MapEntityPopupProps) {
  return (
    <Box sx={{ minWidth: 'min(180px, calc(100vw - 112px))', p: 0.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {title}
      </Typography>
      {chips && (
        <Stack direction="row" spacing={0.5} sx={{ mb: 1 }}>
          {chips}
        </Stack>
      )}
      {detail && <Box sx={{ mb: 1 }}>{detail}</Box>}
      <Stack direction="row" spacing={0.5}>
        {actions}
      </Stack>
    </Box>
  );
}
