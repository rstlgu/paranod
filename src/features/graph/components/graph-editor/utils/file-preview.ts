import { isPdfNode, PDF_NODE_SIZE } from './pdf-node';

export type FilePreviewKind =
  | 'pdf'
  | 'text'
  | 'markdown'
  | 'json'
  | 'csv'
  | 'docx'
  | 'xlsx'
  | 'pptx';
export type ExcerptKind = Exclude<FilePreviewKind, 'pdf'>;
export type FilePreviewData = {
  type?: string;
  label?: string;
  metadata?: Record<string, unknown>;
};
export const TEXT_PREVIEW_BYTES = 64 * 1024;
export const OFFICE_PREVIEW_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = new Set([
  'document',
  'pdf',
  'docx',
  'xlsx',
  'txt',
  'csv',
  'json'
]);
const TEXT_EXTENSIONS = new Set([
  'txt',
  'log',
  'xml',
  'html',
  'htm',
  'svg',
  'css',
  'scss',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'java',
  'c',
  'h',
  'cpp',
  'cs',
  'go',
  'rs',
  'sh',
  'bash',
  'sql',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'rb',
  'php',
  'env'
]);

export function getFilePreviewKind(
  data: FilePreviewData
): FilePreviewKind | null {
  if (!FILE_TYPES.has(data.type || '')) return null;
  const meta = data.metadata || {};
  const name = String(meta.filename || data.label || '');
  const ext = String(
    meta.extension || (name.includes('.') ? name.split('.').pop() : '')
  )
    .toLowerCase()
    .replace(/^\./, '');
  // Legacy binary Office files must not be treated as zipped OOXML.
  if (['doc', 'xls', 'ppt'].includes(ext)) return null;
  if (isPdfNode(data as Parameters<typeof isPdfNode>[0])) return 'pdf';
  if (['docx', 'xlsx', 'pptx'].includes(ext)) return ext as ExcerptKind;
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  if (ext === 'json') return 'json';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  const mime = String(meta.mimeType || '')
    .toLowerCase()
    .split(';')[0];
  const mimeKinds: Record<string, ExcerptKind> = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      'pptx',
    'application/json': 'json',
    'text/csv': 'csv',
    'text/tab-separated-values': 'csv',
    'text/markdown': 'markdown'
  };
  if (mimeKinds[mime]) return mimeKinds[mime];
  if (mime.startsWith('text/')) return 'text';
  if (
    !ext &&
    ['txt', 'csv', 'json', 'docx', 'xlsx'].includes(data.type || '')
  ) {
    return data.type === 'txt' ? 'text' : (data.type as ExcerptKind);
  }
  return null;
}

export function filePreviewDimensions(data: FilePreviewData) {
  const kind = getFilePreviewKind(data);
  return kind
    ? {
        ...(kind === 'pdf' ? PDF_NODE_SIZE : { width: 360, height: 260 }),
        minHeight: kind === 'pdf' ? 220 : 120
      }
    : null;
}

// Stop reading text once the excerpt is full; Office archives require a complete,
// bounded download. Cancelling the stream avoids buffering an entire large file.
export async function readPreviewBytes(
  response: Response,
  maxBytes: number,
  allowTruncation: boolean
) {
  if (!response.ok || !response.body) throw new Error('File unavailable');
  if (
    !allowTruncation &&
    Number(response.headers.get('content-length')) > maxBytes
  ) {
    await response.body.cancel();
    throw new Error('File too large for preview (maximum 10 MB)');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - size;
      if (value.length > remaining) {
        if (!allowTruncation)
          throw new Error('File too large for preview (maximum 10 MB)');
        if (remaining) chunks.push(value.slice(0, remaining));
        size = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(value);
      size += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, truncated };
}

export function decodePreviewText(bytes: Uint8Array) {
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8';
  const text = new TextDecoder(encoding).decode(bytes);
  if (text.includes('\0'))
    throw new Error('Binary content cannot be previewed as text');
  return text;
}

// Quoted separators, escaped quotes and multiline cells are supported. Cells and
// rows are capped independently so an imported table cannot flood the graph DOM.
export function csvPreview(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const candidates = [',', ';', '\t'];
  const counts = candidates.map((delimiter) => {
    let quoted = false,
      count = 0;
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === delimiter) count++;
    }
    return count;
  });
  const delimiter = candidates[counts.indexOf(Math.max(...counts))];
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  const pushCell = () => {
    if (row.length < 8) row.push(cell);
    cell = '';
  };
  for (let i = 0; i < text.length && rows.length < 30; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        if (cell.length < 300) cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) pushCell();
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      pushCell();
      rows.push(row);
      row = [];
    } else if (cell.length < 300) cell += char;
  }
  if ((cell || row.length) && rows.length < 30) {
    pushCell();
    rows.push(row);
  }
  return rows;
}
