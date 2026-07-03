/**
 * Sign-up dialog for an upcoming survey, split by role:
 *
 * - Editors/admins assign anyone: an inline instant-apply list — toggling a
 *   name PUTs the new surveyor_ids onto the survey (optimistically,
 *   serialized so rapid taps can't race, reverted to the last
 *   server-acknowledged set on failure). No Save/Cancel pair — just Done.
 * - Viewers (and any signed-in account) get a true "sign me up": one click
 *   calls the self-signup endpoint, which only ever adds/removes their own
 *   linked surveyor.
 *
 * The space updates the row's avatars from the returned ids either way.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Checkbox,
  CircularProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import { surveysAPI, type Survey, type Surveyor } from '../../services/api';
import { usePermissions } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { spaceColors } from '../../pages/spaces/spacesTokens';
import { formatSessionDate } from '../../pages/spaces/surveyState';

const surveyorLabel = (s: Surveyor) =>
  s.last_name ? `${s.first_name} ${s.last_name}` : s.first_name;

interface SurveyorPickerDialogProps {
  open: boolean;
  survey: Survey | null;
  surveyors: Surveyor[];
  onClose: () => void;
  /** Called after each successful update with the survey id and its new surveyor ids. */
  onSaved: (surveyId: number, surveyorIds: number[]) => void;
}

const brandButtonSx = {
  textTransform: 'none',
  bgcolor: spaceColors.brand,
  '&:hover': { bgcolor: spaceColors.brandHover },
};

export default function SurveyorPickerDialog(props: SurveyorPickerDialogProps) {
  const { canEditSurveys } = usePermissions();
  // Editors and admins manage the full assignee list; everyone else
  // (viewers, whose only power this is) manages just their own place.
  return canEditSurveys ? <AssignSurveyorsDialog {...props} /> : <SelfSignupDialog {...props} />;
}

