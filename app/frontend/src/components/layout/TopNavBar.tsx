import { AppBar, Toolbar, Box, IconButton, Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Assignment, BarChart, Settings, SpaceDashboard, Menu as MenuIcon, Close, Logout } from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useAuth, usePermissions } from '../../context/AuthContext';
import { UserMenu } from './UserMenu';
import canopyLogo from '../../assets/canopy-logo.svg';
import { orgHasGroups } from '../../pages/groups/groupMeta';

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
  const { logout, organisation } = useAuth();
  const { canAccessAdmin } = usePermissions();

  // Groups is a beta gated per organisation (see BETA_GROUPS in groupMeta).
  const showGroups = orgHasGroups();

  const navItems = [
    {
      icon: Assignment,
      label: 'Surveys',
      path: '/surveys',
    },
    ...(showGroups
      ? [
          {
            icon: SpaceDashboard,
            label: 'Groups (Beta)',
            path: '/groups',
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

          {/* Canopy mark + tenant name. Canopy owns the chrome; the tenant
              owns the words — the org name is the persistent "you are
              entering data for Heal/Cannwood" signal on every screen. */}
          <Box
            onClick={handleLogoClick}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: { xs: 1, sm: 1.25 },
              cursor: 'pointer',
              flexShrink: 0,
              mr: { xs: 2, sm: 3 },
              minWidth: 0,
              transition: 'transform 0.2s',
              '&:hover': {
                transform: 'scale(1.03)',
              }
            }}
          >
            <img
              src={canopyLogo}
              alt="Canopy"
              style={{ width: isMobile ? 36 : 44, height: isMobile ? 36 : 44, display: 'block' }}
            />
            {organisation && (
              <Typography
                noWrap
                sx={{
                  fontSize: { xs: 15, sm: 16 },
                  fontWeight: 600,
                  color: 'text.primary',
                  maxWidth: { xs: 130, sm: 200 },
                }}
              >
                {organisation.name}
              </Typography>
            )}
          </Box>

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
          {/* Drawer Header: the workspace-header moment — tenant name with
              the platform as the caption. */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
            <Box
              onClick={handleLogoClick}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                cursor: 'pointer',
                minWidth: 0,
              }}
            >
              <img
                src={canopyLogo}
                alt="Canopy"
                style={{ width: 44, height: 44, display: 'block', flexShrink: 0 }}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: 16, fontWeight: 600, color: 'text.primary', lineHeight: 1.2 }}>
                  {organisation?.name ?? 'Canopy'}
                </Typography>
                {organisation && (
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    on Canopy
                  </Typography>
                )}
              </Box>
            </Box>
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
