/**
 * The calendar date block that leads every survey row. The date is the survey's
 * identifier in Spaces — there is no per-survey title. "Needs a survey" rows use
 * an amber treatment; everything else is neutral.
 */
import { Box } from '@mui/material';
import { dateBlockParts } from '../../pages/spaces/surveyState';
import { spaceColors } from '../../pages/spaces/spacesTokens';

interface DateBlockProps {
  isoDate: string;
  /** Amber treatment for "needs a survey" rows. */
  amber?: boolean;
  /** Month-label tint for neutral blocks (defaults to muted). */
  monthColor?: string;
}

export default function DateBlock({ isoDate, amber = false, monthColor }: DateBlockProps) {
  const { month, day, weekday } = dateBlockParts(isoDate);
  return (
    <Box
      sx={{
        width: 48,
        flexShrink: 0,
        textAlign: 'center',
        borderRadius: '8px',
        py: 0.5,
        border: '1px solid',
        borderColor: amber ? spaceColors.amberBlockBorder : 'rgba(0,0,0,0.1)',
        bgcolor: amber ? spaceColors.amberBlockBg : spaceColors.page,
      }}
    >
      <Box
        sx={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.4px',
          color: amber ? spaceColors.amberMonth : monthColor ?? spaceColors.textMuted,
        }}
      >
        {month}
      </Box>
      <Box sx={{ fontSize: 18, fontWeight: 700, lineHeight: 1.1, color: spaceColors.textPrimary }}>
        {day}
      </Box>
      <Box sx={{ fontSize: 10, fontWeight: 600, color: spaceColors.textMuted }}>{weekday}</Box>
    </Box>
  );
}
