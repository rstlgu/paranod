'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowSquareOutIcon, CircleNotchIcon } from '@/components/icons';
import {
  csvPreview,
  decodePreviewText,
  readPreviewBytes,
  TEXT_PREVIEW_BYTES,
  OFFICE_PREVIEW_BYTES,
  type ExcerptKind
} from '../graph-editor/utils/file-preview';
import {
  parseOfficeExcerpt,
  type OfficeExcerpt
} from '../graph-editor/utils/office-preview';

function officeXml(
  bytes: Uint8Array,
  kind: 'docx' | 'xlsx' | 'pptx',
  signal: AbortSignal
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Preview cancelled'));
      return;
    }
    const worker = new Worker(
      new URL('../graph-editor/utils/office-preview.worker.ts', import.meta.url)
    );
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new Error('Preview cancelled'));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Document too complex for preview'));
    }, 8000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) => {
      cleanup();
      event.data.error
        ? reject(new Error(event.data.error))
        : resolve(event.data.files);
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error('Document preview unavailable'));
    };
    worker.postMessage({ bytes, kind }, [bytes.buffer]);
  });
}

export function FileNodePreview({
  src,
  filename,
  kind,
  onOpen
}: {
  src: string;
  filename: string;
  kind: ExcerptKind;
  onOpen?: () => void;
}) {
  const [preview, setPreview] = useState<OfficeExcerpt | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 20000);
    setPreview(null);
    setError('');
    async function load() {
      try {
        const url = new URL(src, window.location.origin);
        if (
          url.origin !== window.location.origin ||
          !['http:', 'https:'].includes(url.protocol)
        )
          throw new Error('Only locally uploaded files can be previewed');
        const office = kind === 'docx' || kind === 'xlsx' || kind === 'pptx';
        const response = await fetch(url, {
          signal: controller.signal,
          credentials: 'same-origin'
        });
        const { bytes, truncated } = await readPreviewBytes(
          response,
          office ? OFFICE_PREVIEW_BYTES : TEXT_PREVIEW_BYTES,
          !office
        );
        let result: OfficeExcerpt;
        if (office) {
          const files = await officeXml(bytes, kind, controller.signal);
          result = parseOfficeExcerpt(files, kind);
        } else {
          let text = decodePreviewText(bytes);
          if (kind === 'json' && !truncated) {
            try {
              text = JSON.stringify(JSON.parse(text), null, 2);
            } catch {
              /* Keep invalid JSON readable. */
            }
          }
          const label =
            kind === 'csv'
              ? 'Table excerpt · up to 30 rows × 8 columns'
              : `${kind === 'markdown' ? 'Markdown' : kind === 'json' ? 'JSON' : 'Text'} preview${truncated ? ' · first 64 KB' : ''}`;
          result =
            kind === 'csv'
              ? { rows: csvPreview(text), label }
              : { text: text.slice(0, TEXT_PREVIEW_BYTES), label };
        }
        if (active) setPreview(result);
      } catch (err) {
        if (active)
          setError(
            controller.signal.aborted
              ? 'Preview timed out. Open or download the original file.'
              : err instanceof Error
                ? err.message
                : 'Preview unavailable'
          );
      } finally {
        clearTimeout(timeout);
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [src, kind]);

  const empty =
    preview &&
    !preview.text?.trim() &&
    !preview.rows?.some((row) => row.some(Boolean));
  return (
    <div
      className='flex h-full min-h-0 flex-col'
      onDoubleClick={(event) => {
        event.stopPropagation();
        onOpen?.();
      }}
    >
      <div
        className='nodrag nopan nowheel min-h-0 flex-1 overflow-auto p-3 text-xs leading-relaxed'
        tabIndex={0}
        aria-label={`Preview of ${filename}`}
      >
        {!preview && !error && (
          <p
            role='status'
            className='text-muted-foreground flex items-center gap-2'
          >
            <CircleNotchIcon className='h-4 w-4 animate-spin' />
            Loading preview…
          </p>
        )}
        {error && (
          <p role='status' className='text-muted-foreground'>
            {error}
          </p>
        )}
        {empty && (
          <p className='text-muted-foreground'>
            No readable text in this excerpt. Open the original file to see its
            full contents.
          </p>
        )}
        {preview?.rows && !empty && (
          <table className='w-full border-collapse text-left text-[11px]'>
            <tbody>
              {preview.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className='border-border max-w-56 min-w-16 border px-2 py-1 align-top break-words whitespace-pre-wrap'
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {preview?.text &&
          (kind === 'markdown' ? (
            <div className='space-y-2 break-words [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_pre]:overflow-auto'>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                skipHtml
                components={{
                  // File content must not trigger requests to remote tracking images or links.
                  img: ({ alt }) => (
                    <span className='text-muted-foreground'>
                      [Image: {alt || 'image'}]
                    </span>
                  ),
                  a: ({ children }) => (
                    <span className='underline'>{children}</span>
                  )
                }}
              >
                {preview.text}
              </ReactMarkdown>
            </div>
          ) : (
            <pre className='m-0 font-mono text-[11px] break-words whitespace-pre-wrap'>
              {preview.text}
            </pre>
          ))}
      </div>
      <div className='flex shrink-0 items-center gap-2 border-t px-3 py-2'>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-xs font-medium' title={filename}>
            {filename}
          </p>
          <p
            className='text-muted-foreground truncate text-[10px]'
            title={preview?.label}
          >
            {preview?.label || `${kind.toUpperCase()} preview`}
          </p>
        </div>
        {onOpen && (
          <button
            type='button'
            className='nodrag nopan hover:bg-muted rounded p-1.5 focus-visible:outline focus-visible:outline-2'
            title='Open file'
            aria-label={`Open ${filename}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            <ArrowSquareOutIcon className='h-4 w-4' />
          </button>
        )}
      </div>
    </div>
  );
}
