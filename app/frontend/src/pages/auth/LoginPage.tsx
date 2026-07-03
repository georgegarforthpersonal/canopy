import { useState } from 'react';
import { Alert, Box, Button, Collapse, Link, TextField, Typography } from '@mui/material';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { AuthPageLayout } from './AuthPageLayout';

/**
 * Full-page login. Email + password is the primary flow; the legacy shared
 * admin password is available behind a link until the accounts cutover.
 */
export function LoginPage() {
  const { login, loginLegacy } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next') || '/surveys';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [legacyMode, setLegacyMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (legacyMode) {
        await loginLegacy(password);
      } else {
        await login(email.trim(), password);
      }
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageLayout title="Sign in">
      <Box component="form" onSubmit={handleSubmit}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Collapse in={!legacyMode}>
          <TextField
            label="Email"
            type="email"
            fullWidth
            margin="normal"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
          />
        </Collapse>
        <TextField
          label={legacyMode ? 'Shared admin password' : 'Password'}
          type="password"
          fullWidth
          margin="normal"
          autoComplete={legacyMode ? 'off' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
        />

        <Button
          type="submit"
          variant="contained"
          fullWidth
          size="large"
          disabled={submitting || !password || (!legacyMode && !email.trim())}
          sx={{ mt: 2 }}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>

        <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'center' }}>
          {!legacyMode && (
            <Link component={RouterLink} to="/forgot-password" variant="body2">
              Forgot password?
            </Link>
          )}
          <Link
            component="button"
            type="button"
            variant="body2"
            color="text.secondary"
            onClick={() => {
              setLegacyMode(!legacyMode);
              setError(null);
            }}
          >
            {legacyMode ? 'Sign in with an account instead' : 'Use the shared admin password'}
          </Link>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 3, textAlign: 'center' }}>
          No account? Ask your organisation's admin for an invite.
        </Typography>
      </Box>
    </AuthPageLayout>
  );
}
