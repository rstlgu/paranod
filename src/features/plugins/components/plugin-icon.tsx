'use client';

import Image from 'next/image';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { getBuiltInPluginStyle } from '../utils/plugin-style';

interface PluginIconProps {
  inputTypes: string[];
  icon?: string;
  logoUrl?: string;
  size: number;
  iconClassName: string;
}

/** Plugin names are rendered beside this decorative icon. */
export function PluginIcon({
  inputTypes,
  icon,
  logoUrl,
  size,
  iconClassName
}: PluginIconProps) {
  const { Icon } = getBuiltInPluginStyle(inputTypes, icon);
  const [loadedLogoUrl, setLoadedLogoUrl] = useState<string | null>(null);
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const showLogo = Boolean(
    logoUrl && loadedLogoUrl === logoUrl && failedLogoUrl !== logoUrl
  );

  return (
    <span
      aria-hidden='true'
      className='relative flex shrink-0 items-center justify-center'
      style={{ width: size, height: size }}
    >
      {showLogo ? null : <Icon className={iconClassName} />}
      {logoUrl && failedLogoUrl !== logoUrl ? (
        <Image
          src={logoUrl}
          alt=''
          width={size}
          height={size}
          className={cn(
            'absolute inset-0 rounded-md object-contain',
            showLogo ? 'opacity-100' : 'opacity-0'
          )}
          onLoad={() => setLoadedLogoUrl(logoUrl)}
          onError={() => setFailedLogoUrl(logoUrl)}
          unoptimized
        />
      ) : null}
    </span>
  );
}
