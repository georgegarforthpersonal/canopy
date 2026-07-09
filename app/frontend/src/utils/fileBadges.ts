/**
 * Helpers for rendering reference-file badges (extension glyph + color) and
 * human-readable file sizes. Shared by the admin Files manager and the
 * Groups Files panel.
 */

export interface FileBadgeColors {
  background: string;
  text: string;
}

/** Map a filename to its uppercase extension glyph, e.g. "report.PDF" → "PDF". */
export function fileExtensionGlyph(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1 || dot === filename.length - 1) return 'FILE';
  return filename.slice(dot + 1).toUpperCase();
}

/**
 * Color a file badge by type. Mirrors the design handoff's file-type palette;
 * falls back to neutral gray for unknown extensions.
 */
export function fileBadgeColors(filename: string): FileBadgeColors {
  const ext = fileExtensionGlyph(filename);
  switch (ext) {
    case 'PDF':
      return { background: '#FDE7E7', text: '#D03A3A' };
    case 'DOC':
    case 'DOCX':
      return { background: '#E1ECF9', text: '#2B5F86' };
    case 'XLS':
    case 'XLSX':
    case 'CSV':
      return { background: '#E3F2E3', text: '#2E6B42' };
    case 'PNG':
    case 'JPG':
    case 'JPEG':
    case 'GIF':
    case 'WEBP':
      return { background: '#EFE6F4', text: '#6940A5' };
    default:
      return { background: '#EBECED', text: '#555555' };
  }
}

/** Format a byte count as a short human-readable string (e.g. "1.2 MB"). */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
