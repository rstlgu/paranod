'use client';

import {
  CaretRightIcon as IconChevronRight,
  CopyIcon as IconCopy,
  EyeIcon as IconEye,
  EyeSlashIcon as IconEyeOff,
  ArrowsSplitIcon as IconFlow,
  FolderOpenIcon as IconFolderOpen,
  StackIcon as IconMerge,
  PaletteIcon as IconPalette,
  PenIcon as IconPencil,
  PlusIcon as IconPlus,
  MagnifyingGlassIcon as IconSearch,
  TagIcon as IconTag,
  LightningIcon as IconTransform,
  TrashIcon as IconTrash
} from '@/components/icons';
import { useAdaptiveContextMenu } from '@/components/ui/adaptive-context-menu';
import { useGraphCanEdit } from '@/features/graph/contexts/graph-mutation-context';
import { cn } from '@/lib/utils';
import * as React from 'react';
import { createPortal } from 'react-dom';
import type { Node as FlowNode } from 'reactflow';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  fetchFlowDefinition,
  useFlows,
  type FlowSummary
} from '@/features/flow/hooks/use-flows';
import {
  executeFlow,
  type StoredFlowEdge,
  type StoredFlowNode
} from '@/features/flow/lib/execute-flow';
import {
  finishFlowRunRecord,
  startFlowRunRecord
} from '@/features/flow/lib/flow-run-recorder';
import { useEnabledPluginsContext } from '@/features/graph/contexts/enabled-plugins-context';
import { useTransformLogger } from '@/features/graph/contexts/transform-logger-context';
import {
  getGroupedPaletteItems,
  nodeTypeByType
} from '@/features/osint/node-registry';
import { getPhosphorIconByKey } from '@/features/osint/phosphor-icon-by-key';
import {
  createTransformInput,
  executeTransform,
  getTransformsForEntityType,
  matchesInputType,
  type EntityType,
  type PluginDefinition,
  type TransformDefinition
} from '@/features/plugins';
import { toast } from 'sonner';
import { LogoOrIcon } from './logo-or-icon';

const groupedNodeTypes = getGroupedPaletteItems();

const colorOptions: Array<{ name: string; value: string | null }> = [
  { name: 'Default', value: null },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Pink', value: '#ec4899' }
];

export interface NodeContextMenuAddToCaseApi {
  recentCases: Array<{ id: string; name: string }>;
  refreshRecentCases: () => void;
  addNodesToCase: (args: { caseId: string; nodes: FlowNode[] }) => void;
  openAllCasesDialog: (nodes: FlowNode[]) => void;
  openNewCaseDialog: (nodes: FlowNode[]) => void;
}

export interface NodeContextMenuProps {
  position: { x: number; y: number };
  graphViewMode: 'free' | 'locked' | 'analysis' | 'map';

  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  nodeMetadata?: Record<string, unknown> | null;
  sourcePosition: { x: number; y: number };

  onClose: () => void;

  getSelectedNodes?: () => FlowNode[];
  addToCase?: NodeContextMenuAddToCaseApi | null;

  onOpenNode?: () => void;
  onEditLabel?: () => void;
  onToggleHeader?: () => void;
  headerHidden?: boolean;
  onRename?: () => void;
  onDuplicate?: () => void;
  onChangeType: (type: string) => void;
  onChangeColor?: (colorHex: string | null) => void;
  canUnmerge?: boolean;
  onUnmerge?: () => void;
  onDelete: () => void;
}

