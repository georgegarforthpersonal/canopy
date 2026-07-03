import { AppBar, Toolbar, Box, IconButton, Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import { Assignment, BarChart, Settings, SpaceDashboard, Menu as MenuIcon, Close, Logout } from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useAuth, usePermissions } from '../../context/AuthContext';
import { UserMenu } from './UserMenu';
import healLogo from '../../assets/heal_logo.jpg';
import { showLogo } from '../../theme';
import { getOrgSlug } from '../../services/api';

/**
 * TopNavBar - Main navigation bar with logo and navigation icons
 *
 * Features:
 * - Logo on far left (clickable, goes to /surveys)
 * - Navigation icons with tooltips (desktop/tablet)
 * - Hamburger menu on mobile that opens drawer
 * - Active state indication
 * - Responsive design
 */
export function TopNavBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md')); // < 900px
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const { logout } = useAuth();
  const { canAccessAdmin } = usePermissions();

  // Spaces is a Heal-only beta for now.
  const showSpaces = getOrgSlug() === 'heal';

  const navItems = [
    {
      icon: Assignment,
      label: 'Surveys',
      path: '/surveys',
    },
    ...(showSpaces
      ? [
          {
            icon: SpaceDashboard,
            label: 'Spaces (Beta)',
            path: '/spaces',
          },
        ]
      : []),
    {
      icon: BarChart,
      label: 'Dashboards',
      path: '/dashboards',
    },
    // The Admin tab is hidden (not disabled) below admin access
    ...(canAccessAdmin
      ? [
          {
            icon: Settings,
            label: 'Admin',
            path: '/admin',
          },
        ]
      : []),
  ];

  const isActivePath = (path: string) => {
    return location.pathname.startsWith(path);
  };

  const handleNavClick = (path: string) => {
    navigate(path);
    setMobileDrawerOpen(false);
  };

  const handleLogoClick = () => {
    navigate('/surveys');
  };

  const toggleDrawer = () => {
    setMobileDrawerOpen(!mobileDrawerOpen);
  };

  return (
    <>
      <AppBar
        position="static"
        elevation={0}
        sx={{
          bgcolor: 'white',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Toolbar sx={{ minHeight: { xs: 56, sm: 64 }, px: { xs: 2, sm: 3 } }}>
          {/* Mobile: Hamburger Menu */}
          {isMobile && (
            <IconButton
              edge="start"
              onClick={toggleDrawer}
              sx={{ mr: 2, color: 'text.primary' }}
            >
              <MenuIcon />
            </IconButton>
          )}

          {/* Logo - only shown for Heal */}
          {showLogo && (
            <Box
              onClick={handleLogoClick}
              sx={{
                width: { xs: 36, sm: 48 },
                height: { xs: 36, sm: 48 },
                borderRadius: '8px',
                overflow: 'hidden',
                cursor: 'pointer',
                flexShrink: 0,
                mr: { xs: 2, sm: 3 },
                transition: 'transform 0.2s',
                '&:hover': {
                  transform: 'scale(1.05)',
                }
              }}
            >
              <img
                src={healLogo}
                alt="HEAL Rewilding"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            </Box>
          )}

          {/* Desktop/Tablet: Navigation Icons */}
          {!isMobile && (
            <Box sx={{ display: 'flex', gap: 1 }}>
              {navItems.map((item) => {
                const isActive = isActivePath(item.path);
                const IconComponent = item.icon;

                return (
                  <Tooltip key={item.path} title={item.label} arrow>
                    <IconButton
                      onClick={() => handleNavClick(item.path)}
                      sx={{
                        width: 44,
                        height: 44,
                        borderRadius: isActive ? '0px' : '8px',
                        bgcolor: isActive ? 'rgba(0, 0, 0, 0.04)' : 'transparent',
                        color: isActive ? 'primary.main' : 'text.secondary',
                        borderBottom: isActive ? '3px solid' : 'none',
                        borderColor: isActive ? 'primary.main' : 'transparent',
                        '&:hover': {
                          bgcolor: 'rgba(0, 0, 0, 0.08)',
                        },
                      }}
                    >
                      <IconComponent sx={{ fontSize: 24 }} />
                    </IconButton>
                  </Tooltip>
                );
              })}
            </Box>
          )}

          {/* Spacer */}
          <Box sx={{ flexGrow: 1 }} />

          {/* Signed-in user menu */}
          <UserMenu />
        </Toolbar>
      </AppBar>

      {/* Mobile Drawer */}
      <Drawer
        anchor="left"
        open={mobileDrawerOpen}
        onClose={toggleDrawer}
        sx={{
          '& .MuiDrawer-paper': {
            width: 280,
            bgcolor: 'white',
          }
        }}
      >
        <Box sx={{ p: 2 }}>
          {/* Drawer Header with Logo (if applicable) and Close Button */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: showLogo ? 'space-between' : 'flex-end', mb: 3 }}>
            {showLogo && (
              <Box
                onClick={handleLogoClick}
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: '8px',
                  overflow: 'hidden',
                  cursor: 'pointer',
                }}
              >
                <img
                  src={healLogo}
                  alt="HEAL Rewilding"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
              </Box>
            )}
            <IconButton onClick={toggleDrawer} sx={{ color: 'text.secondary' }}>
              <Close />
            </IconButton>
          </Box>

          {/* Navigation List */}
          <List sx={{ px: 0 }}>
            {navItems.map((item) => {
              const isActive = isActivePath(item.path);
              const IconComponent = item.icon;

              return (
                <ListItem key={item.path} disablePadding sx={{ mb: 0.5 }}>
                  <ListItemButton
                    onClick={() => handleNavClick(item.path)}
                    sx={{
                      borderRadius: '8px',
                      bgcolor: isActive ? 'rgba(0, 0, 0, 0.04)' : 'transparent',
                      '&:hover': {
                        bgcolor: 'rgba(0, 0, 0, 0.08)',
                      },
                      borderLeft: isActive ? '4px solid' : 'none',
                      borderColor: isActive ? 'primary.main' : 'transparent',
                      pl: isActive ? 1.5 : 2,
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 40, color: isActive ? 'primary.main' : 'text.secondary' }}>
                      <IconComponent />
                    </ListItemIcon>
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? 'text.primary' : 'text.secondary',
                      }}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}

            {/* Sign out */}
            <ListItem disablePadding sx={{ mt: 2 }}>
              <ListItemButton
                onClick={async () => {
                  setMobileDrawerOpen(false);
                  await logout();
                  navigate('/login');
                }}
                sx={{
                  borderRadius: '8px',
                  '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.08)' },
                  pl: 2,
                }}
              >
                <ListItemIcon sx={{ minWidth: 40, color: 'text.secondary' }}>
                  <Logout />
                </ListItemIcon>
                <ListItemText
                  primary="Sign out"
                  primaryTypographyProps={{
                    fontWeight: 400,
                    color: 'text.secondary',
                  }}
                />
              </ListItemButton>
            </ListItem>
          </List>
        </Box>
      </Drawer>
    </>
  );
}
