import { useState } from 'react';
import { Alert, Box, Button, Link } from '@mui/material';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { authAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { MIN_PASSWORD_LENGTH, PasswordField, PasswordRequirement } from '../../components/auth/PasswordField';
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
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Live once there's something to compare — never while the field is empty.
  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (mismatch || !confirmPassword) return;
    setSubmitting(true);
    setError(null);
    try {
      await authAPI.resetPassword(token, password);
      await refresh();
      navigate('/surveys', { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not reset your password';
      if (/password/i.test(message)) setPasswordError(message);
      else setError(message);
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
        <PasswordField
          label="New password"
          fullWidth
          margin="normal"
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (passwordError) setPasswordError(null);
          }}
          error={Boolean(passwordError)}
          helperText={passwordError ?? <PasswordRequirement password={password} />}
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
          {submitting ? 'Saving…' : 'Set password and sign in'}
        </Button>
      </Box>
    </AuthPageLayout>
  );
}
