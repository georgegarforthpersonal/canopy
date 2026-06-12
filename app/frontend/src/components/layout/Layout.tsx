import { Box } from '@mui/material';
import { type ReactNode } from 'react';
import { TopNavBar } from './TopNavBar';

interface LayoutProps {
  children: ReactNode;
}

/**
 * Main Layout component with top navigation
 *
 * Features:
 * - Top navigation bar with logo and nav icons
 * - Responsive design (hamburger menu on mobile)
 * - Scrollable content area
 * - Clean, modern design following 2025 UX best practices
 */
export function Layout({ children }: LayoutProps) {
  // 100dvh tracks the visible viewport as mobile browser toolbars expand/collapse;
  // the 100vh line is the fallback for browsers without dvh support
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        '@supports (height: 100dvh)': { height: '100dvh' },
        overflow: 'hidden',
      }}
    >
      {/* Top Navigation Bar */}
      <TopNavBar />

      {/* Main Content Area */}
      <Box
        sx={{
          flexGrow: 1,
          overflow: 'auto',
          bgcolor: 'background.default',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