function SelfSignupDialog({ open, survey, surveyors, onClose, onSaved }: SurveyorPickerDialogProps) {
  const toast = useToast();
  const { user } = usePermissions();
  const [saving, setSaving] = useState(false);

  const mySurveyor = useMemo(
    () => surveyors.find((s) => s.user_id != null && s.user_id === user?.id),
    [surveyors, user],
  );
  const isSignedUp = Boolean(
    survey && mySurveyor && survey.surveyor_ids?.includes(mySurveyor.id),
  );

  const handleAction = async () => {
    if (!survey) return;
    setSaving(true);
    try {
      const result = isSignedUp
        ? await surveysAPI.withdraw(survey.id)
        : await surveysAPI.signUp(survey.id);
      onSaved(survey.id, result.surveyor_ids);
      toast.success(isSignedUp ? 'You’ve been taken off this survey' : 'You’re signed up');
      onClose();
    } catch {
      toast.error(isSignedUp ? 'Failed to withdraw' : 'Failed to sign up');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        {isSignedUp ? 'You’re signed up' : 'Sign up for this survey'}
        {survey && (
          <Typography sx={{ fontSize: 13, color: spaceColors.textMuted }}>
            {formatSessionDate(survey.date)}
            {survey.location_name ? ` · ${survey.location_name}` : ''}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ fontSize: 13.5, color: spaceColors.textMuted }}>
          {isSignedUp
            ? 'Your name is on this survey. You can take yourself off it below.'
            : 'Add your name to this survey so everyone can see who’s going.'}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving} sx={{ textTransform: 'none' }}>
          Cancel
        </Button>
        <Button
          onClick={handleAction}
          variant={isSignedUp ? 'outlined' : 'contained'}
          color={isSignedUp ? 'error' : undefined}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
          sx={isSignedUp ? { textTransform: 'none' } : brandButtonSx}
        >
          {isSignedUp ? 'Take me off it' : 'Sign me up'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AssignSurveyorsDialog({ open, survey, surveyors, onClose, onSaved }: SurveyorPickerDialogProps) {
  const toast = useToast();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [query, setQuery] = useState('');

  // The current selection and the last server-acknowledged selection, as refs
  // so queued updates always read the latest values rather than a stale render.
  const selectedRef = useRef<number[]>([]);
  const confirmedRef = useRef<number[]>([]);
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  // Reset to the survey's current surveyors each time it opens.
  useEffect(() => {
    if (open && survey) {
      selectedRef.current = survey.surveyor_ids;
      confirmedRef.current = survey.surveyor_ids;
      setSelectedIds(survey.surveyor_ids);
      setQuery('');
    }
  }, [open, survey]);

  const sorted = useMemo(
    () => [...surveyors].sort((a, b) => surveyorLabel(a).localeCompare(surveyorLabel(b))),
    [surveyors],
  );
  const visible = query.trim()
    ? sorted.filter((s) => surveyorLabel(s).toLowerCase().includes(query.trim().toLowerCase()))
    : sorted;

  const toggle = (surveyorId: number) => {
    if (!survey) return;
    const next = selectedRef.current.includes(surveyorId)
      ? selectedRef.current.filter((id) => id !== surveyorId)
      : [...selectedRef.current, surveyorId];
    selectedRef.current = next;
    setSelectedIds(next);

    // Each PUT carries the full desired set, so applying them in order makes
    // the last tap win; the chain just stops concurrent requests interleaving.
    const surveyId = survey.id;
    chainRef.current = chainRef.current.then(async () => {
      try {
        await surveysAPI.update(surveyId, { surveyor_ids: next });
        confirmedRef.current = next;
        onSaved(surveyId, next);
      } catch {
        toast.error('Failed to update surveyors');
        selectedRef.current = confirmedRef.current;
        setSelectedIds(confirmedRef.current);
      }
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>
        Surveyors
        {survey && (
          <Typography sx={{ fontSize: 13, color: spaceColors.textMuted }}>
            {formatSessionDate(survey.date)}
            {survey.location_name ? ` · ${survey.location_name}` : ''}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {surveyors.length === 0 ? (
          <Typography sx={{ fontSize: 13.5, color: spaceColors.textMuted, px: 2.5, py: 2 }}>
            No surveyors available. Add surveyors in the Admin tab first.
          </Typography>
        ) : (
          <>
            <Typography sx={{ fontSize: 13, color: spaceColors.textMuted, px: 2.5, pt: 1.5 }}>
              Tap a name to sign them up or remove them. Changes save immediately.
            </Typography>
            <TextField
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search surveyors…"
              size="small"
              fullWidth
              sx={{
                px: 2.5,
                pt: 1.25,
                pb: 0.75,
                '& .MuiInputBase-input': { fontSize: { xs: '16px', sm: '0.9rem' } },
              }}
            />
            <List disablePadding sx={{ maxHeight: 320, overflowY: 'auto' }}>
              {visible.length === 0 && (
                <Typography sx={{ fontSize: 13.5, color: spaceColors.textMuted, px: 2.5, py: 1.5 }}>
                  No surveyors match “{query.trim()}”.
                </Typography>
              )}
              {visible.map((s) => {
                const checked = selectedIds.includes(s.id);
                return (
                  <ListItemButton key={s.id} dense onClick={() => toggle(s.id)} sx={{ px: 2.5 }}>
                    <ListItemIcon sx={{ minWidth: 34 }}>
                      <Checkbox
                        edge="start"
                        checked={checked}
                        tabIndex={-1}
                        disableRipple
                        size="small"
                        sx={{ '&.Mui-checked': { color: spaceColors.brand } }}
                      />
                    </ListItemIcon>
                    <ListItemText
                      primary={surveyorLabel(s)}
                      primaryTypographyProps={{
                        fontSize: 14.5,
                        fontWeight: checked ? 600 : 400,
                        color: spaceColors.textPrimary,
                      }}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          </>
        )}
      </DialogContent>
      <DialogActions>
        {surveyors.length > 0 && (
          <Typography sx={{ fontSize: 13, color: spaceColors.textMuted, mr: 'auto', pl: 1 }}>
            {selectedIds.length === 0
              ? 'No surveyors signed up'
              : `${selectedIds.length} signed up`}
          </Typography>
        )}
        <Button onClick={onClose} variant="contained" sx={brandButtonSx}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
