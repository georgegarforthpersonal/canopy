/**
 * The tinted icon tile used on space cards and the space hero. This is the ONLY
 * place the survey-type accent colour appears — everything else stays neutral or
 * brand green.
 */
import { Box } from '@mui/material';
import { getSpeciesIcon } from '../../config/speciesTypes';

interface SpeciesIconTileProps {
  speciesType: string;
  size: number;
  radius: number;
  bg: string;
  fg: string;
}

export default function SpeciesIconTile({ speciesType, size, radius, bg, fg }: SpeciesIconTileProps) {
  const Icon = getSpeciesIcon(speciesType);
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: `${radius}px`,
        bgcolor: bg,
        color: fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Icon sx={{ fontSize: size * 0.5 }} />
    </Box>
  );
}
