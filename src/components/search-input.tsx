'use client';
import { useKBar } from 'kbar';
import { Search } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export default function SearchInput() {
  const { query } = useKBar();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='h-8 w-8 rounded-full'
          onClick={query.toggle}
          aria-label='Search (⌘K)'
        >
          <Search className='h-4 w-4' />
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={8}>
        <div className='flex items-center gap-2'>
          <span>Search</span>
          <kbd className='bg-muted text-muted-foreground inline-flex h-5 items-center rounded border px-1.5 font-mono text-[10px] font-medium'>
            ⌘K
          </kbd>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
