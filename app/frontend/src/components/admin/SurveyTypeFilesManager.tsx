/**
 * Manage reference files attached to a survey type (admin only).
 *
 * Lists existing files, allows uploading new ones and deleting them. Used
 * inside the Edit Survey Type dialog; only rendered for survey types that
 * already exist (you can't attach a file to an unsaved type).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import { Upload, Delete, Download } from '@mui/icons-material';
import { surveyTypesAPI, type SurveyTypeFile } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { formatFileSize } from '../../utils/fileBadges';
import FileTypeBadge from '../FileTypeBadge';

interface SurveyTypeFilesManagerProps {
  surveyTypeId: number;
}

export default function SurveyTypeFilesManager({ surveyTypeId }: SurveyTypeFilesManagerProps) {
  const toast = useToast();
  const [files, setFiles] = useState<SurveyTypeFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFiles = useCallback(async () => {
    try {
      const data = await surveyTypesAPI.getFiles(surveyTypeId);
      setFiles(data);
    } catch {
      toast.error('Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [surveyTypeId, toast]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const uploadFiles = useCallback(
    async (selected: File[]) => {
      if (selected.length === 0) return;

      setUploading(true);
      try {
        const results = await Promise.allSettled(
          selected.map((file) => surveyTypesAPI.uploadFile(surveyTypeId, file)),
        );
        const created = results
          .filter((r): r is PromiseFulfilledResult<SurveyTypeFile> => r.status === 'fulfilled')
          .map((r) => r.value);
        const failed = results.length - created.length;

        if (created.length > 0) setFiles((prev) => [...created, ...prev]);
        if (failed === 0) {
          toast.success(created.length === 1 ? 'File uploaded' : `${created.length} files uploaded`);
        } else if (created.length === 0) {
          toast.error(failed === 1 ? 'Upload failed' : `${failed} files failed to upload`);
        } else {
          toast.error(`${created.length} uploaded, ${failed} failed`);
        }
      } finally {
        setUploading(false);
      }
    },
    [surveyTypeId, toast],
  );

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    if (event.target) event.target.value = ''; // allow re-uploading the same file
    void uploadFiles(selected);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    if (uploading) return;
    void uploadFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const handleDownload = async (file: SurveyTypeFile) => {
    try {
      const { download_url } = await surveyTypesAPI.getFileDownloadUrl(surveyTypeId, file.id);
      window.open(download_url, '_blank', 'noopener');
    } catch {
      toast.error('Failed to get download link');
    }
  };

  const handleDelete = async (file: SurveyTypeFile) => {
    setDeletingId(file.id);
    try {
      await surveyTypesAPI.deleteFile(surveyTypeId, file.id);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      toast.success('File deleted');
    } catch {
      toast.error('Failed to delete file');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Box
      sx={{
        mt: 3,
        p: 1,
        mx: -1,
        borderRadius: 1,
        border: '2px dashed',
        borderColor: dragOver ? 'primary.main' : 'transparent',
        bgcolor: dragOver ? 'action.hover' : 'transparent',
        transition: 'border-color 120ms, background-color 120ms',
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!uploading) setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragOver(false);
      }}
      onDrop={handleDrop}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="subtitle2">Reference files</Typography>
        <Button
          size="small"
          startIcon={uploading ? <CircularProgress size={14} /> : <Upload sx={{ fontSize: 16 }} />}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          Upload
        </Button>
        <input ref={inputRef} type="file" hidden multiple onChange={handleUpload} />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Methodology guides, recording forms and ID sheets shown to surveyors in the survey space.
        Drag and drop files here, or use Upload.
      </Typography>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={20} />
        </Box>
      ) : files.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          No files yet.
        </Typography>
      ) : (
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          {files.map((file, idx) => (
            <Box
              key={file.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                p: 1.25,
                borderTop: idx === 0 ? 'none' : '1px solid',
                borderColor: 'divider',
              }}
            >
              <FileTypeBadge filename={file.filename} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {file.filename}
                </Typography>
                {file.size_bytes != null && (
                  <Typography variant="caption" color="text.secondary">
                    {formatFileSize(file.size_bytes)}
                  </Typography>
                )}
              </Box>
              <Tooltip title="Download">
                <IconButton size="small" onClick={() => handleDownload(file)}>
                  <Download fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete">
                <span>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleDelete(file)}
                    disabled={deletingId === file.id}
                  >
                    {deletingId === file.id ? <CircularProgress size={16} /> : <Delete fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
