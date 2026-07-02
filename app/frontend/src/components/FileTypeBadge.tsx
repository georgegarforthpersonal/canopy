import { Box } from '@mui/material';
import { fileBadgeColors, fileExtensionGlyph } from '../utils/fileBadges';

/** A small badge showing a file's uppercase extension, coloured by type. */
export default function FileTypeBadge({ filename }: { filename: string }) {
  const colors = fileBadgeColors(filename);
  return (
    <Box
      sx={{
        width: 34,
        height: 40,
        borderRadius: '5px',
        bgcolor: colors.background,
        color: colors.text,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: '8.5px',
        letterSpacing: '0.3px',
        flexShrink: 0,
      }}
    >
      {fileExtensionGlyph(filename)}
    </Box>
  );
}
