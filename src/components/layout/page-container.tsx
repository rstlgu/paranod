import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export default function PageContainer({
  children,
  scrollable = true,
  containerClassName
}: {
  children: React.ReactNode;
  scrollable?: boolean;
  containerClassName?: string;
}) {
  return (
    <>
      {scrollable ? (
        <ScrollArea className='h-[calc(100dvh-52px)]'>
          <div
            className={cn(
              'mx-auto w-full max-w-7xl flex-1 px-4 pb-4 pt-6 md:px-6 md:pt-7',
              containerClassName
            )}
          >
            {children}
          </div>
        </ScrollArea>
      ) : (
        <div
          className={cn(
            'mx-auto w-full max-w-7xl flex-1 px-4 pb-4 pt-6 md:px-6 md:pt-7',
            containerClassName
          )}
        >
          {children}
        </div>
      )}
    </>
  );
}
