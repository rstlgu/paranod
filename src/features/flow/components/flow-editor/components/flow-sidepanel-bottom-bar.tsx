'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function FlowSidepanelBottomBar(props: { className?: string; children?: ReactNode }) {
  return (
    <div className={cn('shrink-0 border-t border-border/25 bg-background dark:border-white/8', props.className)}>
      <div className='flex h-8 items-center px-2'>{props.children}</div>
    </div>
  );
}
