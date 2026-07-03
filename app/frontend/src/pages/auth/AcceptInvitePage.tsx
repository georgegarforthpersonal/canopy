import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, TextField, Typography } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authAPI } from '../../services/api';
import type { UserRole } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
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

  const [invite, setInvite] = useState<{ email: string; role: UserRole; organisation: { name: string } } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setLookupError('This invite link is missing its token.');
      setLoading(false);
      return;
    }
    authAPI
      .lookupInvite(token)
      .then(setInvite)
      .catch(() => setLookupError('This invite is invalid, expired or already used. Ask your admin to send a new one.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
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
      setError(err instanceof Error ? err.message : 'Could not create your account');
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

  if (lookupError || !invite) {
    return (
      <AuthPageLayout title="Invite not valid">
        <Alert severity="error">{lookupError}</Alert>
      </AuthPageLayout>
    );
  }

  return (
    <AuthPageLayout title={`Join ${invite.organisation.name}`}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: 'center' }}>
        You're joining as <strong>{invite.email}</strong> with {invite.role} access.{' '}
        {ROLE_DESCRIPTIONS[invite.role]}
      </Typography>

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
            onChange={(e) => setFirstName(e.target.value)}
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
        <TextField
          label="Password"
          type="password"
          fullWidth
          margin="normal"
          autoComplete="new-password"
          helperText="At least 10 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
        />
        <TextField
          label="Confirm password"
          type="password"
          fullWidth
          margin="normal"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={submitting}
        />
        <Button
          type="submit"
          variant="contained"
          fullWidth
          size="large"
          disabled={submitting || !firstName.trim() || password.length < 10 || !confirmPassword}
          sx={{ mt: 2 }}
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </Box>
    </AuthPageLayout>
  );
}
