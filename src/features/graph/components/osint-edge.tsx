'use client';
import { useGraphCanEdit } from '@/features/graph/contexts/graph-mutation-context';

import {
  useCallback,
  useState,
  memo,
  useRef,
  useEffect,
  useMemo,
  CSSProperties
} from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  EdgeProps,
  getBezierPath,
  getStraightPath,
  getSmoothStepPath,
  EdgeLabelRenderer,
  useStore,
  Position,
  BaseEdge,
  EdgeMarker
} from 'reactflow';
import { useGuardedReactFlow as useReactFlow } from '../contexts/graph-mutation-context';
import { Input } from '@/components/ui/input';
import { useAdaptiveContextMenu } from '@/components/ui/adaptive-context-menu';
import { cn } from '@/lib/utils';
import {
  Trash2,
  Pencil,
  Spline,
  Minus,
  CornerDownRight,
  Palette,
  ChevronRight,
  Check,
  GripHorizontal,
  Slash,
  ArrowLeftRight,
  EyeOff,
  Eye,
  ArrowRightLeft,
  Tag,
  X,
  MoveVertical,
  ArrowRight,
  Copy
} from 'lucide-react';

export interface OSINTEdgeData {
  relationship?: string;
  label?: string;
  labelVisible?: boolean; // Whether to show the label
  edgeType?: 'default' | 'straight' | 'step' | 'smoothstep';
  color?: string;
  strokeWidth?: number;
  dashed?: boolean;
  hideDirection?: boolean; // Hide the arrow marker
  bidirectional?: boolean; // Show arrows on both ends
  // Internal (non-persistito): usato per modalità locked per forzare routing su handle previsti
  _layoutMode?: 'locked';
  _lockedAxis?: 'vertical' | 'horizontal';
}

