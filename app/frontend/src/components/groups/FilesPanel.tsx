/**
 * Files panel for a group: a short list of downloadable reference files
 * (methodology PDFs, recording forms, ID sheets) attached to the survey type.
 * Files are managed in Edit Survey Type; this view is download-only.
 */
import { Box, Paper, Typography, ButtonBase, CircularProgress } from '@mui/material';
import { Download } from '@mui/icons-material';
import type { SurveyTypeFile } from '../../services/api';
import { surveyTypesAPI } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { formatFileSize } from '../../utils/fileBadges';
import FileTypeBadge from '../FileTypeBadge';
import { groupCardSx, groupColors } from '../../pages/groups/groupsTokens';

interface FilesPanelProps {
  surveyTypeId: number;
  files: SurveyTypeFile[];
  loading: boolean;
}

export default function FilesPanel({ surveyTypeId, files, loading }: FilesPanelProps) {
  const toast = useToast();

  const handleDownload = async (file: SurveyTypeFile) => {
    try {
      const { download_url } = await surveyTypesAPI.getFileDownloadUrl(surveyTypeId, file.id);
      window.open(download_url, '_blank', 'noopener');
    } catch {
      toast.error('Failed to get download link');
    }
  };

  return (
    <Paper sx={groupCardSx}>
      <Box sx={{ px: 2.25, py: 1.75, borderBottom: `1px solid ${groupColors.divider}` }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: groupColors.textPrimary }}>
          Files
        </Typography>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={20} />
        </Box>
      ) : files.length === 0 ? (
        <Box sx={{ px: 2.25, py: 3 }}>
          <Typography sx={{ fontSize: 13.5, color: groupColors.textMuted }}>
            No files yet.
          </Typography>
        </Box>
      ) : (
        files.map((file) => (
          <ButtonBase
            key={file.id}
            onClick={() => handleDownload(file)}
            sx={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              px: 2.25,
              py: 1.4,
              borderTop: `1px solid ${groupColors.dividerInner}`,
              textAlign: 'left',
              '&:hover': { bgcolor: groupColors.page },
            }}
          >
            <FileTypeBadge filename={file.filename} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: groupColors.textPrimary }} noWrap>
                {file.filename}
              </Typography>
              {file.size_bytes != null && (
                <Typography sx={{ fontSize: 11.5, color: '#999' }}>
                  {formatFileSize(file.size_bytes)}
                </Typography>
              )}
            </Box>
            <Download sx={{ fontSize: 18, color: '#9aa39a', flexShrink: 0 }} />
          </ButtonBase>
        ))
      )}
    </Paper>
  );
}
