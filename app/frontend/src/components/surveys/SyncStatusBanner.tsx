import { Alert, Button, Typography } from '@mui/material';
import { CloudDoneOutlined, WifiOff } from '@mui/icons-material';
import dayjs from 'dayjs';

interface SyncStatusBannerProps {
  online: boolean;
  /** A save failed on connectivity and is waiting to be retried. */
  pendingSync: boolean;
  saving: boolean;
  /** Last successful local draft backup (epoch ms), or null. */
  draftSavedAt: number | null;
  onSyncNow: () => void;
}

/**
 * Field-entry status strip: tells the surveyor whether their data is on the
 * server, waiting for signal, or (at minimum) backed up on the device. Shown
 * only while editing.
 */
export function SyncStatusBanner({
  online,
  pendingSync,
  saving,
  draftSavedAt,
  onSyncNow,
}: SyncStatusBannerProps) {
  if (pendingSync && !saving) {
    return (
      <Alert
        severity="warning"
        icon={online ? undefined : <WifiOff fontSize="inherit" />}
        sx={{ mb: 3 }}
        action={
          <Button color="inherit" size="small" onClick={onSyncNow} sx={{ textTransform: 'none', fontWeight: 600 }}>
            Sync now
          </Button>
        }
      >
        Not uploaded yet — your survey is safely stored on this device and will upload
        automatically when you're back online.
      </Alert>
    );
  }

  if (!online) {
    return (
      <Alert severity="info" icon={<WifiOff fontSize="inherit" />} sx={{ mb: 3 }}>
        You're offline. Your entries are being saved on this device; save the survey once the
        connection returns.
      </Alert>
    );
  }

  if (draftSavedAt) {
    return (
      <Typography
        variant="caption"
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', mb: 2 }}
      >
        <CloudDoneOutlined sx={{ fontSize: 14 }} />
        Backed up on this device at {dayjs(draftSavedAt).format('HH:mm')}
      </Typography>
    );
  }

  return null;
}
