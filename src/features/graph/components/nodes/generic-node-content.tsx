import React, { RefObject, MutableRefObject } from 'react';
import { Markdown } from '@/components/markdown/markdown';
import { LinkableText } from '../linkable-text';
import { Input } from '@/components/ui/input';
import { OSINTNodeData } from '../../types';
import { getNodeDisplayLabel } from '../../utils';

interface GenericNodeContentProps {
  data: OSINTNodeData;
  isEditing: boolean;
  editLabel: string;
  setEditLabel: (label: string) => void;
  handleSaveLabel: () => void;
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  setIsEditing: (editing: boolean) => void;
  isScrollActive: boolean;
  setIsScrollActive: (active: boolean) => void;
  clickTimeoutRef: MutableRefObject<NodeJS.Timeout | null>;
}

export function GenericNodeContent({
  data,
  isEditing,
  editLabel,
  setEditLabel,
  handleSaveLabel,
  inputRef,
  setIsEditing,
  isScrollActive,
  setIsScrollActive,
  clickTimeoutRef
}: GenericNodeContentProps) {
  const displayLabel = getNodeDisplayLabel({
    type: data.type as any,
    label: data.label,
    metadata: data.metadata
  });

  function getDisplayLines(text: string) {
    return String(text ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  // Note / AI Insight (Scrollable Markdown)
  if (data.type === 'note' || data.type === 'ai_insight') {
    return (
      <>
        {isEditing ? (
          <textarea
            ref={inputRef as RefObject<HTMLTextAreaElement>}
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            onBlur={handleSaveLabel}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditLabel(data.label);
                setIsEditing(false);
              }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                handleSaveLabel();
              }
            }}
            className='nodrag nopan h-full w-full resize-none border-0 bg-transparent p-1 text-sm font-medium outline-none focus:ring-0'
            placeholder={
              data.type === 'note'
                ? 'Enter note... (Ctrl+Enter to save)'
                : 'Enter AI insight... (Ctrl+Enter to save)'
            }
          />
        ) : (
          <div className='text-foreground text-sm'>
            <Markdown value={data.label || ''} className='space-y-2' />
          </div>
        )}

        {/* Overlay per attivare lo scroll */}
        {!isScrollActive && !isEditing && (
          <div
            className='absolute inset-0 z-10 cursor-pointer'
            onClick={(e) => {
              e.stopPropagation();
              if (clickTimeoutRef.current) {
                clearTimeout(clickTimeoutRef.current);
                clickTimeoutRef.current = null;
                // Doppio click: entra in edit mode
                setIsEditing(true);
                setTimeout(() => {
                  inputRef.current?.focus();
                  if (inputRef.current instanceof HTMLInputElement) {
                    (inputRef.current as HTMLInputElement).select();
                  } else if (inputRef.current instanceof HTMLTextAreaElement) {
                    (inputRef.current as HTMLTextAreaElement).select();
                  }
                }, 0);
              } else {
                // Singolo click: attiva scroll
                clickTimeoutRef.current = setTimeout(() => {
                  setIsScrollActive(true);
                  clickTimeoutRef.current = null;
                }, 250);
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (clickTimeoutRef.current) {
                clearTimeout(clickTimeoutRef.current);
                clickTimeoutRef.current = null;
              }
              // Doppio click: entra in edit mode
              setIsEditing(true);
              setTimeout(() => {
                inputRef.current?.focus();
                if (inputRef.current instanceof HTMLInputElement) {
                  (inputRef.current as HTMLInputElement).select();
                } else if (inputRef.current instanceof HTMLTextAreaElement) {
                  (inputRef.current as HTMLTextAreaElement).select();
                }
              }, 0);
            }}
          />
        )}
      </>
    );
  }

  // Generic Node (Editable Input or Text List)
  if (isEditing) {
    return (
      <Input
        ref={inputRef as RefObject<HTMLInputElement>}
        value={editLabel}
        onChange={(e) => setEditLabel(e.target.value)}
        onBlur={handleSaveLabel}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSaveLabel();
          if (e.key === 'Escape') {
            setEditLabel(data.label);
            setIsEditing(false);
          }
        }}
        className='nodrag nopan h-auto p-1 text-sm font-medium'
        placeholder='Enter label...'
        onCopy={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <div
      className='-mx-1 min-w-0 cursor-text rounded px-1 text-sm font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5'
      title={data.type === 'url' ? data.label : 'Double click to edit'}
      onCopy={(e) => e.stopPropagation()}
    >
      {data.type === 'url' ? (
        <LinkableText
          text={data.label}
          truncate
          maxLength={35}
          className='block min-w-0 truncate whitespace-nowrap'
          onlyUrlsAndDomains
        />
      ) : data.type === 'transaction' || data.type === 'wallet' || data.type.startsWith('wallet_') ? (
        <span className='line-clamp-4 font-mono break-all'>
          {String(displayLabel ?? '')}
        </span>
      ) : (
        (() => {
          const lines = getDisplayLines(displayLabel || data.label);
          const maxLines = 3;
          const shown = lines.slice(0, maxLines);
          const hasMore = lines.length > maxLines;

          return (
            <>
              {shown.map((line, i) => (
                <div
                  key={`${i}-${line}`}
                  className={
                    i > 0
                      ? 'text-muted-foreground mt-1 min-w-0 truncate text-xs'
                      : 'min-w-0 truncate'
                  }
                  title={line}
                >
                  <LinkableText
                    text={line}
                    truncate
                    maxLength={80}
                    className='break-all'
                    onlyUrlsAndDomains
                  />
                </div>
              ))}
              {hasMore ? (
                <div className='text-muted-foreground mt-1 text-xs'>…</div>
              ) : null}
            </>
          );
        })()
      )}
    </div>
  );
}
