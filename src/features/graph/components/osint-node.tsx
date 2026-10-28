'use client';

import {
  CaretDown as IconChevronDown,
  CaretRight as IconChevronRight,
  CircleNotchIcon as IconLoader2,
  EnvelopeSimple as IconMail,
  StackIcon as IconMerge,
  Plus as IconPlus,
  MagnifyingGlassIcon as IconSearch,
  LightningIcon as IconTransform,
  X as IconX
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DeleteCascadeDialog } from '@/features/graph/components/delete-cascade-dialog';
import { NodeContextMenu } from '@/features/graph/components/graph-editor/components/node-context-menu';
import { OpenNodeDialog } from '@/features/graph/components/graph-editor/components/open-node-dialog';
import { useAddToCase } from '@/features/graph/contexts/add-to-case-context';
import { canUnmergeNode, unmergeNode } from '@/features/graph/utils/node-merge';
import {
  createTransformInput,
  executeTransform,
  getTransformsForEntityType,
  matchesInputType,
  type EntityType,
  type OSINTEntity,
  type PluginDefinition,
  type OSINTEdge as PluginEdge,
  type TransformDefinition
} from '@/features/plugins';
import { getBuiltInPluginStyle } from '@/features/plugins/utils/plugin-style';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'motion/react';
import { useTheme } from 'next-themes';
import Image from 'next/image';
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ElementType
} from 'react';
import {
  Edge,
  Handle,
  MarkerType,
  Node,
  NodeProps,
  NodeResizer,
  Position,
  useStore
} from 'reactflow';
import { toast } from 'sonner';
import { useEnabledPluginsContext } from '../contexts/enabled-plugins-context';
import { useGuardedReactFlow as useReactFlow } from '../contexts/graph-mutation-context';
import { useGraphChildCount } from '../contexts/graph-topology-context';
import { useTransformLoggerActions } from '../contexts/transform-logger-context';
import { CircularProgress } from './circular-progress';
// TransformResultsSheet is now managed centrally by TransformResultsAutoSheet
import { useGraphLayoutSettings } from '@/features/graph/contexts/graph-layout-settings-context';
import { getNodeDisplayLabel } from '../utils';
import { positionTransformResultNodes } from '../utils/auto-layout';
// (layout globale rimosso: in modalità locked le posizioni sono calcolate dal canvas bloccato)
import dynamic from 'next/dynamic';
import {
  isClassicResultType,
  resultNodeSize,
  withEntityValue
} from '../utils/result-node';
import { isCardNode } from './graph-editor/utils/card-node';
import { filePreviewDimensions } from './graph-editor/utils/file-preview';
import {
  isNodeHeaderHidden,
  nodeHeaderKey,
  NOTE_MIN_HEIGHT
} from './graph-editor/utils/node-header';
import { CardNodeContent } from './nodes/card-node-content';
import { DocumentNodeContent } from './nodes/document-node-content';
import { GenericNodeContent } from './nodes/generic-node-content';
import { GroupNodeContent } from './nodes/group-node-content';
import { MediaUrlNodeContent } from './nodes/media-url-node-content';
import { NoteNodeContent } from './nodes/note-node-content';
import { TextNodeContent } from './nodes/text-node-content';

const SHOW_LOW_DETAIL_WHEN_ZOOM_LT = 0.25;
const SHOW_BARE_DETAIL_WHEN_ZOOM_LT = 0.16;

function selectNodeDetailLevel(state: any): 'bare' | 'low' | 'full' {
  const transform = state?.transform;
  const zoom = Array.isArray(transform) ? Number(transform[2]) : 1;
  const normalizedZoom = Number.isFinite(zoom) ? zoom : 1;
  if (normalizedZoom < SHOW_BARE_DETAIL_WHEN_ZOOM_LT) return 'bare';
  if (normalizedZoom < SHOW_LOW_DETAIL_WHEN_ZOOM_LT) return 'low';
  return 'full';
}

// Import FilePreviewDialog as client-only component to avoid SSR issues with react-pdf
const FilePreviewDialog = dynamic(
  () =>
    import('./file-preview-dialog').then((mod) => ({
      default: mod.FilePreviewDialog
    })),
  { ssr: false }
);

const MapPreviewDialog = dynamic(
  () =>
    import('./map-preview-dialog').then((mod) => ({
      default: mod.MapPreviewDialog
    })),
  { ssr: false }
);

import { ArrowsSplitIcon as IconArrowsSplit } from '@/components/icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import {
  createGraphNodeClipboardMarker,
  storeGraphNodeClipboard
} from '@/features/graph/utils/node-clipboard';
import { OSINTNodeData } from '../types';

import {
  computeDynamicLogoUrl,
  pickReadableHeaderTextColor as pickReadableHeaderTextColorShared
} from '@/features/graph/components/osint-node-visual';
import {
  getLogoUrlForNodeType,
  getNodeTypeUiLabel,
  nodeTypeDefinitions,
  type NodeType
} from '@/features/osint/node-registry';

// Import dinamico per MapContent (evita problemi SSR con Leaflet)
const MapContent = dynamic(() => import('./map-content'), {
  ssr: false,
  loading: () => (
    <div className='bg-muted/50 flex flex-1 items-center justify-center'>
      <span className='text-muted-foreground text-xs'>Loading map...</span>
    </div>
  )
});

const typeConfig: Record<
  string,
  {
    icon: typeof IconMail;
    label: string;
    headerBg: string;
    headerText: string;
    bodyBg: string;
    borderColor: string;
  }
> = nodeTypeDefinitions.reduce(
  (acc, def) => {
    acc[def.type] = {
      icon: def.icon as unknown as typeof IconMail,
      label: getNodeTypeUiLabel(def.type),
      headerBg: def.ui.headerBg,
      headerText: def.ui.headerText,
      bodyBg: def.ui.bodyBg,
      borderColor: def.ui.borderColor
    };
    return acc;
  },
  {} as Record<string, any>
);

// Transform con info dal plugin
interface TransformWithPlugin {
  plugin: PluginDefinition;
  transform: TransformDefinition;
}

// Helper per parsare URL video e ottenere embed URL
// function getVideoEmbedInfo(url: string) logic moved to media-node-content.tsx

// Helper per ottenere icona dal tipo di output
function getIconForType(type: string): typeof IconSearch {
  const cfg = typeConfig[type] || typeConfig.custom;
  return cfg.icon as unknown as typeof IconSearch;
}

// Helper per troncare URL e testi lunghi
function truncateLabel(
  label: string,
  type: string,
  maxLength: number = 50
): string {
  if (type === 'url' && label.length > maxLength) {
    return label.substring(0, maxLength) + '...';
  }
  return label;
}

const RESERVED_MERGE_METADATA_KEYS = new Set([
  '__merge',
  'merge',
  'merged',
  'mergedChildCount'
]);

function isReservedMergeMetadataKey(key: string) {
  return RESERVED_MERGE_METADATA_KEYS.has(String(key));
}

