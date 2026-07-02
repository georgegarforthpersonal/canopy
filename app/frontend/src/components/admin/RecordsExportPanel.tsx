import { useEffect, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  CircularProgress,
  Divider,
  Stack,
} from '@mui/material';
import { Download } from '@mui/icons-material';
import {
  exportAPI,
  type SurveyType,
  type SpeciesTypeRef,
} from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { brandColors } from '../../theme';

/**
 * Records export panel - download flat sighting records as Excel (.xlsx),
 * either for a specific survey type or for a species (taxonomic) group.
 *
 * Columns: common_name, species_name, count, date, location.
 */
function RecordsExportPanel() {
  const toast = useToast();
  const [surveyTypes, setSurveyTypes] = useState<SurveyType[]>([]);
  const [speciesTypes, setSpeciesTypes] = useState<SpeciesTypeRef[]>([]);
  const [loading, setLoading] = useState(true);
  // Key of the row currently downloading, e.g. "survey-3" or "species-2".
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [survey, species] = await Promise.all([
          exportAPI.getSurveyTypesWithRecords(),
          exportAPI.getSpeciesTypesWithRecords(),
        ]);
        if (!cancelled) {
          setSurveyTypes(survey);
          setSpeciesTypes(species);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load export options');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const handleDownload = async (key: string, download: () => Promise<void>) => {
    setDownloadingKey(key);
    try {
      await download();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloadingKey(null);
    }
  };

  const downloadButton = (key: string, download: () => Promise<void>) => {
    const busy = downloadingKey === key;
    return (
      <Button
        size="small"
        variant="outlined"
        startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <Download />}
        onClick={() => handleDownload(key, download)}
        disabled={downloadingKey !== null}
        sx={{
          color: brandColors.main,
          borderColor: brandColors.main,
          '&:hover': { borderColor: brandColors.hover, bgcolor: 'rgba(0, 0, 0, 0.02)' },
        }}
      >
        {busy ? 'Preparing...' : 'Download Excel'}
      </Button>
    );
  };

  const row = (label: string, button: React.ReactNode) => (
    <Stack
      key={label}
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      spacing={2}
      sx={{ py: 1 }}
    >
      <Typography variant="body1">{label}</Typography>
      {button}
    </Stack>
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Paper sx={{ p: { xs: 2, md: 3 }, maxWidth: 600 }}>
      <Typography variant="h6" gutterBottom>
        Export records
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Download sighting records as an Excel spreadsheet. Columns: common name, species
        name, count, date and location.
      </Typography>

      <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
        By survey type
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Every sighting from surveys of this type.
      </Typography>
      {surveyTypes.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          No survey types have records yet.
        </Typography>
      ) : (
        <Box>
          {surveyTypes.map((st, i) => (
            <Box key={st.id}>
              {i > 0 && <Divider />}
              {row(
                st.name,
                downloadButton(`survey-${st.id}`, () =>
                  exportAPI.downloadRecordsBySurveyType(st.id),
                ),
              )}
            </Box>
          ))}
        </Box>
      )}

      <Divider sx={{ my: 3 }} />

      <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
        By species type
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Every sighting of this taxonomic group, across all survey types (including ad-hoc).
      </Typography>
      {speciesTypes.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          No species types have records yet.
        </Typography>
      ) : (
        <Box>
          {speciesTypes.map((sp, i) => (
            <Box key={sp.id}>
              {i > 0 && <Divider />}
              {row(
                sp.display_name,
                downloadButton(`species-${sp.id}`, () =>
                  exportAPI.downloadRecordsBySpeciesType(sp.id),
                ),
              )}
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
}

export default RecordsExportPanel;
