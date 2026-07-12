/**
 * Uppercase section header used by the Groups survey lists (the Surveys panel
 * and the All surveys page) — the section carries the status meaning, so rows
 * underneath it need no status chip of their own.
 */
import { Box, Typography } from '@mui/material';
import { groupColors } from '../../pages/groups/groupsTokens';

export default function SectionHeader({
  label,
  color,
  suffix,
}: {
  label: string;
  color: string;
  suffix?: string;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 1,
        px: 2.25,
        pt: 1.5,
        pb: 0.25,
        borderTop: `1px solid ${groupColors.dividerInner}`,
      }}
    >
      <Typography sx={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color }}>
        {label}
      </Typography>
      {suffix && (
        <Typography sx={{ fontSize: 11.5, color: groupColors.textMuted }}>{suffix}</Typography>
      )}
    </Box>
  );
}
