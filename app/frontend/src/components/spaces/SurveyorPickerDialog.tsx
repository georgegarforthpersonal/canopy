/**
 * Assign surveyors to an upcoming survey, in place. Selecting from the list of
 * surveyors (not a self "sign me up") and saving PUTs the new surveyor_ids onto
 * the survey. The space updates the row's avatars from the returned ids.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Checkbox,
  Typography,
  Box,
  CircularProgress,
} from '@mui/material';
import { surveysAPI, type Survey, type Surveyor } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { spaceColors } from '../../pages/spaces/spacesTokens';
import { formatSessionDate } from '../../pages/spaces/surveyState';

interface SurveyorPickerDialogProps {
  open: boolean;
  survey: Survey | null;
  surveyors: Surveyor[];
  onClose: () => void;
  /** Called after a successful save with the survey id and its new surveyor ids. */
  onSaved: (surveyId: number, surveyorIds: number[]) => void;
}

export default function SurveyorPickerDialog({
  open,
  survey,
  surveyors,
  onClose,
  onSaved,
}: SurveyorPickerDialogProps) {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  // Reset selection to the survey's current surveyors each time it opens.
  useEffect(() => {
    if (open && survey) {
      setSelected(new Set(survey.surveyor_ids));
    }
  }, [open, survey]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sortedSurveyors = useMemo(
    () =>
      [...surveyors].sort((a, b) =>
        `${a.last_name ?? ''} ${a.first_name}`.localeCompare(`${b.last_name ?? ''} ${b.first_name}`),
      ),
    [surveyors],
  );

  const handleSave = async () => {
    if (!survey) return;
    const ids = Array.from(selected);
    setSaving(true);
    try {
      await surveysAPI.update(survey.id, { surveyor_ids: ids });
      onSaved(survey.id, ids);
      toast.success('Surveyors updated');
      onClose();
    } catch {
      toast.error('Failed to update surveyors');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        Assign surveyors
        {survey && (
          <Typography sx={{ fontSize: 13, color: spaceColors.textMuted }}>
            {formatSessionDate(survey.date)}
            {survey.location_name ? ` · ${survey.location_name}` : ''}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {sortedSurveyors.length === 0 ? (
          <Box sx={{ p: 3 }}>
            <Typography sx={{ fontSize: 13.5, color: spaceColors.textMuted }}>
              No surveyors available. Add surveyors in the Admin tab first.
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding>
            {sortedSurveyors.map((s) => (
              <ListItemButton key={s.id} onClick={() => toggle(s.id)} disabled={saving}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Checkbox
                    edge="start"
                    checked={selected.has(s.id)}
                    tabIndex={-1}
                    disableRipple
                    sx={{ '&.Mui-checked': { color: spaceColors.brand } }}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={`${s.first_name}${s.last_name ? ' ' + s.last_name : ''}`}
                  primaryTypographyProps={{ fontSize: 14 }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving} sx={{ textTransform: 'none' }}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={saving}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
          sx={{
            textTransform: 'none',
            bgcolor: spaceColors.brand,
            '&:hover': { bgcolor: spaceColors.brandHover },
          }}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
