import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

/**
 * Consistent top-of-page heading for the top-level pages (Surveys, Groups,
 * Dashboards, Admin). Once the nav collapses into the hamburger on mobile
 * this is the only on-screen answer to "where am I?", so every page gets
 * one, at label scale — not hero scale.
 *
 * `subtitle` is for the rare page whose function the title can't carry
 * alone (keep it to one short line; most pages shouldn't have one).
 * `actions` anchors the page's primary buttons to the title row.
 */
export function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 2,
        mb: 2.5,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography component="h1" sx={{ fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.25 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && <Box sx={{ flexShrink: 0 }}>{actions}</Box>}
    </Box>
  );
}
