'use client';

import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';

interface CircularProgressProps {
  progress: number; // 0-100
  size?: number;
  strokeWidth?: number;
  className?: string;
  message?: string;
  showPercentage?: boolean;
}

export function CircularProgress({
  progress,
  size = 32,
  strokeWidth = 3,
  className,
  message,
  showPercentage = false
}: CircularProgressProps) {
  const center = size / 2;
  const radius = center - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  const progressComponent = (
    <div
      className={cn(
        'relative inline-flex items-center justify-center',
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className='-rotate-90 transform'
      >
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke='currentColor'
          strokeWidth={strokeWidth}
          fill='none'
          className='text-zinc-200 dark:text-zinc-700'
        />
        {/* Progress circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke='currentColor'
          strokeWidth={strokeWidth}
          fill='none'
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap='round'
          className='text-blue-500 transition-all duration-300 ease-out dark:text-blue-400'
        />
      </svg>
      {/* Progress text - optional */}
      {showPercentage && (
        <span className='absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-zinc-700 dark:text-zinc-300'>
          {Math.round(progress)}%
        </span>
      )}
    </div>
  );

  if (message) {
    return (
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>{progressComponent}</TooltipTrigger>
          <TooltipContent side='top' className='max-w-xs'>
            <p className='text-xs'>{message}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return progressComponent;
}
