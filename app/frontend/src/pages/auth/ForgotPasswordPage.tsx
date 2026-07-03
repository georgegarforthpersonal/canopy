import { useState } from 'react';
import { Alert, Box, Button, Link, TextField } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { authAPI } from '../../services/api';
import { AuthPageLayout } from './AuthPageLayout';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await authAPI.requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageLayout title="Reset your password">
      {sent ? (
        <Alert severity="success">
          If that email has an account, a reset link is on its way. The link is
          valid for one hour.
        </Alert>
      ) : (
        <Box component="form" onSubmit={handleSubmit}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
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
          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            disabled={submitting || !email.trim()}
            sx={{ mt: 2 }}
          >
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </Box>
      )}
      <Box sx={{ mt: 2, textAlign: 'center' }}>
        <Link component={RouterLink} to="/login" variant="body2">
          Back to sign in
        </Link>
      </Box>
    </AuthPageLayout>
  );
}
