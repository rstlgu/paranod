'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { IconDownload, IconFileText } from '@tabler/icons-react';
import {
  OpenNodeDialogBody,
  type OpenNodeDialogBodyProps
} from './graph-editor/components/open-node-dialog';
import dynamic from 'next/dynamic';
import { getFilePreviewKind } from './graph-editor/utils/file-preview';

const FileNodePreview = dynamic(
  () => import('./nodes/file-node-preview').then((mod) => mod.FileNodePreview),
  { ssr: false }
);

interface FilePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileExtension?: string;
  panelProps: OpenNodeDialogBodyProps;
}

export function FilePreviewDialog({
  open,
  onOpenChange,
  fileUrl,
  fileName,
  fileType,
  fileExtension,
  panelProps
}: FilePreviewDialogProps) {
  const [error, setError] = useState<string | null>(null);

  const ext = (fileExtension || fileName.split('.').pop() || '').toLowerCase();
  const excerptKind = getFilePreviewKind({
    type: 'document',
    label: fileName,
    metadata: { extension: ext, mimeType: fileType }
  });
  const resolvedFileUrl = useMemo(() => {
    // Back-compat: older nodes stored a public URL like /temp/<userId>/<storedFilename>
    // In production Next may not serve runtime-added public files, so we proxy via API.
    const normalized =
      typeof fileUrl === 'string' && fileUrl.startsWith('/temp/')
        ? `/api/upload/temp/${fileUrl.split('/').pop() ?? ''}`
        : fileUrl;

    if (typeof window === 'undefined') return fileUrl;
    try {
      return new URL(normalized, window.location.origin).toString();
    } catch {
      return normalized;
    }
  }, [fileUrl]);

  // Content readers own their loading, cancellation and bounded excerpt state.
  useEffect(() => {
    setError(null);
  }, [open, resolvedFileUrl]);

  const handleDownload = useCallback(() => {
    const link = document.createElement('a');
    link.href = resolvedFileUrl;
    link.download = fileName;
    link.click();
  }, [resolvedFileUrl, fileName]);

  const renderPreview = () => {
    if (excerptKind && excerptKind !== 'pdf') {
      return (
        <div className='absolute inset-0 flex flex-col'>
          <div className='min-h-0 flex-1'>
            <FileNodePreview
              key={`${resolvedFileUrl}:${excerptKind}`}
              src={resolvedFileUrl}
              filename={fileName}
              kind={excerptKind}
            />
          </div>
          <div className='shrink-0 border-t p-3'>
            <Button onClick={handleDownload} variant='outline'>
              <IconDownload className='mr-2 h-4 w-4' />
              Download original
            </Button>
          </div>
        </div>
      );
    }
    // PDF
    if (ext === 'pdf') {
      return (
        <div className='bg-muted/10 absolute inset-0'>
          <iframe
            className='h-full w-full border-0'
            title={fileName}
            src={`${resolvedFileUrl}#view=FitH`}
          />
        </div>
      );
    }

    // Office documents: preview disabled (download only)
    if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) {
      return (
        <div className='flex h-full flex-col items-center justify-center gap-6 p-8 text-center'>
          <div className='bg-primary/10 rounded-full p-6'>
            <IconFileText className='text-primary h-16 w-16' />
          </div>
          <div className='space-y-2'>
            <h3 className='text-lg font-semibold'>Office document</h3>
            <p className='text-muted-foreground max-w-md'>
              Preview is not available for {ext.toUpperCase()} files. Download
              the file to view it.
            </p>
          </div>
          <Button onClick={handleDownload} size='lg'>
            <IconDownload className='mr-2 h-5 w-5' />
            Download File
          </Button>
        </div>
      );
    }

    // Images
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
      return (
        <ScrollArea className='absolute inset-0'>
          <div className='flex items-center justify-center p-4'>
            <img
              src={resolvedFileUrl}
              alt={fileName}
              className='max-h-[70vh] w-auto rounded-lg'
              onError={() => setError('Failed to load image')}
            />
          </div>
        </ScrollArea>
      );
    }

    // Video
    if (['mp4', 'webm', 'ogg', 'mov'].includes(ext)) {
      return (
        <div className='flex items-center justify-center p-4'>
          <video
            src={resolvedFileUrl}
            controls
            className='max-h-[70vh] w-auto rounded-lg'
            onError={() => setError('Failed to load video')}
          >
            Your browser does not support the video tag.
          </video>
        </div>
      );
    }

    // Audio
    if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) {
      return (
        <div className='flex items-center justify-center p-8'>
          <audio
            src={resolvedFileUrl}
            controls
            className='w-full max-w-md'
            onError={() => setError('Failed to load audio')}
          >
            Your browser does not support the audio tag.
          </audio>
        </div>
      );
    }

    // Unsupported file type
    return (
      <div className='flex h-full flex-col items-center justify-center gap-6 p-8 text-center'>
        <div className='bg-muted rounded-full p-6'>
          <IconFileText className='text-muted-foreground h-16 w-16' />
        </div>
        <div className='space-y-2'>
          <h3 className='text-lg font-semibold'>Preview Not Available</h3>
          <p className='text-muted-foreground max-w-md'>
            This file type cannot be previewed in the browser. Download the file
            to view it.
          </p>
        </div>
        <Button onClick={handleDownload} variant='outline' size='lg'>
          <IconDownload className='mr-2 h-5 w-5' />
          Download File
        </Button>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='border/60 !h-[92vh] !w-[92vw] !max-w-none gap-0 rounded-3xl p-0'>
        {/* Required for Radix accessibility; visually hidden on purpose */}
        <DialogTitle className='sr-only'>{fileName}</DialogTitle>
        <div className='flex flex-1 overflow-hidden'>
          {/* Left side - Preview */}
          <div className='bg-muted/10 relative flex-[2] overflow-hidden border-r'>
            {error ? (
              <div className='flex flex-col items-center justify-center gap-4 p-8 text-center'>
                <p className='text-destructive'>{error}</p>
                <Button onClick={handleDownload} variant='outline'>
                  <IconDownload className='mr-2 h-4 w-4' />
                  Download File
                </Button>
              </div>
            ) : (
              renderPreview()
            )}
          </div>

          {/* Right side - same UI as OpenNodeDialog */}
          <div className='bg-background flex-[0.7] overflow-hidden p-6'>
            <div className='flex h-full flex-col'>
              <OpenNodeDialogBody {...panelProps} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
