'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
import {
  CircleNotchIcon,
  FilePdfIcon,
  ArrowSquareOutIcon
} from '@/components/icons';
import { pdfPreviewScale } from '../graph-editor/utils/pdf-node';

export function PdfNodePreview({
  src,
  filename,
  onOpen
}: {
  src: string;
  filename: string;
  onOpen: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let documentTask: PDFDocumentLoadingTask | undefined;
    let renderTask: RenderTask | undefined;
    const destroyDocument = () => {
      const task = documentTask;
      documentTask = undefined;
      void task?.destroy().catch(() => {});
    };

    async function render() {
      try {
        const pdfjs = await import('pdfjs-dist');
        if (cancelled || !canvasRef.current) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url
        ).toString();
        documentTask = pdfjs.getDocument({ url: src, withCredentials: true });
        const document = await documentTask.promise;
        const page = await document.getPage(1);
        if (cancelled || !canvasRef.current) return;
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: pdfPreviewScale(original.width, original.height)
        });
        const canvas = canvasRef.current;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        renderTask = page.render({ canvas, viewport });
        await renderTask.promise;
        if (!cancelled) {
          setPages(document.numPages);
          setStatus('ready');
        }
      } catch {
        if (!cancelled) setStatus('error');
      } finally {
        destroyDocument();
      }
    }
    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      destroyDocument();
    };
  }, [src]);

  return (
    <div
      className='flex h-full min-h-0 flex-col'
      onDoubleClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      <div className='bg-muted/40 relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2'>
        <canvas
          ref={canvasRef}
          role='img'
          aria-label={`First page of ${filename}`}
          className={`max-h-full max-w-full bg-white object-contain shadow-sm ${status === 'ready' ? '' : 'invisible'}`}
        />
        {status === 'loading' && (
          <div
            role='status'
            className='text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs'
          >
            <CircleNotchIcon className='h-6 w-6 animate-spin' />
            Loading PDF preview…
          </div>
        )}
        {status === 'error' && (
          <div
            role='status'
            className='text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-xs'
          >
            <FilePdfIcon className='h-8 w-8' />
            Preview unavailable. The PDF may be protected or damaged.
          </div>
        )}
      </div>
      <div className='flex shrink-0 items-center gap-2 border-t px-3 py-2'>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-xs font-medium' title={filename}>
            {filename}
          </p>
          <p className='text-muted-foreground text-[10px]'>
            {pages ? `Page 1 of ${pages}` : 'PDF document'}
          </p>
        </div>
        <button
          type='button'
          className='nodrag nopan hover:bg-muted rounded p-1.5 focus-visible:outline focus-visible:outline-2'
          aria-label={`Open PDF ${filename}`}
          title='Open PDF'
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <ArrowSquareOutIcon className='h-4 w-4' />
        </button>
      </div>
    </div>
  );
}
