import { Box, Typography } from '@mui/material';
import { Lock } from '@mui/icons-material';

/**
 * Shown when a signed-in user lands on a page above their role
 * (e.g. a viewer deep-links to /surveys/new). In-page affordances for
 * these destinations are hidden, so this is a fallback, not a prompt —
 * gaining access means asking an org admin, not logging in again.
 */
export function AccessNotice({ message }: { message: string }) {
  return (
    <Box
      sx={{
        p: 3,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '400px',
      }}
    >
      <Lock sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
      <Typography variant="h6" sx={{ mb: 1 }}>
        More access needed
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', maxWidth: 420 }}>
        {message} Ask your organisation's admin if you think you should have access.
      </Typography>
    </Box>
  );
}
