import { useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import { Logout, Key } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { authAPI } from '../../services/api';
import { MIN_PASSWORD_LENGTH, PasswordField, PasswordRequirement } from '../auth/PasswordField';

const ROLE_LABELS: Record<string, string> = {
  viewer: 'Viewer',
  editor: 'Editor',
  admin: 'Admin',
};

/**
 * Avatar + dropdown in the top nav: shows who is signed in and their role,
 * with change-password (user accounts) and sign out.
 */
export function UserMenu() {
  const { user, role, logout } = useAuth();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  const initials = user
    ? `${user.first_name[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase()
    : '?';
  const displayName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ')
    : 'Signed in';

  const handleLogout = async () => {
    setAnchorEl(null);
    await logout();
    navigate('/login');
  };

  return (
    <>
      <Tooltip title={displayName} arrow>
        <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} sx={{ p: 0.5 }}>
          <Avatar sx={{ width: 32, height: 32, fontSize: 14, bgcolor: 'primary.main' }}>
            {initials}
          </Avatar>
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2">{displayName}</Typography>
          <Typography variant="caption" color="text.secondary">
            {user?.email}
            {role && ` · ${ROLE_LABELS[role] ?? role}`}
          </Typography>
        </Box>
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            setChangePasswordOpen(true);
          }}
        >
          <ListItemIcon>
            <Key fontSize="small" />
          </ListItemIcon>
          Change password
        </MenuItem>
        <MenuItem onClick={handleLogout}>
          <ListItemIcon>
            <Logout fontSize="small" />
          </ListItemIcon>
          Sign out
        </MenuItem>
      </Menu>

      {changePasswordOpen && <ChangePasswordDialog onClose={() => setChangePasswordOpen(false)} />}
    </>
  );
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Live once there's something to compare — never while the field is empty.
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  const handleSubmit = async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setNewPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (mismatch || !confirmPassword) return;
    setSubmitting(true);
    setError(null);
    try {
      await authAPI.changePassword(currentPassword, newPassword);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not change password';
      if (/new password|too common|at least/i.test(message)) setNewPasswordError(message);
      else setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Change password</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <PasswordField
          autoFocus
          margin="normal"
          label="Current password"
          fullWidth
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          disabled={submitting}
        />
        <PasswordField
          margin="normal"
          label="New password"
          fullWidth
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value);
            if (newPasswordError) setNewPasswordError(null);
          }}
          error={Boolean(newPasswordError)}
          helperText={newPasswordError ?? <PasswordRequirement password={newPassword} />}
          disabled={submitting}
        />
        <PasswordField
          margin="normal"
          label="Confirm new password"
          fullWidth
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={mismatch}
          helperText={mismatch ? 'Passwords do not match' : undefined}
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
          disabled={submitting || !currentPassword}
        >
          {submitting ? 'Saving…' : 'Change password'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
