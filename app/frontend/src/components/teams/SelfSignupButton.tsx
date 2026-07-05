/**
 * Self sign-up as an instant toggle — no confirmation dialog. Signing up and
 * withdrawing are both single clicks: each is trivially reversible (the
 * opposite click undoes it), so the pattern is act-immediately + toast, with
 * the button itself carrying the state. Signed up it reads "✓ Signed up ×"
 * in brand green — the trailing × (removable-chip pattern) is what makes
 * tap-to-withdraw discoverable on touch, where there is no hover. Hovering
 * (desktop) flips the whole button to a red "Withdraw" (GitHub-unfollow
 * style).
 */
import { useState } from 'react';
import { Button, CircularProgress } from '@mui/material';
import { Check, Close, PersonAddAlt1 } from '@mui/icons-material';
import { surveysAPI, type Survey, type Surveyor } from '../../services/api';
import { usePermissions } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { teamColors } from '../../pages/teams/teamsTokens';

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
  const [inFlight, setInFlight] = useState<'signup' | 'withdraw' | null>(null);
  const [hover, setHover] = useState(false);

  const isSignedUp = assigned.some((s) => s.user_id != null && s.user_id === user?.id);
  const saving = inFlight !== null;
  // The red withdraw treatment shows while hovering the signed-up state and
  // stays through the withdraw request itself. Hover is cleared after every
  // completed action, so a fresh sign-up reads "✓ Signed up ×" even though
  // the pointer is still on the button — Withdraw only appears once the
  // pointer leaves and returns.
  const showWithdraw = inFlight === 'withdraw' || (isSignedUp && hover && !saving);

  const handleClick = async (e: React.MouseEvent) => {
    // Some rows navigate on click — this button must never trigger that.
    e.stopPropagation();
    if (saving) return;
    const withdrawing = isSignedUp;
    setInFlight(withdrawing ? 'withdraw' : 'signup');
    try {
      const result = withdrawing
        ? await surveysAPI.withdraw(survey.id)
        : await surveysAPI.signUp(survey.id);
      onSaved(survey.id, result.surveyor_ids);
      toast.success(withdrawing ? 'You’ve been taken off this survey' : 'You’re signed up');
    } catch {
      toast.error(withdrawing ? 'Failed to withdraw' : 'Failed to sign up');
    } finally {
      setInFlight(null);
      setHover(false);
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
      endIcon={
        isSignedUp && !showWithdraw && !saving ? (
          <Close sx={{ fontSize: 15, opacity: 0.6 }} />
        ) : undefined
      }
      sx={{
        flexShrink: 0,
        borderRadius: '7px',
        textTransform: 'none',
        fontSize: 13,
        px: 1.5,
        py: 0.5,
        minWidth: 112,
        // Colour is driven by the same state as the label (not CSS :hover),
        // so text and treatment can never disagree.
        ...(showWithdraw
          ? {
              color: withdrawRed,
              borderColor: withdrawRed,
              bgcolor: 'rgba(198,40,40,0.04)',
              '&:hover': { borderColor: withdrawRed, bgcolor: 'rgba(198,40,40,0.08)' },
              '&.Mui-disabled': { color: withdrawRed, borderColor: 'rgba(198,40,40,0.4)' },
            }
          : isSignedUp
            ? {
                color: teamColors.brandDark,
                borderColor: teamColors.brand,
                bgcolor: 'rgba(61,139,86,0.06)',
                '&:hover': { borderColor: teamColors.brandDark, bgcolor: 'rgba(61,139,86,0.06)' },
              }
            : {
                color: teamColors.brand,
                borderColor: teamColors.brand,
                '&:hover': { borderColor: teamColors.brandDark, bgcolor: 'rgba(61,139,86,0.04)' },
                '&.Mui-disabled': { color: teamColors.brand, borderColor: teamColors.brand },
              }),
      }}
    >
      {inFlight === 'signup'
        ? 'Signing up…'
        : inFlight === 'withdraw'
          ? 'Withdrawing…'
          : showWithdraw
            ? 'Withdraw'
            : isSignedUp
              ? 'Signed up'
              : 'Sign up'}
    </Button>
  );
}
