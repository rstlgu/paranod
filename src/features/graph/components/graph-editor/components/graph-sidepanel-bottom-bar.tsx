'use client';

import { cn } from '@/lib/utils';

export function GraphSidepanelBottomBar(props: { className?: string; children?: React.ReactNode }) {
  // IMPORTANT: Tailwind preflight uses box-border. If we put `border-t` on the same element with `h-8`,
  // the border consumes part of the 32px and looks shorter than the app bottom dock header (which has border outside).
  return (
    <div className={cn('shrink-0 border-t border-border/25 bg-background dark:border-white/8', props.className)}>
      <div className='flex h-8 items-center px-2'>{props.children}</div>
    </div>
  );
}