function LogoOrIcon(args: {
  label: string;
  logoUrl?: string;
  Icon: ElementType<{ className?: string; style?: CSSProperties }>;
  sizePx: number;
  iconClassName?: string;
  iconStyle?: CSSProperties;
  className?: string;
  showSkeletonWhileLoading?: boolean;
  onLogoLoaded?: (img: HTMLImageElement) => void;
}) {
  const [hasLogoError, setHasLogoError] = useState(false);
  const [isLogoLoading, setIsLogoLoading] = useState(true);
  const shouldShowLogo = Boolean(args.logoUrl) && !hasLogoError;
  const isInternalLogoEndpoint =
    typeof args.logoUrl === 'string' && args.logoUrl.startsWith('/api/logo');

  return (
    <div
      className={cn('relative overflow-hidden rounded-md', args.className)}
      style={{
        height: args.sizePx,
        width: args.sizePx
      }}
    >
      {!shouldShowLogo ? (
        <args.Icon className={args.iconClassName} style={args.iconStyle} />
      ) : (
        <>
          {args.showSkeletonWhileLoading && isLogoLoading ? (
            <div className='bg-muted/60 absolute inset-0 animate-pulse rounded-md' />
          ) : null}
          {isInternalLogoEndpoint ? (
            <img
              src={args.logoUrl!}
              alt={args.label}
              width={args.sizePx}
              height={args.sizePx}
              loading='lazy'
              decoding='async'
              className={cn(
                'h-full w-full rounded-md object-contain transition-opacity',
                args.showSkeletonWhileLoading && isLogoLoading
                  ? 'opacity-0'
                  : 'opacity-100'
              )}
              onError={() => setHasLogoError(true)}
              onLoad={(e) => {
                setIsLogoLoading(false);
                args.onLogoLoaded?.(e.currentTarget);
              }}
            />
          ) : (
            <Image
              src={args.logoUrl!}
              alt={args.label}
              fill
              sizes={`${args.sizePx}px`}
              className={cn(
                'rounded-md object-contain transition-opacity',
                args.showSkeletonWhileLoading && isLogoLoading
                  ? 'opacity-0'
                  : 'opacity-100'
              )}
              onError={() => setHasLogoError(true)}
              onLoadingComplete={(img) => {
                setIsLogoLoading(false);
                args.onLogoLoaded?.(img);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function OSINTNodeComponent({ id, data, selected }: NodeProps<OSINTNodeData>) {
  const config = typeConfig[data.type] || typeConfig.custom;
  const Icon = config.icon;
  const isFlowDecoration = data.metadata?.flowDecoration === true;

  // Custom logic to hide header for specific file types (e.g. Audio)
  const isAudioFile =
    ['document', 'audio'].includes(data.type) &&
    (String(data.metadata?.mimeType || '').startsWith('audio/') ||
      ['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(
        String(data.metadata?.extension || '').toLowerCase()
      ));

  function getDynamicLogoUrl() {
    return computeDynamicLogoUrl({
      type: String(data.type ?? ''),
      label: String(data.label ?? ''),
      metadata: data.metadata
    });
  }

  const dynamicLogoUrl = getDynamicLogoUrl();
  const isDynamicDomainLogo = Boolean(dynamicLogoUrl);
  const logoUrl =
    dynamicLogoUrl ??
    getLogoUrlForNodeType(data.type as NodeType, { size: 256 });

  const headerFgColor = data.metadata?.customColor
    ? (data.metadata?.headerTextColor as string) ||
      (data.metadata.customColor as string)
    : undefined;

  function updateAutoColorFromLogo(colorHex: string) {
    function parseHex(input: string) {
      const raw = input.trim();
      const match = /^#([0-9a-fA-F]{6})$/.exec(raw);
      if (!match) return null;
      const hex = match[1] ?? '';
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b))
        return null;
      return { r, g, b };
    }

    function relLuminance(rgb: { r: number; g: number; b: number }) {
      function toLinear(v: number) {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      }
      const r = toLinear(rgb.r);
      const g = toLinear(rgb.g);
      const b = toLinear(rgb.b);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function contrastRatio(
      a: { r: number; g: number; b: number },
      b: { r: number; g: number; b: number }
    ) {
      const la = relLuminance(a);
      const lb = relLuminance(b);
      const lighter = Math.max(la, lb);
      const darker = Math.min(la, lb);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function mixRgb(
      a: { r: number; g: number; b: number },
      b: { r: number; g: number; b: number },
      t: number
    ) {
      const clamped = Math.min(1, Math.max(0, t));
      return {
        r: Math.round(a.r + (b.r - a.r) * clamped),
        g: Math.round(a.g + (b.g - a.g) * clamped),
        b: Math.round(a.b + (b.b - a.b) * clamped)
      };
    }

    function rgbToHex(rgb: { r: number; g: number; b: number }) {
      const toHex = (v: number) => v.toString(16).padStart(2, '0');
      return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
    }

    function pickReadableHeaderTextColor(args: {
      accentHex: string;
      effectiveTheme: string | undefined;
    }) {
      return pickReadableHeaderTextColorShared({
        accentHex: args.accentHex,
        isDark: args.effectiveTheme === 'dark'
      });
    }

    setNodes((nodes) =>
      nodes.map((n) => {
        if (n.id !== id) return n;
        const prevMeta = (n.data as OSINTNodeData).metadata ?? {};
        const hasManualColor =
          typeof prevMeta.customColor === 'string' &&
          Boolean(prevMeta.customColor) &&
          prevMeta.autoColorFromLogo !== true;
        if (hasManualColor) return n;

        const hasManualHeaderTextColor =
          typeof prevMeta.headerTextColor === 'string' &&
          Boolean(prevMeta.headerTextColor) &&
          prevMeta.autoHeaderTextColorFromLogo !== true;

        return {
          ...n,
          data: {
            ...(n.data as OSINTNodeData),
            metadata: {
              ...prevMeta,
              customColor: colorHex,
              autoColorFromLogo: true,
              ...(hasManualHeaderTextColor
                ? {}
                : {
                    headerTextColor:
                      pickReadableHeaderTextColor({
                        accentHex: colorHex,
                        effectiveTheme: resolvedTheme ?? theme
                      }) ?? undefined,
                    autoHeaderTextColorFromLogo: true
                  })
            }
          }
        };
      })
    );
  }

  function extractAverageColorHex(img: HTMLImageElement) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 24;
      canvas.height = 24;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return undefined;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3] ?? 0;
        if (alpha < 32) continue;
        r += data[i] ?? 0;
        g += data[i + 1] ?? 0;
        b += data[i + 2] ?? 0;
        count += 1;
      }
      if (!count) return undefined;
      const rr = Math.round(r / count);
      const gg = Math.round(g / count);
      const bb = Math.round(b / count);
      const toHex = (v: number) => v.toString(16).padStart(2, '0');
      return `#${toHex(rr)}${toHex(gg)}${toHex(bb)}`;
    } catch {
      return undefined;
    }
  }
  const { theme, resolvedTheme } = useTheme();
  const { setNodes, setEdges, getNode, getEdges, getNodes, canEdit } =
    useReactFlow();
  const addToCase = useAddToCase();
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [addMenuTab, setAddMenuTab] = useState<'transforms' | 'flows'>(
    'transforms'
  );
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setEditing] = useState(false);
  const setIsEditing = useCallback(
    (next: boolean) => {
      if (!next || canEdit()) setEditing(next);
    },
    [canEdit]
  );
  const [editLabel, setEditLabel] = useState(data.label);
  const [nodeContextMenuPosition, setNodeContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isTransforming, setIsTransforming] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [collapsedCount, setCollapsedCount] = useState(0);
  const [isDeleteCascadeDialogOpen, setIsDeleteCascadeDialogOpen] =
    useState(false);
  const [deleteCascadeChildIds, setDeleteCascadeChildIds] = useState<string[]>(
    []
  );
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  const mergedChildCount =
    typeof (data as any)?.metadata?.mergedChildCount === 'number'
      ? Number((data as any).metadata.mergedChildCount)
      : Array.isArray((data as any)?.metadata?.__merge?.nodeIds)
        ? (data as any).metadata.__merge.nodeIds.length
        : 0;
  const isMerged = Number.isFinite(mergedChildCount) && mergedChildCount > 1;
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isMapPreviewOpen, setIsMapPreviewOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedLabel, setEditedLabel] = useState(data.label);
  const [editedMetadata, setEditedMetadata] = useState<Record<string, unknown>>(
    data.metadata || {}
  );
  const [newMetaKey, setNewMetaKey] = useState('');
  const [newMetaValue, setNewMetaValue] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [isScrollActive, setIsScrollActive] = useState(false);
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isPulsing, setIsPulsing] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [customTitle, setCustomTitle] = useState(
    (data.metadata?.customTitle as string) || config.label
  );

  const [pendingMergedTransform, setPendingMergedTransform] = useState<{
    item: TransformWithPlugin;
    values: string[];
    primary: string;
  } | null>(null);
  const [mergedTransformScope, setMergedTransformScope] = useState<
    'primary' | 'selected'
  >('primary');
  const [mergedTransformSelectedValues, setMergedTransformSelectedValues] =
    useState<string[]>([]);

  useEffect(() => {
    if (!pendingMergedTransform) return;
    setMergedTransformSelectedValues(pendingMergedTransform.values);
  }, [pendingMergedTransform]);

  // Tracking async job progress
  const [asyncJobState, setAsyncJobState] = useState<{
    jobId: string;
    progress: number;
    message: string;
    isExternal: boolean;
  } | null>(null);

  // Fade in animation quando il nodo viene montato
  useEffect(() => {
    // Piccolo ritardo per permettere al DOM di renderizzare
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 10);
    return () => clearTimeout(timer);
  }, []);

  const childrenCount = useGraphChildCount(id);

  // Hook per ottenere i plugin abilitati dal context (caricati una volta nel componente padre)
  const { enabledPluginIds, addons, graphId, pluginConfigs } =
    useEnabledPluginsContext();

  // Hook per il logger delle transform
  const { addLog, updateLog } = useTransformLoggerActions();

  const { graphViewMode, lockedAxis, spacingPreset } = useGraphLayoutSettings();

  const isLockedLayout = graphViewMode === 'locked';
  const headerVisibilityKey = nodeHeaderKey(data);
  const canToggleHeader =
    graphViewMode !== 'analysis' && headerVisibilityKey !== null;
  const shouldHideHeader =
    isAudioFile || isNodeHeaderHidden(data, graphViewMode);
  const isPlainNote = data.type === 'note' && shouldHideHeader;

  // I nodi si aggiornano solo quando lo zoom attraversa una soglia LOD.
  const detailLevel = useStore(selectNodeDetailLevel);

  const canApplyLod = graphViewMode !== 'analysis' && !isPlainNote;
  const isBareDetail =
    canApplyLod &&
    detailLevel === 'bare' &&
    !selected &&
    !isHovered &&
    !isEditing &&
    !isAddMenuOpen &&
    !isDetailOpen &&
    !isPreviewOpen &&
    !isMapPreviewOpen;
  const isLowDetail =
    canApplyLod &&
    detailLevel !== 'full' &&
    !isBareDetail &&
    !selected &&
    !isHovered &&
    !isEditing &&
    !isAddMenuOpen &&
    !isDetailOpen &&
    !isPreviewOpen &&
    !isMapPreviewOpen;

  const lodFillColor =
    theme === 'dark'
      ? data.metadata?.customColor
        ? `${data.metadata.customColor}26`
        : config.headerBg.includes('blue')
          ? '#3b82f626'
          : config.headerBg.includes('green') ||
              config.headerBg.includes('emerald')
            ? '#22c55e26'
            : config.headerBg.includes('amber') ||
                config.headerBg.includes('yellow')
              ? '#f59e0b26'
              : config.headerBg.includes('purple')
                ? '#a855f726'
                : config.headerBg.includes('pink')
                  ? '#ec489926'
                  : config.headerBg.includes('cyan')
                    ? '#06b6d426'
                    : config.headerBg.includes('indigo')
                      ? '#6366f126'
                      : '#64748b26'
      : data.metadata?.customColor
        ? `${data.metadata.customColor}1f`
        : config.headerBg.includes('blue')
          ? '#3b82f61f'
          : config.headerBg.includes('green') ||
              config.headerBg.includes('emerald')
            ? '#22c55e1f'
            : config.headerBg.includes('amber') ||
                config.headerBg.includes('yellow')
              ? '#f59e0b1f'
              : config.headerBg.includes('purple')
                ? '#a855f71f'
                : config.headerBg.includes('pink')
                  ? '#ec48991f'
                  : config.headerBg.includes('cyan')
                    ? '#06b6d41f'
                    : config.headerBg.includes('indigo')
                      ? '#6366f11f'
                      : '#64748b1f';

  // Ottieni transform disponibili dal registry dei plugin (filtrate per plugin abilitati)
  const availableTransforms = useMemo(() => {
    // Get builtin transforms
    const builtinTransforms = getTransformsForEntityType(
      data.type as EntityType,
      enabledPluginIds ?? undefined
    );

    // Get addon transforms
    const addonTransforms: Array<{
      plugin: PluginDefinition;
      transform: TransformDefinition;
    }> = [];

    for (const addon of addons) {
      // Check if addon is enabled
      if (!addon.enabled) continue;
      if (enabledPluginIds && !enabledPluginIds.includes(addon.id)) continue;

      // Convert addon to PluginDefinition format
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
        transforms: addon.transforms.map((t) => ({
          ...t,
          outputTypes: t.outputTypes as EntityType[]
        })),
        enabled: addon.enabled,
        estimatedTime: 'instant'
      };

      // Find matching transforms for this entity type
      for (const transform of addon.transforms) {
        if (matchesInputType(data.type as EntityType, transform.inputType)) {
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

    // Combine builtin and addon transforms
    return [...builtinTransforms, ...addonTransforms];
  }, [data.type, enabledPluginIds, addons]);

  // Raggruppa transform per plugin
  const groupedTransforms = useMemo(() => {
    const groups: Record<string, typeof availableTransforms> = {};
    for (const item of availableTransforms) {
      if (!groups[item.plugin.id]) {
        groups[item.plugin.id] = [];
      }
      groups[item.plugin.id].push(item);
    }
    return groups;
  }, [availableTransforms]);

  // Flows eseguibili su questo nodo (trigger type compatibile col tipo entità)
  const { flows: orgFlows } = useFlows();
  const matchingFlows = useMemo(
    () =>
      orgFlows.filter((f) =>
        f.triggerTypes.some((t) => matchesInputType(data.type as EntityType, t))
      ),
    [orgFlows, data.type]
  );
  const openTransformGroup = openSubmenu
    ? groupedTransforms[openSubmenu]
    : undefined;
  const estimatedTransformListHeight =
    Object.keys(groupedTransforms).length * 48 +
    (openTransformGroup?.length ?? 0) * 64;
  const shouldScrollTransforms = estimatedTransformListHeight > 340;
  const shouldScrollFlows = matchingFlows.length * 48 > 340;
  const TransformContentContainer = shouldScrollTransforms ? ScrollArea : 'div';
  const FlowContentContainer = shouldScrollFlows ? ScrollArea : 'div';

  // Focus input quando si entra in modalità editing
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Sync label con data
  useEffect(() => {
    setEditLabel(data.label);
  }, [data.label]);

  // Auto-edit mode per nodi appena creati
  useEffect(() => {
    if (!canEdit()) return;
    if (data.metadata?._autoEdit && selected) {
      // Attiva modalità modifica e rimuovi il flag
      setIsEditing(true);
      setNodes((nodes) =>
        nodes.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  metadata: {
                    ...n.data.metadata,
                    _autoEdit: undefined
                  }
                }
              }
            : n
        )
      );
      // Focus sull'input dopo un breve delay
      setTimeout(() => {
        inputRef.current?.focus();
        if (inputRef.current instanceof HTMLInputElement) {
          inputRef.current.select();
        } else if (inputRef.current instanceof HTMLTextAreaElement) {
          inputRef.current.select();
        }
      }, 100);
    }
  }, [canEdit, data.metadata?._autoEdit, selected, id, setNodes, setIsEditing]);

  const deleteNodeIds = useCallback(
    (nodeIds: string[]) => {
      if (!canEdit()) return;
      const ids = Array.from(
        new Set(nodeIds.filter((x) => typeof x === 'string' && x.length > 0))
      );
      if (!ids.length) return;

      // Mutate synchronously through the graph guard: no local fade or delayed
      // removal may outlive edit permission. Keep attachments available to undo.
      setNodes((nodes) => nodes.filter((n) => !ids.includes(n.id)));
      setEdges((edges) =>
        edges.filter((e) => !ids.includes(e.source) && !ids.includes(e.target))
      );
    },
    [canEdit, setEdges, setNodes]
  );

  const handleDelete = useCallback(() => {
    if (!canEdit()) return;

    // Se esistono figli attualmente nascosti (collapse), chiedi se eliminare anche loro.
    // Nota: non usiamo solo `isCollapsed/collapsedCount` perché il componente può
    // rimontare o lo stato può desincronizzarsi; ci basiamo sullo stato reale del grafo.
    const edges = getEdges();
    const findChildrenRecursive = (
      nodeId: string,
      visited: Set<string> = new Set()
    ): string[] => {
      if (visited.has(nodeId)) return [];
      visited.add(nodeId);

      const directChildren = edges
        .filter((e) => e.source === nodeId)
        .map((e) => e.target);

      const allChildren: string[] = [...directChildren];
      for (const childId of directChildren)
        allChildren.push(...findChildrenRecursive(childId, visited));
      return allChildren;
    };

    const childIds = findChildrenRecursive(id).filter((x) => x !== id);
    const hiddenChildIds = childIds.filter((childId) =>
      Boolean(getNode(childId)?.hidden)
    );
    if (hiddenChildIds.length) {
      setDeleteCascadeChildIds(hiddenChildIds);
      setIsDeleteCascadeDialogOpen(true);
      return;
    }

    deleteNodeIds([id]);
  }, [
    deleteNodeIds,
    getEdges,
    getNode,
    id,
    canEdit,
    setIsDeleteCascadeDialogOpen
  ]);

  // Salva modifiche dal dialog
  const handleSaveFromDialog = useCallback(() => {
    if (!canEdit()) return;
    const nextMetadata = (() => {
      const base = { ...(editedMetadata || {}) } as Record<string, unknown>;
      const rawCustomTitle = base.customTitle;
      if (typeof rawCustomTitle !== 'string') return base;
      const trimmed = rawCustomTitle.trim();
      if (!trimmed) {
        delete base.customTitle;
        return base;
      }
      base.customTitle = trimmed;
      return base;
    })();

    setNodes((nodes) =>
      nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                ...n.data,
                label: editedLabel,
                metadata: nextMetadata
              }
            }
          : n
      )
    );
    setIsEditMode(false);
    setIsDetailOpen(false);
    toast.success('Node updated');
  }, [canEdit, id, editedLabel, editedMetadata, setNodes]);

  // Aggiungi nuovo metadata
  const handleAddMetadata = useCallback(() => {
    const key = newMetaKey.trim();
    if (!key) return;
    if (isReservedMergeMetadataKey(key)) {
      toast.error('This metadata key is managed internally.');
      return;
    }
    setEditedMetadata((prev) => ({
      ...prev,
      [key]: newMetaValue
    }));
    setNewMetaKey('');
    setNewMetaValue('');
  }, [newMetaKey, newMetaValue]);

  // Rimuovi metadata
  const handleRemoveMetadata = useCallback((key: string) => {
    setEditedMetadata((prev) => {
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
  }, []);

  // Aggiorna valore metadata
  const handleUpdateMetadata = useCallback((key: string, value: string) => {
    setEditedMetadata((prev) => ({
      ...prev,
      [key]: value
    }));
  }, []);

  // Sync quando si apre il dialog
  const openDetailDialog = useCallback(() => {
    // Special previews: file & maps
    if (data.type === 'maps') {
      setIsMapPreviewOpen(true);
      return;
    }

    const isFileType = [
      'document',
      'pdf',
      'docx',
      'xlsx',
      'txt',
      'csv',
      'json'
    ].includes(String(data.type));
    const hasFileUrl =
      Boolean((data as any)?.metadata?.fileUrl) ||
      Boolean(String(data.label ?? ''));
    if (isFileType && hasFileUrl) {
      setIsPreviewOpen(true);
      return;
    }

    setEditedLabel(data.label);
    setEditedMetadata(data.metadata || {});
    setIsEditMode(false);
    setIsDetailOpen(true);
  }, [
    data.label,
    data.metadata,
    data.type,
    setIsMapPreviewOpen,
    setIsPreviewOpen
  ]);

  // Helper function to detect file type from extension
  const detectFileType = useCallback((fileName: string): string => {
    const ext = fileName.toLowerCase().split('.').pop();
    const typeMap: Record<string, string> = {
      pdf: 'pdf',
      doc: 'docx',
      docx: 'docx',
      xls: 'xlsx',
      xlsx: 'xlsx',
      txt: 'txt',
      csv: 'csv',
      json: 'json',
      jpg: 'image',
      jpeg: 'image',
      png: 'image',
      gif: 'image',
      webp: 'image',
      mp4: 'video',
      webm: 'video',
      mov: 'video',
      mp3: 'audio',
      wav: 'audio',
      ogg: 'audio'
    };
    return typeMap[ext || ''] || 'document';
  }, []);

  // Handle file upload
  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!canEdit()) return;
      setIsUploadingFile(true);
      let toastId: string | number | undefined;

      try {
        const detectedType = detectFileType(file.name);
        const extension = file.name.toLowerCase().split('.').pop() || 'file';
        const extensionUpper = extension.toUpperCase();

        // Create FormData for upload
        const formData = new FormData();
        formData.append('file', file);

        // Show initial toast
        toastId = toast.loading(`Uploading ${file.name}...`, {
          description: '0%'
        });

        // Upload file with progress tracking using XMLHttpRequest
        const result = await new Promise<any>((resolve, reject) => {
          const xhr = new XMLHttpRequest();

          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const percentComplete = Math.round((e.loaded / e.total) * 100);
              toast.loading(`Uploading ${file.name}...`, {
                id: toastId,
                description: `${percentComplete}%`
              });
            }
          });

          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch (e) {
                reject(new Error('Invalid response'));
              }
            } else if (xhr.status === 413) {
              reject(new Error('File is too large. Maximum size is 50MB.'));
            } else {
              try {
                const errorData = JSON.parse(xhr.responseText);
                reject(
                  new Error(errorData.error || `Upload failed: ${xhr.status}`)
                );
              } catch {
                reject(new Error(`Upload failed: ${xhr.status}`));
              }
            }
          });

          xhr.addEventListener('error', () => {
            reject(new Error('Network error'));
          });

          xhr.open('POST', '/api/upload/temp');
          xhr.send(formData);
        });

        const fileUrl = result.url || result.path;
        if (!canEdit()) {
          toast.dismiss(toastId);
          return;
        }

        // Update node with file data
        setNodes((nodes) =>
          nodes.map((n) =>
            n.id === id
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    type: detectedType,
                    label: file.name,
                    metadata: {
                      ...n.data.metadata,
                      filename: file.name,
                      mimeType: file.type,
                      extension: extensionUpper,
                      size: file.size,
                      fileUrl: fileUrl,
                      customTitle:
                        detectedType === 'document'
                          ? `File ${extensionUpper}`
                          : undefined
                    }
                  }
                }
              : n
          )
        );

        toast.success(`File uploaded: ${file.name}`, { id: toastId });
      } catch (error) {
        console.error('Upload error:', error);
        toast.error(
          `Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          {
            id: toastId
          }
        );

        // Delete the node if upload fails
        setTimeout(() => {
          setNodes((nodes) => nodes.filter((n) => n.id !== id));
        }, 500);
      } finally {
        setIsUploadingFile(false);
      }
    },
    [canEdit, id, setNodes, detectFileType]
  );

  // Trigger file input click
  const handleUploadClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!canEdit()) return;
      fileInputRef.current?.click();
    },
    [canEdit]
  );

  // Handle file selection
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!canEdit()) return;
      const file = e.target.files?.[0];
      if (file) {
        handleFileUpload(file);
      }
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [canEdit, handleFileUpload]
  );

  // Collapse/Expand figli - ricorsivo per nascondere tutta la catena
  const handleCollapse = useCallback(() => {
    if (!canEdit()) return;
    const edges = getEdges();
    const newCollapsed = !isCollapsed;

    // Trigger pulse animation
    setIsPulsing(true);
    setTimeout(() => setIsPulsing(false), 300);

    // Trova tutti i nodi figli ricorsivamente
    const findChildrenRecursive = (
      nodeId: string,
      visited: Set<string> = new Set()
    ): string[] => {
      if (visited.has(nodeId)) return [];
      visited.add(nodeId);

      const directChildren = edges
        .filter((e) => e.source === nodeId)
        .map((e) => e.target);

      const allChildren: string[] = [...directChildren];
      for (const childId of directChildren) {
        allChildren.push(...findChildrenRecursive(childId, visited));
      }
      return allChildren;
    };

    const childrenIds = findChildrenRecursive(id);

    if (childrenIds.length === 0) return;

    // Salva il conteggio quando si fa collapse
    if (newCollapsed) {
      setCollapsedCount(childrenIds.length);

      // Anima fade out nodi prima di nascondere
      setNodes((nodes) =>
        nodes.map((n) =>
          childrenIds.includes(n.id)
            ? {
                ...n,
                data: { ...n.data, _collapsing: true }
              }
            : n
        )
      );

      // Anima fade out edge
      setEdges((edges) =>
        edges.map((e) =>
          childrenIds.includes(e.source) || childrenIds.includes(e.target)
            ? { ...e, data: { ...e.data, _collapsing: true } }
            : e
        )
      );

      // Nascondi dopo l'animazione
      setTimeout(() => {
        setNodes((nodes) =>
          nodes.map((n) =>
            childrenIds.includes(n.id)
              ? {
                  ...n,
                  hidden: true,
                  data: { ...n.data, _collapsing: undefined }
                }
              : n
          )
        );

        // Nascondi gli edge
        setEdges((edges) =>
          edges.map((e) =>
            childrenIds.includes(e.source) || childrenIds.includes(e.target)
              ? {
                  ...e,
                  hidden: true,
                  data: { ...e.data, _collapsing: undefined }
                }
              : e
          )
        );
      }, 250); // Durata animazione
    } else {
      // Expand: mostra i nodi e anima fade in
      setNodes((nodes) =>
        nodes.map((n) =>
          childrenIds.includes(n.id)
            ? {
                ...n,
                hidden: false,
                data: { ...n.data, _expanding: true }
              }
            : n
        )
      );

      // Mostra gli edge e anima fade in
      setEdges((edges) =>
        edges.map((e) =>
          childrenIds.includes(e.source) || childrenIds.includes(e.target)
            ? { ...e, hidden: false, data: { ...e.data, _expanding: true } }
            : e
        )
      );

      // Rimuovi i flag dopo l'animazione
      setTimeout(() => {
        setNodes((nodes) =>
          nodes.map((n) =>
            childrenIds.includes(n.id)
              ? {
                  ...n,
                  data: { ...n.data, _expanding: undefined }
                }
              : n
          )
        );

        setEdges((edges) =>
          edges.map((e) =>
            childrenIds.includes(e.source) || childrenIds.includes(e.target)
              ? { ...e, data: { ...e.data, _expanding: undefined } }
              : e
          )
        );
      }, 250);
    }

    setIsCollapsed(newCollapsed);
  }, [canEdit, id, isCollapsed, getEdges, setNodes, setEdges]);

  const handleCopy = useCallback(async () => {
    const node = getNode(id);
    if (!node) return;

    // Trova gli edge collegati a questo nodo
    const connectedEdges = getEdges().filter(
      (e) => e.source === id || e.target === id
    );

    // Salva nella clipboard del browser (se supportato)
    const clipboardData = {
      nodes: [node],
      edges: connectedEdges.filter((e) => e.source === id && e.target === id) // Solo edge interni (improbabile per singolo nodo)
    };

    // Salva in localStorage per persistenza
    try {
      localStorage.setItem('osint-clipboard', JSON.stringify(clipboardData));
      const copyId = `OSINT_COPY_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      if (graphId) {
        storeGraphNodeClipboard(copyId, [{ graphId, nodeId: id }]);
      }
      await navigator.clipboard.writeText(
        createGraphNodeClipboardMarker(copyId)
      );
      toast.success('Node copied');
    } catch (err) {
      toast.error('Failed to copy node');
    }
  }, [id, graphId, getNode, getEdges]);

  const handleDuplicate = useCallback(() => {
    const node = getNode(id);
    if (!node) return;
    setNodes((nodes) => [
      ...nodes,
      {
        ...node,
        id: `node-${Date.now()}`,
        position: { x: node.position.x + 50, y: node.position.y + 50 },
        selected: false
      }
    ]);
    toast.success('Node duplicated');
  }, [id, getNode, setNodes]);

  const handleChangeType = useCallback(
    (newType: string) => {
      setNodes((nodes) =>
        nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, type: newType } } : n
        )
      );
      toast.success(`Type changed to ${typeConfig[newType]?.label}`);
    },
    [id, setNodes]
  );

  const handleChangeCustomColor = useCallback(
    (colorHex: string | null) => {
      setNodes((nodes) =>
        nodes.map((n) => {
          if (n.id !== id) return n;
          const prevMeta = (n.data as OSINTNodeData).metadata ?? {};
          const nextMeta: any = { ...prevMeta };

          if (!colorHex) {
            delete nextMeta.customColor;
            delete nextMeta.headerTextColor;
            delete nextMeta.autoColorFromLogo;
          } else {
            nextMeta.customColor = colorHex;
            nextMeta.autoColorFromLogo = false;
            if (typeof nextMeta.headerTextColor !== 'string')
              nextMeta.headerTextColor = colorHex;
          }

          return {
            ...n,
            data: {
              ...n.data,
              metadata: nextMeta
            }
          };
        })
      );
    },
    [id, setNodes]
  );

  const handleOpenNodeContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      try {
        event.stopPropagation();
      } catch {}

      const current = getNode(id);
      if (!current) return;

      const selectedNodes = getNodes().filter((n) => n.selected);
      const isMultiSelected = selectedNodes.length > 1 && current.selected;

      if (!isMultiSelected) {
        setNodes((nodes) =>
          nodes.map((n) => ({ ...n, selected: n.id === id }))
        );
        setEdges((edges) => edges.map((e) => ({ ...e, selected: false })));
      }

      setNodeContextMenuPosition({ x: event.clientX, y: event.clientY });
    },
    [getNode, getNodes, id, setEdges, setNodes]
  );

  const canUnmergeThisNode = useMemo(() => {
    const node = getNode(id) as any;
    if (!node) return false;
    return canUnmergeNode(node);
  }, [getNode, id]);

  const handleUnmerge = useCallback(() => {
    const current = getNode(id) as any;
    if (!current) return;
    if (!canUnmergeNode(current)) return;
    try {
      const { nextNodes, nextEdges, restoredNodeIds } = unmergeNode({
        nodeId: id,
        nodes: getNodes() as any,
        edges: getEdges() as any
      });
      setNodes(nextNodes as any);
      setEdges(nextEdges as any);
      toast.success(`Unmerged ${restoredNodeIds.length} nodes`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unmerge failed');
    }
  }, [getEdges, getNode, getNodes, id, setEdges, setNodes]);

  const handleSaveLabel = useCallback(() => {
    if (!canEdit()) return;
    if (editLabel.trim()) {
      setNodes((nodes) =>
        nodes.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, label: editLabel.trim() } }
            : n
        )
      );
    } else {
      setEditLabel(data.label); // Reset se vuoto
    }
    setIsEditing(false);
  }, [canEdit, id, editLabel, data.label, setNodes, setIsEditing]);

  // Helper per aggiungere entità al grafo con posizionamento intelligente
  const addEntitiesToGraph = useCallback(
    (
      entities: OSINTEntity[],
      edges: PluginEdge[],
      baseX: number,
      baseY: number,
      selectedIds?: string[]
    ) => {
      // Get existing node IDs to avoid duplicates
      const currentNodes = getNodes();
      const existingNodeIds = new Set(currentNodes.map((n) => n.id));

      // Filter by selection and exclude duplicates
      const filteredEntities = selectedIds
        ? entities.filter(
            (e) => selectedIds.includes(e.id) && !existingNodeIds.has(e.id)
          )
        : entities.filter((e) => !existingNodeIds.has(e.id));

      console.log('🔍 addEntitiesToGraph - Filtering duplicates:', {
        total: entities.length,
        selected: selectedIds?.length || entities.length,
        alreadyExists: selectedIds
          ? selectedIds.filter((id) => existingNodeIds.has(id)).length
          : entities.filter((e) => existingNodeIds.has(e.id)).length,
        toAdd: filteredEntities.length
      });

      // If no new nodes to add, show message and return
      if (filteredEntities.length === 0) {
        console.log('⚠️ All selected nodes already in graph');
        return;
      }

      // Crea nodi con posizione temporanea (verrà calcolata dal layout)
      const tempNodes: Node<OSINTNodeData>[] = filteredEntities.map(
        (entity) => {
          const rawType = String((entity as any)?.type ?? '').trim();
          const nodeType = (
            rawType === 'file' ? 'document' : rawType
          ) as OSINTNodeData['type'];
          const label = entity.label || entity.value;
          const metadata = isClassicResultType(nodeType)
            ? withEntityValue(entity.metadata, entity.value, label)
            : entity.metadata;
          const dimensions = resultNodeSize(nodeType, metadata);

          return {
            id: entity.id,
            type: 'osint',
            position: { x: baseX, y: baseY + 150 }, // Posizione temporanea
            data: {
              label,
              type: nodeType,
              metadata
            },
            // Dimensioni iniziali per nodi con dimensioni specifiche
            ...(dimensions && { style: dimensions })
          };
        }
      );

      // Le posizioni persistite devono restare sempre quelle del grafo libero:
      // output vicino al padre, senza influenzare altri livelli.
      const positionedNodes = positionTransformResultNodes({
        existingNodes: currentNodes,
        newNodes: tempNodes,
        anchorNodeId: id,
        direction: 'down',
        spacingPreset
      });

      // Filtra gli edge: entrambi gli estremi devono esistere sul grafo
      // (nuovi nodi appena aggiunti O nodi già presenti — serve per gli add
      // incrementali dei flow, dove il parent è stato aggiunto a uno step
      // precedente). Niente edge duplicati (stesso id già sul grafo).
      const selectedEntityIds = new Set(filteredEntities.map((e) => e.id));
      selectedEntityIds.add(id); // Aggiungi anche il nodo sorgente

      const existingEdgeIds = new Set(getEdges().map((e) => e.id));
      const filteredEdges = edges.filter(
        (edge) =>
          !existingEdgeIds.has(edge.id) &&
          (selectedEntityIds.has(edge.sourceId) ||
            existingNodeIds.has(edge.sourceId)) &&
          (selectedEntityIds.has(edge.targetId) ||
            existingNodeIds.has(edge.targetId))
      );

      // Se molti edge (>4), mostra label solo sul primo edge
      const showLabels = filteredEdges.length <= 4;
      const manyEdges = filteredEdges.length > 3;
      const veryManyEdges = filteredEdges.length > 5;

      // Crea edge con styling ottimizzato per visualizzazione multipla
      const newEdges: Edge[] = filteredEdges.map((edge, index) => ({
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        type: 'osint',
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
          // Mostra label solo se pochi edge, oppure solo sul primo
          label: showLabels ? edge.label : index === 0 ? edge.label : undefined,
          relationship: edge.relationship,
          edgeType: 'default', // Bezier curve per edge più eleganti
          strokeWidth: manyEdges ? 1.5 : 2, // Edge più sottili quando ce ne sono molti
          dashed: false,
          _opacity: veryManyEdges ? 0.7 : 1 // Opacity ridotta per molti edge
        }
      }));

      setNodes((nodes) => [...nodes, ...positionedNodes]);
      setEdges((edges) => [...edges, ...newEdges]);
    },
    [id, setNodes, setEdges, getNodes, getEdges, graphViewMode, spacingPreset]
  );

  // Poll async job status
  const pollAsyncJob = useCallback(
    async (
      jobId: string,
      transformName: string,
      position: { x: number; y: number },
      isExternal: boolean = false,
      logId?: string
    ) => {
      const maxAttempts = 60; // 60 attempts = 5 minutes with 5s interval
      let attempts = 0;

      const poll = async () => {
        try {
          const response = await fetch(`/api/jobs/${jobId}`);

          if (!response.ok) {
            throw new Error(`Failed to fetch job status: ${response.status}`);
          }

          const job = await response.json();

          // Update progress if available
          if (job.progress !== undefined && job.progressMessage) {
            console.log(
              `📊 Job ${jobId}: ${job.progress}% - ${job.progressMessage}`
            );

            // Update async job state for external plugins
            if (isExternal) {
              setAsyncJobState({
                jobId,
                progress: job.progress || 0,
                message: job.progressMessage || 'Processing...',
                isExternal: true
              });
            }

            // Update log with progress
            if (logId) {
              updateLog(logId, {
                progress: job.progress,
                message: job.progressMessage
              });
            }
          }

          // Check if completed
          if (job.isCompleted && job.result) {
            // Reset async job state
            setAsyncJobState(null);

            // Update log with completion - widget will show this
            if (logId) {
              updateLog(logId, {
                status: 'completed',
                resultCount: job.result.entities?.length || 0,
                endTime: new Date(),
                message: job.result.message,
                results: {
                  entities: job.result.entities || [],
                  edges: job.result.edges || []
                }
              });
            }

            // Add results to graph (≤3 results are added directly, >3 will be handled by context auto-sheet)
            if (
              job.result.entities &&
              job.result.entities.length > 0 &&
              job.result.entities.length <= 3
            ) {
              addEntitiesToGraph(
                job.result.entities,
                job.result.edges || [],
                position.x,
                position.y
              );
            }
            return; // Stop polling
          }

          // Check if failed
          if (job.isFailed) {
            // Reset async job state
            setAsyncJobState(null);

            // Update log with failure - widget will show this
            if (logId) {
              updateLog(logId, {
                status: 'failed',
                error: job.error || 'Unknown error',
                endTime: new Date()
              });
            }
            return; // Stop polling
          }

          // Continue polling if still active
          if (job.isActive && attempts < maxAttempts) {
            attempts++;
            setTimeout(poll, 5000); // Poll every 5 seconds
          } else if (attempts >= maxAttempts) {
            // Reset async job state on timeout
            setAsyncJobState(null);

            // Update log with timeout - widget will show this
            if (logId) {
              updateLog(logId, {
                status: 'failed',
                error: 'Timeout: Job took too long to complete',
                endTime: new Date()
              });
            }
          }
        } catch (error) {
          console.error('Error polling job:', error);

          // Reset async job state on error
          setAsyncJobState(null);

          // Update log with error - widget will show this
          if (logId) {
            updateLog(logId, {
              status: 'failed',
              error: 'Failed to check job status',
              endTime: new Date()
            });
          }
        }
      };

      // Start polling
      poll();
    },
    [addEntitiesToGraph, updateLog]
  );

  function getEffectiveTransformValue(args: {
    label: string;
    metadata: unknown;
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
    // Non serve inviare la payload di merge ai plugin; resta solo metadata "utile".
    delete m.__merge;
    delete m.merged;
    delete m.mergedChildCount;
    return m as Record<string, unknown>;
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
    const canonicalEntityById = new Map<string, any>();
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
      canonicalEntityById.set(id, e);
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
      // keep directed (source->target) to avoid collapsing opposite directions
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

  function getMergedValuesForTransformFromNode(node: any) {
    const nodeData: any = node?.data ?? {};
    const meta: any = nodeData?.metadata ?? {};
    const payload: any = meta?.__merge;
    const mergedList: any[] = Array.isArray(meta?.merged) ? meta.merged : [];

    const primary = getEffectiveTransformValue({
      label: nodeData?.label ?? '',
      metadata: meta
    });

    const fromMergedList = mergedList
      .map((it) =>
        String(it?.value ?? it?.label ?? '')
          .split('\n')[0]
          ?.trim()
      )
      .filter(Boolean);

    // Fallback per vecchi merge: se `merged` non è disponibile/affidabile, proviamo a leggere dai nodi snapshot.
    // Nota: nello snapshot la metadata può essere vuota, quindi usiamo prima `data.value` se presente.
    const fromPayloadNodes =
      fromMergedList.length === 0 && Array.isArray(payload?.nodes)
        ? payload.nodes
            .map((n: any) => {
              const explicit = String(n?.data?.value ?? '').trim();
              if (explicit) return explicit;
              const label = String(n?.data?.label ?? '').trim();
              const m = n?.data?.metadata;
              return getEffectiveTransformValue({ label, metadata: m });
            })
            .map((v: any) => String(v ?? '').trim())
            .filter(Boolean)
        : [];

    const allRaw = [primary, ...fromMergedList, ...fromPayloadNodes]
      .map((v) => String(v).trim())
      .filter(Boolean);

    const unique = Array.from(new Set(allRaw));
    const countHint = Array.isArray(payload?.nodeIds)
      ? payload.nodeIds.length
      : unique.length;

    return { primary, values: unique, countHint };
  }

  const handleTransform = useCallback(
    async (item: TransformWithPlugin) => {
      if (!canEdit()) return;
      const currentNode = getNode(id);
      if (!currentNode || isTransforming) return;

      setIsAddMenuOpen(false);

      const isMerged = canUnmergeNode(currentNode);
      if (isMerged) {
        const { primary, values } = getMergedValuesForTransformFromNode(
          currentNode as any
        );
        // Chiedi sempre su nodi merged (anche se i valori “unici” risultano 1).
        setMergedTransformScope('primary');
        setPendingMergedTransform({
          item,
          values: values.length ? values : [primary].filter(Boolean),
          primary
        });
        return;
      }

      setIsTransforming(true);

      // Determina il valore effettivo da usare per la transform
      const effectiveValue = getEffectiveTransformValue({
        label: data.label,
        metadata: data.metadata
      });

      // Create log entry - this will show in the widget
      const logId = addLog({
        pluginName: item.plugin.name,
        transformName: item.transform.name,
        entityValue: effectiveValue,
        status: 'running',
        progress: 0,
        message: 'Starting...',
        sourceNodeId: id,
        sourcePosition: {
          x: currentNode.position.x,
          y: currentNode.position.y
        }
      });

      try {
        // Carica configurazione plugin dal context (database)
        const pluginConfig: Record<string, unknown> =
          pluginConfigs[item.plugin.id] || {};

        // Crea input per la transform con config
        const input = createTransformInput(
          id,
          data.type,
          effectiveValue,
          getTransformMetadata(data.metadata),
          pluginConfig
        );

        // Esegui la transform chiamando l'API
        const result = await executeTransform(
          item.plugin.id,
          item.transform.id,
          input,
          graphId,
          { onProgress: (update) => updateLog(logId, update) }
        );

        // Debug logging
        console.log('=== TRANSFORM RESULT RECEIVED ===');
        console.log('Plugin:', item.plugin.id);
        console.log('Transform:', item.transform.id);
        console.log('Success:', result.success);
        console.log('Error:', result.error || 'none');
        console.log('Entities:', result.entities?.length || 0);
        if (result.entities) {
          result.entities.forEach((e, i) => {
            console.log(`  Entity ${i + 1}:`, {
              id: e.id,
              type: e.type,
              value:
                e.value?.substring(0, 150) +
                (e.value?.length > 150 ? '...' : ''),
              label: e.label,
              metadata: e.metadata
            });
          });
        }
        console.log('Edges:', result.edges?.length || 0);
        console.log('Message:', result.message);
        console.log('=================================');

        if (!result.success) {
          // Update log with failure - widget will show this
          updateLog(logId, {
            status: 'failed',
            error: result.error || 'Transform failed',
            endTime: new Date()
          });

          setIsTransforming(false);
          return;
        }

        // Handle async job - start polling
        if (result.async && result.jobId) {
          // Check if plugin is external
          const isExternalPlugin = item.plugin.type === 'addon';

          // Set initial async job state
          setAsyncJobState({
            jobId: result.jobId,
            progress: 0,
            message: 'Starting...',
            isExternal: isExternalPlugin
          });

          // Start polling the job
          pollAsyncJob(
            result.jobId,
            item.transform.name,
            currentNode.position,
            isExternalPlugin,
            logId
          );
          setIsTransforming(false);
          return;
        }

        // Verifica che ci siano entities e edges
        const entities = result.entities || [];
        const edges = result.edges || [];

        // Update log with completion - widget will show this
        updateLog(logId, {
          status: 'completed',
          resultCount: entities.length,
          endTime: new Date(),
          message: (result as any).message,
          results: {
            entities: entities,
            edges: edges
          }
        });

        if (entities.length === 0) {
          setIsTransforming(false);
          return;
        }

        // If >3 results, the context will auto-open the results sheet.
        // For ≤3 results, add directly to the graph.
        if (entities.length <= 3) {
          addEntitiesToGraph(
            entities,
            edges,
            currentNode.position.x,
            currentNode.position.y
          );
        }
      } catch (error) {
        // Update log with error - widget will show this
        updateLog(logId, {
          status: 'failed',
          error:
            error instanceof Error
              ? error.message
              : 'Transform execution failed',
          endTime: new Date()
        });
      } finally {
        setIsTransforming(false);
      }
    },
    [
      id,
      data.type,
      data.label,
      data.metadata,
      graphId,
      getNode,
      setNodes,
      setEdges,
      isTransforming,
      addLog,
      updateLog,
      getMergedValuesForTransformFromNode,
      canEdit
    ]
  );

  // Esegue un flow su questo nodo (definizione già caricata): cammina la
  // catena di transform (engine) e aggiunge al grafo i risultati per step.
  const executeFlowOnNode = useCallback(
    async (
      flow: FlowSummary,
      def: { nodes: unknown[]; edges: unknown[]; name: string }
    ) => {
      if (!canEdit()) return;
      const currentNode = getNode(id);
      if (!currentNode || isTransforming) return;

      setIsTransforming(true);

      const effectiveValue = getEffectiveTransformValue({
        label: data.label,
        metadata: data.metadata
      });

      const logId = addLog({
        pluginName: 'Flow',
        transformName: flow.name,
        entityValue: effectiveValue,
        status: 'running',
        progress: 0,
        message: 'Running flow…',
        sourceNodeId: id,
        sourcePosition: {
          x: currentNode.position.x,
          y: currentNode.position.y
        }
      });

      // History best-effort su FlowRun
      const runId = await startFlowRunRecord({
        flowId: flow.id,
        kind: 'run',
        inputType: data.type,
        inputValue: effectiveValue,
        graphId
      });

      try {
        const result = await executeFlow({
          nodes: def.nodes as StoredFlowNode[],
          edges: def.edges as StoredFlowEdge[],
          input: {
            entityId: id,
            entityType: data.type,
            entityValue: effectiveValue,
            metadata: getTransformMetadata(data.metadata)
          },
          graphId,
          pluginConfigs,
          onStep: (step) => {
            updateLog(logId, {
              message: `${step.name}: ${step.status}…`
            });
            // Add progressivo: i risultati di ogni step compaiono sul grafo
            // appena lo step completa (i duplicati sono filtrati dentro
            // addEntitiesToGraph).
            if (step.status === 'completed' && step.entities.length > 0) {
              addEntitiesToGraph(
                step.entities,
                step.edges as PluginEdge[],
                currentNode.position.x,
                currentNode.position.y
              );
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

        // I nodi sono già stati aggiunti progressivamente da onStep:
        // viewed=true evita che il results sheet si auto-apra (i risultati
        // restano comunque consultabili dal logger).
        updateLog(logId, {
          status: 'completed',
          resultCount: result.entities.length,
          endTime: new Date(),
          message: `${result.steps.filter((s) => s.status === 'completed').length} steps completed`,
          viewed: true,
          results: {
            entities: result.entities,
            edges: result.edges
          }
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
        setIsTransforming(false);
      }
    },
    [
      id,
      data.type,
      data.label,
      data.metadata,
      graphId,
      pluginConfigs,
      getNode,
      isTransforming,
      addLog,
      updateLog,
      addEntitiesToGraph,
      canEdit
    ]
  );

  // Load the flow definition before execution.
  const handleRunFlow = useCallback(
    async (flow: FlowSummary) => {
      if (!canEdit() || isTransforming) return;
      setIsAddMenuOpen(false);

      const def = await fetchFlowDefinition(flow.id);
      if (!canEdit()) return;
      if (!def) {
        toast.error('Failed to load flow definition');
        return;
      }
      await executeFlowOnNode(flow, def);
    },
    [canEdit, executeFlowOnNode, isTransforming]
  );

  const handleConfirmMergedTransform = useCallback(async () => {
    if (!canEdit()) return;
    const pending = pendingMergedTransform;
    if (!pending) return;

    const currentNode = getNode(id);
    if (!currentNode || isTransforming) return;

    setPendingMergedTransform(null);
    setIsTransforming(true);
    setIsAddMenuOpen(false);

    const values = pending.values;
    const primary =
      pending.primary ||
      getEffectiveTransformValue({
        label: data.label,
        metadata: data.metadata
      });
    const runValues =
      mergedTransformScope === 'selected'
        ? mergedTransformSelectedValues
        : [primary].filter(Boolean);

    const logId = addLog({
      pluginName: pending.item.plugin.name,
      transformName: pending.item.transform.name,
      entityValue:
        mergedTransformScope === 'selected'
          ? `${primary || values[0]} (+${Math.max(0, runValues.length - 1)})`
          : primary || values[0] || '',
      status: 'running',
      progress: 0,
      message:
        mergedTransformScope === 'selected'
          ? `Running on ${runValues.length} selected merged values...`
          : 'Starting...',
      sourceNodeId: id,
      sourcePosition: {
        x: currentNode.position.x,
        y: currentNode.position.y
      }
    });

    try {
      const pluginConfig: Record<string, unknown> =
        pluginConfigs[pending.item.plugin.id] || {};

      // If the user chose "primary only", keep full behavior (incl. async).
      if (mergedTransformScope === 'primary') {
        const input = createTransformInput(
          id,
          data.type,
          primary,
          getTransformMetadata(data.metadata),
          pluginConfig
        );
        const result = await executeTransform(
          pending.item.plugin.id,
          pending.item.transform.id,
          input,
          graphId,
          { onProgress: (update) => updateLog(logId, update) }
        );

        if (!result.success) {
          updateLog(logId, {
            status: 'failed',
            error: result.error || 'Transform failed',
            endTime: new Date()
          });
          return;
        }

        if (result.async && result.jobId) {
          const isExternalPlugin = pending.item.plugin.type === 'addon';
          setAsyncJobState({
            jobId: result.jobId,
            progress: 0,
            message: 'Starting...',
            isExternal: isExternalPlugin
          });
          pollAsyncJob(
            result.jobId,
            pending.item.transform.name,
            currentNode.position,
            isExternalPlugin,
            logId
          );
          return;
        }

        const entities = result.entities || [];
        const edges = result.edges || [];
        updateLog(logId, {
          status: 'completed',
          resultCount: entities.length,
          endTime: new Date(),
          results: { entities, edges }
        });
        if (entities.length > 0 && entities.length <= 3) {
          addEntitiesToGraph(
            entities,
            edges,
            currentNode.position.x,
            currentNode.position.y
          );
        }
        return;
      }

      const combinedEntities: any[] = [];
      const combinedEdges: any[] = [];
      let okCount = 0;

      for (let i = 0; i < runValues.length; i++) {
        const v = String(runValues[i] ?? '').trim();
        if (!v) continue;

        updateLog(logId, {
          status: 'running',
          progress: runValues.length > 1 ? i / runValues.length : 0,
          message:
            runValues.length > 1
              ? `Running ${i + 1}/${runValues.length}...`
              : 'Running...'
        });

        const input = createTransformInput(
          id,
          data.type,
          v,
          getTransformMetadata(data.metadata),
          pluginConfig
        );

        const result = await executeTransform(
          pending.item.plugin.id,
          pending.item.transform.id,
          input,
          graphId
        );

        if (!result.success) continue;
        if (result.async) {
          // Batch + async è complesso (multi-job).
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

      const reduced = reduceTransformResultsByTypeAndValue({
        entities: combinedEntities,
        edges: combinedEdges
      });

      updateLog(logId, {
        status: okCount > 0 ? 'completed' : 'failed',
        ...(okCount > 0
          ? {
              resultCount: reduced.entities.length,
              results: { entities: reduced.entities, edges: reduced.edges }
            }
          : { error: 'Transform failed on all selected merged values.' }),
        endTime: new Date()
      });

      if (reduced.entities.length > 0 && reduced.entities.length <= 3) {
        addEntitiesToGraph(
          reduced.entities,
          reduced.edges,
          currentNode.position.x,
          currentNode.position.y
        );
        toast.success(
          `Added ${reduced.entities.length} node${reduced.entities.length === 1 ? '' : 's'} and ${
            reduced.edges.length
          } link${reduced.edges.length === 1 ? '' : 's'}.`
        );
      } else if (reduced.entities.length > 3) {
        toast.info(
          `Found ${reduced.entities.length} results. Open the Results panel to review and add them.`
        );
      } else if (reduced.entities.length === 0) {
        toast.info(
          okCount > 0
            ? 'No results were added because no unique results were returned.'
            : 'Transform failed on all selected merged values.'
        );
      }
    } catch (error) {
      updateLog(logId, {
        status: 'failed',
        error:
          error instanceof Error ? error.message : 'Transform execution failed',
        endTime: new Date()
      });
    } finally {
      setIsTransforming(false);
    }
  }, [
    addEntitiesToGraph,
    canEdit,
    addLog,
    data.label,
    data.metadata,
    data.type,
    getNode,
    graphId,
    id,
    isTransforming,
    mergedTransformScope,
    mergedTransformSelectedValues,
    pendingMergedTransform,
    pluginConfigs,
    updateLog
  ]);

  const startEditing = useCallback(() => {
    if (!canEdit()) return;
    setEditLabel(data.label);
    setIsEditing(true);
  }, [canEdit, data.label, setIsEditing]);

  // Stile comune per gli handle - visibili solo su hover
  const handleClass = cn(
    // Base dimensions and positioning
    '!w-3 !h-3 !bg-transparent !border-0',
    'relative z-50',

    // Extended hit area (invisible)
    'before:content-[""] before:absolute before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2',
    'before:w-10 before:h-10 before:rounded-full before:bg-transparent',

    // Visible dot
    'after:content-[""] after:absolute after:top-1/2 after:left-1/2 after:-translate-x-1/2 after:-translate-y-1/2',
    'after:w-3 after:h-3 after:bg-indigo-400 after:border-2 after:border-white after:rounded-full after:transition-all',

    // Visibility logic
    'after:opacity-0 hover:after:opacity-100',
    'hover:after:bg-indigo-500 hover:after:scale-125'
  );

  const isMediaNode = data.type === 'media_url';
  const isCard = isCardNode(data);
  const filePreviewSize = filePreviewDimensions(data);
  const isFilePreviewNode = Boolean(filePreviewSize);
  const isResizableNode =
    isCard ||
    isFilePreviewNode ||
    isMediaNode ||
    data.type === 'ai_insight' ||
    data.type === 'note' ||
    data.type === 'maps' ||
    data.type === 'group' ||
    data.type === 'text';

  // In ReactFlow manual/auto vogliamo box coerenti: anche i file devono allinearsi
  // ai nodi "classici" per evitare handle / UI overlay sfasati.
  const isClassicFixedNode = !isResizableNode;

  // Determina lo stato dell'animazione in base ai flag
  const getAnimationState = () => {
    if ((data as any)._collapsing) {
      return { opacity: 0, scale: 0.8 };
    }
    if ((data as any)._expanding) {
      return { opacity: 1, scale: 1 };
    }
    if (isPulsing) {
      return { opacity: 1, scale: 1.08 };
    }
    return {
      opacity: isVisible ? 1 : 0,
      scale: isVisible ? 1 : 0.95
    };
  };

  // Calcola il colore del glow in base al tipo di nodo
  const glowColor = () => {
    const colors: Record<string, string> = {
      email: '59, 130, 246', // blue
      domain: '34, 197, 94', // green
      ip: '251, 191, 36', // amber
      person: '168, 85, 247', // purple
      username: '236, 72, 153', // pink
      phone: '6, 182, 212', // cyan
      organization: '99, 102, 241' // indigo
      // ... altri tipi usano il default
    };
    return colors[data.type] || '100, 116, 139'; // slate di default
  };

  return (
    <Fragment>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={getAnimationState()}
        transition={{
          duration: isPulsing
            ? 0.3
            : (data as any)._collapsing || (data as any)._expanding
              ? 0.25
              : 0.2,
          ease: isPulsing ? [0.4, 0, 0.2, 1] : 'easeInOut'
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <div
          className='relative h-full w-full'
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => !isAddMenuOpen && setIsHovered(false)}
          onContextMenu={handleOpenNodeContextMenu}
        >
          {/* Resizer per nodi media, ai_insight e text */}
          {isResizableNode && canEdit() && (
            <NodeResizer
              minWidth={data.type === 'text' ? 50 : 200}
              minHeight={
                data.type === 'text'
                  ? 30
                  : data.type === 'note'
                    ? shouldHideHeader
                      ? NOTE_MIN_HEIGHT.plain
                      : NOTE_MIN_HEIGHT.withHeader
                    : (filePreviewSize?.minHeight ?? 140)
              }
              isVisible={selected || isHovered}
              lineClassName='!border-primary'
              handleClassName='!w-2 !h-2 !bg-primary !border-primary'
              onResize={(event, params) => {
                if (!canEdit()) return;
                // Per nodi text: calcola fontSize in base alle dimensioni
                if (data.type === 'text') {
                  // Usa la dimensione maggiore tra width e height per calcolare fontSize
                  const size = Math.max(
                    params.width || 200,
                    params.height || 100
                  );
                  const fontSize = Math.max(
                    12,
                    Math.min(120, Math.round(size / 6))
                  );

                  setNodes((nodes) =>
                    nodes.map((n) =>
                      n.id === id
                        ? {
                            ...n,
                            data: {
                              ...n.data,
                              metadata: {
                                ...n.data.metadata,
                                fontSize
                              }
                            }
                          }
                        : n
                    )
                  );
                }
              }}
            />
          )}

          {/* Handles */}
          {!isFlowDecoration &&
            (isLockedLayout ? (
              lockedAxis === 'vertical' ? (
                <>
                  <Handle
                    type='target'
                    position={Position.Left}
                    id='left'
                    isConnectableStart={false}
                    className={handleClass}
                  />
                  <Handle
                    type='source'
                    position={Position.Right}
                    id='right'
                    isConnectableEnd={false}
                    className={handleClass}
                  />
                </>
              ) : (
                <>
                  <Handle
                    type='target'
                    position={Position.Top}
                    id='top'
                    isConnectableStart={false}
                    className={handleClass}
                  />
                  <Handle
                    type='source'
                    position={Position.Bottom}
                    id='bottom'
                    isConnectableEnd={false}
                    className={cn(handleClass, '!z-10')}
                  />
                </>
              )
            ) : (
              <>
                {/* ConnectionMode.Loose rende ogni handle utilizzabile in entrambe le direzioni. */}
                <Handle
                  type='source'
                  position={Position.Top}
                  id='top'
                  className={handleClass}
                />
                <Handle
                  type='source'
                  position={Position.Right}
                  id='right'
                  className={handleClass}
                />
                <Handle
                  type='source'
                  position={Position.Bottom}
                  id='bottom'
                  className={cn(handleClass, '!z-10')}
                />
                <Handle
                  type='source'
                  position={Position.Left}
                  id='left'
                  className={handleClass}
                />
              </>
            ))}

          {/* Group Label - Outside the box (only if labelVisible) */}
          {data.type === 'group' && data.metadata?.labelVisible !== false && (
            <div
              className='nodrag nopan absolute bg-transparent'
              style={{
                ...(data.metadata?.labelPosition === 'top' ||
                !data.metadata?.labelPosition
                  ? {
                      top: -30,
                      left: 10
                    }
                  : data.metadata?.labelPosition === 'bottom'
                    ? {
                        bottom: -30,
                        left: 10
                      }
                    : data.metadata?.labelPosition === 'left'
                      ? {
                          left: -10,
                          top: 10,
                          transform: 'translateX(-100%)'
                        }
                      : {
                          right: -10,
                          top: 10,
                          transform: 'translateX(100%)'
                        }),
                color: (data.metadata?.groupBorderColor as string) || '#64748b'
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsEditing(true);
                setTimeout(() => {
                  inputRef.current?.focus();
                  if (inputRef.current instanceof HTMLInputElement) {
                    inputRef.current.select();
                  }
                }, 50);
              }}
            >
              {isEditing ? (
                <Input
                  ref={inputRef as React.RefObject<HTMLInputElement>}
                  value={editLabel}
                  readOnly={!canEdit()}
                  onChange={(e) => setEditLabel(e.target.value)}
                  onBlur={handleSaveLabel}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveLabel();
                    if (e.key === 'Escape') {
                      setEditLabel(data.label);
                      setIsEditing(false);
                    }
                  }}
                  className='nodrag nopan h-8 px-2 py-1 text-sm font-semibold'
                  placeholder='Group name...'
                  autoFocus
                />
              ) : (
                <div className='cursor-text px-2 py-1 text-sm font-semibold transition-opacity hover:opacity-70'>
                  {getNodeDisplayLabel({
                    type: data.type as NodeType,
                    label: data.label,
                    metadata: data.metadata
                  }) || 'Group'}
                </div>
              )}
            </div>
          )}

          {/* Stacked Cards Effect - quando collapsato o merged */}
          {((isCollapsed && collapsedCount > 0) || isMerged) &&
            data.type !== 'group' && (
              <>
                {/* Carta 2 (più indietro) */}
                <div
                  className='absolute rounded-xl border shadow-sm'
                  style={{
                    top: '5px',
                    left: '7px',
                    right: '-7px',
                    bottom: '-5px',
                    zIndex: -2,
                    backgroundColor:
                      theme === 'dark'
                        ? data.metadata?.customColor
                          ? `${data.metadata.customColor}15`
                          : config.headerBg.includes('blue')
                            ? '#3b82f618'
                            : config.headerBg.includes('green') ||
                                config.headerBg.includes('emerald')
                              ? '#22c55e18'
                              : config.headerBg.includes('amber') ||
                                  config.headerBg.includes('yellow')
                                ? '#f59e0b18'
                                : config.headerBg.includes('purple')
                                  ? '#a855f718'
                                  : config.headerBg.includes('pink')
                                    ? '#ec489918'
                                    : config.headerBg.includes('cyan')
                                      ? '#06b6d418'
                                      : config.headerBg.includes('indigo')
                                        ? '#6366f118'
                                        : '#64748b18'
                        : data.metadata?.customColor
                          ? `${data.metadata.customColor}08`
                          : config.headerBg.includes('blue')
                            ? '#3b82f610'
                            : config.headerBg.includes('green') ||
                                config.headerBg.includes('emerald')
                              ? '#22c55e10'
                              : config.headerBg.includes('amber') ||
                                  config.headerBg.includes('yellow')
                                ? '#f59e0b10'
                                : config.headerBg.includes('purple')
                                  ? '#a855f710'
                                  : config.headerBg.includes('pink')
                                    ? '#ec489910'
                                    : config.headerBg.includes('cyan')
                                      ? '#06b6d410'
                                      : config.headerBg.includes('indigo')
                                        ? '#6366f110'
                                        : '#64748b10',
                    borderColor:
                      theme === 'dark'
                        ? data.metadata?.customColor
                          ? `${data.metadata.customColor}40`
                          : 'rgba(255,255,255,0.12)'
                        : data.metadata?.customColor
                          ? `${data.metadata.customColor}30`
                          : 'rgba(0,0,0,0.1)',
                    opacity: theme === 'dark' ? 0.6 : 0.5
                  }}
                />
                {/* Carta 1 (più vicina) */}
                <div
                  className='absolute rounded-xl border shadow-sm'
                  style={{
                    top: '3px',
                    left: '4px',
                    right: '-4px',
                    bottom: '-3px',
                    zIndex: -1,
                    backgroundColor:
                      theme === 'dark'
                        ? data.metadata?.customColor
                          ? `${data.metadata.customColor}20`
                          : config.headerBg.includes('blue')
                            ? '#3b82f622'
                            : config.headerBg.includes('green') ||
                                config.headerBg.includes('emerald')
                              ? '#22c55e22'
                              : config.headerBg.includes('amber') ||
                                  config.headerBg.includes('yellow')
                                ? '#f59e0b22'
                                : config.headerBg.includes('purple')
                                  ? '#a855f722'
                                  : config.headerBg.includes('pink')
                                    ? '#ec489922'
                                    : config.headerBg.includes('cyan')
                                      ? '#06b6d422'
                                      : config.headerBg.includes('indigo')
                                        ? '#6366f122'
                                        : '#64748b22'
                        : data.metadata?.customColor
                          ? `${data.metadata.customColor}12`
                          : config.headerBg.includes('blue')
                            ? '#3b82f615'
                            : config.headerBg.includes('green') ||
                                config.headerBg.includes('emerald')
                              ? '#22c55e15'
                              : config.headerBg.includes('amber') ||
                                  config.headerBg.includes('yellow')
                                ? '#f59e0b15'
                                : config.headerBg.includes('purple')
                                  ? '#a855f715'
                                  : config.headerBg.includes('pink')
                                    ? '#ec489915'
                                    : config.headerBg.includes('cyan')
                                      ? '#06b6d415'
                                      : config.headerBg.includes('indigo')
                                        ? '#6366f115'
                                        : '#64748b15',
                    borderColor:
                      theme === 'dark'
                        ? data.metadata?.customColor
                          ? `${data.metadata.customColor}50`
                          : 'rgba(255,255,255,0.15)'
                        : data.metadata?.customColor
                          ? `${data.metadata.customColor}40`
                          : 'rgba(0,0,0,0.15)',
                    opacity: theme === 'dark' ? 0.75 : 0.7
                  }}
                />
              </>
            )}

          {/* Nodo */}
          <div
            className={cn(
              data.type === 'text'
                ? 'border-none bg-transparent shadow-none' // Text node: nessuna card
                : isBareDetail || isLowDetail
                  ? 'overflow-hidden rounded-xl border shadow-none'
                  : 'overflow-hidden rounded-xl border shadow-sm',
              data.type === 'group'
                ? `bg-transparent ${(data.metadata?.groupBorderStyle as string) === 'solid' ? 'border-2' : 'border-2 border-dashed'}`
                : data.type === 'text'
                  ? 'bg-transparent'
                  : isBareDetail || isLowDetail
                    ? 'bg-transparent'
                    : 'bg-background',
              isClassicFixedNode
                ? 'flex h-full w-full min-w-0 flex-col'
                : isResizableNode
                  ? 'flex min-w-[200px] flex-col'
                  : 'min-w-[200px]',
              // Max width solo per note non ancora ridimensionati
              data.type === 'note' && !getNode(id)?.style?.width
                ? 'max-w-[350px]'
                : '',
              selected && data.type !== 'text' ? 'ring-primary/20 ring-4' : '',
              isHovered && data.type !== 'text' ? 'shadow-md' : '',
              'transition-all duration-200',
              isPlainNote && 'rounded-sm shadow-none'
            )}
            style={{
              ...(isResizableNode ? { height: '100%' } : undefined),
              ...(data.type === 'text'
                ? {
                    backgroundColor: 'transparent',
                    border: 'none',
                    boxShadow: 'none'
                  }
                : data.type === 'group'
                  ? {
                      backgroundColor:
                        (data.metadata?.groupColor as string) ||
                        'rgba(100, 116, 139, 0.05)',
                      borderColor:
                        (data.metadata?.groupBorderColor as string) ||
                        '#64748b',
                      zIndex: -1
                    }
                  : {
                      backgroundColor:
                        isBareDetail || isLowDetail ? lodFillColor : undefined,
                      borderColor: selected
                        ? undefined
                        : isBareDetail || isLowDetail
                          ? theme === 'dark'
                            ? 'rgba(255,255,255,0.16)'
                            : 'rgba(0,0,0,0.18)'
                          : 'transparent'
                    })
            }}
          >
            {/* Header - Only for non-group and non-text nodes, EXCLUDE audio files */}
            {!isBareDetail &&
              !isLowDetail &&
              !shouldHideHeader &&
              data.type !== 'group' &&
              data.type !== 'text' &&
              !(
                data.metadata?.extension &&
                ['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(
                  String(data.metadata.extension).toLowerCase()
                )
              ) && (
                <div
                  ref={headerRef}
                  className={cn(
                    'flex items-center justify-between px-3 py-2',
                    !data.metadata?.customColor && config.headerBg
                  )}
                  style={
                    data.metadata?.customColor
                      ? {
                          backgroundColor: `${data.metadata.customColor}15`,
                          color: headerFgColor
                        }
                      : undefined
                  }
                  onDoubleClickCapture={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openDetailDialog();
                  }}
                >
                  <div className='flex items-center gap-2'>
                    {!isLowDetail ? (
                      <LogoOrIcon
                        label={config.label}
                        logoUrl={isBareDetail ? undefined : logoUrl}
                        Icon={Icon}
                        sizePx={20}
                        showSkeletonWhileLoading={
                          !isBareDetail && isDynamicDomainLogo
                        }
                        onLogoLoaded={(img) => {
                          if (isBareDetail) return;
                          if (!isDynamicDomainLogo) return;
                          const color = extractAverageColorHex(img);
                          if (!color) return;
                          updateAutoColorFromLogo(color);
                        }}
                        iconClassName={cn(
                          'h-5 w-5',
                          !data.metadata?.customColor && config.headerText
                        )}
                        iconStyle={
                          data.metadata?.customColor
                            ? { color: headerFgColor }
                            : undefined
                        }
                        className='h-5 w-5'
                      />
                    ) : (
                      <div className='h-5 w-5' />
                    )}
                    <div className='flex min-w-0 flex-1 items-center gap-2'>
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-sm font-semibold tracking-tight whitespace-nowrap',
                          !data.metadata?.customColor && config.headerText
                        )}
                        style={
                          data.metadata?.customColor
                            ? {
                                color: headerFgColor
                              }
                            : undefined
                        }
                      >
                        {/* For ai_insight, show dynamic title from metadata (e.g., "Next Steps", "Analysis") */}
                        {data.type === 'ai_insight' && data.metadata?.title
                          ? String(data.metadata.title)
                          : (data.metadata?.customTitle as string) ||
                            config.label}
                      </span>

                      {!isLowDetail && isMerged ? (
                        <span
                          className='bg-primary/10 text-primary border-border/40 inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[10px] font-semibold'
                          title={`Merged ${mergedChildCount} nodes`}
                        >
                          <IconMerge className='h-3 w-3' />
                          {mergedChildCount}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className='flex items-center gap-0.5'>
                    {/* Collapse/Expand figli - solo se ha figli */}
                    {!isLowDetail && childrenCount > 0 && (
                      <Button
                        disabled={!canEdit()}
                        variant='ghost'
                        size='icon'
                        className={cn(
                          'relative h-5 w-5',
                          !data.metadata?.customColor && config.headerText,
                          'hover:bg-black/10'
                        )}
                        onPointerDownCapture={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        style={
                          data.metadata?.customColor
                            ? {
                                color: headerFgColor
                              }
                            : undefined
                        }
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleCollapse();
                        }}
                        title={
                          isCollapsed
                            ? `Expand ${collapsedCount} children`
                            : 'Collapse children'
                        }
                      >
                        <IconChevronDown
                          className={cn(
                            'h-3 w-3 transition-transform duration-200',
                            isCollapsed && '-rotate-90'
                          )}
                        />
                        {/* Badge con conteggio quando collapsed */}
                        {isCollapsed && collapsedCount > 0 && (
                          <motion.span
                            className='bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-1 text-[9px] font-bold shadow-lg'
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{
                              type: 'spring',
                              stiffness: 500,
                              damping: 15
                            }}
                            style={{
                              boxShadow: `0 0 0 3px rgba(${glowColor()}, 0.2)`
                            }}
                          >
                            {collapsedCount}
                          </motion.span>
                        )}
                      </Button>
                    )}
                    {/* Delete - always visible */}
                    {!isLowDetail && (
                      <Button
                        variant='ghost'
                        size='icon'
                        className={cn(
                          'h-5 w-5',
                          !data.metadata?.customColor && config.headerText,
                          'hover:bg-black/10 hover:text-red-600'
                        )}
                        onPointerDownCapture={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        style={
                          data.metadata?.customColor
                            ? {
                                color: headerFgColor
                              }
                            : undefined
                        }
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDelete();
                        }}
                        title='Delete node'
                        disabled={!canEdit()}
                      >
                        <IconX className='h-3 w-3' />
                      </Button>
                    )}
                  </div>
                </div>
              )}

            {/* Delete button for group nodes - top right corner, visible only on hover */}
            {data.type === 'group' && (isHovered || selected) && (
              <Button
                variant='ghost'
                size='icon'
                className='hover:bg-destructive/10 absolute top-2 right-2 z-10 h-6 w-6 rounded-md bg-white/80 shadow-sm backdrop-blur-sm hover:text-red-600 dark:bg-zinc-900/80'
                onClick={handleDelete}
                title='Delete group'
                disabled={!canEdit()}
              >
                <IconX className='h-4 w-4' />
              </Button>
            )}

            {/* Body - Editabile con doppio click */}
            {isBareDetail || isLowDetail ? (
              <div
                className={cn(
                  'min-h-[40px]',
                  data.type === 'group'
                    ? 'flex-1 p-0'
                    : isClassicFixedNode
                      ? 'flex-1'
                      : ''
                )}
              />
            ) : (
              <div
                className={cn(
                  'relative min-h-[40px]',
                  data.type === 'group'
                    ? 'flex-1 p-0'
                    : isMediaNode ||
                        isFilePreviewNode ||
                        data.type === 'maps' ||
                        (isCard && !isEditing)
                      ? 'flex-1 p-0'
                      : data.type === 'ai_insight' || data.type === 'note'
                        ? `min-h-0 flex-1 overflow-auto ${!isEditing ? 'px-3 py-3' : 'p-2'} ${isScrollActive ? 'nodrag nopan' : ''}`
                        : !isEditing
                          ? 'px-3 py-3'
                          : 'p-2',
                  isClassicFixedNode && !isEditing
                    ? 'flex-1 overflow-hidden'
                    : '',
                  isMediaNode && 'min-h-0 overflow-auto',
                  (isFilePreviewNode || isCard) && 'min-h-0 overflow-hidden',
                  data.type === 'note' && !isEditing && 'py-2',
                  // Remove colored body background, keep it clean
                  data.type === 'group'
                    ? 'bg-transparent'
                    : 'bg-white/50 backdrop-blur-sm dark:bg-zinc-900/50'
                )}
                onDoubleClickCapture={(e) => {
                  if (
                    data.type === 'media_url' ||
                    data.type === 'note' ||
                    isFilePreviewNode
                  )
                    return;
                  e.preventDefault();
                  // Per i nodi scrollabili (note, ai_insight) o maps, non entrare in edit mode qui
                  // ma lasciare che l'overlay gestisca il comportamento
                  if (data.type === 'ai_insight' || data.type === 'maps') {
                    return;
                  }
                  // Per tutti gli altri nodi (inclusi image/video URL): entra in edit mode
                  e.stopPropagation();
                  setIsEditing(true);
                  setTimeout(() => {
                    inputRef.current?.focus();
                    if (inputRef.current instanceof HTMLInputElement) {
                      inputRef.current.select();
                    } else if (
                      inputRef.current instanceof HTMLTextAreaElement
                    ) {
                      inputRef.current.select();
                    }
                  }, 0);
                }}
                onMouseLeave={() => {
                  if (
                    (data.type === 'note' || data.type === 'ai_insight') &&
                    isScrollActive
                  ) {
                    setIsScrollActive(false);
                    if (clickTimeoutRef.current) {
                      clearTimeout(clickTimeoutRef.current);
                      clickTimeoutRef.current = null;
                    }
                  }
                }}
              >
                {data.type === 'group' ? (
                  <GroupNodeContent />
                ) : data.type === 'note' ? (
                  <NoteNodeContent
                    id={id}
                    data={data}
                    editing={isEditing}
                    onEdit={startEditing}
                    onDone={() => setIsEditing(false)}
                  />
                ) : data.type === 'media_url' ? (
                  <MediaUrlNodeContent
                    id={id}
                    data={data}
                    editing={isEditing}
                    editable={graphViewMode !== 'analysis' && canEdit()}
                    onEdit={startEditing}
                    onDone={() => setIsEditing(false)}
                  />
                ) : [
                    'document',
                    'pdf',
                    'docx',
                    'xlsx',
                    'txt',
                    'csv',
                    'json'
                  ].includes(data.type) ? (
                  <DocumentNodeContent
                    data={data}
                    config={config}
                    isUploadingFile={isUploadingFile}
                    fileInputRef={fileInputRef}
                    handleFileSelect={handleFileSelect}
                    handleUploadClick={handleUploadClick}
                    setIsPreviewOpen={setIsPreviewOpen}
                    Icon={Icon}
                  />
                ) : data.type === 'text' ? (
                  <TextNodeContent
                    data={data}
                    isEditing={isEditing && canEdit()}
                    editLabel={editLabel}
                    setEditLabel={setEditLabel}
                    handleSaveLabel={handleSaveLabel}
                    inputRef={inputRef as React.RefObject<HTMLTextAreaElement>}
                    setIsEditing={setIsEditing}
                  />
                ) : data.type === 'maps' ? (
                  <MapContent
                    value={data.label}
                    title={data.metadata?.title as string | undefined}
                    onDoubleClick={() => setIsMapPreviewOpen(true)}
                  />
                ) : isCard && !isEditing ? (
                  <CardNodeContent
                    data={data}
                    Icon={Icon}
                    iconClassName={config.headerText}
                  />
                ) : (
                  <GenericNodeContent
                    data={data}
                    isEditing={isEditing && canEdit()}
                    editLabel={editLabel}
                    setEditLabel={setEditLabel}
                    handleSaveLabel={handleSaveLabel}
                    inputRef={inputRef}
                    setIsEditing={setIsEditing}
                    isScrollActive={isScrollActive}
                    setIsScrollActive={setIsScrollActive}
                    clickTimeoutRef={clickTimeoutRef}
                  />
                )}
              </div>
            )}
          </div>

          {/* Pulsante + per Transforms (non per i nodi group) */}
          {data.type !== 'group' &&
            !isPlainNote &&
            !isFlowDecoration &&
            !isLowDetail &&
            !isBareDetail && (
              <Popover
                open={isAddMenuOpen && canEdit()}
                onOpenChange={(open) => {
                  setIsAddMenuOpen(open && canEdit());
                  if (!open) setIsHovered(false);
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant='outline'
                    size='icon'
                    className={cn(
                      'absolute -bottom-4 left-1/2 z-30 h-8 w-8 -translate-x-1/2 rounded-lg border-2 shadow-md transition-all hover:scale-110',
                      'bg-white hover:bg-gray-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                      (isHovered ||
                        isAddMenuOpen ||
                        selected ||
                        isTransforming ||
                        asyncJobState) &&
                        'opacity-100',
                      !(
                        isHovered ||
                        isAddMenuOpen ||
                        selected ||
                        isTransforming ||
                        asyncJobState
                      ) && 'pointer-events-none opacity-0',
                      (isTransforming || asyncJobState) &&
                        'cursor-wait !opacity-100'
                    )}
                    title='Run transform'
                    disabled={!canEdit() || isTransforming || !!asyncJobState}
                  >
                    {asyncJobState?.isExternal ? (
                      <CircularProgress
                        progress={asyncJobState.progress}
                        message={asyncJobState.message}
                        size={24}
                        strokeWidth={2}
                      />
                    ) : isTransforming || asyncJobState ? (
                      <IconLoader2 className='h-4 w-4 animate-spin' />
                    ) : (
                      <IconPlus className='h-4 w-4' />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className='animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 w-72 border-0 bg-transparent p-0 shadow-none duration-200'
                  align='center'
                  side='bottom'
                  onCloseAutoFocus={() => setOpenSubmenu(null)}
                >
                  <Tabs
                    value={addMenuTab}
                    onValueChange={(v) =>
                      setAddMenuTab(v === 'flows' ? 'flows' : 'transforms')
                    }
                    className='gap-0'
                  >
                    {/* Linguette stile "cartellina": ogni tab disegna un layer
                        bg-border sotto al fill, così il bordo segue anche la diagonale
                        e la tab inattiva resta agganciata alla card. */}
                    <TabsList className='relative z-10 -mb-[7px] flex h-7 w-full items-end gap-0 rounded-none bg-transparent p-0 dark:bg-transparent'>
                      <TabsTrigger
                        value='transforms'
                        className={cn(
                          'relative flex-1 gap-1.5 overflow-visible rounded-tl-xl rounded-tr-none rounded-b-none border-0 bg-transparent px-3 pr-8 text-xs font-medium shadow-none transition-colors hover:bg-transparent',
                          'focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none',
                          'text-muted-foreground h-6 items-start pt-2',
                          'data-[state=active]:text-foreground data-[state=active]:z-10 data-[state=active]:h-7 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:hover:bg-transparent',
                          'dark:data-[state=active]:text-foreground'
                        )}
                      >
                        <span
                          className={cn(
                            'bg-border absolute inset-x-0 top-0 [clip-path:polygon(0_12px,1px_7px,4px_3px,8px_1px,12px_0,calc(100%-26px)_0,calc(100%-21px)_2px,calc(100%-17px)_6px,calc(100%-5px)_calc(100%-6px),calc(100%-2px)_calc(100%-2px),100%_100%,0_100%)]',
                            addMenuTab === 'transforms'
                              ? 'bottom-[-7px]'
                              : 'bottom-[-7px]'
                          )}
                        />
                        <span
                          className={cn(
                            'absolute top-px right-px left-px [clip-path:polygon(0_11px,1px_6px,4px_2px,8px_0,12px_0,calc(100%-26px)_0,calc(100%-21px)_2px,calc(100%-17px)_6px,calc(100%-5px)_calc(100%-6px),calc(100%-2px)_calc(100%-2px),100%_100%,0_100%)]',
                            addMenuTab === 'transforms'
                              ? 'bg-popover bottom-[-8px]'
                              : 'bg-muted bottom-[-8px]'
                          )}
                        />
                        <IconTransform
                          className='relative z-10 h-3 w-3'
                          weight='fill'
                        />
                        <span className='relative z-10'>
                          Transforms
                          {availableTransforms.length > 0
                            ? ` (${availableTransforms.length})`
                            : ''}
                        </span>
                      </TabsTrigger>
                      <TabsTrigger
                        value='flows'
                        className={cn(
                          'relative -ml-6 flex-1 gap-1.5 overflow-visible rounded-tl-none rounded-tr-xl rounded-b-none border-0 bg-transparent px-3 pl-8 text-xs font-medium shadow-none transition-colors hover:bg-transparent',
                          'focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none',
                          'text-muted-foreground h-6 items-start pt-2',
                          'data-[state=active]:text-foreground data-[state=active]:z-10 data-[state=active]:h-7 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:hover:bg-transparent',
                          'dark:data-[state=active]:text-foreground'
                        )}
                      >
                        <span
                          className={cn(
                            'bg-border absolute inset-x-0 top-0 [clip-path:polygon(26px_0,calc(100%-12px)_0,calc(100%-8px)_1px,calc(100%-4px)_3px,calc(100%-1px)_7px,100%_12px,100%_100%,0_100%,2px_calc(100%-2px),5px_calc(100%-6px),17px_6px,21px_2px)]',
                            addMenuTab === 'flows'
                              ? 'bottom-[-7px]'
                              : 'bottom-[-7px]'
                          )}
                        />
                        <span
                          className={cn(
                            'absolute top-px right-px left-px [clip-path:polygon(26px_0,calc(100%-12px)_0,calc(100%-8px)_0,calc(100%-4px)_2px,calc(100%-1px)_6px,100%_11px,100%_100%,0_100%,2px_calc(100%-2px),5px_calc(100%-6px),17px_6px,21px_2px)]',
                            addMenuTab === 'flows'
                              ? 'bg-popover bottom-[-8px]'
                              : 'bg-muted bottom-[-8px]'
                          )}
                        />
                        <IconArrowsSplit className='relative z-10 h-3 w-3 -rotate-90' />
                        <span className='relative z-10'>
                          Flows
                          {matchingFlows.length > 0
                            ? ` (${matchingFlows.length})`
                            : ''}
                        </span>
                      </TabsTrigger>
                    </TabsList>
                    {/* Corpo della cartellina: angolo superiore squadrato dal lato della linguetta attiva */}
                    <div
                      className={cn(
                        'bg-popover relative rounded-b-xl border px-2 pt-3 pb-2 shadow-md',
                        addMenuTab === 'transforms'
                          ? 'rounded-tr-xl'
                          : 'rounded-tl-xl'
                      )}
                    >
                      {isTransforming && (
                        <div className='flex items-center justify-center gap-2 py-4'>
                          <IconLoader2 className='h-5 w-5 animate-spin' />
                          <span className='text-muted-foreground text-sm'>
                            Executing...
                          </span>
                        </div>
                      )}
                      {!isTransforming && (
                        <TabsContent value='transforms' className='mt-0'>
                          {availableTransforms.length === 0 && (
                            <p className='text-muted-foreground px-2 py-4 text-center text-sm'>
                              No transforms available for this entity type.
                            </p>
                          )}
                          {availableTransforms.length > 0 && (
                            <TransformContentContainer
                              className={cn(
                                shouldScrollTransforms && 'h-[340px]'
                              )}
                            >
                              <motion.div
                                className={cn(
                                  'space-y-1',
                                  shouldScrollTransforms && 'pr-3'
                                )}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.2 }}
                              >
                                {Object.entries(groupedTransforms).map(
                                  ([pluginId, transforms], groupIndex) => {
                                    const plugin = transforms[0].plugin;
                                    const { Icon: PluginIcon } =
                                      getBuiltInPluginStyle(
                                        (plugin.inputTypes as
                                          | string[]
                                          | undefined) ?? ['custom'],
                                        plugin.icon as string | undefined,
                                        plugin.logoUrl ?? undefined
                                      );

                                    // Raggruppa sempre per plugin (anche se c'è una sola transform)
                                    const isOpen = openSubmenu === pluginId;
                                    return (
                                      <motion.div
                                        key={pluginId}
                                        className='relative'
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{
                                          duration: 0.15,
                                          delay: groupIndex * 0.05,
                                          ease: 'easeOut'
                                        }}
                                      >
                                        <button
                                          className={cn(
                                            'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-all',
                                            isOpen
                                              ? 'bg-muted'
                                              : 'hover:bg-muted'
                                          )}
                                          disabled={isTransforming}
                                          onClick={() =>
                                            setOpenSubmenu(
                                              isOpen ? null : pluginId
                                            )
                                          }
                                        >
                                          <span className='h-6 w-6 overflow-hidden rounded-md'>
                                            {plugin.logoUrl ? (
                                              <img
                                                src={plugin.logoUrl}
                                                alt={plugin.name}
                                                width={24}
                                                height={24}
                                                loading='lazy'
                                                decoding='async'
                                                className='h-full w-full rounded-md object-contain'
                                              />
                                            ) : (
                                              <span className='bg-primary/10 flex h-full w-full items-center justify-center rounded-md'>
                                                <PluginIcon className='text-primary h-4 w-4' />
                                              </span>
                                            )}
                                          </span>
                                          <div className='flex-1'>
                                            <p className='font-medium'>
                                              {plugin.name}
                                            </p>
                                            <p className='text-muted-foreground text-xs'>
                                              {transforms.length} transforms
                                            </p>
                                          </div>
                                          <motion.div
                                            animate={{
                                              rotate: isOpen ? 90 : 0
                                            }}
                                            transition={{
                                              duration: 0.2,
                                              ease: 'easeInOut'
                                            }}
                                          >
                                            <IconChevronRight className='text-muted-foreground h-4 w-4' />
                                          </motion.div>
                                        </button>
                                        {/* Submenu inline con animazione */}
                                        <AnimatePresence>
                                          {isOpen && (
                                            <motion.div
                                              initial={{
                                                opacity: 0,
                                                height: 0
                                              }}
                                              animate={{
                                                opacity: 1,
                                                height: 'auto'
                                              }}
                                              exit={{ opacity: 0, height: 0 }}
                                              transition={{
                                                duration: 0.2,
                                                ease: 'easeInOut'
                                              }}
                                              className='overflow-hidden'
                                            >
                                              <div className='border-muted mt-1 ml-4 space-y-1 border-l-2 pl-2'>
                                                {transforms.map(
                                                  (item, index) => {
                                                    const outputType =
                                                      item.transform
                                                        .outputTypes[0] ||
                                                      'custom';
                                                    const TIcon =
                                                      getIconForType(
                                                        outputType
                                                      );
                                                    const tConfig =
                                                      typeConfig[outputType] ||
                                                      typeConfig.custom;
                                                    return (
                                                      <motion.button
                                                        key={`${item.plugin.id}-${item.transform.id}`}
                                                        initial={{
                                                          opacity: 0,
                                                          x: -10
                                                        }}
                                                        animate={{
                                                          opacity: 1,
                                                          x: 0
                                                        }}
                                                        transition={{
                                                          duration: 0.15,
                                                          delay: index * 0.05,
                                                          ease: 'easeOut'
                                                        }}
                                                        className='hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-50'
                                                        onClick={() =>
                                                          handleTransform(item)
                                                        }
                                                        disabled={
                                                          isTransforming
                                                        }
                                                      >
                                                        <span
                                                          className={cn(
                                                            'rounded p-1',
                                                            tConfig.headerBg
                                                          )}
                                                        >
                                                          <TIcon
                                                            className={cn(
                                                              'h-3 w-3',
                                                              tConfig.headerText
                                                            )}
                                                          />
                                                        </span>
                                                        <div className='flex-1'>
                                                          <div className='flex items-center gap-1.5'>
                                                            <p className='font-medium'>
                                                              {
                                                                item.transform
                                                                  .name
                                                              }
                                                            </p>
                                                          </div>
                                                          <p className='text-muted-foreground text-xs'>
                                                            {
                                                              item.transform
                                                                .description
                                                            }
                                                          </p>
                                                        </div>
                                                      </motion.button>
                                                    );
                                                  }
                                                )}
                                              </div>
                                            </motion.div>
                                          )}
                                        </AnimatePresence>
                                      </motion.div>
                                    );
                                  }
                                )}
                              </motion.div>
                            </TransformContentContainer>
                          )}
                        </TabsContent>
                      )}
                      {!isTransforming && (
                        <TabsContent value='flows' className='mt-0'>
                          {matchingFlows.length === 0 ? (
                            <p className='text-muted-foreground px-2 py-4 text-center text-sm'>
                              No flows with a &quot;{String(data.type)}&quot;
                              trigger. Create one in Flows.
                            </p>
                          ) : (
                            <FlowContentContainer
                              className={cn(shouldScrollFlows && 'h-[340px]')}
                            >
                              <motion.div
                                className={cn(
                                  'space-y-1',
                                  shouldScrollFlows && 'pr-3'
                                )}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.2 }}
                              >
                                {matchingFlows.map((flow) => (
                                  <button
                                    key={flow.id}
                                    className='hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-50'
                                    onClick={() => void handleRunFlow(flow)}
                                    disabled={isTransforming}
                                    title={flow.description ?? undefined}
                                  >
                                    <span className='rounded bg-indigo-100 p-1 dark:bg-indigo-900/30'>
                                      <IconArrowsSplit className='h-3 w-3 -rotate-90 text-indigo-600 dark:text-indigo-400' />
                                    </span>
                                    <div className='min-w-0 flex-1'>
                                      <p className='truncate font-medium'>
                                        {flow.name}
                                      </p>
                                      <p className='text-muted-foreground truncate text-xs'>
                                        {flow.description ||
                                          `${Math.max(flow.nodeCount - flow.triggerTypes.length, 0)} transforms`}
                                      </p>
                                    </div>
                                    {null}
                                  </button>
                                ))}
                              </motion.div>
                            </FlowContentContainer>
                          )}
                        </TabsContent>
                      )}
                    </div>
                  </Tabs>
                </PopoverContent>
              </Popover>
            )}
        </div>

        {/* Node context menu (shared across Manual/Auto/Analysis) */}
        {nodeContextMenuPosition ? (
          <NodeContextMenu
            position={nodeContextMenuPosition}
            graphViewMode={graphViewMode}
            nodeId={id}
            nodeType={String((data as any)?.type ?? 'custom')}
            nodeLabel={String(
              (data as any)?.label ?? (data as any)?.value ?? ''
            )}
            nodeMetadata={(data as any)?.metadata ?? null}
            sourcePosition={{
              x: getNode(id)?.position?.x ?? 0,
              y: getNode(id)?.position?.y ?? 0
            }}
            onClose={() => setNodeContextMenuPosition(null)}
            getSelectedNodes={() => getNodes().filter((n) => n.selected) as any}
            addToCase={
              addToCase
                ? {
                    recentCases: addToCase.recentCases,
                    refreshRecentCases: () => addToCase.refreshRecentCases(),
                    addNodesToCase: ({ caseId, nodes }) =>
                      addToCase.addNodesToCase({ caseId, nodes }),
                    openAllCasesDialog: (nodes) =>
                      addToCase.openAllCasesDialog(nodes),
                    openNewCaseDialog: (nodes) =>
                      addToCase.openNewCaseDialog(nodes)
                  }
                : null
            }
            onOpenNode={openDetailDialog}
            onEditLabel={startEditing}
            headerHidden={shouldHideHeader}
            onToggleHeader={
              canToggleHeader && headerVisibilityKey
                ? () => {
                    setNodes((nodes) =>
                      nodes.map((node) =>
                        node.id === id
                          ? {
                              ...node,
                              data: {
                                ...node.data,
                                metadata: {
                                  ...node.data.metadata,
                                  [headerVisibilityKey]:
                                    node.data.metadata?.[
                                      headerVisibilityKey
                                    ] !== true
                                }
                              }
                            }
                          : node
                      )
                    );
                  }
                : undefined
            }
            onDuplicate={handleDuplicate}
            onChangeType={handleChangeType}
            onChangeColor={handleChangeCustomColor}
            canUnmerge={canUnmergeThisNode}
            onUnmerge={isMerged ? handleUnmerge : undefined}
            onDelete={handleDelete}
          />
        ) : null}

        {/*
        Context menu legacy removed (Radix). Keeping a block comment here so future diffs stay stable.
        */}
        {null}

        {/* Results sheet is now managed centrally by TransformResultsAutoSheet */}

        <DeleteCascadeDialog
          open={isDeleteCascadeDialogOpen && canEdit()}
          childCount={deleteCascadeChildIds.length}
          onOpenChange={(open) => {
            setIsDeleteCascadeDialogOpen(open);
            if (!open) setDeleteCascadeChildIds([]);
          }}
          onDeleteParent={() => {
            setIsDeleteCascadeDialogOpen(false);
            setDeleteCascadeChildIds([]);
            deleteNodeIds([id]);
          }}
          onDeleteParentAndChildren={() => {
            const childIds = deleteCascadeChildIds;
            setIsDeleteCascadeDialogOpen(false);
            setDeleteCascadeChildIds([]);
            deleteNodeIds([id, ...childIds]);
          }}
        />

        <OpenNodeDialog
          open={isDetailOpen}
          onOpenChange={setIsDetailOpen}
          nodeId={String(id)}
          nodeData={data}
          headerBgClassName={config.headerBg}
          headerTextClassName={config.headerText}
          titleLabel={config.label}
          Icon={Icon as any}
          logoUrl={logoUrl ?? null}
          isEditMode={isEditMode}
          setIsEditMode={setIsEditMode}
          editedLabel={editedLabel}
          setEditedLabel={setEditedLabel}
          editedMetadata={editedMetadata}
          setEditedMetadata={setEditedMetadata}
          newMetaKey={newMetaKey}
          setNewMetaKey={setNewMetaKey}
          newMetaValue={newMetaValue}
          setNewMetaValue={setNewMetaValue}
          onUpdateMetadataValue={handleUpdateMetadata}
          onRemoveMetadataKey={handleRemoveMetadata}
          onAddMetadataKeyValue={handleAddMetadata}
          onSave={handleSaveFromDialog}
          onDelete={() => {
            setIsDetailOpen(false);
            handleDelete();
          }}
          availableTransformNames={availableTransforms.map(
            (x) => x.transform.name
          )}
        />

        {/* Dialog Edit Title */}
        <Dialog open={isEditingTitle} onOpenChange={setIsEditingTitle}>
          <DialogContent className='sm:max-w-[425px]'>
            <DialogHeader>
              <DialogTitle>Edit Node Title</DialogTitle>
              <DialogDescription>
                Customize the node title. The type remains unchanged.
              </DialogDescription>
            </DialogHeader>
            <div className='grid gap-4 py-4'>
              <div className='grid gap-2'>
                <label htmlFor='custom-title' className='text-sm font-medium'>
                  Custom Title
                </label>
                <Input
                  id='custom-title'
                  value={customTitle}
                  readOnly={!canEdit()}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder={config.label}
                  onKeyDown={(e) => {
                    if (!canEdit()) return;
                    if (e.key === 'Enter') {
                      setNodes((nodes) =>
                        nodes.map((n) =>
                          n.id === id
                            ? {
                                ...n,
                                data: {
                                  ...n.data,
                                  metadata: {
                                    ...n.data.metadata,
                                    customTitle: customTitle.trim() || null
                                  }
                                }
                              }
                            : n
                        )
                      );
                      setIsEditingTitle(false);
                      toast.success('Title updated');
                    }
                  }}
                  autoFocus
                />
                <p className='text-muted-foreground text-xs'>
                  Leave empty to use the default title: &quot;{config.label}
                  &quot;
                </p>
              </div>
            </div>
            <div className='flex justify-end gap-2'>
              <Button
                variant='outline'
                onClick={() => setIsEditingTitle(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={!canEdit()}
                onClick={() => {
                  if (!canEdit()) return;
                  setNodes((nodes) =>
                    nodes.map((n) =>
                      n.id === id
                        ? {
                            ...n,
                            data: {
                              ...n.data,
                              metadata: {
                                ...n.data.metadata,
                                customTitle: customTitle.trim() || null
                              }
                            }
                          }
                        : n
                    )
                  );
                  setIsEditingTitle(false);
                  toast.success('Title updated');
                }}
              >
                Save
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>

      {isPreviewOpen && (data.metadata?.fileUrl || data.label) ? (
        <FilePreviewDialog
          key={String(data.metadata?.fileUrl || data.label)}
          open={isPreviewOpen}
          onOpenChange={setIsPreviewOpen}
          fileUrl={String(data.metadata?.fileUrl || data.label)}
          fileName={String(data.metadata?.filename || data.label)}
          fileType={data.type}
          fileExtension={String(data.metadata?.extension || '')}
          panelProps={{
            nodeId: String(id),
            nodeData: data,
            headerBgClassName: config.headerBg,
            headerTextClassName: config.headerText,
            titleLabel: config.label,
            Icon: Icon as any,
            logoUrl: logoUrl ?? null,
            isEditMode,
            setIsEditMode,
            editedLabel,
            setEditedLabel,
            editedMetadata,
            setEditedMetadata,
            newMetaKey,
            setNewMetaKey,
            newMetaValue,
            setNewMetaValue,
            onUpdateMetadataValue: handleUpdateMetadata,
            onRemoveMetadataKey: handleRemoveMetadata,
            onAddMetadataKeyValue: handleAddMetadata,
            onSave: handleSaveFromDialog,
            onDelete: () => {
              setIsPreviewOpen(false);
              handleDelete();
            },
            availableTransformNames: availableTransforms.map(
              (x) => x.transform.name
            )
          }}
        />
      ) : null}

      {isMapPreviewOpen && data.type === 'maps' ? (
        <MapPreviewDialog
          open={isMapPreviewOpen}
          onOpenChange={setIsMapPreviewOpen}
          panelProps={{
            nodeId: String(id),
            nodeData: data,
            headerBgClassName: config.headerBg,
            headerTextClassName: config.headerText,
            titleLabel: config.label,
            Icon: Icon as any,
            logoUrl: logoUrl ?? null,
            isEditMode,
            setIsEditMode,
            editedLabel,
            setEditedLabel,
            editedMetadata,
            setEditedMetadata,
            newMetaKey,
            setNewMetaKey,
            newMetaValue,
            setNewMetaValue,
            onUpdateMetadataValue: handleUpdateMetadata,
            onRemoveMetadataKey: handleRemoveMetadata,
            onAddMetadataKeyValue: handleAddMetadata,
            onSave: handleSaveFromDialog,
            onDelete: () => {
              setIsMapPreviewOpen(false);
              handleDelete();
            },
            availableTransformNames: availableTransforms.map(
              (x) => x.transform.name
            )
          }}
        />
      ) : null}

      <Dialog
        open={Boolean(pendingMergedTransform)}
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
                  type='button'
                  className={cn(
                    'rounded-md border p-3 text-left transition-colors',
                    mergedTransformScope === 'primary'
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted'
                  )}
                  onClick={() => setMergedTransformScope('primary')}
                >
                  <p className='text-sm font-semibold'>Primary only</p>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    Runs the transform on the primary value of this merged node.
                  </p>
                </button>
                <button
                  type='button'
                  className={cn(
                    'rounded-md border p-3 text-left transition-colors',
                    mergedTransformScope === 'selected'
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted'
                  )}
                  onClick={() => setMergedTransformScope('selected')}
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
                      disabled={mergedTransformScope !== 'selected'}
                      onClick={() =>
                        setMergedTransformSelectedValues(
                          pendingMergedTransform.values
                        )
                      }
                    >
                      Select all
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      variant='ghost'
                      disabled={mergedTransformScope !== 'selected'}
                      onClick={() => setMergedTransformSelectedValues([])}
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
                          className='mt-0.5'
                          disabled={mergedTransformScope !== 'selected'}
                          checked={mergedTransformSelectedValues.includes(v)}
                          onChange={(e) => {
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

              {null}

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
                  onClick={handleConfirmMergedTransform}
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
    </Fragment>
  );
}

export const OSINTNode = memo(OSINTNodeComponent);
