'use client';

import { useState, type ComponentType } from 'react';
import Image from 'next/image';

import { cn } from '@/lib/utils';

interface LogoOrIconProps {
  label: string;
  logoUrl?: string;
  Icon: ComponentType<{ className?: string }>;
  sizePx: number;
  className?: string;
  iconClassName?: string;
}

export function LogoOrIcon(props: LogoOrIconProps) {
  const [hasLogoError, setHasLogoError] = useState(false);
  const shouldShowLogo = Boolean(props.logoUrl) && !hasLogoError;
  const isInternalLogoEndpoint =
    typeof props.logoUrl === 'string' && props.logoUrl.startsWith('/api/logo');

  return (
    <span className={cn('relative block', props.className)}>
      <span className='flex h-full w-full items-center justify-center overflow-hidden rounded-md'>
        {!shouldShowLogo ? (
          <props.Icon
            className={cn('h-full w-full', props.iconClassName ?? 'text-foreground')}
          />
        ) : isInternalLogoEndpoint ? (
          <img
            src={props.logoUrl!}
            alt={props.label}
            width={props.sizePx}
            height={props.sizePx}
            loading='lazy'
            decoding='async'
            className='h-full w-full rounded-md object-contain'
            onError={() => setHasLogoError(true)}
          />
        ) : (
          <Image
            src={props.logoUrl!}
            alt={props.label}
            fill
            sizes={`${props.sizePx}px`}
            className='rounded-md object-contain'
            onError={() => setHasLogoError(true)}
          />
        )}
      </span>
    </span>
  );
}
