/**
 * Card representation of a single admin list row, used on mobile where the
 * desktop tables would otherwise force horizontal scrolling. Actions are
 * pinned top-right; chips wrap underneath the title block.
 */
import type { ReactNode, Ref } from 'react';
import { Box, Paper, Stack } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';

interface EntityCardProps {
  /** Main identifying content (name text or chip). */
  title: ReactNode;
  /** Secondary content rendered under the title (e.g. a description). */
  subtitle?: ReactNode;
  /** Chips (status, type, features) rendered as a wrapping row below. */
  chips?: ReactNode;
  /** Icon buttons pinned to the top-right corner. */
  actions?: ReactNode;
  /** Ref to the card element, for scroll-into-view highlighting. */
  ref?: Ref<HTMLDivElement>;
  sx?: SxProps<Theme>;
}

export default function EntityCard({ title, subtitle, chips, actions, ref, sx = [] }: EntityCardProps) {
  return (
    <Paper
      ref={ref}
      variant="outlined"
      sx={[{ p: 2 }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
        <Box sx={{ minWidth: 0 }}>
          {title}
          {subtitle}
        </Box>
        {actions && (
          <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0, mt: -0.5, mr: -0.5 }}>
            {actions}
          </Stack>
        )}
      </Stack>
      {chips && (
        <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1.5 }}>
          {chips}
        </Stack>
      )}
    </Paper>
  );
}
