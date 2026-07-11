import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Link, TextField, Typography } from '@mui/material';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, authAPI } from '../../services/api';
import type { UserRole } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { MIN_PASSWORD_LENGTH, PasswordField, PasswordRequirement } from '../../components/auth/PasswordField';
import { AuthPageLayout } from './AuthPageLayout';

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  viewer: 'You can view everything and sign yourself up to scheduled surveys.',
  editor: 'You can record and edit surveys.',
  admin: 'You have full admin access.',
};

/**
 * Landing page for emailed invite links: /accept-invite?token=…
 * Shows who the invite is for, collects a name and password, and signs in.
 */
export function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [invite, setInvite] = useState<{
    email: string;
    role: UserRole;
    organisation: { name: string };
    surveyor: { id: number; first_name: string; last_name: string | null } | null;
  } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [alreadyUsed, setAlreadyUsed] = useState(false);
  const [loading, setLoading] = useState(true);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ firstName?: string; password?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  // Live once there's something to compare — never while the field is empty.
  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;

  useEffect(() => {
    if (!token) {
      setLookupError('This invite link is missing its token.');
      setLoading(false);
      return;
    }
    authAPI
      .lookupInvite(token)
      .then((result) => {
        setInvite(result);
        // Prefill from the linked surveyor — this is who the admin says
        // the invitee is, and matching names avoids confusion later.
        if (result.surveyor) {
          setFirstName(result.surveyor.first_name);
          setLastName(result.surveyor.last_name ?? '');
        }
      })
      .catch((err) => {
        // The most common way to land here: re-clicking the invite email
        // after the account was created. That's not an error — point at
        // sign-in rather than dead-ending.
        if (err instanceof ApiError && /already been used/i.test(err.message)) {
          setAlreadyUsed(true);
        } else if (err instanceof ApiError && /expired/i.test(err.message)) {
          setLookupError('This invite has expired. Ask your admin to send a new one.');
        } else {
          setLookupError('This invite link is not valid. Ask your admin to send a new one.');
        }
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    // Validate on submit and say exactly what's wrong at the field itself —
    // the button is never silently disabled.
    const errors: typeof fieldErrors = {};
    if (!firstName.trim()) errors.firstName = 'First name is required';
    if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || mismatch || !confirmPassword) return;

    setSubmitting(true);
    setError(null);
    try {
      await authAPI.acceptInvite({
        token,
        first_name: firstName.trim(),
        last_name: lastName.trim() || undefined,
        password,
      });
      await refresh();
      navigate('/surveys', { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create your account';
      // Server-side password rejections (e.g. "too common") belong on the field.
      if (/password/i.test(message)) {
        setFieldErrors({ password: message });
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AuthPageLayout title="Join">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      </AuthPageLayout>
    );
  }

  if (alreadyUsed) {
    return (
      <AuthPageLayout title="You're already set up">
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
          This invite has already been used to create an account. Just sign in
          with your email and password.
        </Typography>
        <Button variant="contained" fullWidth size="large" sx={{ mt: 3 }} onClick={() => navigate('/login')}>
          Go to sign in
        </Button>
        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Link component={RouterLink} to="/forgot-password" variant="body2">
            Forgot your password?
          </Link>
        </Box>
      </AuthPageLayout>
    );
  }

  if (lookupError || !invite) {
    return (
      <AuthPageLayout title="Invite not valid">
        <Alert severity="error">{lookupError}</Alert>
        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Link component={RouterLink} to="/login" variant="body2">
            Already have an account? Sign in
          </Link>
        </Box>
      </AuthPageLayout>
    );
  }

  return (
    <AuthPageLayout title={`Join ${invite.organisation.name}`}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: 'center' }}>
        You're joining as <strong>{invite.email}</strong> with {invite.role} access.{' '}
        {ROLE_DESCRIPTIONS[invite.role]}
      </Typography>
      {invite.surveyor && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: 'center' }}>
          Your account will be linked to the existing surveyor{' '}
          <strong>
            {[invite.surveyor.first_name, invite.surveyor.last_name].filter(Boolean).join(' ')}
          </strong>
          , keeping their survey history.
        </Typography>
      )}

      <Box component="form" onSubmit={handleSubmit}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            label="First name"
            fullWidth
            margin="normal"
            autoFocus
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              if (fieldErrors.firstName) setFieldErrors({ ...fieldErrors, firstName: undefined });
            }}
            error={Boolean(fieldErrors.firstName)}
            helperText={fieldErrors.firstName}
            disabled={submitting}
          />
          <TextField
            label="Last name"
            fullWidth
            margin="normal"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            disabled={submitting}
          />
        </Box>
        <PasswordField
          label="Password"
          fullWidth
          margin="normal"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: undefined });
          }}
          error={Boolean(fieldErrors.password)}
          helperText={fieldErrors.password ?? <PasswordRequirement password={password} />}
          disabled={submitting}
        />
        <PasswordField
          label="Confirm password"
          fullWidth
          margin="normal"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={mismatch}
          helperText={mismatch ? 'Passwords do not match' : undefined}
          disabled={submitting}
        />
        <Button
          type="submit"
          variant="contained"
          fullWidth
          size="large"
          disabled={submitting}
          sx={{ mt: 2 }}
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </Box>
    </AuthPageLayout>
  );
}
