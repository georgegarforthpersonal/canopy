/**
 * The "Powered by Canopy" attribution lockup — small leaf + words, exactly as
 * on the auth card footer. The single way Canopy credits itself on surfaces
 * that a tenant's own brand headlines.
 */
import { Box, Typography } from '@mui/material';
import canopyLogo from '../../assets/canopy-logo.svg';

interface PoweredByCanopyProps {
  /** Leaf size in px. */
  size?: number;
  fontSize?: number;
  /** Center (auth footer, drawer footer) or start-align (nav bar caption). */
  align?: 'center' | 'start';
}

export function PoweredByCanopy({ size = 18, fontSize = 12.5, align = 'center' }: PoweredByCanopyProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: align === 'center' ? 'center' : 'flex-start',
        gap: size >= 16 ? 0.75 : 0.5,
      }}
    >
      <img src={canopyLogo} alt="" style={{ width: size, height: size, display: 'block' }} />
      <Typography noWrap sx={{ fontSize, color: 'text.secondary', lineHeight: 1.2 }}>
        Powered by Canopy
      </Typography>
    </Box>
  );
}
