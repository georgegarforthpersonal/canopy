import { Box, Paper, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { brandColors } from '../../theme';
import { orgLogoUrl } from '../../config/orgBranding';
import { PoweredByCanopy } from '../../components/layout/PoweredByCanopy';
import canopyLogo from '../../assets/canopy-logo.svg';

/**
 * Centered card layout shared by the login / invite / password pages.
 * These render outside the main app Layout (no nav bar) since the user
 * is not signed in yet.
 *
 * Branding: exactly one brand owns the top of the card. Orgs with a logo
 * (orgBranding) headline it themselves — their volunteers were invited by the
 * org, not by Canopy — and Canopy moves to a "Powered by Canopy" footer.
 * Orgs without one get the Canopy mark + wordmark lockup on top (the word
 * disambiguates the leaf; an unlabelled glyph above the org name would read
 * as the org's own logo). Tenant identity is otherwise carried by language:
 * the login page puts the org in the heading ("Sign in to Heal") and passes
 * hideOrgName; other pages keep their action heading and show the muted org
 * line for context. Controls stay Canopy green in both variants — tenant
 * colour lives inside the logo image, never in the UI chrome.
 */
export function AuthPageLayout({
  title,
  hideOrgName = false,
  children,
}: {
  title: string;
  /** Hide the muted org line — for pages whose title already names the org. */
  hideOrgName?: boolean;
  children: ReactNode;
}) {
  const { organisation } = useAuth();
  const orgLogo = orgLogoUrl(organisation?.slug);

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
          {orgLogo ? (
            <Box sx={{ width: 56, height: 56, borderRadius: '8px', overflow: 'hidden', mb: 2 }}>
              <img
                src={orgLogo}
                alt={organisation?.name ?? ''}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 2 }}>
              <img
                src={canopyLogo}
                alt=""
                style={{ width: 40, height: 40, display: 'block' }}
              />
              <Typography sx={{ fontSize: 21, fontWeight: 600, color: brandColors.dark, letterSpacing: 0.2 }}>
                Canopy
              </Typography>
            </Box>
          )}
          {!hideOrgName && organisation && (
            <Typography variant="body2" color="text.secondary">
              {organisation.name}
            </Typography>
          )}
          <Typography variant="h5" fontWeight={600} sx={{ mt: 0.5 }}>
            {title}
          </Typography>
        </Box>
        {children}
        {orgLogo && (
          <Box sx={{ mt: 3.5 }}>
            <PoweredByCanopy />
          </Box>
        )}
      </Paper>
    </Box>
  );
}
