/**
 * Sward composition panel for frequency-scored (botanical) survey types.
 *
 * A species x survey heatmap per location: rows are species (strongest in
 * the latest survey first), columns are survey visits, cells are the
 * relative-frequency band colour with the exact percent in the tooltip. A
 * totals row tracks species richness per visit, and when the two most recent
 * surveys both carry percents, the biggest risers and fallers are listed
 * beneath. Series-shaping lives in swardSeries.ts (pure, tested).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  CircularProgress,
  MenuItem,
  Paper,
  Select,
  Tooltip,
  Typography,
} from '@mui/material';
import { TrendingDown, TrendingUp } from '@mui/icons-material';

import { dashboardAPI, type SwardCompositionRow } from '../../services/api';
import { FREQUENCY_BAND_MEANINGS } from '../../config/frequencyScore';
import { groupCardSx, groupColors } from '../../pages/groups/groupsTokens';
import {
  BAND_COLORS,
  BAND_DARK,
  buildSwardMatrix,
  swardLocations,
  winnersLosers,
  type SwardCell,
} from './swardSeries';

interface SwardCompositionPanelProps {
  surveyTypeId: number;
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ py: 5, display: 'flex', justifyContent: 'center' }}>
      {children}
    </Box>
  );
}

function cellTooltip(cell: SwardCell, speciesName: string, surveyLabel: string): string {
  const parts = [`${speciesName}, ${surveyLabel}`];
  if (cell.percent !== null) parts.push(`${cell.percent}% of quadrats`);
  if (cell.band) parts.push(FREQUENCY_BAND_MEANINGS[cell.band] ?? `Band ${cell.band}`);
  return parts.join(' · ');
}

export default function SwardCompositionPanel({ surveyTypeId }: SwardCompositionPanelProps) {
  const [rows, setRows] = useState<SwardCompositionRow[] | null>(null);
  const [error, setError] = useState(false);
  const [locationId, setLocationId] = useState<number | null>(null);
  const [locationChosen, setLocationChosen] = useState(false);

  useEffect(() => {
    let active = true;
    setError(false);
    setRows(null);
    setLocationChosen(false);
    dashboardAPI
      .getSwardComposition(surveyTypeId)
      .then((response) => {
        if (!active) return;
        setRows(response.rows);
        const locations = swardLocations(response.rows);
        setLocationId(locations[0]?.id ?? null);
      })
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [surveyTypeId]);

  const locations = useMemo(() => swardLocations(rows ?? []), [rows]);
  const effectiveLocationId = locationChosen ? locationId : locations[0]?.id ?? null;
  const matrix = useMemo(
    () => buildSwardMatrix(rows ?? [], effectiveLocationId),
    [rows, effectiveLocationId],
  );
  const { risers, fallers } = useMemo(() => winnersLosers(matrix), [matrix]);
  const latestLabel = matrix.surveys[matrix.surveys.length - 1]?.label;
  const previousLabel = matrix.surveys[matrix.surveys.length - 2]?.label;

  return (
    <Paper sx={groupCardSx}>
      <Box
        sx={{
          px: 2.25,
          py: 1.75,
          borderBottom: `1px solid ${groupColors.divider}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
        }}
      >
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: groupColors.textPrimary }}>
          Sward composition
        </Typography>
        {locations.length > 1 && (
          <Select
            size="small"
            value={effectiveLocationId ?? ''}
            onChange={(e) => {
              const raw = e.target.value as number | '';
              setLocationId(raw === '' ? null : Number(raw));
              setLocationChosen(true);
            }}
            sx={{ minWidth: 180, fontSize: 13 }}
            aria-label="Location"
          >
            {locations.map((location) => (
              <MenuItem key={location.id ?? 'none'} value={location.id ?? ''} sx={{ fontSize: 13 }}>
                {location.name}
              </MenuItem>
            ))}
          </Select>
        )}
      </Box>

      {error ? (
        <CenteredMessage>
          <Typography sx={{ fontSize: 13, color: groupColors.textMuted }}>
            Couldn't load sward data
          </Typography>
        </CenteredMessage>
      ) : rows === null ? (
        <CenteredMessage>
          <CircularProgress size={22} sx={{ color: '#9aa39a' }} />
        </CenteredMessage>
      ) : matrix.species.length === 0 ? (
        <CenteredMessage>
          <Typography sx={{ fontSize: 13, color: groupColors.textMuted }}>
            No frequency-scored surveys yet
          </Typography>
        </CenteredMessage>
      ) : (
        <Box sx={{ p: 2.25 }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={{ borderCollapse: 'collapse', minWidth: '100%' }}>
              <Box component="thead">
                <Box component="tr">
                  <Box
                    component="th"
                    sx={{
                      textAlign: 'left',
                      fontSize: 12,
                      fontWeight: 600,
                      color: groupColors.textSecondary,
                      pb: 1,
                      pr: 2,
                      position: 'sticky',
                      left: 0,
                      bgcolor: groupColors.paper,
                    }}
                  >
                    Species
                  </Box>
                  {matrix.surveys.map((survey) => (
                    <Box
                      key={survey.id}
                      component="th"
                      sx={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: groupColors.textSecondary,
                        pb: 1,
                        px: 0.5,
                        minWidth: 52,
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {survey.label}
                    </Box>
                  ))}
                </Box>
              </Box>
              <Box component="tbody">
                {matrix.species.map((species) => (
                  <Box component="tr" key={species.id}>
                    <Box
                      component="td"
                      sx={{
                        fontSize: 12.5,
                        color: groupColors.textPrimary,
                        py: 0.25,
                        pr: 2,
                        whiteSpace: 'nowrap',
                        position: 'sticky',
                        left: 0,
                        bgcolor: groupColors.paper,
                      }}
                    >
                      {species.name}
                      {species.notable && (
                        <Tooltip title="Somerset Notable species">
                          <Box component="span" sx={{ color: '#b8860b', ml: 0.5, cursor: 'default' }}>
                            ★
                          </Box>
                        </Tooltip>
                      )}
                    </Box>
                    {species.cells.map((cell, index) => (
                      <Box component="td" key={matrix.surveys[index].id} sx={{ px: 0.5, py: 0.25 }}>
                        {cell ? (
                          <Tooltip title={cellTooltip(cell, species.name, matrix.surveys[index].label)}>
                            <Box
                              sx={{
                                bgcolor: cell.band ? BAND_COLORS[cell.band] : BAND_COLORS['+'],
                                color: cell.band && BAND_DARK.has(cell.band) ? '#fff' : groupColors.textPrimary,
                                borderRadius: '4px',
                                fontSize: 11.5,
                                fontWeight: 600,
                                textAlign: 'center',
                                py: 0.4,
                                minWidth: 44,
                                cursor: 'default',
                              }}
                            >
                              {cell.band ?? `${cell.percent}%`}
                            </Box>
                          </Tooltip>
                        ) : (
                          <Box sx={{ textAlign: 'center', color: '#d5dad3', fontSize: 11.5 }}>·</Box>
                        )}
                      </Box>
                    ))}
                  </Box>
                ))}
                <Box component="tr">
                  <Box
                    component="td"
                    sx={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: groupColors.textSecondary,
                      pt: 1,
                      pr: 2,
                      position: 'sticky',
                      left: 0,
                      bgcolor: groupColors.paper,
                    }}
                  >
                    Species recorded
                  </Box>
                  {matrix.richness.map((count, index) => (
                    <Box
                      key={matrix.surveys[index].id}
                      component="td"
                      sx={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: groupColors.textPrimary,
                        pt: 1,
                        textAlign: 'center',
                      }}
                    >
                      {count}
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>
          </Box>

          {(risers.length > 0 || fallers.length > 0) && (
            <Box sx={{ mt: 2, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {[
                { title: 'Risers', icon: <TrendingUp sx={{ fontSize: 15, color: '#3a7d2c' }} />, changes: risers },
                { title: 'Fallers', icon: <TrendingDown sx={{ fontSize: 15, color: '#b3452f' }} />, changes: fallers },
              ]
                .filter((group) => group.changes.length > 0)
                .map((group) => (
                  <Box key={group.title} sx={{ minWidth: 200 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                      {group.icon}
                      <Typography sx={{ fontSize: 12, fontWeight: 600, color: groupColors.textSecondary }}>
                        {group.title} {previousLabel} → {latestLabel}
                      </Typography>
                    </Box>
                    {group.changes.map((change) => (
                      <Typography key={change.speciesId} sx={{ fontSize: 12.5, color: groupColors.textPrimary }}>
                        {change.name}: {change.from}% → {change.to}%
                      </Typography>
                    ))}
                  </Box>
                ))}
            </Box>
          )}

          <Typography sx={{ fontSize: 11, color: groupColors.textMuted, mt: 2 }}>
            Cells show the relative frequency band: 5 = in 81-100% of sampling quadrats, 4 = 61-80%,
            3 = 41-60%, 2 = 21-40%, 1+ = 11-20%, 1 = 1-10%, + = present but not caught by a quadrat.
          </Typography>
        </Box>
      )}
    </Paper>
  );
}
