import { useCallback, useEffect, useState, type ReactNode } from 'react';
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
import { surveyorFullName } from '../../utils/formatters';
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
  const [surveyors, setSurveyors] = useState<Surveyor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [linkInvite, setLinkInvite] = useState<OrgInvite | null>(null);
  const [linkUser, setLinkUser] = useState<OrgUser | null>(null);

  const load = useCallback(async () => {
    try {
      const [userList, inviteList, surveyorList] = await Promise.all([
        usersAPI.getAll(),
        usersAPI.getInvites(),
        surveyorsAPI.getAll(true),
      ]);
      setUsers(userList);
      setInvites(inviteList);
      setSurveyors(surveyorList);
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

  const surveyorByUserId = new Map(
    surveyors.filter((s) => s.user_id != null).map((s) => [s.user_id, s])
  );

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
              <TableCell>Surveyor</TableCell>
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
                    <Tooltip
                      title="Link this account to an existing surveyor — it takes over that survey history"
                      arrow
                    >
                      <Button
                        size="small"
                        onClick={() => setLinkUser(user)}
                        sx={{ textTransform: 'none', px: 0.75, minWidth: 0 }}
                      >
                        {(() => {
                          const linked = surveyorByUserId.get(user.id);
                          return linked ? surveyorFullName(linked) : 'Link…';
                        })()}
                      </Button>
                    </Tooltip>
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
                <TableCell colSpan={6}>
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
                      <TableCell>
                        {/* The link can change any time before acceptance */}
                        <Tooltip title="Link to an existing surveyor — they'll keep that survey history" arrow>
                          <Button
                            size="small"
                            onClick={() => setLinkInvite(invite)}
                            sx={{ textTransform: 'none', px: 0.75, minWidth: 0 }}
                          >
                            {invite.surveyor_name ?? 'Link…'}
                          </Button>
                        </Tooltip>
                      </TableCell>
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
          openInvites={invites}
          onClose={() => setInviteDialogOpen(false)}
          onInvited={() => {
            setInviteDialogOpen(false);
            load();
          }}
        />
      )}

      {linkInvite && (
        <LinkSurveyorDialog
          description={
            <>
              When <strong>{linkInvite.email}</strong> accepts their invite, their
              account will claim the surveyor picked here.
            </>
          }
          currentSurveyorId={linkInvite.surveyor_id}
          openInvites={invites}
          excludeInviteId={linkInvite.id}
          allowClear
          onClose={() => setLinkInvite(null)}
          onSave={async (surveyor) => {
            try {
              await usersAPI.updateInvite(linkInvite.id, surveyor?.id ?? null);
              toast.success(
                surveyor
                  ? `Invite for ${linkInvite.email} linked to ${surveyorFullName(surveyor)}`
                  : `Surveyor link removed from ${linkInvite.email}'s invite`
              );
              setLinkInvite(null);
              load();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Could not update invite');
              throw err;
            }
          }}
        />
      )}

      {linkUser && (
        <LinkSurveyorDialog
          description={
            <>
              <strong>
                {[linkUser.first_name, linkUser.last_name].filter(Boolean).join(' ')}
              </strong>
              's account will be linked to the surveyor picked here and take over
              that survey history.
            </>
          }
          currentSurveyorId={surveyorByUserId.get(linkUser.id)?.id ?? null}
          openInvites={invites}
          allowClear={false}
          onClose={() => setLinkUser(null)}
          onSave={async (surveyor) => {
            if (!surveyor) return;
            try {
              await usersAPI.linkSurveyor(linkUser.id, surveyor.id);
              toast.success(`${linkUser.first_name} linked to ${surveyorFullName(surveyor)}`);
              setLinkUser(null);
              load();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Could not link surveyor');
              throw err;
            }
          }}
        />
      )}
    </Stack>
  );
}

/** Surveyors an invite could claim: unclaimed, and not already targeted by
 * another live invite (which would 409 on save). */
