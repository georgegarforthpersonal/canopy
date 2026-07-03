import { useState } from 'react';
import { Alert, Box, Button, Link, TextField } from '@mui/material';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { authAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { AuthPageLayout } from './AuthPageLayout';

/** Landing page for emailed reset links: /reset-password?token=… */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await authAPI.resetPassword(token, password);
      await refresh();
      navigate('/surveys', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset your password');
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <AuthPageLayout title="Reset link not valid">
        <Alert severity="error">
          This reset link is missing its token. Request a new one from the sign-in page.
        </Alert>
        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Link component={RouterLink} to="/forgot-password" variant="body2">
            Request a new link
          </Link>
        </Box>
      </AuthPageLayout>
    );
  }

  return (
    <AuthPageLayout title="Choose a new password">
      <Box component="form" onSubmit={handleSubmit}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField
          label="New password"
          type="password"
          fullWidth
          margin="normal"
          autoComplete="new-password"
          autoFocus
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
          disabled={submitting || password.length < 10 || !confirmPassword}
          sx={{ mt: 2 }}
        >
          {submitting ? 'Saving…' : 'Set password and sign in'}
        </Button>
      </Box>
    </AuthPageLayout>
  );
}
