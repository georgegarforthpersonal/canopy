/**
 * Self sign-up as an instant toggle — no confirmation dialog. Signing up and
 * withdrawing are both single clicks: each is trivially reversible (the
 * opposite click undoes it), so the pattern is act-immediately + toast, with
 * the button itself carrying the state. Signed up it reads "✓ Signed up" in
 * brand green; hovering flips it to a red "Withdraw" (GitHub-unfollow style).
 * On touch there is no hover, so a tap on the signed-up button withdraws
 * directly — acceptable because re-signing up is one tap too.
 */
import { useState } from 'react';
import { Button, CircularProgress } from '@mui/material';
import { Check, Close, PersonAddAlt1 } from '@mui/icons-material';
import { surveysAPI, type Survey, type Surveyor } from '../../services/api';
import { usePermissions } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { spaceColors } from '../../pages/spaces/spacesTokens';

interface SelfSignupButtonProps {
  survey: Survey;
  /** The surveyors currently assigned to this survey. */
  assigned: Surveyor[];
  /** Called after a successful change with the survey's new surveyor ids. */
  onSaved: (surveyId: number, surveyorIds: number[]) => void;
}

const withdrawRed = '#c62828';

export default function SelfSignupButton({ survey, assigned, onSaved }: SelfSignupButtonProps) {
  const toast = useToast();
  const { user } = usePermissions();
  const [saving, setSaving] = useState(false);
  const [hover, setHover] = useState(false);

  const isSignedUp = assigned.some((s) => s.user_id != null && s.user_id === user?.id);
  const showWithdraw = isSignedUp && hover && !saving;

  const handleClick = async (e: React.MouseEvent) => {
    // Some rows navigate on click — this button must never trigger that.
    e.stopPropagation();
    if (saving) return;
    setSaving(true);
    try {
      const result = isSignedUp
        ? await surveysAPI.withdraw(survey.id)
        : await surveysAPI.signUp(survey.id);
      onSaved(survey.id, result.surveyor_ids);
      toast.success(isSignedUp ? 'You’ve been taken off this survey' : 'You’re signed up');
    } catch {
      toast.error(isSignedUp ? 'Failed to withdraw' : 'Failed to sign up');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Button
      variant="outlined"
      onClick={handleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={saving}
      startIcon={
        saving ? (
          <CircularProgress size={14} color="inherit" />
        ) : showWithdraw ? (
          <Close sx={{ fontSize: 17 }} />
        ) : isSignedUp ? (
          <Check sx={{ fontSize: 17 }} />
        ) : (
          <PersonAddAlt1 sx={{ fontSize: 17 }} />
        )
      }
      sx={{
        flexShrink: 0,
        borderRadius: '7px',
        textTransform: 'none',
        fontSize: 13,
        px: 1.5,
        py: 0.5,
        minWidth: 112,
        ...(isSignedUp
          ? {
              color: spaceColors.brandDark,
              borderColor: spaceColors.brand,
              bgcolor: 'rgba(61,139,86,0.06)',
              '&:hover': {
                color: withdrawRed,
                borderColor: withdrawRed,
                bgcolor: 'rgba(198,40,40,0.04)',
              },
            }
          : {
              color: spaceColors.brand,
              borderColor: spaceColors.brand,
              '&:hover': { borderColor: spaceColors.brandDark, bgcolor: 'rgba(61,139,86,0.04)' },
            }),
      }}
    >
      {showWithdraw ? 'Withdraw' : isSignedUp ? 'Signed up' : 'Sign up'}
    </Button>
  );
}
