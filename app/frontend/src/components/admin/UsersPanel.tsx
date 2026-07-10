import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Add, Block, ContentCopy, Refresh, RestoreFromTrash, Send } from '@mui/icons-material';
import { surveyorsAPI, usersAPI } from '../../services/api';
import type { OrgInvite, OrgUser, Surveyor, UserRole } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

const ROLE_OPTIONS: { value: UserRole; label: string; description: string }[] = [
  { value: 'viewer', label: 'Viewer', description: 'View everything; sign up to scheduled surveys' },
  { value: 'editor', label: 'Editor', description: 'Viewer + record and edit surveys' },
  { value: 'admin', label: 'Admin', description: 'Editor + admin page and user management' },
];

const ROLE_CHIP_COLOR: Record<UserRole, 'default' | 'primary' | 'secondary'> = {
  viewer: 'default',
  editor: 'primary',
  admin: 'secondary',
};

/**
 * Admin › Users: accounts, roles and invites for the organisation.
 */
export function UsersPanel() {
  const toast = useToast();
  const { user: currentUser } = useAuth();

  const [users, setUsers] = useState<OrgUser[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [userList, inviteList] = await Promise.all([usersAPI.getAll(), usersAPI.getInvites()]);
      setUsers(userList);
      setInvites(inviteList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRoleChange = async (user: OrgUser, role: UserRole) => {
    try {
      await usersAPI.update(user.id, { role });
      toast.success(`${user.first_name} is now ${role === 'admin' ? 'an' : 'a'} ${role}`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change role');
    }
  };

  const handleActiveToggle = async (user: OrgUser) => {
    try {
      await usersAPI.update(user.id, { is_active: !user.is_active });
      toast.success(user.is_active ? `${user.first_name} deactivated and signed out` : `${user.first_name} reactivated`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update user');
    }
  };

  const copyInviteLink = async (inviteId: number) => {
    try {
      // Resending regenerates the link — the raw token is never stored
      const { invite_url } = await usersAPI.resendInvite(inviteId);
      await navigator.clipboard.writeText(invite_url);
      toast.success('New invite link copied to clipboard');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not copy invite link');
    }
  };

  const handleRevokeInvite = async (invite: OrgInvite) => {
    try {
      await usersAPI.revokeInvite(invite.id);
      toast.error(`Invite for ${invite.email} revoked`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not revoke invite');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="contained" startIcon={<Add />} onClick={() => setInviteDialogOpen(true)}>
          Invite user
        </Button>
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Last sign-in</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => {
              const isSelf = currentUser?.id === user.id;
              return (
                <TableRow key={user.id} sx={{ opacity: user.is_active ? 1 : 0.5 }}>
                  <TableCell>
                    {[user.first_name, user.last_name].filter(Boolean).join(' ')}
                    {isSelf && (
                      <Typography component="span" variant="caption" color="text.secondary">
                        {' '}
                        (you)
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    {isSelf || !user.is_active ? (
                      <Chip size="small" label={user.role} color={ROLE_CHIP_COLOR[user.role]} />
                    ) : (
                      <Select
                        size="small"
                        value={user.role}
                        onChange={(e) => handleRoleChange(user, e.target.value as UserRole)}
                        sx={{ minWidth: 110, fontSize: '0.875rem' }}
                      >
                        {ROLE_OPTIONS.map((option) => (
                          <MenuItem key={option.value} value={option.value}>
                            {option.label}
                          </MenuItem>
                        ))}
                      </Select>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.last_login_at ? new Date(user.last_login_at).toLocaleDateString('en-GB') : 'Never'}
                  </TableCell>
                  <TableCell align="right">
                    {!isSelf && (
                      <Tooltip title={user.is_active ? 'Deactivate (signs them out)' : 'Reactivate'} arrow>
                        <IconButton size="small" onClick={() => handleActiveToggle(user)}>
                          {user.is_active ? <Block fontSize="small" /> : <RestoreFromTrash fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    No accounts yet — invite the first user to get started.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {invites.length > 0 && (
        <Box>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
            Pending invites
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Email</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Linked surveyor</TableCell>
                  <TableCell>Expires</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invites.map((invite) => {
                  const expired = new Date(invite.expires_at) < new Date();
                  return (
                    <TableRow key={invite.id}>
                      <TableCell>{invite.email}</TableCell>
                      <TableCell>
                        <Chip size="small" label={invite.role} color={ROLE_CHIP_COLOR[invite.role]} />
                      </TableCell>
                      <TableCell>{invite.surveyor_name ?? '—'}</TableCell>
                      <TableCell>
                        {expired ? (
                          <Chip size="small" label="Expired" color="warning" />
                        ) : (
                          new Date(invite.expires_at).toLocaleDateString('en-GB')
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Copy a fresh invite link" arrow>
                          <IconButton size="small" onClick={() => copyInviteLink(invite.id)}>
                            <ContentCopy fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Resend the invite email" arrow>
                          <IconButton
                            size="small"
                            onClick={async () => {
                              try {
                                const { email_sent } = await usersAPI.resendInvite(invite.id);
                                if (email_sent) {
                                  toast.success(`Invite re-sent to ${invite.email}`);
                                } else {
                                  toast.error('Email sending is not configured — use the copy button instead');
                                }
                                load();
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : 'Could not resend invite');
                              }
                            }}
                          >
                            <Send fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Revoke invite" arrow>
                          <IconButton size="small" onClick={() => handleRevokeInvite(invite)}>
                            <Block fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {inviteDialogOpen && (
        <InviteDialog
          onClose={() => setInviteDialogOpen(false)}
          onInvited={() => {
            setInviteDialogOpen(false);
            load();
          }}
        />
      )}
    </Stack>
  );
}

const surveyorLabel = (s: Surveyor) =>
  s.last_name ? `${s.first_name} ${s.last_name}` : s.first_name;

function InviteDialog({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [surveyor, setSurveyor] = useState<Surveyor | null>(null);
  const [unclaimedSurveyors, setUnclaimedSurveyors] = useState<Surveyor[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    // Include inactive surveyors — claiming one reactivates it
    surveyorsAPI
      .getAll(true)
      .then((all) => setUnclaimedSurveyors(all.filter((s) => s.user_id == null)))
      .catch(() => setUnclaimedSurveyors([]));
  }, []);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await usersAPI.createInvite(email.trim().toLowerCase(), role, surveyor?.id ?? null);
      setInviteUrl(result.invite_url);
      setEmailSent(result.email_sent);
      if (result.email_sent) {
        toast.success(`Invite emailed to ${email.trim()}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create invite');
    } finally {
      setSubmitting(false);
    }
  };

  // After creating the invite, show the link so it can be shared manually
  // (the only way to deliver it when email sending isn't configured).
  if (inviteUrl) {
    return (
      <Dialog open onClose={onInvited} maxWidth="sm" fullWidth>
        <DialogTitle>Invite created</DialogTitle>
        <DialogContent>
          <Alert severity={emailSent ? 'success' : 'info'} sx={{ mb: 2 }}>
            {emailSent
              ? 'The invite has been emailed. You can also share this link directly:'
              : 'Email sending is not configured, so share this link with them directly. It works once and expires in 7 days.'}
          </Alert>
          <TextField
            fullWidth
            value={inviteUrl}
            InputProps={{
              readOnly: true,
              endAdornment: (
                <IconButton
                  onClick={async () => {
                    await navigator.clipboard.writeText(inviteUrl);
                    toast.success('Invite link copied');
                  }}
                >
                  <ContentCopy />
                </IconButton>
              ),
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onInvited} variant="contained">
            Done
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={() => !submitting && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>Invite a user</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField
          autoFocus
          margin="normal"
          label="Email"
          type="email"
          fullWidth
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
        />
        <FormControl fullWidth margin="normal">
          <InputLabel id="invite-role-label">Role</InputLabel>
          <Select
            labelId="invite-role-label"
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            disabled={submitting}
          >
            {ROLE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                <Box>
                  <Typography variant="body2">{option.label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {option.description}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {unclaimedSurveyors.length > 0 && (
          <Autocomplete
            options={unclaimedSurveyors}
            value={surveyor}
            onChange={(_, value) => setSurveyor(value)}
            getOptionLabel={surveyorLabel}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                {surveyorLabel(option)}
                {!option.is_active && (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                    (inactive)
                  </Typography>
                )}
              </li>
            )}
            disabled={submitting}
            renderInput={(params) => (
              <TextField
                {...params}
                margin="normal"
                label="Link to existing surveyor (optional)"
                helperText="If they already appear in the surveyor list, pick them here — their account will keep that survey history instead of creating a duplicate."
              />
            )}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          startIcon={submitting ? <Refresh /> : <Send />}
          disabled={submitting || !email.includes('@')}
        >
          {submitting ? 'Creating…' : 'Send invite'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
