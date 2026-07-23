import { Box } from '@mui/material';
import { type ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { orgLogoUrl } from '../../config/orgBranding';
import { TopNavBar } from './TopNavBar';
import { PoweredByCanopy } from './PoweredByCanopy';

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
  // Orgs whose own logo headlines the chrome credit the platform in a page
  // footer at the end of the scroll — the same lockup and placement as the
  // auth card. Logo-less orgs already carry the Canopy mark in the bar.
  const { organisation } = useAuth();
  const showPoweredBy = orgLogoUrl(organisation?.slug) != null;

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
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box sx={{ flexGrow: 1 }}>{children}</Box>
        {showPoweredBy && (
          <Box sx={{ py: 2.5 }}>
            <PoweredByCanopy />
          </Box>
        )}
      </Box>
    </Box>
  );
}
