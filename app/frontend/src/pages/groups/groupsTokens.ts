/**
 * Groups design tokens.
 *
 * Groups is a beta surface that deliberately uses its OWN neutral + green
 * palette regardless of the org brand colour (Heal's brand is purple). The
 * green here is the single data/action colour for the feature, per the design
 * handoff. Keep these scoped to Groups — do not leak into the global theme.
 */

export const groupColors = {
  brand: '#3D8B56',
  brandDark: '#2E6B42',
  brandHover: '#4A9B62',

  page: '#fafafa',
  paper: '#ffffff',

  textPrimary: '#1a1a1a',
  textSecondary: '#666666',
  textMuted: '#888888',

  divider: 'rgba(0,0,0,0.12)',
  dividerInner: 'rgba(0,0,0,0.06)',

  // "Needs a survey" amber treatment
  amberRowBg: '#FFFCF3',
  amberText: '#B0860A',
  amberMonth: '#C99A00',
} as const;

// Card chrome shared by every Group panel.
export const groupCardSx = {
  bgcolor: groupColors.paper,
  border: `1px solid ${groupColors.divider}`,
  borderRadius: '10px',
  boxShadow: 'none',
} as const;

export const GROUP_MAX_WIDTH = 1120;

// The contained "Record survey" button, shared by the worklist row and the
// All surveys page.
export const recordButtonSx = {
  flexShrink: 0,
  bgcolor: groupColors.brand,
  '&:hover': { bgcolor: groupColors.brandHover },
  borderRadius: '7px',
  textTransform: 'none',
  fontSize: 13,
  px: 1.5,
  py: 0.6,
} as const;

// Surveyor avatar palette (cycled). A freshly-assigned surveyor renders green.
const SURVEYOR_AVATAR_COLORS = ['#6b7280', '#7c6f64', '#5f6b7a', '#7a6678'] as const;

export function surveyorAvatarColor(seed: number): string {
  return SURVEYOR_AVATAR_COLORS[seed % SURVEYOR_AVATAR_COLORS.length];
}

/** Initials for a surveyor name, e.g. "Maya Patel" → "MP". */
export function surveyorInitials(firstName: string, lastName: string | null): string {
  const a = firstName?.trim()?.[0] ?? '';
  const b = lastName?.trim()?.[0] ?? '';
  return (a + b).toUpperCase() || a.toUpperCase() || '?';
}
