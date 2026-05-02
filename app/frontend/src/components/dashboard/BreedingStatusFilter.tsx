import { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Popover,
  Stack,
  Typography,
  IconButton,
  Tooltip,
  Badge,
  Checkbox,
  FormControlLabel,
  Button,
  Divider,
  CircularProgress,
} from '@mui/material';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import type { BreedingCategory, BreedingStatusCode } from '../../services/api';
import { surveysAPI } from '../../services/api';
import { CATEGORY_LABELS, CATEGORY_COLORS } from '../surveys/breedingConstants';

const CATEGORY_ORDER: BreedingCategory[] = [
  'confirmed_breeder',
  'probable_breeder',
  'possible_breeder',
  'non_breeding',
];

interface BreedingStatusFilterProps {
  /** Codes (with counts) that actually appear in the loaded sightings. */
  availableCounts: Map<string, number>;
  /** Currently-selected codes; empty Set means "no filter applied" (show all). */
  selectedCodes: Set<string>;
  onChange: (codes: Set<string>) => void;
}

export default function BreedingStatusFilter({
  availableCounts,
  selectedCodes,
  onChange,
}: BreedingStatusFilterProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [allCodes, setAllCodes] = useState<BreedingStatusCode[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Lazy-fetch the breeding code reference data the first time the popover opens
  useEffect(() => {
    if (!anchorEl || allCodes !== null || loading) return;
    setLoading(true);
    surveysAPI
      .getBreedingCodes()
      .then(setAllCodes)
      .catch(() => setAllCodes([])) // fall back to ungrouped view on error
      .finally(() => setLoading(false));
  }, [anchorEl, allCodes, loading]);

  // Group available codes by category using the reference data
  const grouped = useMemo(() => {
    const codeMeta = new Map<string, BreedingStatusCode>();
    (allCodes ?? []).forEach((c) => codeMeta.set(c.code, c));

    const byCategory = new Map<BreedingCategory, BreedingStatusCode[]>();
    for (const code of availableCounts.keys()) {
      const meta = codeMeta.get(code);
      if (!meta) continue;
      const list = byCategory.get(meta.category) ?? [];
      list.push(meta);
      byCategory.set(meta.category, list);
    }
    for (const list of byCategory.values()) {
      list.sort((a, b) => a.code.localeCompare(b.code));
    }
    return byCategory;
  }, [allCodes, availableCounts]);

  const totalOptions = availableCounts.size;
  const isFiltering = selectedCodes.size > 0;

  const handleToggle = (code: string) => {
    const next = new Set(selectedCodes);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  };

  const handleClear = () => onChange(new Set());

  return (
    <>
      <Tooltip title="Filter by breeding status">
        <span>
          <IconButton
            size="small"
            onClick={(e) => setAnchorEl(e.currentTarget)}
            disabled={totalOptions === 0}
          >
            <Badge
              color="primary"
              badgeContent={isFiltering ? selectedCodes.size : 0}
              overlap="circular"
            >
              <FilterAltIcon fontSize="small" color={isFiltering ? 'primary' : 'inherit'} />
            </Badge>
          </IconButton>
        </span>
      </Tooltip>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 320, maxHeight: 480, p: 0 } } }}
      >
        <Box sx={{ px: 2, py: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            Breeding status
          </Typography>
          <Button
            size="small"
            onClick={handleClear}
            disabled={!isFiltering}
            sx={{ minWidth: 0 }}
          >
            Clear
          </Button>
        </Box>
        <Divider />

        <Box sx={{ px: 2, py: 1, overflowY: 'auto', maxHeight: 380 }}>
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={20} />
            </Box>
          )}

          {!loading && (
            <Stack spacing={1.5}>
              {CATEGORY_ORDER.map((category) => {
                const codes = grouped.get(category);
                if (!codes || codes.length === 0) return null;
                return (
                  <Box key={category}>
                    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: CATEGORY_COLORS[category],
                        }}
                      />
                      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                        {CATEGORY_LABELS[category]}
                      </Typography>
                    </Stack>
                    <Stack sx={{ pl: 1 }}>
                      {codes.map((meta) => {
                        const count = availableCounts.get(meta.code) ?? 0;
                        return (
                          <FormControlLabel
                            key={meta.code}
                            control={
                              <Checkbox
                                size="small"
                                checked={selectedCodes.has(meta.code)}
                                onChange={() => handleToggle(meta.code)}
                              />
                            }
                            label={
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                <Typography variant="body2">
                                  <strong>{meta.code}</strong>
                                  {meta.description && ` — ${meta.description}`}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                  {count}
                                </Typography>
                              </Box>
                            }
                            sx={{ m: 0, '& .MuiFormControlLabel-label': { flex: 1 } }}
                          />
                        );
                      })}
                    </Stack>
                  </Box>
                );
              })}

            </Stack>
          )}
        </Box>
      </Popover>
    </>
  );
}
