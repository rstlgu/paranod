'use client';

/**
 * Flow test dialog — esegue il flow corrente con un input di prova e mostra
 * validazione + risultato per-step (stato, entità prodotte, errori, durata).
 * Nessuna scrittura sul grafo: solo dry-run reale delle transform.
 */

import {
  CheckCircleIcon as IconCheck,
  CircleNotchIcon as IconLoader2,
  PlayIcon as IconPlay,
  MinusCircleIcon as IconSkip,
  WarningIcon as IconWarning,
  XCircleIcon as IconX
} from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  executeFlow,
  getFlowTriggerTypes,
  validateFlow,
  type FlowRunResult,
  type FlowRunStep,
  type StoredFlowEdge,
  type StoredFlowNode
} from '@/features/flow/lib/execute-flow';
import {
  finishFlowRunRecord,
  startFlowRunRecord
} from '@/features/flow/lib/flow-run-recorder';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Edge, Node } from 'reactflow';

import type { FlowNodeData } from '@/features/flow/types';

function StepStatusIcon({ status }: { status: FlowRunStep['status'] }) {
  if (status === 'running')
    return <IconLoader2 className='h-4 w-4 animate-spin text-blue-500' />;
  if (status === 'completed')
    return <IconCheck className='h-4 w-4 text-emerald-500' />;
  if (status === 'failed') return <IconX className='h-4 w-4 text-red-500' />;
  if (status === 'skipped')
    return <IconSkip className='text-muted-foreground h-4 w-4' />;
  return <div className='bg-muted h-4 w-4 rounded-full' />;
}

