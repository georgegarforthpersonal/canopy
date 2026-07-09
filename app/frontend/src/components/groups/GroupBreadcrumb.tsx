/**
 * Lightweight breadcrumb for Group screens, e.g. "Groups / Butterfly". Non-last
 * crumbs with an `href` navigate; the last crumb is plain muted text.
 */
import { Box, Link, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { groupColors } from '../../pages/groups/groupsTokens';

export interface Crumb {
  label: string;
  to?: string;
}

export default function GroupBreadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  const navigate = useNavigate();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 2, flexWrap: 'wrap' }}>
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            {c.to && !isLast ? (
              <Link
                component="button"
                onClick={() => navigate(c.to!)}
                underline="hover"
                sx={{ fontSize: 13.5, color: groupColors.brand, fontWeight: 500 }}
              >
                {c.label}
              </Link>
            ) : (
              <Typography sx={{ fontSize: 13.5, color: groupColors.textMuted }}>{c.label}</Typography>
            )}
            {!isLast && <Typography sx={{ fontSize: 13.5, color: '#ccc' }}>/</Typography>}
          </Box>
        );
      })}
    </Box>
  );
}