function useUnclaimedSurveyors(openInvites: OrgInvite[], excludeInviteId?: number) {
  const [surveyors, setSurveyors] = useState<Surveyor[]>([]);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const heldByOtherInvite = new Set(
      openInvites
        .filter(
          (i) =>
            i.id !== excludeInviteId &&
            i.surveyor_id != null &&
            new Date(i.expires_at) > new Date()
        )
        .map((i) => i.surveyor_id)
    );
    // Include inactive surveyors — claiming one reactivates it
    surveyorsAPI
      .getAll(true)
      .then((all) =>
        setSurveyors(all.filter((s) => s.user_id == null && !heldByOtherInvite.has(s.id)))
      )
      .catch(() => setLoadError(true));
  }, [openInvites, excludeInviteId]);

  return { surveyors, loadError };
}

function SurveyorLinkPicker({
  options,
  value,
  onChange,
  disabled,
}: {
  options: Surveyor[];
  value: Surveyor | null;
  onChange: (surveyor: Surveyor | null) => void;
  disabled: boolean;
}) {
  return (
    <Autocomplete
      options={options}
      value={value}
      onChange={(_, newValue) => onChange(newValue)}
      getOptionLabel={surveyorFullName}
      renderOption={(props, option) => (
        <li {...props} key={option.id}>
          {surveyorFullName(option)}
          {!option.is_active && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
              (inactive)
            </Typography>
          )}
        </li>
      )}
      disabled={disabled}
      renderInput={(params) => (
        <TextField
          {...params}
          margin="normal"
          label="Link to existing surveyor (optional)"
          helperText="If they already appear in the surveyor list, pick them here — their account will keep that survey history instead of creating a duplicate."
        />
      )}
    />
  );
}

function InviteDialog({
  onClose,
  onInvited,
  openInvites,
}: {
  onClose: () => void;
  onInvited: () => void;
  openInvites: OrgInvite[];
}) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [surveyor, setSurveyor] = useState<Surveyor | null>(null);
  const { surveyors: unclaimedSurveyors, loadError: surveyorLoadError } =
    useUnclaimedSurveyors(openInvites);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

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
        {surveyorLoadError && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Couldn't load the surveyor list, so this invite can't be linked to an
            existing surveyor. Close the dialog and try again if you need that.
          </Alert>
        )}
        {unclaimedSurveyors.length > 0 && (
          <SurveyorLinkPicker
            options={unclaimedSurveyors}
            value={surveyor}
            onChange={setSurveyor}
            disabled={submitting}
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

/** Pick an unclaimed surveyor to link — to a pending invite or directly to
 * an account. The caller owns the save (API call, toasts, closing). */
function LinkSurveyorDialog({
  description,
  currentSurveyorId,
  openInvites,
  excludeInviteId,
  allowClear,
  onClose,
  onSave,
}: {
  description: ReactNode;
  currentSurveyorId: number | null;
  openInvites: OrgInvite[];
  excludeInviteId?: number;
  /** Whether saving with nothing selected removes an existing link */
  allowClear: boolean;
  onClose: () => void;
  onSave: (surveyor: Surveyor | null) => Promise<void>;
}) {
  const { surveyors: unclaimedSurveyors, loadError } = useUnclaimedSurveyors(
    openInvites,
    excludeInviteId
  );
  const [surveyor, setSurveyor] = useState<Surveyor | null>(null);
  const [saving, setSaving] = useState(false);

  // Preselect the current surveyor once the options arrive
  useEffect(() => {
    setSurveyor(unclaimedSurveyors.find((s) => s.id === currentSurveyorId) ?? null);
  }, [unclaimedSurveyors, currentSurveyorId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(surveyor);
    } catch {
      setSaving(false); // the caller has already shown the error
    }
  };

  return (
    <Dialog open onClose={() => !saving && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>Link surveyor</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {description}
        </Typography>
        {loadError ? (
          <Alert severity="warning" sx={{ mt: 1 }}>
            Couldn't load the surveyor list. Close the dialog and try again.
          </Alert>
        ) : (
          <SurveyorLinkPicker
            options={unclaimedSurveyors}
            value={surveyor}
            onChange={setSurveyor}
            disabled={saving}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={saving || loadError || (!surveyor && !allowClear)}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
