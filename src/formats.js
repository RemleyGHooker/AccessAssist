// Supported file types for AccessAssist (pod contract, REQ-02).
// GET /formats publishes exactly this list, and POST /analyze enforces it,
// so the published list and the real behavior can never disagree.

export const MAX_FILE_SIZE_MB = 10;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const SUPPORTED = {
  'text/html': {
    extensions: ['.html', '.htm'],
    // A file counts as HTML if, once decoded, it contains an HTML tag we recognize.
    looksValid: (buf) => /<(!doctype html|html|head|body|div|p|img|h[1-6]|main|section)\b/i.test(buf.toString('utf8')),
  },
  'application/pdf': {
    extensions: ['.pdf'],
    // A PDF starts with "%PDF-" and ends with an "%%EOF" marker. A file cut off
    // partway through (a failed download, a corrupted upload) is missing the end marker.
    looksValid: (buf) => buf.subarray(0, 5).toString('latin1') === '%PDF-'
      && buf.subarray(Math.max(0, buf.length - 1024)).toString('latin1').includes('%%EOF'),
  },
  [DOCX]: {
    extensions: ['.docx'],
    // A Word file is a ZIP archive (starts with "PK") that contains word/document.xml.
    looksValid: (buf) => buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
      && buf.includes(Buffer.from('word/document.xml')),
  },
};

export const SUPPORTED_MIME_TYPES = Object.keys(SUPPORTED);

// Decide which supported type a file claims to be. The declared MIME type wins;
// a generic or missing type falls back to the file extension. Returns null when
// the file claims to be something we do not support (-> 415).
export function resolveType(originalName = '', declaredMime = '') {
  const mime = declaredMime.split(';')[0].trim().toLowerCase();
  if (SUPPORTED[mime]) return mime;
  const generic = mime === '' || mime === 'application/octet-stream';
  if (!generic) return null;
  const lower = originalName.toLowerCase();
  return SUPPORTED_MIME_TYPES.find((m) => SUPPORTED[m].extensions.some((ext) => lower.endsWith(ext))) ?? null;
}
