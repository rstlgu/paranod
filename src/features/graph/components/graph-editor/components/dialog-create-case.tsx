'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { XIcon as IconX } from '@/components/icons';
import { toast } from 'sonner';

interface CreateCaseDialogProps {
  open: boolean;
  defaultName?: string;
  onClose: () => void;
  onCreated: (created: { id: string; name: string }) => Promise<void> | void;
}

export function CreateCaseDialog(props: CreateCaseDialogProps) {
  const [name, setName] = useState(props.defaultName ?? '');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setName(props.defaultName ?? '');
    setDescription('');
  }, [props.open, props.defaultName]);

  if (!props.open) return null;

  async function submit() {
    const n = name.trim();
    if (!n) {
      toast.error('Name is required');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, description })
      });
      if (!res.ok) throw new Error('create_case_failed');
      const data = await res.json();
      const created = data.case as { id: string; name: string } | undefined;
      if (!created?.id) throw new Error('bad_response');
      toast.success('Case created');
      await props.onCreated(created);
      props.onClose();
    } catch {
      toast.error('Failed to create case');
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className='fixed inset-0 z-[100000] flex items-center justify-center p-4'>
      <div
        className='absolute inset-0 bg-black/50 backdrop-blur-sm'
        onClick={props.onClose}
      />
      <div className='bg-popover text-popover-foreground relative w-full max-w-lg rounded-2xl border shadow-xl'>
        <div className='flex items-start justify-between gap-4 border-b p-4'>
          <div className='min-w-0'>
            <div className='text-sm font-semibold'>New Case</div>
            <div className='text-muted-foreground mt-0.5 text-xs'>
              Create a case without leaving the graph.
            </div>
          </div>
          <button
            className='hover:bg-accent rounded-md p-2'
            onClick={props.onClose}
            aria-label='Close'
          >
            <IconX className='h-4 w-4' />
          </button>
        </div>

        <div className='space-y-3 p-4'>
          <div className='space-y-1.5'>
            <div className='text-xs font-semibold'>Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='Investigation case…'
              className='border-input bg-background h-10 w-full rounded-xl border px-3 text-sm'
            />
          </div>
          <div className='space-y-1.5'>
            <div className='text-xs font-semibold'>Description (optional)</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder='Context, hypothesis, notes…'
              className='border-input bg-background min-h-[96px] w-full resize-none rounded-xl border px-3 py-2 text-sm'
            />
          </div>
        </div>

        <div className='flex items-center justify-end gap-2 border-t p-4'>
          <button
            className='hover:bg-accent h-10 rounded-xl px-3 text-sm'
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            className='bg-primary text-primary-foreground hover:bg-primary/90 h-10 rounded-xl px-3 text-sm font-medium disabled:opacity-60'
            disabled={submitting}
            onClick={submit}
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
