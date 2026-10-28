import React, { RefObject, useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  CircleNotchIcon as IconLoader2,
  UploadSimpleIcon as IconUpload,
  PlayIcon as IconPlayerPlay,
  MusicNotesIcon as IconMusic,
  VideoCameraIcon as IconVideo,
  ImageIcon as IconPhoto,
  PauseIcon as IconPlayerPause
} from '@/components/icons';
import { OSINTNodeData } from '../../types';
import { toast } from 'sonner';
import WaveSurfer from 'wavesurfer.js';
import { useTheme } from 'next-themes';
import { PdfNodePreview } from './pdf-node-preview';
import { isPdfNode } from '../graph-editor/utils/pdf-node';
import dynamic from 'next/dynamic';
import { getFilePreviewKind } from '../graph-editor/utils/file-preview';

const FileNodePreview = dynamic(() => import('./file-node-preview').then((mod) => mod.FileNodePreview), { ssr: false });

interface DocumentNodeContentProps {
  data: OSINTNodeData;
  config: {
    label: string;
    headerText: string;
  };
  isUploadingFile: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleUploadClick: (e: React.MouseEvent) => void;
  setIsPreviewOpen: (open: boolean) => void;
  Icon: React.ElementType;
}

// Mini Audio Player Component with Real Waveform visualization
const MiniAudioPlayer = ({ src, label }: { src: string, label: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const { theme } = useTheme();

  // Colors based on theme
  const waveColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.25)';
  const progressColor = theme === 'dark' ? '#3b82f6' : '#2563eb';

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize WaveSurfer
    wavesurfer.current = WaveSurfer.create({
      container: containerRef.current,
      waveColor: waveColor,
      progressColor: progressColor,
      cursorColor: 'transparent',
      cursorWidth: 0,
      barWidth: 3,
      barGap: 2,
      barRadius: 3,
      height: 32,
      normalize: true,
      url: src,
      interact: true,
    });

    // Event listeners
    wavesurfer.current.on('play', () => setIsPlaying(true));
    wavesurfer.current.on('pause', () => setIsPlaying(false));
    wavesurfer.current.on('finish', () => setIsPlaying(false));

    return () => {
      wavesurfer.current?.destroy();
    };
  }, [src, theme, waveColor, progressColor]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    wavesurfer.current?.playPause();
  };

  return (
    <div className="flex flex-col w-full h-full justify-between py-2">
       <div className="flex items-center gap-3 w-full flex-1 px-3">
         {/* Play/Pause Button - Left */}
         <button
           className="shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary transition-all hover:bg-primary/20 hover:scale-105 nodrag nopan"
           onClick={togglePlay}
         >
            {isPlaying ? (
              <IconPlayerPause className="w-5 h-5 fill-current" />
            ) : (
              <IconPlayerPlay className="w-5 h-5 fill-current ml-0.5" />
            )}
         </button>

         {/* Waveform - Right/Inline */}
         <div
            className="flex-1 min-w-0 h-8 flex items-center"
            onClick={(e) => e.stopPropagation()}
         >
            <div ref={containerRef} className="w-full nodrag nopan cursor-pointer" />
         </div>
       </div>

       {/* Label - Bottom */}
       <p className="text-[10px] font-medium text-center truncate w-full px-3 select-text nodrag nopan opacity-70">
          {label}
       </p>
    </div>
  );
};

