import { createTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import { FONT_SIZES, MOBILE_BREAKPOINT } from './config/responsive';

/**
 * Canopy brand palette — the green ramp sampled from the Canopy logo. The
 * product identity (logo, chrome, primary colour) is Canopy for every
 * organisation; tenant identity appears as content (org name on the login
 * card and in the tab title), never as a colour scheme. Note: white text on
 * `main` sits just under WCAG AA for small text — prefer `dark` for small
 * green-on-white text.
 */
export const brandColors = {
  main: '#51895A',   // Mid green (logo)
  light: '#6CA477',  // Light green (logo)
  dark: '#3E6A45',   // Dark green (logo)
  hover: '#5D9668',  // Button hover state, between main and light
  tint: '#ECF3EC',   // Badge/background tint (logo)
} as const;

// Notion-style color palette for tags/chips
// Each color has a background (light) and foreground (dark) shade
export const notionColors = {
  default: {
    background: '#E3E2E0',
    text: '#37352F',
  },
  gray: {
    background: '#EBECED',
    text: '#454648',
  },
  brown: {
    background: '#E9E5E3',
    text: '#64473A',
  },
  orange: {
    background: '#FADEC9',
    text: '#D9730D',
  },
  yellow: {
    background: '#FBF3DB',
    text: '#DFAB01',
  },
  green: {
    background: '#DBEDDB',
    text: '#4D6461',
  },
  blue: {
    background: '#D3E5EF',
    text: '#2B5F86',
  },
  purple: {
    background: '#E8DEEE',
    text: '#6940A5',
  },
  pink: {
    background: '#F5E0E9',
    text: '#AD5E99',
  },
  red: {
    background: '#FFE2DD',
    text: '#E03E3E',
  },
} as const;

// Table sizing constants for consistent spacing across pages
export const tableSizing = {
  header: {
    fontSize: '0.75rem',
    iconSize: 14,
    py: 1,
    px: 2,
  },
  row: {
    fontSize: '0.875rem',
    py: 1,
    px: 2,
  },
  avatar: {
    size: 28,
    fontSize: '0.7rem',
  },
  chip: {
    fontSize: '0.8125rem',
    height: 24,
    iconSize: '1rem',
  },
  actionIcon: {
    size: 18,
    padding: '6px',
  },
} as const;

// Brand theme - uses organisation-specific colors
export const theme: Theme = createTheme({
  palette: {
    primary: {
      main: brandColors.main,
      light: brandColors.light,
      dark: brandColors.dark,
      contrastText: '#fff',
    },
    secondary: {
      main: '#dc004e', // Keep red for accents/warnings
    },
    background: {
      default: '#fafafa',
      paper: '#ffffff',
    },
    text: {
      primary: '#1a1a1a',
      secondary: '#666666',
    },
  },
  typography: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: 14,
    h1: {
      fontSize: '2rem',
      fontWeight: 500,
    },
    h2: {
      fontSize: '1.5rem',
      fontWeight: 500,
    },
    h3: {
      fontSize: '1.25rem',
      fontWeight: 500,
    },
    body1: {
      fontSize: '0.875rem',
    },
  },
  shape: {
    borderRadius: 4,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          boxShadow: 'none',
          '&:hover': {
            boxShadow: 'none',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
        },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        input: ({ theme }) => ({
          // iOS/Android auto-zoom on focus when the input font is below 16px
          [theme.breakpoints.down(MOBILE_BREAKPOINT)]: {
            fontSize: FONT_SIZES.MOBILE_INPUT_MIN,
          },
        }),
      },
    },
  },
});
