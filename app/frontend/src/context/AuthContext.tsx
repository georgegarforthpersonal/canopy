import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { authAPI, SESSION_EXPIRED_EVENT } from '../services/api';
import { brandColors } from '../theme';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  requireAuth: (action: () => void) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);

  // Check auth status on mount
  useEffect(() => {
    authAPI.status()
      .then((data) => setIsAuthenticated(data.authenticated))
      .catch(() => setIsAuthenticated(false))
      .finally(() => setIsLoading(false));
  }, []);

  // When any API call fails with an expired session, prompt for re-login
  // in place so the user keeps their page state. Repeated 401s are harmless:
  // the dialog is a single conditionally-rendered instance.
  useEffect(() => {
    const handleSessionExpired = () => {
      setIsAuthenticated(false);
      setShowPasswordDialog(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  const login = useCallback(async (password: string) => {
    const data = await authAPI.login(password);
    if (data.authenticated) {
      setIsAuthenticated(true);
      // Execute pending action if there was one
      if (pendingAction) {
        pendingAction();
        setPendingAction(null);
      }
      setShowPasswordDialog(false);
    }
  }, [pendingAction]);

  const logout = useCallback(async () => {
    await authAPI.logout();
    setIsAuthenticated(false);
  }, []);

  const requireAuth = useCallback((action: () => void) => {
    if (isAuthenticated) {
      action();
    } else {
      setPendingAction(() => action);
      setShowPasswordDialog(true);
    }
  }, [isAuthenticated]);

  const handleDialogClose = useCallback(() => {
    setShowPasswordDialog(false);
    setPendingAction(null);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, login, logout, requireAuth }}>
      {children}
      {showPasswordDialog && (
        <PasswordDialogInner
          onLogin={login}
          onClose={handleDialogClose}
        />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Inline password dialog to avoid circular imports
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Alert } from '@mui/material';

function PasswordDialogInner({ onLogin, onClose }: { onLogin: (password: string) => Promise<void>; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!password.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onLogin(password);
    } catch {
      setError('Incorrect password');
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Admin Password Required</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField
          autoFocus
          margin="normal"
          label="Password"
          type="password"
          fullWidth
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={submitting}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={submitting || !password.trim()}
          sx={{ bgcolor: brandColors.main, '&:hover': { bgcolor: brandColors.hover } }}
        >
          {submitting ? 'Verifying...' : 'Login'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
