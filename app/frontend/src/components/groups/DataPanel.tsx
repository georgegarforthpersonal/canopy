/**
 * Data panel for a group: download every sighting recorded by this group's
 * surveys as an Excel spreadsheet (common name, species, count, date,
 * location). Mirrors the admin Data tab export, scoped to one survey type.
 */
import { useState } from 'react';
import { Box, Paper, Typography, ButtonBase, CircularProgress } from '@mui/material';
import { Download } from '@mui/icons-material';
import { exportAPI } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import FileTypeBadge from '../FileTypeBadge';
import { groupCardSx, groupColors } from '../../pages/groups/groupsTokens';

interface DataPanelProps {
  surveyTypeId: number;
  surveyTypeName: string;
}

export default function DataPanel({ surveyTypeId, surveyTypeName }: DataPanelProps) {
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await exportAPI.downloadRecordsBySurveyType(surveyTypeId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Paper sx={groupCardSx}>
      <Box sx={{ px: 2.25, py: 1.75, borderBottom: `1px solid ${groupColors.divider}` }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: groupColors.textPrimary }}>
          Data
        </Typography>
      </Box>

      <ButtonBase
        onClick={handleDownload}
        disabled={downloading}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2.25,
          py: 1.4,
          textAlign: 'left',
          '&:hover': { bgcolor: groupColors.page },
        }}
      >
        <FileTypeBadge filename="records.xlsx" />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: groupColors.textPrimary }} noWrap>
            {surveyTypeName} sighting records
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: '#999' }}>
            {downloading ? 'Preparing…' : 'Excel · species, count, date, location'}
          </Typography>
        </Box>
        {downloading ? (
          <CircularProgress size={18} sx={{ color: '#9aa39a', flexShrink: 0 }} />
        ) : (
          <Download sx={{ fontSize: 18, color: '#9aa39a', flexShrink: 0 }} />
        )}
      </ButtonBase>
    </Paper>
  );
}
