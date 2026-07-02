/**
 * Admin "Scheduled" tab: lists upcoming/overdue scheduled surveys and lets an
 * admin schedule a recurring series or cancel/delete an existing one. Scheduled
 * surveys are what populate the Spaces worklist for volunteers to sign up to.
 *
 * Heal-only for now (gated by the caller), matching where scheduled surveys
 * currently surface.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Alert,
} from '@mui/material';
import { Add, Delete, EventBusy } from '@mui/icons-material';
import dayjs from 'dayjs';
import {
  surveysAPI,
  type Survey,
  type SurveyType,
  type Surveyor,
} from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { brandColors } from '../../theme';
import type { ChipProps } from '@mui/material';
import {
  deriveSurveyState,
  formatWeekRange,
  hasWindow,
  type SurveyState,
} from '../../pages/spaces/surveyState';
import SurveyorAvatars from '../spaces/SurveyorAvatars';
import ScheduleSurveyDialog from './ScheduleSurveyDialog';
import EntityCard from './EntityCard';
import { useResponsive } from '../../hooks/useResponsive';

interface ScheduledSurveysPanelProps {
  /** All surveyors (active + inactive); used to resolve assigned ids to names. */
  surveyors: Surveyor[];
  /** All survey types; only active ones are offered for scheduling. */
  surveyTypes: SurveyType[];
}

type PendingAction = { survey: Survey; action: 'cancel' | 'delete' };

/** State → chip label/colour for the scheduled list. */
const STATE_CHIP: Record<SurveyState, { label: string; color: ChipProps['color'] }> = {
  'needs-survey': { label: 'Overdue', color: 'warning' },
  'due-this-week': { label: 'Due this week', color: 'info' },
  upcoming: { label: 'Upcoming', color: 'default' },
  recorded: { label: 'Recorded', color: 'success' },
  cancelled: { label: 'Cancelled', color: 'default' },
};