export function FlowTestDialog({
  open,
  onOpenChange,
  nodes,
  edges,
  flowId
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  /** Se presente, il test viene registrato nella history (kind 'test'). */
  flowId?: string;
}) {
  const storedNodes = useMemo(
    () => nodes as unknown as StoredFlowNode[],
    [nodes]
  );
  const storedEdges = useMemo(
    () => edges as unknown as StoredFlowEdge[],
    [edges]
  );

  const issues = useMemo(
    () => validateFlow(storedNodes, storedEdges),
    [storedNodes, storedEdges]
  );
  const triggerTypes = useMemo(
    () => getFlowTriggerTypes(storedNodes),
    [storedNodes]
  );
  const hasErrors = issues.some((i) => i.level === 'error');

  const [triggerType, setTriggerType] = useState<string>('');
  const [value, setValue] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<FlowRunStep[]>([]);
  const [result, setResult] = useState<FlowRunResult | null>(null);

  useEffect(() => {
    if (open) {
      setTriggerType((prev) =>
        triggerTypes.includes(prev) ? prev : (triggerTypes[0] ?? '')
      );
      setSteps([]);
      setResult(null);
    }
  }, [open, triggerTypes]);

  const handleRun = useCallback(async () => {
    if (!triggerType || !value.trim() || isRunning) return;
    setIsRunning(true);
    setSteps([]);
    setResult(null);

    const runId = flowId
      ? await startFlowRunRecord({
          flowId,
          kind: 'test',
          inputType: triggerType,
          inputValue: value.trim()
        })
      : null;

    const res = await executeFlow({
      nodes: storedNodes,
      edges: storedEdges,
      input: {
        entityId: `flow-test-${Date.now()}`,
        entityType: triggerType,
        entityValue: value.trim()
      },
      onStep: () => {
        // Gli step sono mutati in-place dall'engine: forza il re-render.
        setSteps((prev) => [...prev]);
      }
    });

    if (flowId && runId) {
      void finishFlowRunRecord({
        flowId,
        runId,
        status: res.success ? 'COMPLETED' : 'FAILED',
        steps: res.steps,
        entityCount: res.entities.length,
        error: res.error
      });
    }

    setSteps(res.steps);
    setResult(res);
    setIsRunning(false);
  }, [triggerType, value, isRunning, storedNodes, storedEdges, flowId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[560px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <IconPlay className='h-5 w-5' />
            Test flow
          </DialogTitle>
          <DialogDescription>
            Runs the flow with a sample input. Transforms are executed for real;
            nothing is added to any graph.
          </DialogDescription>
          {null}
        </DialogHeader>

        {issues.length > 0 && (
          <div className='space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/30 dark:bg-amber-900/10'>
            {issues.map((issue, i) => (
              <div key={i} className='flex items-start gap-2 text-xs'>
                {issue.level === 'error' ? (
                  <IconX className='mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500' />
                ) : (
                  <IconWarning className='mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500' />
                )}
                <span className='text-amber-800 dark:text-amber-300'>
                  {issue.message}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className='flex items-end gap-2'>
          {triggerTypes.length > 1 ? (
            <div className='w-44 space-y-1'>
              <Label className='text-xs'>Trigger</Label>
              <Select value={triggerType} onValueChange={setTriggerType}>
                <SelectTrigger className='h-9'>
                  <SelectValue placeholder='Trigger type' />
                </SelectTrigger>
                <SelectContent>
                  {triggerTypes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className='flex-1 space-y-1'>
            <Label className='text-xs'>
              Test input{' '}
              {triggerTypes.length === 1 ? (
                <Badge variant='secondary' className='ml-1 text-[10px]'>
                  {triggerTypes[0]}
                </Badge>
              ) : null}
            </Label>
            <Input
              placeholder={
                triggerType ? `Enter a ${triggerType} value…` : 'Value…'
              }
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRun();
              }}
              disabled={isRunning}
            />
          </div>
          <Button
            onClick={() => void handleRun()}
            disabled={hasErrors || isRunning || !value.trim() || !triggerType}
            className='gap-1.5'
          >
            {isRunning ? (
              <IconLoader2 className='h-4 w-4 animate-spin' />
            ) : (
              <IconPlay className='h-4 w-4' />
            )}
            Run
          </Button>
        </div>

        {(steps.length > 0 || result) && (
          <ScrollArea className='max-h-[320px]'>
            <div className='space-y-1.5 pr-3'>
              {steps.map((step) => (
                <div
                  key={step.nodeId}
                  className={cn(
                    'rounded-lg border p-2.5',
                    step.status === 'failed' &&
                      'border-red-200 bg-red-50/50 dark:border-red-900/30 dark:bg-red-900/10'
                  )}
                >
                  <div className='flex items-center gap-2'>
                    <StepStatusIcon status={step.status} />
                    <span className='min-w-0 flex-1 truncate text-sm font-medium'>
                      {step.name}
                    </span>
                    {step.status === 'completed' && (
                      <Badge variant='secondary' className='text-[10px]'>
                        {step.entities.length}{' '}
                        {step.entities.length === 1 ? 'entity' : 'entities'}
                      </Badge>
                    )}

                    {step.durationMs > 0 && (
                      <span className='text-muted-foreground text-[10px]'>
                        {(step.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                  {step.error && (
                    <p className='text-muted-foreground mt-1 pl-6 text-xs'>
                      {step.error}
                    </p>
                  )}
                  {step.entities.length > 0 && (
                    <div className='mt-1.5 flex flex-wrap gap-1 pl-6'>
                      {step.entities.slice(0, 8).map((e) => (
                        <Badge
                          key={e.id}
                          variant='outline'
                          className='max-w-[180px] truncate text-[10px]'
                          title={`${e.type}: ${e.value}`}
                        >
                          {e.value}
                        </Badge>
                      ))}
                      {step.entities.length > 8 && (
                        <span className='text-muted-foreground text-[10px]'>
                          +{step.entities.length - 8} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {result && (
                <div
                  className={cn(
                    'mt-2 flex items-center gap-2 rounded-lg border p-2.5 text-sm',
                    result.success
                      ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/30 dark:bg-emerald-900/10'
                      : 'border-red-200 bg-red-50/50 dark:border-red-900/30 dark:bg-red-900/10'
                  )}
                >
                  {result.success ? (
                    <IconCheck className='h-4 w-4 text-emerald-500' />
                  ) : (
                    <IconX className='h-4 w-4 text-red-500' />
                  )}
                  <span className='flex-1'>
                    {result.success
                      ? `Flow completed: ${result.entities.length} unique entities.`
                      : result.error || 'Flow failed.'}
                  </span>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