export function DocumentNodeContent({
  data,
  config,
  isUploadingFile,
  fileInputRef,
  handleFileSelect,
  handleUploadClick,
  setIsPreviewOpen,
  Icon
}: DocumentNodeContentProps) {
  // Empty document node - show upload prompt
  if (!data.metadata?.fileUrl && !data.metadata?.filename && !data.label.includes('.')) {
    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelect}
          accept="*/*"
        />
        <div
          className='flex h-full cursor-pointer flex-col items-center justify-center gap-2 py-3 transition-colors hover:bg-muted/30'
          onClick={handleUploadClick}
        >
          {isUploadingFile ? (
            <>
              <IconLoader2 className={cn('h-8 w-8 animate-spin', config.headerText)} />
              <p className='text-muted-foreground text-[10px] font-medium'>
                Uploading...
              </p>
            </>
          ) : (
            <>
              <div className='bg-muted/30 rounded-lg p-2'>
                <IconUpload className={cn('h-8 w-8', config.headerText)} />
              </div>
              <p className='text-muted-foreground text-[10px] font-medium'>
                Click to upload
              </p>
            </>
          )}
        </div>
      </>
    );
  }

  // Determine file type
  const mimeType = String(data.metadata?.mimeType || '');
  const extension = String(data.metadata?.extension || data.label.split('.').pop() || '');
  const isImage = mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(extension.toLowerCase());
  const isVideo = mimeType.startsWith('video/') || ['mp4', 'webm', 'ogg', 'mov'].includes(extension.toLowerCase());
  const isAudio = mimeType.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(extension.toLowerCase());

  const fileUrl = data.metadata?.fileUrl;
  const resolvedUrl = fileUrl && String(fileUrl).startsWith('/temp/')
    ? `/api/upload/temp/${String(fileUrl).split('/').pop()}`
    : String(fileUrl || '');

  if (isPdfNode(data) && resolvedUrl && !data.metadata?._uploading) {
    return <PdfNodePreview key={resolvedUrl} src={resolvedUrl}
      filename={String(data.metadata?.filename || data.label)}
      onOpen={() => setIsPreviewOpen(true)} />;
  }

  const previewKind = getFilePreviewKind(data);
  if (previewKind && previewKind !== 'pdf' && resolvedUrl && !data.metadata?._uploading) {
    return <FileNodePreview key={`${resolvedUrl}:${previewKind}`} src={resolvedUrl} kind={previewKind}
      filename={String(data.metadata?.filename || data.label)} onOpen={() => setIsPreviewOpen(true)} />;
  }

  // Media Preview Wrapper
  const MediaWrapper = ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <div
      className={cn('relative group flex h-full flex-col items-center justify-center overflow-hidden rounded-md', className)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (data.metadata?.fileUrl) {
          setIsPreviewOpen(true);
        }
      }}
    >
      {children}
    </div>
  );

  // Image Node
  if (isImage && resolvedUrl && !data.metadata?._uploading) {
    return (
      <MediaWrapper>
        <div className="relative w-full h-full min-h-[100px] bg-black/5">
          <img
            src={resolvedUrl}
            alt={data.label}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
        </div>
        <div className='absolute bottom-0 w-full bg-black/60 p-1 backdrop-blur-sm'>
          <p className='truncate text-[9px] font-medium text-white text-center px-1'>
            {data.label}
          </p>
        </div>
      </MediaWrapper>
    );
  }

  // Video Node
  if (isVideo && resolvedUrl && !data.metadata?._uploading) {
    return (
      <MediaWrapper>
        <div className="relative w-full h-full min-h-[100px] bg-black/90 flex items-center justify-center">
          <video
            src={resolvedUrl}
            className="w-full h-full object-cover opacity-80"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-full bg-white/20 p-2 backdrop-blur-sm transition-transform group-hover:scale-110">
              <IconPlayerPlay className="h-6 w-6 text-white fill-white" />
            </div>
          </div>
        </div>
        <div className='absolute bottom-0 w-full bg-black/60 p-1 backdrop-blur-sm'>
          <p className='truncate text-[9px] font-medium text-white text-center px-1'>
            {data.label}
          </p>
        </div>
      </MediaWrapper>
    );
  }

  // Audio Node
  if (isAudio && resolvedUrl && !data.metadata?._uploading) {
    return (
      <div
        className="w-full h-full max-w-[300px] flex items-center justify-center bg-muted/10 rounded-md"
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (data.metadata?.fileUrl) {
            setIsPreviewOpen(true);
          }
        }}
      >
        <MiniAudioPlayer src={resolvedUrl} label={data.label} />
      </div>
    );
  }

  // Generic File / Default
  return (
    <div
      className='flex h-full flex-col items-center justify-center gap-2 py-3 cursor-pointer group relative max-w-[300px]'
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (data.metadata?.fileUrl) {
          setIsPreviewOpen(true);
        }
      }}
    >
      {data.metadata?._uploading ? (
        <IconLoader2 className={cn('h-10 w-10 animate-spin', config.headerText)} />
      ) : (
        <Icon className={cn('h-10 w-10', config.headerText)} />
      )}
      <div className='flex flex-col items-center gap-0.5 px-1 text-center max-w-[180px]'>
        <p
          className='line-clamp-2 text-[11px] font-semibold break-all leading-tight w-full select-text nodrag nopan'
        >
          {data.metadata?.filename
            ? String(data.metadata.filename).replace(/\.[^.]+$/, '')
            : data.label.startsWith('File ')
              ? data.label
              : data.label.replace(/\.[^.]+$/, '')
          }
        </p>
        <p className='text-muted-foreground text-[9px] font-medium uppercase tracking-wider'>
          {data.metadata?._uploading
            ? 'Uploading...'
            : String(data.metadata?.extension || data.type)}
        </p>
        {!data.metadata?._uploading && data.metadata?.size ? (
          <p className='text-muted-foreground text-[8px]'>
            {(Number(data.metadata.size) / 1024).toFixed(1)} KB
          </p>
        ) : null}
      </div>
    </div>
  );
}
