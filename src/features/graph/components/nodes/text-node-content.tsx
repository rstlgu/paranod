import React, { RefObject } from 'react';
import { OSINTNodeData } from '../../types';

interface TextNodeContentProps {
  data: OSINTNodeData;
  isEditing: boolean;
  editLabel: string;
  setEditLabel: (label: string) => void;
  handleSaveLabel: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  setIsEditing: (editing: boolean) => void;
}

export function TextNodeContent({
  data,
  isEditing,
  editLabel,
  setEditLabel,
  handleSaveLabel,
  inputRef,
  setIsEditing
}: TextNodeContentProps) {
  return (
    <div
      className='nodrag nopan flex h-full w-full items-center justify-center'
      onDoubleClick={(e) => {
        e.stopPropagation();
        setIsEditing(true);
        setTimeout(() => {
          inputRef.current?.focus();
          if (inputRef.current instanceof HTMLTextAreaElement) {
            inputRef.current.select();
          }
        }, 50);
      }}
      onCopy={(e) => e.stopPropagation()}
      style={{
        transform: `rotate(${(data.metadata?.rotation as number) || 0}deg)`,
        color:
          (data.metadata?.textColor as string) ||
          (data.metadata?.customColor as string) ||
          '#64748b',
        fontSize: `${(data.metadata?.fontSize as number) || 16}px`,
        fontWeight:
          (data.metadata?.fontWeight as string) || '500',
        textAlign:
          (data.metadata?.textAlign as
            | 'left'
            | 'center'
            | 'right') || 'center',
        lineHeight: '1.2',
        background: 'transparent'
      }}
    >
      {isEditing ? (
        <textarea
          ref={inputRef}
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
          className='nodrag nopan h-full w-full resize-none border-0 bg-transparent text-center outline-none focus:ring-0'
          style={{
            color: 'inherit',
            fontSize: 'inherit',
            fontWeight: 'inherit',
            lineHeight: 'inherit'
          }}
          placeholder='Text...'
          autoFocus
        />
      ) : (
        <div className='w-full cursor-text px-2 text-center break-words whitespace-pre-wrap'>
          {data.label || 'Text'}
        </div>
      )}
    </div>
  );
}
