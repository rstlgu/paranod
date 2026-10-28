import React, { useState, useMemo, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { IconPhoto, IconVideo, IconMusic, IconPlayerPlay, IconPlayerPause } from '@tabler/icons-react';
import { OSINTNodeData } from '../../types';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';

// Helper per parsare URL video e ottenere embed URL
function getVideoEmbedInfo(url: string): {
  type: 'youtube' | 'vimeo' | 'direct' | 'invalid';
  embedUrl: string | null;
} {
  if (!url) return { type: 'invalid', embedUrl: null };

  // YouTube
  const youtubeMatch = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  if (youtubeMatch) {
    return {
      type: 'youtube',
      embedUrl: `https://www.youtube.com/embed/${youtubeMatch[1]}`
    };
  }

  // Vimeo
  const vimeoMatch = url.match(/(?:vimeo\.com\/)(\d+)/);
  if (vimeoMatch) {
    return {
      type: 'vimeo',
      embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}`
    };
  }

  // File video diretto (mp4, webm, ogg)
  if (url.match(/\.(mp4|webm|ogg|mov)(\?.*)?$/i) || url.includes('blob:')) {
    return { type: 'direct', embedUrl: url };
  }

  // Prova comunque come URL diretto
  if (url.startsWith('http')) {
    return { type: 'direct', embedUrl: url };
  }

  return { type: 'invalid', embedUrl: null };
}

// Componente per player audio custom
function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (value: number[]) => {
    if (audioRef.current) {
      audioRef.current.currentTime = value[0];
      setCurrentTime(value[0]);
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-2 w-full max-w-[200px] nodrag nopan bg-background/50 p-2 rounded-md border border-border/50">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
        className="hidden"
      />
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full hover:bg-primary/10"
          onClick={togglePlay}
        >
          {isPlaying ? (
            <IconPlayerPause className="h-4 w-4 fill-current" />
          ) : (
            <IconPlayerPlay className="h-4 w-4 fill-current" />
          )}
        </Button>
        <div className="flex-1 space-y-1">
          <Slider
            value={[currentTime]}
            max={duration || 100}
            step={0.1}
            onValueChange={handleSeek}
            className="w-full cursor-pointer"
          />
          <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Componente per il contenuto video
function VideoContent({
  url,
  title,
  onDoubleClick
}: {
  url: string;
  title?: string;
  onDoubleClick?: () => void;
}) {
  const videoInfo = useMemo(() => getVideoEmbedInfo(url), [url]);
  const [hasError, setHasError] = useState(false);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // Previeni il dblclick se stiamo interagendo con i controlli
      if ((e.target as HTMLElement).tagName === 'VIDEO' || (e.target as HTMLElement).tagName === 'IFRAME') {
        return;
      }
      e.stopPropagation();
      onDoubleClick?.();
    },
    [onDoubleClick]
  );

  if (!url || videoInfo.type === 'invalid') {
    return (
      <div className='flex h-full min-h-[80px] flex-col items-center justify-center px-3 py-6 text-center'>
        <IconVideo className='text-muted-foreground/50 mb-2 h-8 w-8' />
        <p className='text-muted-foreground text-xs'>
          {url || 'Double click to add video URL'}
        </p>
      </div>
    );
  }

  return (
    <div
      className='nodrag nopan relative flex-1 group'
      style={{ height: '100%', minHeight: 120 }}
      onDoubleClick={handleDoubleClick}
    >
      {videoInfo.type === 'youtube' || videoInfo.type === 'vimeo' ? (
        // YouTube o Vimeo - usa iframe
        <div className="relative w-full h-full">
           <iframe
             src={videoInfo.embedUrl!}
             className='h-full w-full pointer-events-auto'
             allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
             allowFullScreen
             title={title || 'Video'}
           />
           {/* Overlay per drag solo sui bordi/header, non sul video */}
        </div>
      ) : !hasError ? (
        // File video diretto
        <video
          src={videoInfo.embedUrl!}
          className='h-full w-full bg-black object-contain pointer-events-auto'
          controls
          muted={false}
          playsInline
          onError={() => setHasError(true)}
        />
      ) : (
        // Errore caricamento
        <div className='flex h-full flex-col items-center justify-center px-3 py-6 text-center'>
          <IconVideo className='text-muted-foreground/50 mb-2 h-8 w-8' />
          <p className='text-muted-foreground text-xs'>Unable to load video</p>
          <p className='text-muted-foreground/70 mt-1 px-2 text-[10px] break-all'>
            {url}
          </p>
        </div>
      )}
      {title && (
        <div className='absolute right-0 bottom-0 left-0 z-20 truncate bg-black/60 px-2 py-1.5 text-center text-xs text-white pointer-events-none'>
          {title}
        </div>
      )}
    </div>
  );
}

interface MediaNodeContentProps {
  data: OSINTNodeData;
  openDetailDialog: () => void;
}

export function MediaNodeContent({ data, openDetailDialog }: MediaNodeContentProps) {
  // NOTE: This component is no longer used as image/video/audio types have been replaced
  // with the unified 'media_url' type handled by MediaUrlNodeContent.
  // Kept for reference/legacy purposes.
  return null;

  /* LEGACY CODE - Commented out
  if (data.type === 'image') {
    // Se non c'è URL, mostra placeholder e lascia che il doppio click del body entri in edit mode
    if (!data.label || (!data.label.startsWith('http') && !data.label.startsWith('data:'))) {
      return (
        <div className='flex h-full flex-col items-center justify-center px-3 py-6 text-center'>
          <IconPhoto className='text-muted-foreground/50 mb-2 h-8 w-8' />
          <p className='text-muted-foreground text-xs'>
            Double click to add image URL
          </p>
        </div>
      );
    }

    // Se c'è URL valido, mostra l'immagine
    return (
      <div className='relative h-full min-h-[80px]'>
        <img
          src={data.label}
          alt={String(data.metadata?.title || 'Image')}
          className='h-full w-full object-cover'
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
            (
              e.target as HTMLImageElement
            ).nextElementSibling?.classList.remove('hidden');
          }}
        />
        <div className='hidden flex h-full flex-col items-center justify-center px-3 py-6 text-center'>
          <IconPhoto className='text-muted-foreground/50 mb-2 h-8 w-8' />
          <p className='text-muted-foreground text-xs'>Failed to load image</p>
        </div>
        {typeof data.metadata?.title === 'string' &&
          data.metadata.title && (
            <div className='absolute right-0 bottom-0 left-0 truncate bg-black/60 px-2 py-1.5 text-center text-xs text-white'>
              {data.metadata.title}
            </div>
          )}
      </div>
    );
  }

  if (data.type === 'video') {
    // Se non c'è URL, mostra placeholder
    if (!data.label) {
      return (
        <div className='flex h-full min-h-[80px] flex-col items-center justify-center px-3 py-6 text-center'>
          <IconVideo className='text-muted-foreground/50 mb-2 h-8 w-8' />
          <p className='text-muted-foreground text-xs'>
            Double click to add video URL
          </p>
        </div>
      );
    }

    // Se c'è URL, mostra il video
    return (
      <VideoContent
        url={data.label}
        title={data.metadata?.title as string | undefined}
        onDoubleClick={openDetailDialog}
      />
    );
  }

  if (data.type === 'audio') {
    return (
      <div
        className='flex flex-col gap-2 p-3 w-full h-full justify-center items-center bg-muted/10 min-h-[100px] max-w-[300px]'
        onDoubleClick={(e) => {
            e.stopPropagation();
            openDetailDialog();
        }}
      >
        {data.label && data.label.startsWith('http') ? (
            <>
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary mb-1">
                    <IconMusic className="w-6 h-6" />
                </div>
                <AudioPlayer src={data.label} />
            </>
        ) : (
            <div className='flex h-full flex-col items-center justify-center px-3 text-center'>
                <IconMusic className='text-muted-foreground/50 mb-2 h-8 w-8' />
                <p className='text-muted-foreground text-xs'>
                    {data.label || 'Double click to add audio URL'}
                </p>
            </div>
        )}
      </div>
    );
  }

  return null;
  */
}
