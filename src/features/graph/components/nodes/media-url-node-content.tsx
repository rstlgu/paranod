import React, { useState, useMemo, useRef } from 'react';
import {
  ImageIcon as IconPhoto,
  VideoCameraIcon as IconVideo,
  MusicNotesIcon as IconMusic,
  PlayIcon as IconPlayerPlay,
  PauseIcon as IconPlayerPause
} from '@/components/icons';
import { OSINTNodeData } from '../../types';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { getMediaSource, isImageNode } from '../graph-editor/utils/image-node';
import { MediaSourceEditor } from './media-source-editor';

// Helper per rilevare il tipo di media dall'URL
function detectMediaType(url: string): 'image' | 'video' | 'audio' | 'unknown' {
  if (!url) return 'unknown';

  const urlLower = url.toLowerCase();

  // Image extensions
  if (urlLower.match(/\.(jpg|jpeg|png|gif|webp|avif|svg|bmp)([?#].*)?$/i)) {
    return 'image';
  }

  // Video platforms
  if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be') ||
      urlLower.includes('vimeo.com') || urlLower.match(/\.(mp4|webm|ogg|mov)(\?.*)?$/i)) {
    return 'video';
  }

  // Audio extensions
  if (urlLower.match(/\.(mp3|wav|ogg|flac|m4a)(\?.*)?$/i)) {
    return 'audio';
  }

  // Check if it's a data URL
  if (url.startsWith('data:image/')) return 'image';
  if (url.startsWith('data:video/')) return 'video';
  if (url.startsWith('data:audio/')) return 'audio';

  return 'unknown';
}

// Helper per parsare URL video e ottenere embed URL
function getVideoEmbedInfo(url: string): {
  type: 'youtube' | 'vimeo' | 'direct' | 'invalid';
  embedUrl: string | null;
} {
  if (!url) return { type: 'invalid', embedUrl: null };

  const youtubeMatch = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  if (youtubeMatch) {
    return {
      type: 'youtube',
      embedUrl: `https://www.youtube.com/embed/${youtubeMatch[1]}`
    };
  }

  const vimeoMatch = url.match(/(?:vimeo\.com\/)(\d+)/);
  if (vimeoMatch) {
    return {
      type: 'vimeo',
      embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}`
    };
  }

  if (url.match(/\.(mp4|webm|ogg|mov)(\?.*)?$/i) || url.includes('blob:')) {
    return { type: 'direct', embedUrl: url };
  }

  if (url.startsWith('http')) {
    return { type: 'direct', embedUrl: url };
  }

  return { type: 'invalid', embedUrl: null };
}

// Audio Player Component
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

// Video Component
function VideoContent({ url, title }: { url: string; title?: string }) {
  const videoInfo = useMemo(() => getVideoEmbedInfo(url), [url]);
  const [hasError, setHasError] = useState(false);

  if (!url || videoInfo.type === 'invalid') {
    return null;
  }

  return (
    <div
      className='nodrag nopan relative flex-1'
      style={{ height: '100%', minHeight: 120 }}
    >
      {videoInfo.type === 'youtube' || videoInfo.type === 'vimeo' ? (
        <div className="relative w-full h-full">
           <iframe
             src={videoInfo.embedUrl!}
             className='h-full w-full pointer-events-auto'
             allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
             allowFullScreen
             title={title || 'Video'}
           />
        </div>
      ) : !hasError ? (
        <video
          src={videoInfo.embedUrl!}
          className='h-full w-full bg-black object-contain pointer-events-auto'
          controls
          muted={false}
          playsInline
          onError={() => setHasError(true)}
        />
      ) : (
        <div className='flex h-full flex-col items-center justify-center px-3 py-6 text-center'>
          <IconVideo className='text-muted-foreground/50 mb-2 h-8 w-8' />
          <p className='text-muted-foreground text-xs'>Unable to load video</p>
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

interface MediaUrlNodeContentProps {
  id: string;
  data: OSINTNodeData;
  editing: boolean;
  editable: boolean;
  onEdit: () => void;
  onDone: () => void;
}

function ImagePreview({ source, title, onEdit, editable }: {
  source: string; title: string; onEdit: () => void; editable: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return <div className='relative h-full min-h-[80px]' onDoubleClick={editable ? (event) => {
    event.stopPropagation();
    onEdit();
  } : undefined}>
    {failed ? <div className='flex h-full flex-col items-center justify-center gap-2 p-3 text-center'>
      <IconPhoto className='text-muted-foreground h-8 w-8' />
      <p className='text-muted-foreground text-xs'>Unable to load image. Check the URL or access permissions.</p>
      {editable && <Button className='nodrag nopan' size='sm' variant='outline' onClick={onEdit}>Change image</Button>}
    </div> : <img src={source} alt={title || 'Image'} draggable={false}
      className='h-full w-full object-contain' onError={() => setFailed(true)} />}
    {title && !failed && <div className='pointer-events-none absolute right-0 bottom-0 left-0 truncate bg-black/60 px-2 py-1.5 text-center text-xs text-white'>{title}</div>}
  </div>;
}

export function MediaUrlNodeContent({ id, data, editing, editable, onEdit, onDone }: MediaUrlNodeContentProps) {
  const source = getMediaSource(data);
  const mediaType = isImageNode(data) ? 'image' : detectMediaType(source);

  if (data.metadata?._uploading) return <div role='status' className='flex h-full items-center justify-center p-4 text-xs'>Uploading image…</div>;
  if (editable && (editing || !source || mediaType === 'unknown')) {
    return <MediaSourceEditor key={source} id={id} source={source} onDone={onDone} detectType={detectMediaType} />;
  }

  // Render based on detected media type
  if (mediaType === 'image') {
    return (
      <ImagePreview key={source} source={source} title={String(data.metadata?.title || '')} onEdit={onEdit} editable={editable} />
    );
  }

  if (mediaType === 'video') {
    return (
      <VideoContent
        url={source}
        title={data.metadata?.title as string | undefined}
      />
    );
  }

  if (mediaType === 'audio') {
    return (
      <div className='flex flex-col gap-2 p-3 w-full h-full justify-center items-center bg-muted/10 min-h-[100px] max-w-[300px]'>
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary mb-1">
          <IconMusic className="w-6 h-6" />
        </div>
        <AudioPlayer src={source} />
      </div>
    );
  }

  // Unknown or no URL yet - show as simple node (will be handled by generic node content)
  return null;
}
