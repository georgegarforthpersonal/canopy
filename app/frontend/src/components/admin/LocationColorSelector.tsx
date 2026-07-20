/**
 * Discrete map-colour selector for a location, modelled on the survey type
 * colour selector. Offers "Default" (the fixed per-location_type colour) plus
 * the named keys in LOCATION_COLORS; the key is what gets stored, the hex
 * mapping stays in the frontend palette.
 */
import { Box, MenuItem, Select, FormControl, InputLabel, Stack, Typography } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import { LOCATION_COLORS, LOCATION_TYPE_STYLE } from '../../config';
import type { LocationType } from '../../services/api';

interface LocationColorSelectorProps {
  /** Stored colour key, or null for the type default. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Current location type — determines the "Default" swatch colour. */
  locationType: LocationType;
}

function Swatch({ hex }: { hex: string }) {
  return (
    <Box
      sx={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        backgroundColor: hex,
        border: '1px solid rgba(0,0,0,0.2)',
        flexShrink: 0,
      }}
    />
  );
}

export default function LocationColorSelector({ value, onChange, locationType }: LocationColorSelectorProps) {
  const defaultHex =
    locationType !== 'none' ? LOCATION_TYPE_STYLE[locationType].stroke : LOCATION_TYPE_STYLE.area.stroke;

  const handleChange = (event: SelectChangeEvent<string>) => {
    onChange(event.target.value || null);
  };

  const row = (hex: string, label: string) => (
    <Stack direction="row" alignItems="center" spacing={1}>
      <Swatch hex={hex} />
      <Typography variant="body2">{label}</Typography>
    </Stack>
  );

  return (
    <FormControl fullWidth size="small">
      {/* shrink + displayEmpty so the "Default" swatch shows for the empty value. */}
      <InputLabel id="location-color-label" shrink>
        Colour
      </InputLabel>
      <Select
        labelId="location-color-label"
        value={value && value in LOCATION_COLORS ? value : ''}
        onChange={handleChange}
        label="Colour"
        displayEmpty
        renderValue={(selected) =>
          selected && selected in LOCATION_COLORS
            ? row(LOCATION_COLORS[selected].hex, LOCATION_COLORS[selected].label)
            : row(defaultHex, 'Default')
        }
      >
        <MenuItem value="">{row(defaultHex, 'Default')}</MenuItem>
        {Object.entries(LOCATION_COLORS).map(([key, { label, hex }]) => (
          <MenuItem key={key} value={key}>
            {row(hex, label)}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
