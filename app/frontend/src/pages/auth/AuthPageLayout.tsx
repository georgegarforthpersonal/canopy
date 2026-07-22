import { Box, Paper, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import canopyLogo from '../../assets/canopy-logo.svg';

/**
 * Centered card layout shared by the login / invite / password pages.
 * These render outside the main app Layout (no nav bar) since the user
 * is not signed in yet.
 */
export function AuthPageLayout({ title, children }: { title: string; children: ReactNode }) {
  const { organisation } = useAuth();

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'grey.50',
        px: 2,
      }}
    >
      <Paper elevation={1} sx={{ p: 4, width: '100%', maxWidth: 420, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
          <Box sx={{ width: 56, height: 56, mb: 1.5 }}>
            <img
              src={canopyLogo}
              alt="Canopy"
              style={{ width: '100%', height: '100%' }}
            />
          </Box>
          {organisation && (
            <Typography variant="body2" color="text.secondary">
              {organisation.name}
            </Typography>
          )}
          <Typography variant="h5" fontWeight={600} sx={{ mt: 0.5 }}>
            {title}
          </Typography>
        </Box>
        {children}
      </Paper>
    </Box>
  );
}
