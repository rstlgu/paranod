import { useRef, useState } from 'react';
import { useGuardedReactFlow as useReactFlow } from '../../contexts/graph-mutation-context';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { OSINTNodeData } from '../../types';
import { uploadTempFileWithProgress } from '../graph-editor/utils/upload-file';
import {
  IMAGE_FILE_ACCEPT,
  getMediaSource,
  normalizeMediaUrl,
  prepareImageFile,
  uploadedImageData
} from '../graph-editor/utils/image-node';

export function MediaSourceEditor({
  id,
  source,
  onDone,
  detectType
}: {
  id: string;
  source: string;
  onDone: () => void;
  detectType: (url: string) => string;
}) {
  const { setNodes, canEdit } = useReactFlow<OSINTNodeData>();
  const [url, setUrl] = useState(source);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  async function upload(file: File) {
    if (busy.current || !canEdit()) return;
    try {
      file = prepareImageFile(file);
      busy.current = true;
      setProgress(0);
      setError('');
      const result = await uploadTempFileWithProgress({
        file,
        onProgress: setProgress
      });
      if (!canEdit()) return;
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id &&
          node.data.type === 'media_url' &&
          getMediaSource(node.data) === source
            ? { ...node, data: uploadedImageData(node.data, file, result.url) }
            : node
        )
      );
      onDone();
      toast.success('Image uploaded');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      busy.current = false;
      setProgress(null);
    }
  }

  return (
    <form
      className='nodrag nopan nowheel flex h-full min-h-[150px] flex-col justify-center gap-2 p-3'
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy.current || !canEdit()) return;
        if (source && url.trim() === source) {
          onDone();
          return;
        }
        try {
          const nextUrl = normalizeMediaUrl(url);
          const type = detectType(nextUrl);
          setNodes((nodes) =>
            nodes.map((node) =>
              node.id === id
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      label: nextUrl,
                      metadata: {
                        ...node.data.metadata,
                        url: nextUrl,
                        fileUrl: undefined,
                        filename: undefined,
                        mimeType: undefined,
                        size: undefined,
                        mediaType: type === 'unknown' ? 'image' : type,
                        _uploading: false
                      }
                    }
                  }
                : node
            )
          );
          onDone();
        } catch {
          setError('Enter a valid HTTP or HTTPS URL.');
        }
      }}
    >
      <input
        ref={fileInput}
        type='file'
        accept={IMAGE_FILE_ACCEPT}
        className='hidden'
        aria-label='Upload image file'
        disabled={progress !== null || !canEdit()}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />
      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={progress !== null || !canEdit()}
        onClick={() => fileInput.current?.click()}
      >
        {progress !== null ? `Uploading… ${progress}%` : 'Upload image'}
      </Button>
      <p className='text-muted-foreground text-center text-[10px]'>
        PNG, JPEG, GIF, WebP · max 50 MB
      </p>
      <Input
        aria-label='Image or media URL'
        placeholder='https://…'
        value={url}
        readOnly={!canEdit()}
        disabled={progress !== null}
        onChange={(event) => setUrl(event.target.value)}
        className='h-8 text-xs'
      />
      <div className='flex gap-2'>
        <Button
          type='submit'
          size='sm'
          className='flex-1'
          disabled={!url.trim() || progress !== null || !canEdit()}
        >
          Use URL
        </Button>
        {source && (
          <Button
            type='button'
            size='sm'
            variant='ghost'
            disabled={progress !== null}
            onClick={onDone}
          >
            Cancel
          </Button>
        )}
      </div>
      {error && (
        <p role='alert' className='text-destructive text-xs'>
          {error}
        </p>
      )}
    </form>
  );
}