export function NodeContextMenu(props: NodeContextMenuProps) {
  const canEdit = useGraphCanEdit();
  const readOnly = !canEdit();
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [showAddToCaseSubmenu, setShowAddToCaseSubmenu] = React.useState(false);
  const [showTypeSubmenu, setShowTypeSubmenu] = React.useState(false);
  const [showColorSubmenu, setShowColorSubmenu] = React.useState(false);
  const [showTransformsSubmenu, setShowTransformsSubmenu] =
    React.useState(false);
  const [showFlowsSubmenu, setShowFlowsSubmenu] = React.useState(false);
  const [activeCategory, setActiveCategory] = React.useState<string | null>(
    null
  );
  const [activeSocialPlatform, setActiveSocialPlatform] = React.useState<
    string | null
  >(null);
  const [activeTransformPluginId, setActiveTransformPluginId] = React.useState<
    string | null
  >(null);
  const submenuTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const categoryTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const socialTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const { enabledPluginIds, addons, graphId, pluginConfigs } =
    useEnabledPluginsContext();
  const { addLog, logs, updateLog, onAddResults } = useTransformLogger();

  const { flows, isLoading: areFlowsLoading } = useFlows();

  const matchingFlows = React.useMemo(
    () =>
      props.graphViewMode === 'analysis'
        ? flows.filter((flow) =>
            flow.triggerTypes.some((type) =>
              matchesInputType(props.nodeType as EntityType, type)
            )
          )
        : [],
    [flows, props.graphViewMode, props.nodeType]
  );
  const isNodeRunning = logs.some(
    (log) => log.status === 'running' && log.sourceNodeId === props.nodeId
  );

  const [pendingMergedTransform, setPendingMergedTransform] = React.useState<{
    plugin: PluginDefinition;
    transform: TransformDefinition;
    values: string[];
    primary: string;
  } | null>(null);
  const [mergedTransformScope, setMergedTransformScope] = React.useState<
    'primary' | 'selected'
  >('primary');
  const [mergedTransformSelectedValues, setMergedTransformSelectedValues] =
    React.useState<string[]>([]);

  React.useEffect(() => {
    if (!readOnly) return;
    setPendingMergedTransform(null);
    setMergedTransformSelectedValues([]);
    setMergedTransformScope('primary');
  }, [readOnly]);

  React.useEffect(() => {
    if (readOnly || !pendingMergedTransform) return;
    setMergedTransformSelectedValues(pendingMergedTransform.values);
    setMergedTransformScope('primary');
  }, [pendingMergedTransform, readOnly]);

  React.useEffect(() => {
    function handlePointer(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node))
        props.onClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') props.onClose();
    }

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handlePointer, true);
      document.addEventListener('contextmenu', handlePointer, true);
      document.addEventListener('keydown', handleKeyDown);
    }, 0);

    return () => {
      clearTimeout(timer);
      if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
      if (categoryTimeoutRef.current) clearTimeout(categoryTimeoutRef.current);
      if (socialTimeoutRef.current) clearTimeout(socialTimeoutRef.current);
      document.removeEventListener('mousedown', handlePointer, true);
      document.removeEventListener('contextmenu', handlePointer, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [props]);

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: props.position.x,
    top: props.position.y,
    zIndex: 99999
  };
  useAdaptiveContextMenu(menuRef, props.position);

  const availableTransforms = React.useMemo(() => {
    const entityType = props.nodeType as EntityType;
    const builtin = getTransformsForEntityType(
      entityType,
      enabledPluginIds ?? undefined
    );

    const addonTransforms: Array<{
      plugin: PluginDefinition;
      transform: TransformDefinition;
    }> = [];
    for (const addon of addons as any[]) {
      if (!addon?.enabled) continue;
      if (enabledPluginIds && !enabledPluginIds.includes(addon.id)) continue;

      const pluginDef: PluginDefinition = {
        id: addon.id,
        name: addon.name,
        description: addon.description,
        version: addon.version,
        author: addon.author,
        icon: addon.icon,
        category: addon.category,
        type: 'addon',
        runtime: 'external',
        inputTypes: addon.inputTypes as EntityType[],
        outputTypes: addon.outputTypes as EntityType[],
        transforms: (addon.transforms ?? []).map((t: any) => ({
          ...t,
          outputTypes: t.outputTypes as EntityType[]
        })),
        enabled: addon.enabled,
        estimatedTime: 'instant'
      };

      for (const transform of addon.transforms ?? []) {
        if (
          matchesInputType(props.nodeType as EntityType, transform.inputType)
        ) {
          addonTransforms.push({
            plugin: pluginDef,
            transform: {
              ...transform,
              outputTypes: transform.outputTypes as EntityType[]
            }
          });
        }
      }
    }

    return [...builtin, ...addonTransforms];
  }, [props.nodeType, enabledPluginIds, addons]);

  const groupedTransforms = React.useMemo(() => {
    const groups = new Map<
      string,
      { plugin: PluginDefinition; items: TransformDefinition[] }
    >();
    for (const item of availableTransforms) {
      const existing = groups.get(item.plugin.id);
      if (existing) {
        existing.items.push(item.transform);
        continue;
      }
      groups.set(item.plugin.id, {
        plugin: item.plugin,
        items: [item.transform]
      });
    }
    return Array.from(groups.values());
  }, [availableTransforms]);

  function cancelCloseSubmenu() {
    if (!submenuTimeoutRef.current) return;
    clearTimeout(submenuTimeoutRef.current);
    submenuTimeoutRef.current = null;
  }

  function closeAllSubmenus() {
    setShowAddToCaseSubmenu(false);
    setShowTypeSubmenu(false);
    setShowColorSubmenu(false);
    setShowTransformsSubmenu(false);
    setShowFlowsSubmenu(false);
    setActiveCategory(null);
    setActiveSocialPlatform(null);
    setActiveTransformPluginId(null);
  }

  function openAddToCaseSubmenu() {
    cancelCloseSubmenu();
    setShowTypeSubmenu(false);
    setShowColorSubmenu(false);
    setShowTransformsSubmenu(false);
    setShowFlowsSubmenu(false);
    setActiveCategory(null);
    setActiveSocialPlatform(null);
    setActiveTransformPluginId(null);
    setShowAddToCaseSubmenu(true);
  }
  function closeAddToCaseSubmenuWithDelay() {
    submenuTimeoutRef.current = setTimeout(() => {
      setShowAddToCaseSubmenu(false);
    }, 150);
  }

  function openTypeSubmenu() {
    cancelCloseSubmenu();
    setShowAddToCaseSubmenu(false);
    setShowColorSubmenu(false);
    setShowTransformsSubmenu(false);
    setShowFlowsSubmenu(false);
    setActiveCategory(null);
    setActiveSocialPlatform(null);
    setActiveTransformPluginId(null);
    setShowTypeSubmenu(true);
  }
  function closeTypeSubmenuWithDelay() {
    submenuTimeoutRef.current = setTimeout(() => {
      setShowTypeSubmenu(false);
      setActiveCategory(null);
      setActiveSocialPlatform(null);
    }, 150);
  }
  function openColorSubmenu() {
    cancelCloseSubmenu();
    setShowAddToCaseSubmenu(false);
    setShowTypeSubmenu(false);
    setShowTransformsSubmenu(false);
    setShowFlowsSubmenu(false);
    setActiveCategory(null);
    setActiveSocialPlatform(null);
    setActiveTransformPluginId(null);
    setShowColorSubmenu(true);
  }
  function closeColorSubmenuWithDelay() {
    submenuTimeoutRef.current = setTimeout(() => {
      setShowColorSubmenu(false);
    }, 150);
  }
  function openTransformsSubmenu() {
    if (!canEdit()) return;
    cancelCloseSubmenu();
    setShowAddToCaseSubmenu(false);
    setShowTypeSubmenu(false);
    setShowColorSubmenu(false);
    setShowFlowsSubmenu(false);
    setActiveCategory(null);
    setActiveSocialPlatform(null);
    setShowTransformsSubmenu(true);
  }
  function closeTransformsSubmenuWithDelay() {
    submenuTimeoutRef.current = setTimeout(() => {
      setShowTransformsSubmenu(false);
      setActiveTransformPluginId(null);
    }, 150);
  }
  function openFlowsSubmenu() {
    if (!canEdit()) return;
    cancelCloseSubmenu();
    setShowAddToCaseSubmenu(false);
    setShowTypeSubmenu(false);
    setShowColorSubmenu(false);
    setShowTransformsSubmenu(false);
    setActiveCategory(null);
    setActiveSocialPlatform(null);
    setActiveTransformPluginId(null);
    setShowFlowsSubmenu(true);
  }
  function closeFlowsSubmenuWithDelay() {
    submenuTimeoutRef.current = setTimeout(() => {
      setShowFlowsSubmenu(false);
    }, 150);
  }

  function openCategory(category: string) {
    if (categoryTimeoutRef.current) clearTimeout(categoryTimeoutRef.current);
    setActiveCategory(category);
    setActiveSocialPlatform(null);
  }
  function closeCategoryWithDelay() {
    categoryTimeoutRef.current = setTimeout(() => {
      setActiveCategory(null);
      setActiveSocialPlatform(null);
    }, 150);
  }
  function cancelCloseCategory() {
    if (!categoryTimeoutRef.current) return;
    clearTimeout(categoryTimeoutRef.current);
    categoryTimeoutRef.current = null;
  }

  function openSocialPlatform(platform: string) {
    if (socialTimeoutRef.current) clearTimeout(socialTimeoutRef.current);
    setActiveSocialPlatform(platform);
  }
  function closeSocialPlatformWithDelay() {
    socialTimeoutRef.current = setTimeout(() => {
      setActiveSocialPlatform(null);
    }, 150);
  }
  function cancelCloseSocialPlatform() {
    if (!socialTimeoutRef.current) return;
    clearTimeout(socialTimeoutRef.current);
    socialTimeoutRef.current = null;
  }

  function getEffectiveTransformValue(args: {
    label: string;
    metadata?: Record<string, unknown> | null;
  }) {
    const meta: any = args.metadata ?? {};
    const candidates = [
      meta?.hash,
      meta?.address,
      meta?.value,
      String(args.label ?? '').split('\n')[0]
    ];
    for (const c of candidates) {
      const v = String(c ?? '').trim();
      if (v) return v;
    }
    return '';
  }

  function getTransformMetadata(meta: unknown) {
    const m: any =
      meta && typeof meta === 'object' && !Array.isArray(meta)
        ? { ...(meta as any) }
        : {};
    delete m.__merge;
    delete m.merged;
    delete m.mergedChildCount;
    return m as Record<string, unknown>;
  }

  function getMergedValuesForTransformFromMetadata(args: {
    label: string;
    metadata?: Record<string, unknown> | null;
  }) {
    const meta: any = args.metadata ?? {};
    const payload: any = meta?.__merge;
    const mergedList: any[] = Array.isArray(meta?.merged) ? meta.merged : [];

    const primary = getEffectiveTransformValue({
      label: args.label,
      metadata: meta
    });
    const fromMergedList = mergedList
      .map((it) =>
        String(it?.value ?? it?.label ?? '')
          .split('\n')[0]
          ?.trim()
      )
      .filter(Boolean);

    const fromPayloadNodes = Array.isArray(payload?.nodes)
      ? payload.nodes
          .map((n: any) => {
            const label = String(n?.data?.label ?? '').trim();
            const m = n?.data?.metadata;
            return getEffectiveTransformValue({ label, metadata: m });
          })
          .map((v: any) => String(v ?? '').trim())
          .filter(Boolean)
      : [];

    const all = [primary, ...fromMergedList, ...fromPayloadNodes]
      .map((v) => String(v).trim())
      .filter(Boolean);
    const unique = Array.from(new Set(all));
    return {
      primary,
      values: unique.length ? unique : [primary].filter(Boolean)
    };
  }

  async function runTransformWithValue(args: {
    plugin: PluginDefinition;
    transform: TransformDefinition;
    value: string;
    logId?: string;
  }) {
    if (!canEdit())
      return {
        success: false,
        entities: [],
        edges: [],
        denied: true,
        error: 'Graph is read-only'
      };
    const pluginConfig: Record<string, unknown> =
      (pluginConfigs as any)[args.plugin.id] || {};
    const input = createTransformInput(
      props.nodeId,
      props.nodeType,
      args.value,
      getTransformMetadata(props.nodeMetadata ?? undefined),
      pluginConfig
    );
    const logId = args.logId;
    return await executeTransform(
      args.plugin.id,
      args.transform.id,
      input,
      graphId,
      {
        onProgress: logId ? (update) => updateLog(logId, update) : undefined
      }
    );
  }

  function addResultsFromNode(entities: any[], edges: any[]) {
    if (!canEdit() || !onAddResults || entities.length === 0) return;
    onAddResults(
      entities,
      edges,
      { position: props.sourcePosition, nodeId: props.nodeId },
      entities.map((entity) => String(entity.id))
    );
  }

  async function pollAsyncTransformJob(args: { jobId: string; logId: string }) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const response = await fetch(`/api/jobs/${args.jobId}`);
      if (!response.ok) throw new Error(`Job status error: ${response.status}`);
      const job = await response.json();

      if (typeof job.progress === 'number') {
        updateLog(args.logId, {
          progress: job.progress,
          message: job.progressMessage || 'Running…'
        });
      }

      if (job.isCompleted) {
        const entities = job.result?.entities ?? [];
        const edges = job.result?.edges ?? [];
        updateLog(args.logId, {
          status: 'completed',
          resultCount: entities.length,
          endTime: new Date(),
          message: job.result?.message,
          results: { entities, edges }
        });
        if (entities.length <= 3) addResultsFromNode(entities, edges);
        return;
      }

      if (job.isFailed) {
        updateLog(args.logId, {
          status: 'failed',
          error: job.error || 'Async transform failed',
          endTime: new Date()
        });
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    updateLog(args.logId, {
      status: 'failed',
      error: 'Timeout: Job took too long to complete',
      endTime: new Date()
    });
  }

  async function executeFlowOnNode(
    flow: FlowSummary,
    definition: { nodes: unknown[]; edges: unknown[]; name: string }
  ) {
    if (!canEdit() || isNodeRunning) return;

    const effectiveValue = getEffectiveTransformValue({
      label: props.nodeLabel,
      metadata: props.nodeMetadata ?? null
    });
    const logId = addLog({
      pluginName: 'Flow',
      transformName: flow.name,
      entityValue: effectiveValue,
      status: 'running',
      progress: 0,
      message: 'Running flow…',
      sourceNodeId: props.nodeId,
      sourcePosition: props.sourcePosition
    });
    const runId = await startFlowRunRecord({
      flowId: flow.id,
      kind: 'run',
      inputType: props.nodeType,
      inputValue: effectiveValue,
      graphId
    });

    try {
      if (!canEdit()) throw new Error('Graph is read-only');
      const result = await executeFlow({
        nodes: definition.nodes as StoredFlowNode[],
        edges: definition.edges as StoredFlowEdge[],
        input: {
          entityId: props.nodeId,
          entityType: props.nodeType,
          entityValue: effectiveValue,
          metadata: getTransformMetadata(props.nodeMetadata)
        },
        graphId,
        pluginConfigs,
        onStep: (step) => {
          updateLog(logId, { message: `${step.name}: ${step.status}…` });
          if (step.status === 'completed' && step.entities.length > 0) {
            addResultsFromNode(step.entities, step.edges);
          }
        }
      });

      if (runId) {
        void finishFlowRunRecord({
          flowId: flow.id,
          runId,
          status: result.success ? 'COMPLETED' : 'FAILED',
          steps: result.steps,
          entityCount: result.entities.length,
          error: result.error
        });
      }

      if (!result.success) {
        updateLog(logId, {
          status: 'failed',
          error: result.error || 'Flow failed',
          endTime: new Date()
        });
        return;
      }

      updateLog(logId, {
        status: 'completed',
        resultCount: result.entities.length,
        endTime: new Date(),
        message: `${result.steps.filter((step) => step.status === 'completed').length} steps completed`,
        viewed: true,
        results: { entities: result.entities, edges: result.edges }
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Flow execution failed';
      if (runId) {
        void finishFlowRunRecord({
          flowId: flow.id,
          runId,
          status: 'FAILED',
          steps: [],
          entityCount: 0,
          error: message
        });
      }
      updateLog(logId, {
        status: 'failed',
        error: message,
        endTime: new Date()
      });
    } finally {
    }
  }

  async function handleRunFlow(flow: FlowSummary) {
    if (!canEdit() || isNodeRunning) return;
    const definition = await fetchFlowDefinition(flow.id);
    if (!canEdit()) return;
    if (!definition) {
      toast.error('Failed to load flow definition');
      return;
    }

    void executeFlowOnNode(flow, definition);
    props.onClose();
  }

  function reduceTransformResultsByTypeAndValue(args: {
    entities: any[];
    edges: any[];
  }): { entities: any[]; edges: any[] } {
    function norm(input: unknown) {
      return String(input ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
    }

    function entityKey(e: any) {
      const type = norm(e?.type);
      const value = norm(e?.value ?? e?.label ?? '');
      return `${type}::${value}`;
    }

    const canonicalIdByKey = new Map<string, string>();
    const idMap = new Map<string, string>();
    const dedupedEntities: any[] = [];

    for (const e of args.entities ?? []) {
      const id = String(e?.id ?? '');
      if (!id) continue;
      const k = entityKey(e);
      const existingId = canonicalIdByKey.get(k);
      if (existingId) {
        idMap.set(id, existingId);
        continue;
      }
      canonicalIdByKey.set(k, id);
      idMap.set(id, id);
      dedupedEntities.push(e);
    }

    function resolveId(raw: unknown) {
      const id = String(raw ?? '');
      return idMap.get(id) ?? id;
    }

    function edgeKey(e: any) {
      const s = resolveId(e?.sourceId ?? e?.source);
      const t = resolveId(e?.targetId ?? e?.target);
      const rel = norm(e?.relationship ?? (e?.data as any)?.relationship ?? '');
      const label = norm(e?.label ?? (e?.data as any)?.label ?? '');
      return `${s}=>${t}::${rel}::${label}`;
    }

    const seenEdges = new Set<string>();
    const dedupedEdges: any[] = [];
    for (const e of args.edges ?? []) {
      const s0 = e?.sourceId ?? e?.source;
      const t0 = e?.targetId ?? e?.target;
      const s = resolveId(s0);
      const t = resolveId(t0);
      if (!s || !t) continue;
      const next = { ...(e as any) };
      if ('sourceId' in next) next.sourceId = s;
      if ('targetId' in next) next.targetId = t;
      if ('source' in next) next.source = s;
      if ('target' in next) next.target = t;
      const k = edgeKey(next);
      if (seenEdges.has(k)) continue;
      seenEdges.add(k);
      dedupedEdges.push(next);
    }

    return { entities: dedupedEntities, edges: dedupedEdges };
  }

  async function runTransform(item: {
    plugin: PluginDefinition;
    transform: TransformDefinition;
  }) {
    if (!canEdit() || isNodeRunning) return;
    const isMerged = Boolean((props.nodeMetadata as any)?.__merge);
    if (isMerged) {
      const { primary, values } = getMergedValuesForTransformFromMetadata({
        label: props.nodeLabel,
        metadata: props.nodeMetadata ?? null
      });
      setPendingMergedTransform({
        plugin: item.plugin,
        transform: item.transform,
        values,
        primary
      });
      return;
    }

    const effectiveValue = getEffectiveTransformValue({
      label: props.nodeLabel,
      metadata: props.nodeMetadata ?? null
    });

    const logId = addLog({
      pluginName: item.plugin.name,
      transformName: item.transform.name,
      entityValue: effectiveValue,
      status: 'running',
      progress: 0,
      message: 'Starting...',
      sourceNodeId: props.nodeId,
      sourcePosition: props.sourcePosition
    });

    try {
      const result = await runTransformWithValue({
        plugin: item.plugin,
        transform: item.transform,
        value: effectiveValue,
        logId
      });

      if (!result.success) {
        updateLog(logId, {
          status: 'failed',
          error: result.error || 'Transform failed',
          endTime: new Date()
        });
        return;
      }

      if ((result as any).async && (result as any).jobId) {
        updateLog(logId, { message: 'Queued…', progress: 0 });
        await pollAsyncTransformJob({
          jobId: String((result as any).jobId),
          logId
        });
        return;
      }

      updateLog(logId, {
        status: 'completed',
        resultCount: result.entities?.length || 0,
        endTime: new Date(),
        message: (result as any).message,
        results: { entities: result.entities || [], edges: result.edges || [] }
      });

      if (canEdit() && onAddResults && (result.entities?.length || 0) > 0) {
        const entities = result.entities || [];
        const edges = result.edges || [];
        if (entities.length > 3) return;
        const allIds = entities.map((e: any) => String(e.id));
        onAddResults(
          entities,
          edges,
          { position: props.sourcePosition, nodeId: props.nodeId },
          allIds
        );
      }
    } catch (err: any) {
      updateLog(logId, {
        status: 'failed',
        error: String(err?.message ?? 'Transform error'),
        endTime: new Date()
      });
    } finally {
    }
  }

  async function handleConfirmMergedTransform() {
    if (!canEdit()) return;
    const pending = pendingMergedTransform;
    if (!pending) return;

    const runValues =
      mergedTransformScope === 'primary'
        ? [pending.primary].filter(Boolean)
        : mergedTransformSelectedValues;
    if (mergedTransformScope === 'selected' && runValues.length === 0) return;

    const logId = addLog({
      pluginName: pending.plugin.name,
      transformName: pending.transform.name,
      entityValue:
        mergedTransformScope === 'selected'
          ? `${pending.primary || pending.values[0]} (+${Math.max(0, runValues.length - 1)})`
          : pending.primary || pending.values[0] || '',
      status: 'running',
      progress: 0,
      message:
        mergedTransformScope === 'selected'
          ? `Running on ${runValues.length} selected merged values...`
          : 'Starting...',
      sourceNodeId: props.nodeId,
      sourcePosition: props.sourcePosition
    });

    try {
      if (mergedTransformScope === 'primary') {
        const result = await runTransformWithValue({
          plugin: pending.plugin,
          transform: pending.transform,
          value: pending.primary,
          logId
        });

        if (!result.success) {
          updateLog(logId, {
            status: 'failed',
            error: result.error || 'Transform failed',
            endTime: new Date()
          });
          return;
        }

        if ((result as any).async && (result as any).jobId) {
          updateLog(logId, { message: 'Queued…', progress: 0 });
          setPendingMergedTransform(null);
          props.onClose();
          await pollAsyncTransformJob({
            jobId: String((result as any).jobId),
            logId
          });
          return;
        }

        updateLog(logId, {
          status: 'completed',
          resultCount: result.entities?.length || 0,
          endTime: new Date(),
          results: {
            entities: result.entities || [],
            edges: result.edges || []
          }
        });

        if (canEdit() && onAddResults && (result.entities?.length || 0) > 0) {
          const entities = result.entities || [];
          const edges = result.edges || [];
          if (entities.length <= 3) {
            const allIds = entities.map((e: any) => String(e.id));
            onAddResults(
              entities,
              edges,
              { position: props.sourcePosition, nodeId: props.nodeId },
              allIds
            );
          }
        }

        setPendingMergedTransform(null);
        props.onClose();
        return;
      }

      const combinedEntities: any[] = [];
      const combinedEdges: any[] = [];
      let okCount = 0;

      for (let i = 0; i < runValues.length; i++) {
        if (!canEdit()) return;
        const v = String(runValues[i] ?? '').trim();
        if (!v) continue;

        updateLog(logId, {
          status: 'running',
          progress: runValues.length > 1 ? i / runValues.length : 0,
          message: `Running ${i + 1}/${runValues.length}...`
        });

        const result = await runTransformWithValue({
          plugin: pending.plugin,
          transform: pending.transform,
          value: v
        });

        if (!result.success) continue;
        if ((result as any).async) {
          updateLog(logId, {
            status: 'failed',
            error:
              'Async transforms are not supported when running on multiple values yet.',
            endTime: new Date()
          });
          return;
        }

        okCount += 1;
        if (Array.isArray(result.entities))
          combinedEntities.push(...result.entities);
        if (Array.isArray(result.edges)) combinedEdges.push(...result.edges);
      }

      updateLog(logId, {
        status: okCount > 0 ? 'completed' : 'failed',
        ...(okCount > 0
          ? {
              ...(() => {
                const reduced = reduceTransformResultsByTypeAndValue({
                  entities: combinedEntities,
                  edges: combinedEdges
                });
                return {
                  resultCount: reduced.entities.length,
                  results: { entities: reduced.entities, edges: reduced.edges }
                };
              })()
            }
          : { error: 'Transform failed on all selected merged values.' }),
        endTime: new Date()
      });

      const reducedForAdd = reduceTransformResultsByTypeAndValue({
        entities: combinedEntities,
        edges: combinedEdges
      });

      if (
        canEdit() &&
        onAddResults &&
        reducedForAdd.entities.length > 0 &&
        reducedForAdd.entities.length <= 3
      ) {
        const allIds = reducedForAdd.entities.map((e: any) => String(e.id));
        const out = onAddResults(
          reducedForAdd.entities,
          reducedForAdd.edges,
          { position: props.sourcePosition, nodeId: props.nodeId },
          allIds
        );

        const addedNodes = Number((out as any)?.addedNodes ?? 0);
        const addedEdges = Number((out as any)?.addedEdges ?? 0);
        const reason = String((out as any)?.reason ?? '').trim();
        if (addedNodes > 0 || addedEdges > 0) {
          toast.success(
            `Added ${addedNodes} node${addedNodes === 1 ? '' : 's'} and ${addedEdges} link${
              addedEdges === 1 ? '' : 's'
            }.`
          );
        } else {
          toast.info(`Nothing was added${reason ? `: ${reason}` : '.'}`);
        }
      } else if (reducedForAdd.entities.length > 3) {
        toast.info(
          `Found ${reducedForAdd.entities.length} results. Open the Results panel to review and add them.`
        );
      } else if (reducedForAdd.entities.length === 0) {
        toast.info(
          okCount > 0
            ? 'No results were added because no unique results were returned.'
            : 'Transform failed on all selected merged values.'
        );
      }

      setPendingMergedTransform(null);
      props.onClose();
    } catch (err: any) {
      updateLog(logId, {
        status: 'failed',
        error: String(err?.message ?? 'Transform error'),
        endTime: new Date()
      });
    } finally {
    }
  }

  function resolveNodesToAddToCase() {
    // We assume the caller ensures the current node is selected before opening the menu.
    // If it's multi-selected, we return the whole selection; otherwise, we return the single node.
    const selected = props.getSelectedNodes?.() ?? [];
    const current = selected.find((n) => n.id === props.nodeId);
    if (!current) return [];
    return selected.length > 1 ? selected : [current];
  }

  return createPortal(
    <>
      {readOnly || !pendingMergedTransform ? (
        <div
          ref={menuRef}
          className='bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 w-56 rounded-md border p-1 shadow-md duration-100'
          style={menuStyle}
          onContextMenu={(e) => e.stopPropagation()}
          onMouseLeave={closeAllSubmenus}
        >
          {props.onOpenNode ? (
            <button
              className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
              onClick={() => {
                props.onOpenNode?.();
                props.onClose();
              }}
            >
              <IconSearch className='h-4 w-4' />
              Open Node
            </button>
          ) : null}

          <button
            className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
            onClick={() => {
              void navigator.clipboard.writeText(props.nodeLabel).catch(() => {
                toast.error('Unable to copy node value');
              });
              props.onClose();
            }}
          >
            <IconCopy className='h-4 w-4' />
            Copy value
          </button>

          {groupedTransforms.length ? (
            <div
              className='relative'
              onMouseEnter={() => {
                if (!canEdit()) return;
                openTransformsSubmenu();
              }}
              onMouseLeave={closeTransformsSubmenuWithDelay}
            >
              <button
                disabled={!canEdit()}
                className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:opacity-40'
              >
                <span className='flex items-center gap-2'>
                  <IconTransform className='h-4 w-4' />
                  Transform
                </span>
                <IconChevronRight className='h-4 w-4' />
              </button>
              {showTransformsSubmenu && canEdit() ? (
                <div
                  className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-64 rounded-md border p-1 shadow-md duration-100'
                  onMouseEnter={() => {
                    if (!canEdit()) return;
                    cancelCloseSubmenu();
                  }}
                  onMouseLeave={closeTransformsSubmenuWithDelay}
                >
                  {groupedTransforms.map(({ plugin, items }) => (
                    <div
                      key={plugin.id}
                      className='relative'
                      onMouseEnter={() => {
                        if (!canEdit()) return;
                        setActiveTransformPluginId(plugin.id);
                      }}
                      onMouseLeave={() => setActiveTransformPluginId(null)}
                    >
                      <button
                        disabled={!canEdit()}
                        className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                      >
                        <span className='min-w-0 flex-1 truncate'>
                          {plugin.name}
                        </span>
                        <IconChevronRight className='h-4 w-4' />
                      </button>
                      {activeTransformPluginId === plugin.id ? (
                        <div
                          className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-72 rounded-md border p-1 shadow-md duration-100'
                          onMouseEnter={() => {
                            if (!canEdit()) return;
                            cancelCloseSubmenu();
                          }}
                          onMouseLeave={closeTransformsSubmenuWithDelay}
                        >
                          {items.map((t) => (
                            <button
                              key={t.id}
                              className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:cursor-wait disabled:opacity-50'
                              disabled={!canEdit() || isNodeRunning}
                              onClick={() => {
                                if (!canEdit()) return;
                                runTransform({ plugin, transform: t });
                                // If the node is merged we open a dialog; do not close/unmount the menu.
                                if (!(props.nodeMetadata as any)?.__merge)
                                  props.onClose();
                              }}
                            >
                              <IconTransform className='h-4 w-4' />
                              <span className='min-w-0 flex-1 truncate'>
                                {t.name}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {props.graphViewMode === 'analysis' ? (
            <div
              className='relative'
              onMouseEnter={() => {
                if (!canEdit()) return;
                openFlowsSubmenu();
              }}
              onMouseLeave={closeFlowsSubmenuWithDelay}
            >
              <button
                disabled={!canEdit()}
                className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:opacity-40'
              >
                <span className='flex items-center gap-2'>
                  <IconFlow className='h-4 w-4' />
                  Flows
                </span>
                <IconChevronRight className='h-4 w-4' />
              </button>
              {showFlowsSubmenu && canEdit() ? (
                <div
                  className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-72 rounded-md border p-1 shadow-md duration-100'
                  onMouseEnter={() => {
                    if (!canEdit()) return;
                    cancelCloseSubmenu();
                  }}
                  onMouseLeave={closeFlowsSubmenuWithDelay}
                >
                  {areFlowsLoading ? (
                    <div className='text-muted-foreground px-2 py-1.5 text-xs'>
                      Loading flows…
                    </div>
                  ) : matchingFlows.length === 0 ? (
                    <div className='text-muted-foreground px-2 py-1.5 text-xs'>
                      No flows available for this entity type.
                    </div>
                  ) : (
                    matchingFlows.map((flow) => (
                      <button
                        key={flow.id}
                        className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none select-none disabled:cursor-wait disabled:opacity-50'
                        disabled={!canEdit() || isNodeRunning}
                        title={flow.description ?? undefined}
                        onClick={() => {
                          if (!canEdit()) return;
                          void handleRunFlow(flow);
                        }}
                      >
                        <IconFlow className='h-4 w-4 shrink-0' />
                        <span className='min-w-0 flex-1'>
                          <span className='block truncate text-sm'>
                            {flow.name}
                          </span>
                          <span className='text-muted-foreground block truncate text-[11px]'>
                            {flow.description ||
                              `${Math.max(flow.nodeCount - flow.triggerTypes.length, 0)} transforms`}
                          </span>
                        </span>
                        {null}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {(props.onOpenNode ||
            groupedTransforms.length ||
            props.graphViewMode === 'analysis') &&
          (props.onEditLabel || props.onRename) ? (
            <div className='bg-border/60 my-1 h-px w-full' />
          ) : null}

          {props.onEditLabel ? (
            <button
              disabled={!canEdit()}
              className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
              onClick={() => {
                if (!canEdit()) return;
                props.onEditLabel?.();
                props.onClose();
              }}
            >
              <IconPencil className='h-4 w-4' />
              {props.nodeType === 'note'
                ? 'Edit note'
                : props.nodeType === 'media_url' &&
                    props.graphViewMode !== 'analysis'
                  ? 'Change media'
                  : 'Edit label'}
            </button>
          ) : null}

          {props.graphViewMode !== 'analysis' && props.onToggleHeader ? (
            <button
              disabled={!canEdit()}
              className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
              onClick={() => {
                if (!canEdit()) return;
                props.onToggleHeader?.();
                props.onClose();
              }}
            >
              {props.headerHidden ? (
                <IconEye className='h-4 w-4' />
              ) : (
                <IconEyeOff className='h-4 w-4' />
              )}
              {props.nodeType === 'note'
                ? props.headerHidden
                  ? 'Show note header'
                  : 'Hide note header'
                : props.headerHidden
                  ? 'Show image header'
                  : 'Hide image header'}
            </button>
          ) : null}

          {props.onRename ? (
            <button
              disabled={!canEdit()}
              className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
              onClick={() => {
                if (!canEdit()) return;
                props.onRename?.();
                props.onClose();
              }}
            >
              <IconPencil className='h-4 w-4' />
              Rename
            </button>
          ) : null}

          <div
            className='relative'
            onMouseEnter={() => {
              if (!canEdit()) return;
              openTypeSubmenu();
            }}
            onMouseLeave={closeTypeSubmenuWithDelay}
          >
            <button
              disabled={!canEdit()}
              className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
            >
              <span className='flex items-center gap-2'>
                <span className='h-4 w-4 rounded-sm border' />
                Change type
              </span>
              <IconChevronRight className='h-4 w-4' />
            </button>
            {showTypeSubmenu ? (
              <div
                className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-56 rounded-md border p-1 shadow-md duration-100'
                onMouseEnter={() => {
                  if (!canEdit()) return;
                  cancelCloseSubmenu();
                }}
                onMouseLeave={closeTypeSubmenuWithDelay}
              >
                {Object.entries(groupedNodeTypes).map(
                  ([category, subcategories]) => {
                    const hasSubcategories =
                      Object.keys(subcategories).filter((k) => k !== '_root')
                        .length > 0;
                    const hasRootItems =
                      subcategories['_root'] &&
                      subcategories['_root'].length > 0;

                    return (
                      <div
                        key={category}
                        className='relative'
                        onMouseEnter={() => {
                          if (!canEdit()) return;
                          openCategory(category);
                        }}
                        onMouseLeave={closeCategoryWithDelay}
                      >
                        <button
                          disabled={!canEdit()}
                          className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                        >
                          <span className='flex-1 text-left'>{category}</span>
                          <IconChevronRight className='h-4 w-4' />
                        </button>

                        {activeCategory === category ? (
                          <div
                            className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-56 rounded-md border p-1 shadow-md duration-100'
                            onMouseEnter={() => {
                              if (!canEdit()) return;
                              cancelCloseCategory();
                            }}
                            onMouseLeave={closeCategoryWithDelay}
                          >
                            {/* Root items */}
                            {hasRootItems
                              ? subcategories['_root'].map((option) => (
                                  <button
                                    disabled={!canEdit()}
                                    key={option.value}
                                    className='hover:bg-accent hover:text-accent-foreground relative flex w-full min-w-0 cursor-default items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                                    onClick={() => {
                                      if (!canEdit()) return;
                                      props.onChangeType(option.value);
                                      props.onClose();
                                    }}
                                  >
                                    <span
                                      className={cn(
                                        'relative rounded-lg p-1',
                                        nodeTypeByType[option.value]?.ui
                                          ?.headerBg
                                      )}
                                    >
                                      <LogoOrIcon
                                        label={option.label}
                                        logoUrl={option.logoUrl}
                                        Icon={getPhosphorIconByKey(
                                          option.iconKey
                                        )}
                                        sizePx={14}
                                        className='h-3.5 w-3.5'
                                        iconClassName={
                                          nodeTypeByType[option.value]?.ui
                                            ?.headerText
                                        }
                                      />
                                    </span>
                                    <span className='min-w-0 flex-1 truncate text-left whitespace-nowrap'>
                                      {option.label}
                                    </span>
                                  </button>
                                ))
                              : null}

                            {hasRootItems && hasSubcategories ? (
                              <div className='bg-border -mx-1 my-1 h-px' />
                            ) : null}

                            {/* Subcategories (e.g. Social platforms) */}
                            {Object.entries(subcategories)
                              .filter(([key]) => key !== '_root')
                              .map(([subcategory, options]) => (
                                <div
                                  key={subcategory}
                                  className='relative'
                                  onMouseEnter={() => {
                                    if (!canEdit()) return;
                                    openSocialPlatform(subcategory);
                                  }}
                                  onMouseLeave={closeSocialPlatformWithDelay}
                                >
                                  <button
                                    disabled={!canEdit()}
                                    className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                                  >
                                    <span className='flex-1 text-left'>
                                      {subcategory}
                                    </span>
                                    <IconChevronRight className='h-4 w-4' />
                                  </button>

                                  {activeSocialPlatform === subcategory ? (
                                    <div
                                      className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-56 rounded-md border p-1 shadow-md duration-100'
                                      onMouseEnter={() => {
                                        if (!canEdit()) return;
                                        cancelCloseSocialPlatform();
                                      }}
                                      onMouseLeave={
                                        closeSocialPlatformWithDelay
                                      }
                                    >
                                      {options.map((option) => (
                                        <button
                                          disabled={!canEdit()}
                                          key={option.value}
                                          className='hover:bg-accent hover:text-accent-foreground relative flex w-full min-w-0 cursor-default items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                                          onClick={() => {
                                            if (!canEdit()) return;
                                            props.onChangeType(option.value);
                                            props.onClose();
                                          }}
                                        >
                                          <span
                                            className={cn(
                                              'relative rounded-lg p-1',
                                              nodeTypeByType[option.value]?.ui
                                                ?.headerBg
                                            )}
                                          >
                                            <LogoOrIcon
                                              label={option.label}
                                              logoUrl={option.logoUrl}
                                              Icon={getPhosphorIconByKey(
                                                option.iconKey
                                              )}
                                              sizePx={14}
                                              className='h-3.5 w-3.5'
                                              iconClassName={
                                                nodeTypeByType[option.value]?.ui
                                                  ?.headerText
                                              }
                                            />
                                          </span>
                                          <span className='min-w-0 flex-1 truncate text-left whitespace-nowrap'>
                                            {option.label}
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  }
                )}
              </div>
            ) : null}
          </div>

          {props.onChangeColor ? (
            <div
              className='relative'
              onMouseEnter={() => {
                if (!canEdit()) return;
                openColorSubmenu();
              }}
              onMouseLeave={closeColorSubmenuWithDelay}
            >
              <button
                disabled={!canEdit()}
                className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
              >
                <span className='flex items-center gap-2'>
                  <IconPalette className='h-4 w-4' />
                  Edit Color
                </span>
                <IconChevronRight className='h-4 w-4' />
              </button>
              {showColorSubmenu ? (
                <div
                  className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-56 rounded-md border p-1 shadow-md duration-100'
                  onMouseEnter={() => {
                    if (!canEdit()) return;
                    cancelCloseSubmenu();
                  }}
                  onMouseLeave={closeColorSubmenuWithDelay}
                >
                  {colorOptions.map((opt) => (
                    <button
                      disabled={!canEdit()}
                      key={String(opt.value)}
                      className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                      onClick={() => {
                        if (!canEdit()) return;
                        props.onChangeColor?.(opt.value);
                        props.onClose();
                      }}
                    >
                      <span
                        className='h-3 w-3 rounded-sm border'
                        style={{ background: opt.value ?? 'transparent' }}
                      />
                      {opt.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Add to Case (sezione separata, dopo le modifiche del nodo) */}
          {props.addToCase ? (
            <>
              <div className='bg-border/60 my-1 h-px w-full' />
              <div
                className='relative'
                onMouseEnter={() => {
                  if (!canEdit()) return;
                  props.addToCase?.refreshRecentCases();
                  openAddToCaseSubmenu();
                }}
                onMouseLeave={closeAddToCaseSubmenuWithDelay}
              >
                <button
                  disabled={!canEdit()}
                  className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                >
                  <span className='flex items-center gap-2'>
                    <IconTag className='h-4 w-4' />
                    Add to Case
                  </span>
                  <IconChevronRight className='h-4 w-4' />
                </button>
                {showAddToCaseSubmenu ? (
                  <div
                    className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-0 w-56 rounded-md border p-1 shadow-md duration-100'
                    onMouseEnter={() => {
                      if (!canEdit()) return;
                      cancelCloseSubmenu();
                    }}
                    onMouseLeave={closeAddToCaseSubmenuWithDelay}
                  >
                    {props.addToCase.recentCases.map((c) => (
                      <button
                        disabled={!canEdit()}
                        key={c.id}
                        className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                        onClick={() => {
                          if (!canEdit()) return;
                          const nodesToAdd = resolveNodesToAddToCase();
                          props.addToCase?.addNodesToCase({
                            caseId: c.id,
                            nodes: nodesToAdd
                          });
                          props.onClose();
                        }}
                      >
                        <IconFolderOpen className='h-4 w-4' />
                        <span className='min-w-0 flex-1 truncate'>
                          {c.name}
                        </span>
                      </button>
                    ))}

                    <div className='bg-border/60 my-1 h-px w-full' />

                    <button
                      disabled={!canEdit()}
                      className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                      onClick={() => {
                        if (!canEdit()) return;
                        const nodesToAdd = resolveNodesToAddToCase();
                        props.addToCase?.openAllCasesDialog(nodesToAdd);
                        props.onClose();
                      }}
                    >
                      <IconFolderOpen className='h-4 w-4' />
                      All Cases…
                    </button>
                    <button
                      disabled={!canEdit()}
                      className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
                      onClick={() => {
                        if (!canEdit()) return;
                        const nodesToAdd = resolveNodesToAddToCase();
                        props.addToCase?.openNewCaseDialog(nodesToAdd);
                        props.onClose();
                      }}
                    >
                      <IconPlus className='h-4 w-4' />
                      New Case…
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          <div className='bg-border/60 my-1 h-px w-full' />

          {props.onDuplicate ? (
            <button
              disabled={!canEdit()}
              className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
              onClick={() => {
                if (!canEdit()) return;
                props.onDuplicate?.();
                props.onClose();
              }}
            >
              <IconCopy className='h-4 w-4' />
              Duplicate
            </button>
          ) : null}

          {props.onUnmerge ? (
            <button
              className={cn(
                'relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50',
                props.canUnmerge
                  ? 'hover:bg-accent hover:text-accent-foreground'
                  : 'opacity-50'
              )}
              disabled={!canEdit() || !props.canUnmerge}
              onClick={() => {
                if (!canEdit()) return;
                props.onUnmerge?.();
                props.onClose();
              }}
            >
              <IconMerge className='h-4 w-4' />
              Unmerge
            </button>
          ) : null}

          {props.onDuplicate ? (
            <div className='bg-border/60 my-1 h-px w-full' />
          ) : null}

          <button
            className='hover:bg-destructive/10 hover:text-destructive relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50'
            disabled={!canEdit()}
            onClick={() => {
              if (!canEdit()) return;
              props.onDelete();
              props.onClose();
            }}
          >
            <IconTrash className='h-4 w-4' />
            Delete
          </button>
        </div>
      ) : null}

      <Dialog
        open={!readOnly && Boolean(pendingMergedTransform)}
        onOpenChange={(open) => {
          if (open) return;
          setPendingMergedTransform(null);
        }}
      >
        <DialogContent className='sm:max-w-[520px]'>
          <DialogHeader>
            <DialogTitle>Run transform on merged node?</DialogTitle>
            <DialogDescription>
              This node contains multiple values. Do you want to run the
              transform only on the primary value, or on a selected set of
              merged values?
            </DialogDescription>
          </DialogHeader>

          {pendingMergedTransform ? (
            <div className='space-y-4'>
              <div className='grid gap-2 sm:grid-cols-2'>
                <button
                  disabled={!canEdit()}
                  type='button'
                  className={cn(
                    'rounded-md border p-3 text-left transition-colors disabled:pointer-events-none disabled:opacity-50',
                    mergedTransformScope === 'primary'
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted'
                  )}
                  onClick={() => {
                    if (!canEdit()) return;
                    setMergedTransformScope('primary');
                  }}
                >
                  <p className='text-sm font-semibold'>Primary only</p>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    Runs the transform on the primary value of this merged node.
                  </p>
                </button>
                <button
                  disabled={!canEdit()}
                  type='button'
                  className={cn(
                    'rounded-md border p-3 text-left transition-colors disabled:pointer-events-none disabled:opacity-50',
                    mergedTransformScope === 'selected'
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted'
                  )}
                  onClick={() => {
                    if (!canEdit()) return;
                    setMergedTransformScope('selected');
                  }}
                >
                  <p className='text-sm font-semibold'>
                    Selected values ({mergedTransformSelectedValues.length}/
                    {pendingMergedTransform.values.length})
                  </p>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    Choose exactly which merged values to run on.
                  </p>
                </button>
              </div>

              <div className='space-y-2'>
                <div className='flex items-center justify-between gap-2'>
                  <p className='text-muted-foreground text-xs font-semibold uppercase'>
                    Values
                  </p>
                  <div className='flex items-center gap-2'>
                    <Button
                      type='button'
                      size='sm'
                      variant='ghost'
                      disabled={
                        !canEdit() || mergedTransformScope !== 'selected'
                      }
                      onClick={() => {
                        if (!canEdit()) return;
                        setMergedTransformSelectedValues(
                          pendingMergedTransform.values
                        );
                      }}
                    >
                      Select all
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      variant='ghost'
                      disabled={
                        !canEdit() || mergedTransformScope !== 'selected'
                      }
                      onClick={() => {
                        if (!canEdit()) return;
                        setMergedTransformSelectedValues([]);
                      }}
                    >
                      Select none
                    </Button>
                  </div>
                </div>

                <ScrollArea className='h-40 rounded-md border p-2'>
                  <ul className='space-y-1'>
                    {pendingMergedTransform.values.map((v) => (
                      <li
                        key={v}
                        className='flex items-start gap-2 py-0.5 text-xs'
                      >
                        <input
                          type='checkbox'
                          className='mt-0.5 disabled:pointer-events-none disabled:opacity-50'
                          disabled={
                            !canEdit() || mergedTransformScope !== 'selected'
                          }
                          checked={mergedTransformSelectedValues.includes(v)}
                          onChange={(e) => {
                            if (!canEdit()) return;
                            const checked = e.currentTarget.checked;
                            setMergedTransformSelectedValues((prev) => {
                              if (checked)
                                return prev.includes(v) ? prev : [...prev, v];
                              return prev.filter((x) => x !== v);
                            });
                          }}
                        />
                        <span className='min-w-0 font-mono'>{v}</span>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>

              <div className='flex justify-end gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => setPendingMergedTransform(null)}
                >
                  Cancel
                </Button>
                <Button
                  type='button'
                  onClick={() => {
                    if (!canEdit()) return;
                    handleConfirmMergedTransform();
                  }}
                  disabled={
                    !canEdit() ||
                    (mergedTransformScope === 'selected' &&
                      mergedTransformSelectedValues.length === 0)
                  }
                >
                  Run
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>,
    document.body
  );
}