export default function ScheduledSurveysPanel({
  surveyors,
  surveyTypes,
}: ScheduledSurveysPanelProps) {
  const toast = useToast();
  const { isMobile } = useResponsive();
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [working, setWorking] = useState(false);

  const surveyorById = useMemo(() => {
    const map = new Map<number, Surveyor>();
    surveyors.forEach((s) => map.set(s.id, s));
    return map;
  }, [surveyors]);

  const activeSurveyTypes = useMemo(() => surveyTypes.filter((t) => t.is_active), [surveyTypes]);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await surveysAPI.getAllPages({ survey_status: 'scheduled' });
      const sorted = [...res].sort((a, b) => a.date.localeCompare(b.date));
      setSurveys(sorted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scheduled surveys');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleConfirm = async () => {
    if (!pending) return;
    setWorking(true);
    try {
      if (pending.action === 'cancel') {
        await surveysAPI.update(pending.survey.id, { status: 'cancelled' });
        toast.success('Survey cancelled');
      } else {
        await surveysAPI.delete(pending.survey.id);
        toast.success('Survey deleted');
      }
      setPending(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setWorking(false);
    }
  };

  // Cancel/delete icon buttons, shared between the desktop table and mobile cards.
  const surveyActions = (survey: Survey) => (
    <>
      <IconButton
        size="small"
        onClick={() => setPending({ survey, action: 'cancel' })}
        sx={{ color: 'warning.main' }}
        title="Cancel"
      >
        <EventBusy />
      </IconButton>
      <IconButton
        size="small"
        onClick={() => setPending({ survey, action: 'delete' })}
        sx={{ color: 'error.main' }}
        title="Delete"
      >
        <Delete />
      </IconButton>
    </>
  );

  return (
    <Box>
      <Box sx={{ mb: { xs: 2, md: 3 }, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          fullWidth={isMobile}
          startIcon={<Add />}
          onClick={() => setDialogOpen(true)}
          sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
        >
          Schedule surveys
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {isMobile ? (
        loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : surveys.length === 0 ? (
          <Paper variant="outlined" sx={{ py: 6, px: 2, textAlign: 'center', color: 'text.secondary' }}>
            No scheduled surveys. Use “Schedule surveys” to plan a series.
          </Paper>
        ) : (
          <Stack spacing={1.5}>
            {surveys.map((s) => {
              const state = deriveSurveyState(s);
              const chip = STATE_CHIP[state] ?? STATE_CHIP.upcoming;
              const weekly = hasWindow(s);
              const assigned = s.surveyor_ids
                .map((id) => surveyorById.get(id))
                .filter((x): x is Surveyor => x !== undefined);
              return (
                <EntityCard
                  key={s.id}
                  title={
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {weekly
                        ? formatWeekRange(s.scheduled_window_start!, s.scheduled_window_end!)
                        : dayjs(s.date).format('ddd D MMM YYYY')}
                      {weekly && (
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
                          Week window
                        </Typography>
                      )}
                    </Typography>
                  }
                  subtitle={
                    <>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {[s.survey_type_name, s.location_name].filter(Boolean).join(' · ') || '—'}
                      </Typography>
                      <Box sx={{ mt: 1 }}>
                        <SurveyorAvatars surveyors={assigned} emptyLabel="No surveyors yet" />
                      </Box>
                    </>
                  }
                  chips={<Chip label={chip.label} size="small" color={chip.color} />}
                  actions={surveyActions(s)}
                />
              );
            })}
          </Stack>
        )
      ) : (
        <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Survey type</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Surveyors</TableCell>
                <TableCell>State</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : surveys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 8, color: 'text.secondary' }}>
                    No scheduled surveys. Use “Schedule surveys” to plan a series.
                  </TableCell>
                </TableRow>
              ) : (
                surveys.map((s) => {
                  const state = deriveSurveyState(s);
                  const chip = STATE_CHIP[state] ?? STATE_CHIP.upcoming;
                  const weekly = hasWindow(s);
                  const assigned = s.surveyor_ids
                    .map((id) => surveyorById.get(id))
                    .filter((x): x is Surveyor => x !== undefined);
                  return (
                    <TableRow key={s.id} sx={{ '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.02)' } }}>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {weekly
                            ? formatWeekRange(s.scheduled_window_start!, s.scheduled_window_end!)
                            : dayjs(s.date).format('ddd D MMM YYYY')}
                        </Typography>
                        {weekly && (
                          <Typography variant="caption" color="text.secondary">
                            Week window
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{s.survey_type_name ?? '—'}</TableCell>
                      <TableCell>{s.location_name ?? '—'}</TableCell>
                      <TableCell>
                        <SurveyorAvatars surveyors={assigned} emptyLabel="No surveyors yet" />
                      </TableCell>
                      <TableCell>
                        <Chip label={chip.label} size="small" color={chip.color} />
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          {surveyActions(s)}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <ScheduleSurveyDialog
        open={dialogOpen}
        surveyTypes={activeSurveyTypes}
        onClose={() => setDialogOpen(false)}
        onScheduled={() => {
          setDialogOpen(false);
          load();
        }}
      />

      <Dialog open={pending !== null} onClose={() => !working && setPending(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {pending?.action === 'delete' ? 'Delete scheduled survey?' : 'Cancel scheduled survey?'}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {pending?.action === 'delete'
              ? 'This permanently removes the scheduled survey.'
              : 'This marks the survey as cancelled. It stays on record but drops off the worklist.'}
          </Typography>
          {pending && (
            <Typography sx={{ mt: 2, color: 'text.secondary' }}>
              {pending.survey.survey_type_name ?? 'Survey'} ·{' '}
              {dayjs(pending.survey.date).format('ddd D MMM YYYY')}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} disabled={working}>
            Keep
          </Button>
          <Button
            onClick={handleConfirm}
            variant="contained"
            color={pending?.action === 'delete' ? 'error' : 'warning'}
            disabled={working}
          >
            {working
              ? 'Working…'
              : pending?.action === 'delete'
                ? 'Delete'
                : 'Cancel survey'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
