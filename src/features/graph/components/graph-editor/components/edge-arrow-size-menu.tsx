'use client';

import { useState } from 'react';
import { ArrowRight, Check, ChevronRight } from 'lucide-react';
import { useGraphCanEdit } from '@/features/graph/contexts/graph-mutation-context';
import { EDGE_ARROW_SIZE_OPTIONS } from '../utils/edge-style';

export function EdgeArrowSizeMenu({
  scale,
  onChange,
  onClose
}: {
  scale?: number;
  onChange: (scale: number) => void;
  onClose: () => void;
}) {
  const canEdit = useGraphCanEdit();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className='relative'
      onMouseEnter={() => {
        if (canEdit()) setIsOpen(true);
      }}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement))
          setIsOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setIsOpen(false);
      }}
    >
      <button
        type='button'
        disabled={!canEdit()}
        aria-haspopup='menu'
        aria-expanded={isOpen && canEdit()}
        className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
        onClick={() => {
          if (canEdit()) setIsOpen(true);
        }}
      >
        <span className='flex items-center gap-2'>
          <ArrowRight className='size-4' />
          Arrow size
        </span>
        <ChevronRight className='size-4' />
      </button>
      {isOpen && canEdit() ? (
        <div
          role='menu'
          aria-label='Arrow size'
          className='bg-popover text-popover-foreground adaptive-context-submenu absolute top-0 left-full w-36 rounded-md border p-1 shadow-md'
        >
          {EDGE_ARROW_SIZE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type='button'
              role='menuitemradio'
              aria-checked={scale === option.value}
              disabled={!canEdit()}
              className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
              onClick={() => {
                if (!canEdit()) return;
                onChange(option.value);
                onClose();
              }}
            >
              {option.label}
              {scale === option.value ? <Check className='size-4' /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
