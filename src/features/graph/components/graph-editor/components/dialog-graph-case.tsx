'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon as IconCheck, XIcon as IconX } from '@/components/icons';
import { toast } from 'sonner';

interface GraphCaseDialogProps {
  open: boolean;
  graphId?: string;
  mode: 'add' | 'remove';
  onClose: () => void;
}

export function GraphCaseDialog(props: GraphCaseDialogProps) {
  const [cases, setCases] = useState<Array<{ id: string; name: string }>>([]);
  const [search, setSearch] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setLoading(true);
    setSelectedCaseId('');
    setSearch('');
    fetch('/api/cases')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) =>
        setCases((d.cases ?? []).map((c: any) => ({ id: c.id, name: c.name })))
      )
      .catch(() => toast.error('Failed to load cases'))
      .finally(() => setLoading(false));
  }, [props.open]);

  const filteredCases = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cases;
    return cases.filter((c) => c.name.toLowerCase().includes(q));
  }, [cases, search]);

  const submit = useCallback(async () => {
    if (!props.graphId) {
      toast.error('Missing graphId');
      return;
    }
    if (!selectedCaseId) {
      toast.error('Select a case');
      return;
    }

    setSubmitting(true);
    try {
      if (props.mode === 'add') {
        const res = await fetch(`/api/cases/${selectedCaseId}/graphs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graphId: props.graphId })
        });
        if (!res.ok) throw new Error('add_failed');
        toast.success('Graph added to case');
      } else {
        const res = await fetch(
          `/api/cases/${selectedCaseId}/graphs/${props.graphId}`,
          { method: 'DELETE' }
        );
        if (!res.ok) throw new Error('remove_failed');
        toast.success('Graph removed from case');
      }

      props.onClose();
    } catch {
      toast.error(
        props.mode === 'add' ? 'Failed to add graph' : 'Failed to remove graph'
      );
    } finally {
      setSubmitting(false);
    }
  }, [props.graphId, props.mode, props.onClose, selectedCaseId]);

  if (!props.open) return null;

  return createPortal(
    <div className='fixed inset-0 z-[100000] flex items-center justify-center p-4'>
      <div
        className='absolute inset-0 bg-black/50 backdrop-blur-sm'
        onClick={props.onClose}
      />
      <div className='bg-popover text-popover-foreground relative w-full max-w-lg rounded-2xl border shadow-xl'>
        <div className='flex items-start justify-between gap-4 border-b p-4'>
          <div className='min-w-0'>
            <div className='text-sm font-semibold'>
              {props.mode === 'add'
                ? 'Add graph to Case'
                : 'Remove graph from Case'}
            </div>
            <div className='text-muted-foreground mt-0.5 text-xs'>
              Select a case to {props.mode}.
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
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder='Search cases…'
            className='border-input bg-background h-10 w-full rounded-xl border px-3 text-sm'
          />
          <div className='max-h-64 overflow-auto rounded-xl border'>
            {loading ? (
              <div className='text-muted-foreground p-3 text-sm'>Loading…</div>
            ) : filteredCases.length === 0 ? (
              <div className='text-muted-foreground p-3 text-sm'>No cases found.</div>
            ) : (
              filteredCases.map((c) => (
                <button
                  key={c.id}
                  className={`hover:bg-accent flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                    selectedCaseId === c.id ? 'bg-accent' : ''
                  }`}
                  onClick={() => setSelectedCaseId(c.id)}
                >
                  <span className='truncate'>{c.name}</span>
                  {selectedCaseId === c.id ? (
                    <IconCheck className='h-4 w-4' />
                  ) : null}
                </button>
              ))
            )}
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
            disabled={submitting || !selectedCaseId}
            onClick={submit}
          >
            {submitting
              ? props.mode === 'add'
                ? 'Adding…'
                : 'Removing…'
              : props.mode === 'add'
                ? 'Add'
                : 'Remove'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
