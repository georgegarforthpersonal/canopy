/**
 * Admin "Schedule surveys" dialog: pick a survey type and optional location,
 * then a recurrence rule (start date, frequency, number of occurrences). The
 * rule is expanded into explicit dates and bulk-created as `scheduled` surveys
 * with no surveyors — these are what surface in the Groups worklist for
 * volunteers to sign up to.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Box,
  Typography,
  Stack,
  CircularProgress,
} from '@mui/material';
import dayjs from 'dayjs';
import {
  surveysAPI,
  surveyTypesAPI,
  type SurveyType,
  type SurveyTypeWithDetails,
} from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { brandColors } from '../../theme';
import { formatWeekRange } from '../../pages/groups/surveyState';
import { FREQUENCY_OPTIONS, generateDates, type Frequency } from './recurrence';

interface ScheduleSurveyDialogProps {
  open: boolean;
  /** Active survey types to schedule against. */
  surveyTypes: SurveyType[];
  onClose: () => void;
  /** Called after a successful bulk-create with the number of surveys scheduled. */
  onScheduled: (count: number) => void;
}

const todayIso = () => dayjs().format('YYYY-MM-DD');

export default function ScheduleSurveyDialog({
  open,
  surveyTypes,
  onClose,
  onScheduled,
}: ScheduleSurveyDialogProps) {
  const toast = useToast();

  const [surveyTypeId, setSurveyTypeId] = useState<number | ''>('');
  const [typeDetails, setTypeDetails] = useState<SurveyTypeWithDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [locationId, setLocationId] = useState<number | ''>('');
  const [startDate, setStartDate] = useState<string>(todayIso());
  const [frequency, setFrequency] = useState<Frequency>('weekly');
  const [occurrences, setOccurrences] = useState<number>(4);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setSurveyTypeId('');
      setTypeDetails(null);
      setLocationId('');
      setStartDate(todayIso());
      setFrequency('weekly');
      setOccurrences(4);
      setNotes('');
      setError(null);
    }
  }, [open]);

  // Load the chosen type's details (locations, location level) on selection.
  useEffect(() => {
    if (surveyTypeId === '') {
      setTypeDetails(null);
      return;
    }
    let cancelled = false;
    setLoadingDetails(true);
    setLocationId('');
    surveyTypesAPI
      .getById(surveyTypeId)
      .then((details) => {
        if (!cancelled) setTypeDetails(details);
      })
      .catch(() => {
        if (!cancelled) setTypeDetails(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetails(false);
      });
    return () => {
      cancelled = true;
    };
  }, [surveyTypeId]);

  // Location applies only when the type records location at survey level and
  // has locations configured.
  const locationAtSurveyLevel = typeDetails ? !typeDetails.location_at_sighting_level : false;
  const locationOptions = typeDetails?.locations ?? [];
  const showLocation = locationAtSurveyLevel && locationOptions.length > 0;

  // Weekly-cadence types schedule a whole week per occurrence; the backend
  // derives the window, so each preview entry is a 7-day span, not a single day.
  const weekly = typeDetails?.schedule_cadence === 'weekly';
  const weekEndIso = (startIso: string) => dayjs(startIso).add(6, 'day').format('YYYY-MM-DD');

  const dates = useMemo(
    () => generateDates(startDate, frequency, occurrences),
    [startDate, frequency, occurrences],
  );

  const canSubmit =
    surveyTypeId !== '' &&
    dates.length > 0 &&
    (!showLocation || locationId !== '') &&
    !saving &&
    !loadingDetails;

  const handleSubmit = async () => {
    if (surveyTypeId === '') return;
    setSaving(true);
    setError(null);
    try {
      const created = await surveysAPI.bulkSchedule({
        survey_type_id: surveyTypeId,
        location_id: showLocation && locationId !== '' ? locationId : null,
        surveyor_ids: [],
        notes: notes.trim() || null,
        dates,
      });
      toast.success(
        `Scheduled ${created.length} survey${created.length === 1 ? '' : 's'}`,
      );
      onScheduled(created.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule surveys');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>Schedule surveys</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <FormControl fullWidth margin="normal">
          <InputLabel id="schedule-type-label">Survey type</InputLabel>
          <Select<number | ''>
            labelId="schedule-type-label"
            label="Survey type"
            value={surveyTypeId}
            onChange={(e) => setSurveyTypeId(e.target.value === '' ? '' : Number(e.target.value))}
            disabled={saving}
          >
            {surveyTypes.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {loadingDetails && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="caption" color="text.secondary">
              Loading survey type…
            </Typography>
          </Box>
        )}

        {showLocation && (
          <FormControl fullWidth margin="normal">
            <InputLabel id="schedule-location-label">Location</InputLabel>
            <Select<number | ''>
              labelId="schedule-location-label"
              label="Location"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value === '' ? '' : Number(e.target.value))}
              disabled={saving}
            >
              {locationOptions.map((loc) => (
                <MenuItem key={loc.id} value={loc.id}>
                  {loc.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Start date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ min: todayIso() }}
            disabled={saving}
            fullWidth
          />
          <FormControl fullWidth>
            <InputLabel id="schedule-frequency-label">Frequency</InputLabel>
            <Select
              labelId="schedule-frequency-label"
              label="Frequency"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
              disabled={saving}
            >
              {FREQUENCY_OPTIONS.map((f) => (
                <MenuItem key={f.value} value={f.value}>
                  {f.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Occurrences"
            type="number"
            value={frequency === 'once' ? 1 : occurrences}
            onChange={(e) => setOccurrences(Math.max(1, Math.min(52, Number(e.target.value))))}
            inputProps={{ min: 1, max: 52 }}
            disabled={saving || frequency === 'once'}
            fullWidth
          />
        </Stack>

        <TextField
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          margin="normal"
          fullWidth
          multiline
          minRows={2}
          disabled={saving}
        />

        <Box sx={{ mt: 2, p: 1.5, bgcolor: 'rgba(0,0,0,0.03)', borderRadius: 1 }}>
          {dates.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Pick a start date and frequency to preview the surveys.
            </Typography>
          ) : (
            <>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Will create {dates.length} {weekly ? 'weekly ' : ''}survey
                {dates.length === 1 ? '' : 's'}:
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {dates
                  .map((d) =>
                    weekly
                      ? `Week of ${formatWeekRange(d, weekEndIso(d))}`
                      : dayjs(d).format('ddd D MMM YYYY'),
                  )
                  .join(' · ')}
              </Typography>
              {weekly && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  This is a weekly survey — each entry is a whole week and can be carried out on any
                  day within it.
                </Typography>
              )}
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!canSubmit}
          sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
        >
          {saving ? 'Scheduling…' : `Schedule ${dates.length || ''}`.trim()}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