// Colori disponibili per gli edge
const edgeColors = [
  { name: 'Slate', value: '#64748b' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Pink', value: '#ec4899' }
];

const edgeTypesList = [
  { name: 'Bezier (Curved)', value: 'default', icon: Spline },
  { name: 'Straight', value: 'straight', icon: Minus },
  { name: 'Smooth Step', value: 'smoothstep', icon: CornerDownRight }
];

const edgeThicknessOptions = [
  { label: 'Thin', value: 2 },
  { label: 'Medium', value: 3 },
  { label: 'Thick', value: 4.5 }
];

// Progressive edge rendering keeps dense graphs responsive without removing
// relationship details when the user is working on a specific edge.
const HIDE_EDGES_WHEN_ZOOM_LT = 0.14;
const LINE_ONLY_WHEN_ZOOM_LT = 0.25;
const INTERACTIVE_WHEN_ZOOM_LT = 0.45;
const DENSE_GRAPH_EDGE_COUNT = 80;
const VERY_DENSE_GRAPH_EDGE_COUNT = 180;
type EdgeDetailLevel = 'hidden' | 'lines' | 'interactive' | 'full';

function selectEdgeDetailLevel(state: any): EdgeDetailLevel {
  const transform = state?.transform;
  const zoom = Array.isArray(transform) ? Number(transform[2]) : 1;
  const normalizedZoom = Number.isFinite(zoom) ? zoom : 1;
  const edgeCount = Array.isArray(state?.edges) ? state.edges.length : 0;

  if (normalizedZoom < HIDE_EDGES_WHEN_ZOOM_LT) return 'hidden';
  if (edgeCount >= VERY_DENSE_GRAPH_EDGE_COUNT) {
    return normalizedZoom < 0.85 ? 'lines' : 'interactive';
  }
  if (edgeCount >= DENSE_GRAPH_EDGE_COUNT) {
    return normalizedZoom < 0.55 ? 'lines' : 'interactive';
  }
  if (normalizedZoom < LINE_ONLY_WHEN_ZOOM_LT) return 'lines';
  if (normalizedZoom < INTERACTIVE_WHEN_ZOOM_LT) return 'interactive';
  return 'full';
}

// Calcola il punto sul bordo del nodo più vicino all'altro nodo
function getNodeIntersection(node: any, targetNode: any) {
  if (!node?.positionAbsolute || !targetNode?.positionAbsolute) return null;

  const w = (node.width || 200) / 2;
  const h = (node.height || 80) / 2;
  const cx = node.positionAbsolute.x + w;
  const cy = node.positionAbsolute.y + h;

  const tcx = targetNode.positionAbsolute.x + (targetNode.width || 200) / 2;
  const tcy = targetNode.positionAbsolute.y + (targetNode.height || 80) / 2;

  const dx = tcx - cx;
  const dy = tcy - cy;

  if (Math.abs(dx) > Math.abs(dy)) {
    return {
      x: dx > 0 ? cx + w : cx - w,
      y: cy,
      position: dx > 0 ? Position.Right : Position.Left
    };
  }
  return {
    x: cx,
    y: dy > 0 ? cy + h : cy - h,
    position: dy > 0 ? Position.Bottom : Position.Top
  };
}

// Componente Context Menu separato - stile Shadcn
interface EdgeContextMenuProps {
  position: { x: number; y: number };
  edgeType: string;
  baseColor: string;
  thickness: number;
  dashed: boolean;
  labelVisible: boolean;
  hideDirection: boolean;
  bidirectional: boolean;
  onClose: () => void;
  onCopyLabel: () => void;
  onEditLabel: () => void;
  onChangeType: (type: string) => void;
  onChangeColor: (color: string) => void;
  onChangeThickness: (value: number) => void;
  onToggleDashed: (value: boolean) => void;
  onToggleLabelVisible: (value: boolean) => void;
  onToggleHideDirection: (value: boolean) => void;
  onToggleBidirectional: (value: boolean) => void;
  onInvertDirection: () => void;
  onDelete: () => void;
}

function EdgeContextMenu({
  position,
  edgeType,
  baseColor,
  thickness,
  dashed,
  labelVisible,
  hideDirection,
  bidirectional,
  onClose,
  onCopyLabel,
  onEditLabel,
  onChangeType,
  onChangeColor,
  onChangeThickness,
  onToggleDashed,
  onToggleLabelVisible,
  onToggleHideDirection,
  onToggleBidirectional,
  onInvertDirection,
  onDelete
}: EdgeContextMenuProps) {
  const canEdit = useGraphCanEdit();
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<
    'type' | 'color' | 'thickness' | 'direction' | null
  >(null);

  useEffect(() => {
    const handlePointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handlePointer, true);
      document.addEventListener('contextmenu', handlePointer, true);
      document.addEventListener('keydown', handleKeyDown);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handlePointer, true);
      document.removeEventListener('contextmenu', handlePointer, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: position.x,
    top: position.y,
    zIndex: 99999
  };
  useAdaptiveContextMenu(menuRef, position);

  return createPortal(
    <div
      ref={menuRef}
      className='bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 w-48 rounded-md border p-1 shadow-md duration-100'
      style={menuStyle}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <button
        className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        onClick={() => {
          onCopyLabel();
          onClose();
        }}
      >
        <Copy className='h-4 w-4' />
        Copy label
      </button>

      {/* Modifica etichetta */}
      <button
        disabled={!canEdit()}
        className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        onClick={() => {
          if (!canEdit()) return;
          onEditLabel();
          onClose();
        }}
      >
        <Pencil className='h-4 w-4' />
        Edit label
      </button>

      {/* Tipo linea - Submenu */}
      <div
        className='relative'
        onMouseEnter={() => {
          if (!canEdit()) return;
          setActiveSubmenu('type');
        }}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <button
          disabled={!canEdit()}
          className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        >
          <span className='flex items-center gap-2'>
            <Spline className='h-4 w-4' />
            Line type
          </span>
          <ChevronRight className='h-4 w-4' />
        </button>

        {activeSubmenu === 'type' && (
          <div className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-1 w-44 rounded-md border p-1 shadow-md duration-100'>
            {edgeTypesList.map((type) => (
              <button
                disabled={!canEdit()}
                key={type.value}
                className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                onClick={() => {
                  if (!canEdit()) return;
                  onChangeType(type.value);
                  onClose();
                }}
              >
                <span className='flex items-center gap-2'>
                  <type.icon className='h-4 w-4' />
                  {type.name}
                </span>
                {edgeType === type.value && <Check className='h-4 w-4' />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Thickness - Submenu */}
      <div
        className='relative'
        onMouseEnter={() => {
          if (!canEdit()) return;
          setActiveSubmenu('thickness');
        }}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <button
          disabled={!canEdit()}
          className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        >
          <span className='flex items-center gap-2'>
            <MoveVertical className='h-4 w-4' />
            Thickness
          </span>
          <ChevronRight className='h-4 w-4' />
        </button>

        {activeSubmenu === 'thickness' && (
          <div className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-1 w-36 rounded-md border p-1 shadow-md duration-100'>
            {edgeThicknessOptions.map((option) => (
              <button
                disabled={!canEdit()}
                key={option.value}
                className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                onClick={() => {
                  if (!canEdit()) return;
                  onChangeThickness(option.value);
                  onClose();
                }}
              >
                <span>{option.label}</span>
                {Math.abs(thickness - option.value) < 0.1 && (
                  <Check className='h-4 w-4' />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Toggle Dashed/Solid Line */}
      <button
        disabled={!canEdit()}
        className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        onClick={() => {
          if (!canEdit()) return;
          onToggleDashed(!dashed);
          onClose();
        }}
      >
        {dashed ? (
          <>
            <Minus className='h-4 w-4' />
            Solid Line
          </>
        ) : (
          <>
            <Slash className='h-4 w-4' />
            Dashed Line
          </>
        )}
      </button>

      {/* Label visibility toggle */}
      <button
        disabled={!canEdit()}
        className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        onClick={() => {
          if (!canEdit()) return;
          onToggleLabelVisible(!labelVisible);
          onClose();
        }}
      >
        {labelVisible ? (
          <>
            <EyeOff className='h-4 w-4' />
            Hide Label
          </>
        ) : (
          <>
            <Eye className='h-4 w-4' />
            Show Label
          </>
        )}
      </button>

      {/* Direction - Submenu */}
      <div
        className='relative'
        onMouseEnter={() => {
          if (!canEdit()) return;
          setActiveSubmenu('direction');
        }}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <button
          disabled={!canEdit()}
          className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        >
          <span className='flex items-center gap-2'>
            <ArrowRight className='h-4 w-4' />
            Direction
          </span>
          <ChevronRight className='h-4 w-4' />
        </button>

        {activeSubmenu === 'direction' && (
          <div className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-1 w-44 rounded-md border p-1 shadow-md duration-100'>
            {/* Hide/Show Arrow */}
            <button
              disabled={!canEdit()}
              className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
              onClick={() => {
                if (!canEdit()) return;
                onToggleHideDirection(!hideDirection);
                onClose();
              }}
            >
              {hideDirection ? (
                <>
                  <Eye className='h-4 w-4' />
                  Show Arrow
                </>
              ) : (
                <>
                  <EyeOff className='h-4 w-4' />
                  Hide Arrow
                </>
              )}
            </button>

            {/* Bidirectional */}
            <button
              disabled={!canEdit()}
              className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
              onClick={() => {
                if (!canEdit()) return;
                onToggleBidirectional(!bidirectional);
                onClose();
              }}
            >
              <ArrowRightLeft className='h-4 w-4' />
              Bidirectional
              {bidirectional && <Check className='ml-auto h-4 w-4' />}
            </button>

            {/* Invert Direction */}
            <button
              className='hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none disabled:cursor-not-allowed disabled:opacity-40'
              onClick={() => {
                if (!canEdit()) return;
                onInvertDirection();
                onClose();
              }}
              disabled={!canEdit() || bidirectional}
              title={
                bidirectional ? 'Cannot invert bidirectional edge' : 'Invert edge direction'
              }
            >
              <ArrowLeftRight className='h-4 w-4' />
              Invert Direction
            </button>
          </div>
        )}
      </div>

      <div className='bg-border -mx-1 my-1 h-px' />

      {/* Colore - Submenu */}
      <div
        className='relative'
        onMouseEnter={() => {
          if (!canEdit()) return;
          setActiveSubmenu('color');
        }}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <button
          disabled={!canEdit()}
          className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        >
          <span className='flex items-center gap-2'>
            <Palette className='h-4 w-4' />
            Color
          </span>
          <div className='flex items-center gap-1'>
            <div
              className='border-border h-3 w-3 rounded-full border'
              style={{ backgroundColor: baseColor }}
            />
            <ChevronRight className='h-4 w-4' />
          </div>
        </button>

        {activeSubmenu === 'color' && (
          <div className='bg-popover text-popover-foreground animate-in fade-in-0 slide-in-from-left-1 adaptive-context-submenu absolute top-0 left-full ml-1 w-36 rounded-md border p-1 shadow-md duration-100'>
            {edgeColors.map((color) => (
              <button
                disabled={!canEdit()}
                key={color.value}
                className='disabled:opacity-50 disabled:pointer-events-none hover:bg-accent hover:text-accent-foreground relative flex w-full cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none select-none'
                onClick={() => {
                  if (!canEdit()) return;
                  onChangeColor(color.value);
                  onClose();
                }}
              >
                <span className='flex items-center gap-2'>
                  <div
                    className='border-border h-4 w-4 rounded-full border'
                    style={{ backgroundColor: color.value }}
                  />
                  {color.name}
                </span>
                {baseColor === color.value && <Check className='h-4 w-4' />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className='bg-border -mx-1 my-1 h-px' />

      {/* Elimina */}
      <button
        className='disabled:opacity-50 disabled:pointer-events-none text-destructive hover:bg-destructive/10 relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none'
        disabled={!canEdit()}
        onClick={() => {
          if (!canEdit()) return;
          onDelete();
          onClose();
        }}
      >
        <Trash2 className='h-4 w-4' />
        Delete
      </button>
    </div>,
    document.body
  );
}

function OSINTEdgeVisible({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
  interactionWidth,
  detailLevel,
  endpointNodes
}: EdgeProps<OSINTEdgeData> & {
  detailLevel: 'interactive' | 'full';
  endpointNodes?: { sourceNode: any; targetNode: any };
}) {
  const { setEdges, deleteElements } = useReactFlow();
  const canEdit = useGraphCanEdit();
  const readOnly = !canEdit();
  const safeSvgId = useMemo(() => {
    // `url(#...)` può fallire se l'id contiene caratteri non URL-safe.
    // Usiamo un id “sanificato” per marker/filter.
    const raw = String(id ?? '');
    return `edge-${raw.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }, [id]);

  const [isEditing, setIsEditing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [labelText, setLabelText] = useState(data?.label || '');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    setLabelText(data?.label || '');
  }, [data?.label]);

  useEffect(() => {
    if (!readOnly) return;
    setIsEditing(false);
    setLabelText(data?.label || '');
  }, [readOnly, data?.label]);

  // Floating edge calculation
  let sx = sourceX,
    sy = sourceY,
    tx = targetX,
    ty = targetY;
  let sPos = sourcePosition,
    tPos = targetPosition;

  const isLockedLayout = data?._layoutMode === 'locked';
  if (isLockedLayout) {
    const axis = data?._lockedAxis;
    if (axis === 'horizontal') {
      sPos = Position.Bottom;
      tPos = Position.Top;
    } else if (axis === 'vertical') {
      sPos = Position.Right;
      tPos = Position.Left;
    }
  } else if (endpointNodes?.sourceNode && endpointNodes.targetNode) {
    const sIntersect = getNodeIntersection(
      endpointNodes.sourceNode,
      endpointNodes.targetNode
    );
    const tIntersect = getNodeIntersection(
      endpointNodes.targetNode,
      endpointNodes.sourceNode
    );
    if (sIntersect && tIntersect) {
      sx = sIntersect.x;
      sy = sIntersect.y;
      sPos = sIntersect.position;
      tx = tIntersect.x;
      ty = tIntersect.y;
      tPos = tIntersect.position;
    }
  }

  // Calculate path
  const edgeType = data?.edgeType || 'default';
  let edgePath = '';
  let labelX = 0;
  let labelY = 0;

  if (edgeType === 'straight') {
    [edgePath, labelX, labelY] = getStraightPath({
      sourceX: sx,
      sourceY: sy,
      targetX: tx,
      targetY: ty
    });
  } else if (edgeType === 'smoothstep' || edgeType === 'step') {
    [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX: sx,
      sourceY: sy,
      targetX: tx,
      targetY: ty,
      sourcePosition: sPos,
      targetPosition: tPos
    });
  } else {
    [edgePath, labelX, labelY] = getBezierPath({
      sourceX: sx,
      sourceY: sy,
      targetX: tx,
      targetY: ty,
      sourcePosition: sPos,
      targetPosition: tPos
    });
  }

  const updateLabel = useCallback(
    (text: string) => {
      if (!canEdit()) return;
      setLabelText(text);
      setEdges((eds) =>
        eds.map((e) =>
          e.id === id ? { ...e, data: { ...e.data, label: text } } : e
        )
      );
    },
    [canEdit, id, setEdges]
  );

  const updateEdgeType = useCallback(
    (type: string) => {
      if (!canEdit()) return;
      setEdges((eds) =>
        eds.map((e) =>
          e.id === id ? { ...e, data: { ...e.data, edgeType: type } } : e
        )
      );
    },
    [canEdit, id, setEdges]
  );

  const updateEdgeColor = useCallback(
    (color: string) => {
      if (!canEdit()) return;
      setEdges((eds) =>
        eds.map((e) => (e.id === id ? { ...e, data: { ...e.data, color } } : e))
      );
    },
    [canEdit, id, setEdges]
  );

  const updateEdgeThickness = useCallback(
    (value: number) => {
      if (!canEdit()) return;
      setEdges((eds) =>
        eds.map((e) =>
          e.id === id ? { ...e, data: { ...e.data, strokeWidth: value } } : e
        )
      );
    },
    [canEdit, id, setEdges]
  );

  const updateEdgeDash = useCallback(
    (next: boolean) => {
      if (!canEdit()) return;
      setEdges((eds) =>
        eds.map((e) =>
          e.id === id ? { ...e, data: { ...e.data, dashed: next } } : e
        )
      );
    },
    [canEdit, id, setEdges]
  );

  const updateLabelVisible = useCallback(
    (visible: boolean) => {
      if (!canEdit()) return;
      setEdges((eds) =>
        eds.map((e) =>
          e.id === id ? { ...e, data: { ...e.data, labelVisible: visible } } : e
        )
      );
    },
    [canEdit, id, setEdges]
  );

  const updateHideDirection = useCallback(
    (hide: boolean) => {
      if (!canEdit()) return;
      setEdges((eds) =>
        eds.map((e) =>
          e.id === id ? { ...e, data: { ...e.data, hideDirection: hide } } : e
        )
      );
    },
    [canEdit, id, setEdges]
  );

  const updateBidirectional = useCallback(
    (bidirectional: boolean) => {
      if (!canEdit()) return;
      setEdges((eds) =>
        eds.map((e) =>
          e.id === id ? { ...e, data: { ...e.data, bidirectional } } : e
        )
      );
    },
    [canEdit, id, setEdges]
  );

  const handleInvertDirection = useCallback(() => {
    if (!canEdit()) return;
    setEdges((eds) =>
      eds.map((e) => {
        if (e.id === id) {
          return {
            ...e,
            source: e.target,
            target: e.source,
            sourceHandle: e.targetHandle,
            targetHandle: e.sourceHandle
          };
        }
        return e;
      })
    );
  }, [canEdit, id, setEdges]);

  const handleDelete = useCallback(() => {
    if (!canEdit()) return;
    deleteElements({ edges: [{ id }] });
  }, [canEdit, id, deleteElements]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // Gestione animazioni collapse/expand
  const isCollapsing = (data as any)?._collapsing;
  const isExpanding = (data as any)?._expanding;
  const customOpacity = (data as any)?._opacity;

  // Calcola opacity in base allo stato
  const getOpacity = () => {
    if (isCollapsing) return 0;
    if (isExpanding) return 1;
    return customOpacity ?? 1;
  };

  // Stile base dell'edge
  const baseColor = data?.color || '#64748b';
  const baseWidth = data?.strokeWidth ?? 2;
  const isDashed = !!data?.dashed;
  const labelVisible = data?.labelVisible ?? true; // Default to visible
  const labelContent = (readOnly ? data?.label : labelText) || data?.relationship || '';
  const showLabelEditor = isEditing && !readOnly;
  const shouldShowLabel =
    (labelVisible || showLabelEditor) &&
    (detailLevel === 'full' || selected || showLabelEditor || isHovered) &&
    Boolean(labelContent || selected || showLabelEditor);
  // Usa un blu più scuro e sottile quando selezionato, come i nodi
  const strokeColor = selected ? '#4338ca' : baseColor; // indigo-700
  const displayWidth = selected ? baseWidth + 1 : baseWidth;
  const edgeStyle = {
    '--edge-stroke': strokeColor,
    '--edge-width': displayWidth,
    '--edge-stroke-selected': strokeColor,
    '--edge-width-selected': displayWidth,
    strokeDasharray: isDashed ? '10 6' : 'none',
    opacity: getOpacity(),
    transition:
      isCollapsing || isExpanding
        ? 'stroke 0.2s ease, stroke-width 0.2s ease, opacity 0.25s ease'
        : 'stroke 0.2s ease, stroke-width 0.2s ease'
  } as CSSProperties;

  return (
    <g
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onContextMenu={handleContextMenu}
    >
      {selected ? (
        <defs>
          {/* Marker con glow per selezione (end) - stesso stile di ArrowClosed ma più grande */}
          {!data?.hideDirection && (
            <marker
              id={`arrow-glow-${safeSvgId}`}
              markerWidth='15'
              markerHeight='15'
              viewBox='0 0 10 10'
              orient='auto'
              refX='10'
              refY='5'
              markerUnits='userSpaceOnUse'
            >
              <path
                d='M 0 0 L 10 5 L 0 10 z'
                fill={strokeColor}
                style={{
                  transition: 'fill 0.2s ease',
                  filter: 'drop-shadow(0 0 3px rgba(67, 56, 202, 0.6))'
                }}
              />
            </marker>
          )}

          {/* Marker con glow per selezione (start - per bidirectional) */}
          {data?.bidirectional && (
            <marker
              id={`arrow-glow-start-${safeSvgId}`}
              markerWidth='15'
              markerHeight='15'
              viewBox='0 0 10 10'
              orient='auto'
              refX='0'
              refY='5'
              markerUnits='userSpaceOnUse'
            >
              <path
                d='M 10 0 L 0 5 L 10 10 z'
                fill={strokeColor}
                style={{
                  transition: 'fill 0.2s ease',
                  filter: 'drop-shadow(0 0 3px rgba(67, 56, 202, 0.6))'
                }}
              />
            </marker>
          )}
        </defs>
      ) : null}

      {/* Glow “safe” senza SVG filter (evita edge che spariscono se bbox=0) */}
      {selected ? (
        <BaseEdge
          id={`${id}-glow`}
          path={edgePath}
          style={{
            stroke: strokeColor,
            strokeWidth: displayWidth + 8,
            strokeDasharray: isDashed ? '10 6' : 'none',
            strokeLinecap: 'round',
            opacity: 0.18
          }}
          interactionWidth={0}
        />
      ) : null}

      {/* Path principale visibile */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={
          data?.hideDirection
            ? undefined
            : selected
              ? `url(#arrow-glow-${safeSvgId})`
              : markerEnd
        }
        markerStart={
          data?.bidirectional && !data?.hideDirection
            ? selected
              ? `url(#arrow-glow-start-${safeSvgId})`
              : markerEnd
            : undefined
        }
        style={{
          stroke: strokeColor,
          strokeWidth: displayWidth,
          strokeDasharray: isDashed ? '10 6' : 'none',
          strokeLinecap: 'round',
          ...edgeStyle
        }}
        interactionWidth={interactionWidth ?? 30}
      />

      {/* Label editabile - shown only if labelVisible is true */}
      {shouldShowLabel && (
        <EdgeLabelRenderer>
          <div
            className='nodrag nopan pointer-events-auto absolute'
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              opacity: getOpacity(),
              transition:
                isCollapsing || isExpanding ? 'opacity 0.25s ease' : 'none'
            }}
          >
            {showLabelEditor ? (
              <Input
                disabled={readOnly}
                value={labelText}
                onChange={(e) => updateLabel(e.target.value)}
                onBlur={() => setIsEditing(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') setIsEditing(false);
                }}
                className='h-7 w-32 bg-white text-xs dark:bg-zinc-900'
                autoFocus
                placeholder='Label...'
              />
            ) : (
              <div
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs shadow-sm transition-all',
                  readOnly ? 'cursor-text select-text' : 'cursor-pointer',
                  'bg-white hover:bg-gray-50 dark:bg-zinc-900 dark:hover:bg-zinc-800',
                  selected ? 'border-indigo-600 ring-2 ring-indigo-600/30' : 'border-border'
                )}
                onDoubleClick={() => {
                  if (canEdit()) setIsEditing(true);
                }}
                onContextMenu={handleContextMenu}
                title={
                  readOnly ? 'Read-only' : 'Double click to edit • Right click for options'
                }
              >
                {labelContent || '—'}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}

      {/* Context Menu - renderizzato via portal */}
      {contextMenu && (
        <EdgeContextMenu
          position={contextMenu}
          edgeType={edgeType}
          baseColor={baseColor}
          thickness={baseWidth}
          dashed={isDashed}
          labelVisible={labelVisible}
          hideDirection={data?.hideDirection || false}
          bidirectional={data?.bidirectional || false}
          onClose={() => setContextMenu(null)}
          onCopyLabel={() => {
            void (async () => {
              try {
                await navigator.clipboard.writeText(labelContent);
              } catch {
                toast.error('Unable to copy edge label');
              }
            })();
          }}
          onEditLabel={() => {
            if (canEdit()) setIsEditing(true);
          }}
          onChangeType={updateEdgeType}
          onChangeColor={updateEdgeColor}
          onChangeThickness={updateEdgeThickness}
          onToggleDashed={updateEdgeDash}
          onToggleLabelVisible={updateLabelVisible}
          onToggleHideDirection={updateHideDirection}
          onToggleBidirectional={updateBidirectional}
          onInvertDirection={handleInvertDirection}
          onDelete={handleDelete}
        />
      )}
    </g>
  );
}

function OSINTEdgeLine({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data
}: EdgeProps<OSINTEdgeData>) {
  const [edgePath] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY
  });
  const isCollapsing = (data as any)?._collapsing;
  const customOpacity = (data as any)?._opacity;

  return (
    <path
      id={id}
      d={edgePath}
      fill='none'
      stroke={data?.color || '#64748b'}
      strokeWidth={data?.strokeWidth ?? 2}
      opacity={isCollapsing ? 0 : (customOpacity ?? 1)}
      pointerEvents='stroke'
      shapeRendering='optimizeSpeed'
      className='react-flow__edge-path'
    />
  );
}

function OSINTEdgeDetailed(props: EdgeProps<OSINTEdgeData>) {
  const sourceNode = useStore(
    useCallback(
      (state) => state.nodeInternals.get(props.source),
      [props.source]
    )
  );
  const targetNode = useStore(
    useCallback(
      (state) => state.nodeInternals.get(props.target),
      [props.target]
    )
  );
  const endpointNodes = useMemo(
    () => ({ sourceNode, targetNode }),
    [sourceNode, targetNode]
  );

  return (
    <OSINTEdgeVisible
      {...props}
      detailLevel='full'
      endpointNodes={endpointNodes}
    />
  );
}

function OSINTEdgeComponent(props: EdgeProps<OSINTEdgeData>) {
  const detailLevel = useStore(selectEdgeDetailLevel);

  if (detailLevel === 'hidden') return null;
  if (props.selected || detailLevel === 'full') {
    return <OSINTEdgeDetailed {...props} />;
  }
  if (detailLevel === 'lines') return <OSINTEdgeLine {...props} />;

  return <OSINTEdgeVisible {...props} detailLevel='interactive' />;
}

export const OSINTEdge = memo(OSINTEdgeComponent);
export default OSINTEdge;
