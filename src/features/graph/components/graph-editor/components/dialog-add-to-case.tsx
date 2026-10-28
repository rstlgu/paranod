'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon as IconCheck, XIcon as IconX } from '@/components/icons';
import { toast } from 'sonner';
import type { Node as FlowNode } from 'reactflow';

import type { OSINTNodeData } from '../../../types';

interface AddToCaseDialogProps {
  open: boolean;
  graphId?: string;
  nodes: FlowNode[];
  onClose: () => void;
}

export function AddToCaseDialog(props: AddToCaseDialogProps) {
  const [cases, setCases] = useState<Array<{ id: string; name: string }>>([]);
  const [targets, setTargets] = useState<
    Array<{
      id: string;
      name: string | null;
      entity: { type: string; value: string; label: string | null };
    }>
  >([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>('');
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setLoading(true);
    setSelectedCaseId('');
    setSelectedTargetId('');
    setTargets([]);
    setSearch('');
    fetch('/api/cases')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) =>
        setCases((d.cases ?? []).map((c: any) => ({ id: c.id, name: c.name })))
      )
      .catch(() => toast.error('Failed to load cases'))
      .finally(() => setLoading(false));
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    if (!selectedCaseId) return;
    setTargets([]);
    setSelectedTargetId('');
    fetch(`/api/cases/${selectedCaseId}/targets`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setTargets(d.targets ?? []))
      .catch(() => toast.error('Failed to load targets'));
  }, [props.open, selectedCaseId]);

  const filteredCases = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cases;
    return cases.filter((c) => c.name.toLowerCase().includes(q));
  }, [cases, search]);

  const submit = useCallback(async () => {
    if (!props.nodes.length) return;
    if (!selectedCaseId) {
      toast.error('Select a case');
      return;
    }

    setSubmitting(true);
    try {
      for (const node of props.nodes) {
        const data = node.data as OSINTNodeData | undefined;
        if (!data?.type || typeof data.label !== 'string') continue;

        const res = await fetch(`/api/cases/${selectedCaseId}/entities/pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: data.type,
            value: String(data.label ?? '').trim(),
            label:
              typeof data.metadata?.customTitle === 'string'
                ? data.metadata.customTitle
                : undefined,
            metadata: data.metadata ?? {},
            targetIds: selectedTargetId ? [selectedTargetId] : [],
            source: {
              kind: 'graph_node',
              graphId: props.graphId ?? null,
              graphNodeId: node.id
            }
          })
        });
        if (!res.ok) throw new Error('pin_failed');
      }

      toast.success('Added to case');
      props.onClose();
    } catch {
      toast.error('Failed to add to case');
    } finally {
      setSubmitting(false);
    }
  }, [props.graphId, props.nodes, props.onClose, selectedCaseId, selectedTargetId]);

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
            <div className='text-sm font-semibold'>Add to Case</div>
            <div className='text-muted-foreground mt-0.5 text-xs'>
              Pin {props.nodes.length} node(s) into a case (metadata included).
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

        <div className='space-y-4 p-4'>
          <div className='space-y-2'>
            <div className='text-xs font-semibold'>Select Case</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Search cases…'
              className='border-input bg-background h-10 w-full rounded-xl border px-3 text-sm'
            />
            <div className='max-h-48 overflow-auto rounded-xl border'>
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

          {selectedCaseId ? (
            <div className='space-y-2'>
              <div className='text-xs font-semibold'>Associate to Target (optional)</div>
              <div className='max-h-40 overflow-auto rounded-xl border'>
                <button
                  className={`hover:bg-accent flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                    selectedTargetId === '' ? 'bg-accent' : ''
                  }`}
                  onClick={() => setSelectedTargetId('')}
                >
                  <span>None</span>
                  {selectedTargetId === '' ? (
                    <IconCheck className='h-4 w-4' />
                  ) : null}
                </button>
                {targets.map((t) => (
                  <button
                    key={t.id}
                    className={`hover:bg-accent flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                      selectedTargetId === t.id ? 'bg-accent' : ''
                    }`}
                    onClick={() => setSelectedTargetId(t.id)}
                  >
                    <span className='truncate'>
                      {t.name || t.entity.label || t.entity.value} ({t.entity.type})
                    </span>
                    {selectedTargetId === t.id ? (
                      <IconCheck className='h-4 w-4' />
                    ) : null}
                  </button>
                ))}
              </div>
              <div className='text-muted-foreground text-xs'>
                If the case has exactly 1 target, we’ll auto-associate even if you pick “None”.
              </div>
            </div>
          ) : null}
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
            {submitting ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
