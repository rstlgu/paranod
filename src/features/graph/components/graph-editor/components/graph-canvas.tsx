'use client';

import * as React from 'react';
import type { Edge, Node, ReactFlowInstance } from 'reactflow';
import ReactFlow, {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  MarkerType,
  useStore
} from 'reactflow';
import {
  CircleIcon as IconCircle,
  CircleNotchIcon as IconLoader2,
  FileTextIcon as IconFileText
} from '@/components/icons';

import { AddToCaseProvider } from '@/features/graph/contexts/add-to-case-context';
import { GraphChildCountsProvider } from '@/features/graph/contexts/graph-topology-context';

interface NodeTypeOptionLike {
  value: string;
  label: string;
  color?: string;
  icon?: React.ComponentType<{
    className?: string;
    style?: React.CSSProperties;
  }>;
}

interface GraphCanvasProps {
  graphId?: string;
  isActive: boolean;
  isLayoutLocked?: boolean;
  isReadOnly?: boolean;
  lockedLanes?: {
    axis: 'vertical' | 'horizontal';
    positionsPx: number[];
    stepPx: number;
    anchorPx: number;
  };
  isDark: boolean;
  mounted: boolean;

  // drag & drop overlays
  isDraggingOver: boolean;
  dropPosition: { x: number; y: number } | null;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;

  // local root ref (for exports / per-tab isolation)
  reactFlowRootElRef: React.RefObject<HTMLDivElement | null>;

  // connect preview overlay
  previewNodePosition: { x: number; y: number } | null;
  previewNodeOffset: { x: number; y: number };
  suggestedNodeType: string;
  nodeTypeOptions: ReadonlyArray<NodeTypeOptionLike>;
  reactFlowInstance: ReactFlowInstance;

  // loading
  isLoadingGraph: boolean;
  graphName: string;

  // add-to-case provider value
  recentCases: Array<{ id: string; name: string }>;
  refreshRecentCases: () => Promise<void>;
  addNodesToCase: (args: { caseId: string; nodes: any[] }) => Promise<void>;
  openAddToCase: (nodes: any[]) => void;
  openNewCaseDialogForNodes: (nodes: any[]) => void;

  // reactflow
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (...args: any[]) => void;
  onEdgesChange: (...args: any[]) => void;
  onConnect: (...args: any[]) => void;
  onConnectStart: (...args: any[]) => void;
  onConnectEnd: (...args: any[]) => void;
  onReconnect: (...args: any[]) => void;
  onReconnectStart: (...args: any[]) => void;
  onReconnectEnd: (...args: any[]) => void;
  onNodeClick?: (...args: any[]) => void;
  onEdgeClick?: (...args: any[]) => void;
  onPaneContextMenu: (...args: any[]) => void;
  onSelectionContextMenu: (...args: any[]) => void;
  onSelectionDragStart?: (...args: any[]) => void;
  onSelectionDragStop?: (...args: any[]) => void;
  onPaneClick?: (...args: any[]) => void;
  onNodeContextMenu?: (...args: any[]) => void;
  onEdgeContextMenu?: (...args: any[]) => void;
  onNodeDragStart: (...args: any[]) => void;
  onNodeDrag: (...args: any[]) => void;
  isValidConnection: (...args: any[]) => boolean;
  nodeTypes: Record<string, React.ComponentType<any>>;
  edgeTypes: Record<string, React.ComponentType<any>>;

  showGrid: boolean;
  backgroundPatternId: string;
  backgroundVariant: BackgroundVariant;
  showMiniMap: boolean;
  nodeColorMap: Record<string, string>;
  defaultEdgeOptions?: any;
  snapToGrid?: boolean;
  layoutOverlay?: { isRunning: boolean; pct?: number; label?: string } | null;
}

function LockedLaneOverlay(props: {
  axis: 'vertical' | 'horizontal';
  positionsPx: number[];
  stepPx?: number;
  anchorPx?: number;
  isDark: boolean;
}) {
  const transform = useStore(
    (state: any) =>
      (state.transform as [number, number, number] | undefined) ??
      ([0, 0, 1] as const)
  );
  const translateX = transform?.[0] ?? 0;
  const translateY = transform?.[1] ?? 0;
  const zoom = transform?.[2] ?? 1;
  const color = props.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)';

  function medianStep(values: number[]): number {
    if (values.length < 2) return 360;
    const sorted = [...values].sort((a, b) => a - b);
    const diffs = sorted
      .slice(1)
      .map((v, i) => Math.abs(v - sorted[i]))
      .filter((d) => d > 1e-6)
      .sort((a, b) => a - b);
    if (!diffs.length) return 360;
    return diffs[Math.floor(diffs.length / 2)] ?? 360;
  }

  const step = typeof props.stepPx === 'number' ? props.stepPx : medianStep(props.positionsPx);
  const anchor =
    typeof props.anchorPx === 'number'
      ? props.anchorPx
      : props.positionsPx[0] ?? 0;

  const safeStep = Math.max(40, step);
  const screenStep = Math.max(1, safeStep * zoom);
  const screenAnchor =
    (props.axis === 'vertical' ? translateX : translateY) + anchor * zoom;
  const patternOffset =
    ((screenAnchor % screenStep) + screenStep) % screenStep;

  return (
    <div
      className='pointer-events-none absolute inset-0 z-[2]'
      style={{
        backgroundImage:
          props.axis === 'vertical'
            ? `linear-gradient(to right, ${color} 0, ${color} 1px, transparent 1px)`
            : `linear-gradient(to bottom, ${color} 0, ${color} 1px, transparent 1px)`,
        backgroundPosition:
          props.axis === 'vertical'
            ? `${patternOffset}px 0`
            : `0 ${patternOffset}px`,
        backgroundSize:
          props.axis === 'vertical'
            ? `${screenStep}px 100%`
            : `100% ${screenStep}px`
      }}
    />
  );
}

function GraphCanvasComponent(props: GraphCanvasProps) {
  const nodes = React.useMemo(
    () =>
      props.isReadOnly
        ? props.nodes.map((node) => ({
            ...node,
            draggable: false,
            connectable: false,
            deletable: false
          }))
        : props.nodes,
    [props.isReadOnly, props.nodes]
  );
  const initialFitEnabled = React.useRef<boolean | null>(null);
  if (!props.isLoadingGraph && initialFitEnabled.current === null) {
    initialFitEnabled.current = props.nodes.length > 0;
  }
  const { onNodeDragStart } = props;
  const [isNodeDragging, setIsNodeDragging] = React.useState(false);
  React.useEffect(() => {
    if (props.isReadOnly) setIsNodeDragging(false);
  }, [props.isReadOnly]);
  const isPaneDragging = useStore((state: any) =>
    Boolean(state.paneDragging)
  );
  const addToCaseValue = React.useMemo(
    () => ({
      recentCases: props.recentCases,
      refreshRecentCases: props.refreshRecentCases,
      addNodesToCase: props.addNodesToCase,
      openAllCasesDialog: props.openAddToCase,
      openNewCaseDialog: props.openNewCaseDialogForNodes
    }),
    [
      props.addNodesToCase,
      props.openAddToCase,
      props.openNewCaseDialogForNodes,
      props.recentCases,
      props.refreshRecentCases
    ]
  );
  const childCountEdgesRef = React.useRef(props.edges);
  childCountEdgesRef.current = props.edges;
  const childCountSignature = props.edges
    .map((edge) => `${edge.id}:${edge.source}>${edge.target}`)
    .join('|');
  const childCountById = React.useMemo(() => {
    void childCountSignature;
    const counts = new Map<string, number>();
    for (const edge of childCountEdgesRef.current) {
      counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
    }
    return counts;
  }, [childCountSignature]);
  const handleNodeDragStart = React.useCallback(
    (...args: any[]) => {
      setIsNodeDragging(true);
      onNodeDragStart(...args);
    },
    [onNodeDragStart]
  );
  const handleNodeDragStop = React.useCallback(() => {
    setIsNodeDragging(false);
  }, []);

  return (
    <div className='min-h-0 h-full w-full overflow-hidden'>
      <div
        ref={props.reactFlowRootElRef}
        className='relative h-full w-full overflow-hidden'
        onDragOver={props.onDragOver}
        onDragLeave={props.onDragLeave}
        onDrop={props.onDrop}
      >
        {props.layoutOverlay?.isRunning ? (
          <div className='pointer-events-none absolute left-3 top-3 z-50'>
            <div className='bg-background/80 text-foreground flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs shadow-sm backdrop-blur'>
              <IconLoader2 className='h-3.5 w-3.5 animate-spin' />
              <span className='font-medium'>
                {props.layoutOverlay.label ?? 'Layout…'}
              </span>
              {typeof props.layoutOverlay.pct === 'number' ? (
                <span className='text-muted-foreground'>
                  {Math.round(props.layoutOverlay.pct * 100)}%
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Le corsie vanno dentro il viewport di ReactFlow (seguono pan/zoom) */}

        {/* Drop Zone Overlay - Minimal preview */}
        {!props.isReadOnly && props.isDraggingOver && props.dropPosition && (
          <div className='pointer-events-none absolute inset-0 z-50 flex items-center justify-center'>
            <div
              className='border-primary bg-background absolute rounded-2xl border-2 shadow-2xl transition-all'
              style={{
                left: props.dropPosition.x - 70,
                top: props.dropPosition.y - 80,
                width: 140,
                height: 160,
                opacity: 0.9
              }}
            >
              <div className='flex h-full flex-col items-center justify-center gap-2 p-3'>
                <div className='bg-primary/10 rounded-lg p-2'>
                  <IconFileText className='text-primary h-8 w-8' />
                </div>
                <div className='text-center'>
                  <p className='text-muted-foreground text-[10px] font-medium'>
                    Rilascia file
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Preview Node Overlay */}
        {!props.isReadOnly && props.previewNodePosition &&
          (() => {
            const typeConfig = props.nodeTypeOptions.find(
              (opt) => opt.value === props.suggestedNodeType
            );
            const PreviewIcon = typeConfig?.icon || IconCircle;
            const fullLabel = typeConfig?.label || 'Node';
            const previewColor = typeConfig?.color || '#60a5fa';

            return (
              <div
                className='pointer-events-none absolute z-50 transition-all duration-150'
                style={{
                  left:
                    props.reactFlowInstance.flowToScreenPosition(
                      props.previewNodePosition
                    ).x +
                    props.previewNodeOffset.x +
                    'px',
                  top:
                    props.reactFlowInstance.flowToScreenPosition(
                      props.previewNodePosition
                    ).y +
                    props.previewNodeOffset.y +
                    'px',
                  opacity: 0.4
                }}
              >
                <div className='bg-background min-w-[200px] overflow-hidden rounded-xl border shadow-sm transition-shadow duration-200'>
                  <div
                    className='flex items-center justify-between border-b px-3 py-2'
                    style={{
                      backgroundColor: previewColor + '15',
                      borderBottomColor: previewColor + '40'
                    }}
                  >
                    <div className='flex items-center gap-2'>
                      <PreviewIcon
                        className='h-4 w-4'
                        style={{ color: previewColor }}
                      />
                      <span
                        className='text-sm font-semibold tracking-tight'
                        style={{ color: previewColor }}
                      >
                        {fullLabel}
                      </span>
                    </div>
                  </div>
                  <div className='min-h-[40px] bg-white/50 px-3 py-3 backdrop-blur-sm dark:bg-zinc-900/50'>
                    <div className='text-muted-foreground/50 -mx-1 cursor-text rounded px-1 text-sm font-medium'>
                      New {fullLabel.toLowerCase()}...
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

        <div className='h-full w-full'>
          {props.isLoadingGraph ? (
            <GraphLoadingSkeleton graphName={props.graphName} />
          ) : (
            <GraphChildCountsProvider value={childCountById}>
              <AddToCaseProvider value={addToCaseValue}>
                <ReactFlow
                  nodes={nodes}
                  edges={props.edges}
                  onNodesChange={props.onNodesChange}
                  onEdgesChange={props.onEdgesChange}
                  onConnect={props.onConnect}
                  onConnectStart={props.onConnectStart}
                  onConnectEnd={props.onConnectEnd}
                  onReconnect={props.onReconnect}
                  onReconnectStart={props.onReconnectStart}
                  onReconnectEnd={props.onReconnectEnd}
                  onNodeClick={props.onNodeClick}
                  onEdgeClick={props.onEdgeClick}
                  onPaneContextMenu={props.onPaneContextMenu}
                  onPaneClick={props.onPaneClick}
                  onSelectionContextMenu={props.onSelectionContextMenu}
                  onSelectionDragStart={props.onSelectionDragStart as any}
                  onSelectionDragStop={props.onSelectionDragStop as any}
                  onNodeContextMenu={props.onNodeContextMenu}
                  onEdgeContextMenu={props.onEdgeContextMenu}
                  onNodeDragStart={handleNodeDragStart}
                  onNodeDrag={props.onNodeDrag}
                  onNodeDragStop={handleNodeDragStop}
                  isValidConnection={props.isValidConnection}
                  nodeTypes={props.nodeTypes}
                  edgeTypes={props.edgeTypes}
                  connectionMode={ConnectionMode.Loose}
                  fitView={initialFitEnabled.current ?? false}
                  // Cap dello zoom del fit iniziale: con 1-2 nodi non
                  // ingrandire oltre il 100%.
                  fitViewOptions={{ padding: 0.4, maxZoom: 1 }}
                  className='bg-canvas'
                  snapToGrid={props.snapToGrid ?? true}
                  snapGrid={[15, 15]}
                  nodesDraggable={props.isActive && !props.isLayoutLocked && !props.isReadOnly}
                  nodesConnectable={props.isActive && !props.isReadOnly}
                  deleteKeyCode={
                    props.isActive && !props.isReadOnly ? 'Backspace' : null
                  }
                  edgesUpdatable={false}
                  elementsSelectable={props.isActive}
                  panOnDrag={props.isActive}
                  zoomOnScroll={props.isActive}
                  zoomOnPinch={props.isActive}
                  zoomOnDoubleClick={props.isActive}
                  selectionOnDrag={props.isActive}
                  defaultEdgeOptions={
                    props.defaultEdgeOptions ?? {
                      type: 'osint',
                      markerEnd: {
                        type: MarkerType.ArrowClosed,
                        width: 10,
                        height: 10
                      }
                    }
                  }
                  minZoom={0.04}
                  maxZoom={4}
                  connectionRadius={30}
                  multiSelectionKeyCode={props.isActive ? 'Shift' : null}
                  selectionKeyCode={props.isActive ? 'Shift' : null}
                  onlyRenderVisibleElements
                >
                  {props.isLayoutLocked &&
                  props.lockedLanes?.positionsPx?.length ? (
                    <LockedLaneOverlay
                      axis={props.lockedLanes.axis}
                      positionsPx={props.lockedLanes.positionsPx}
                      stepPx={props.lockedLanes.stepPx}
                      anchorPx={props.lockedLanes.anchorPx}
                      isDark={props.isDark}
                    />
                  ) : null}
                  {/* Background grid: solo in modalità free */}
                  {!props.isLayoutLocked && props.showGrid && (
                    <Background
                      id={props.backgroundPatternId}
                      variant={props.backgroundVariant}
                      color={
                        props.backgroundVariant === BackgroundVariant.Lines
                          ? props.isDark
                            ? 'rgba(255,255,255,0.06)'
                            : '#e4e4e7'
                          : props.backgroundVariant === BackgroundVariant.Cross
                            ? props.isDark
                              ? 'rgba(255,255,255,0.16)'
                              : '#a1a1aa'
                            : props.isDark
                              ? 'rgba(255,255,255,0.18)'
                              : '#71717a'
                      }
                      gap={
                        props.backgroundVariant === BackgroundVariant.Lines
                          ? 72
                          : props.backgroundVariant === BackgroundVariant.Cross
                            ? 48
                            : 24
                      }
                      size={
                        props.backgroundVariant === BackgroundVariant.Dots
                          ? 1.5
                          : props.backgroundVariant === BackgroundVariant.Cross
                            ? 2
                            : 1
                      }
                    />
                  )}

                  {props.showMiniMap &&
                    props.mounted &&
                    !isNodeDragging &&
                    !isPaneDragging && (
                    <MiniMap
                      nodeColor={(node) =>
                        props.nodeColorMap[(node.data as any)?.type] || '#6b7280'
                      }
                      nodeStrokeColor={props.isDark ? '#374151' : '#d1d5db'}
                      nodeBorderRadius={8}
                      maskColor={
                        props.isDark
                          ? 'rgba(0, 0, 0, 0.7)'
                          : 'rgba(255, 255, 255, 0.7)'
                      }
                      style={{
                        width: 150,
                        height: 105,
                        backgroundColor: props.isDark ? '#18181b' : '#ffffff',
                        border: props.isDark
                          ? '1px solid #27272a'
                          : '1px solid #e5e7eb',
                        borderRadius: '8px',
                        opacity: 0.5
                      }}
                    />
                  )}
                </ReactFlow>
                <div className='pointer-events-none absolute inset-0 z-[5] shadow-[inset_0_0_90px_rgba(0,0,0,0.01)] dark:shadow-[inset_0_0_110px_rgba(0,0,0,0.02)]' />
              </AddToCaseProvider>
            </GraphChildCountsProvider>
          )}
        </div>
      </div>
    </div>
  );
}

export const GraphCanvas = React.memo(GraphCanvasComponent);

function GraphLoadingSkeleton({ graphName }: { graphName: string }) {
  return (
    <div className='bg-background relative h-full w-full'>
      <div className='absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,theme(colors.zinc.200)_1px,transparent_0)] bg-[size:24px_24px] dark:bg-[radial-gradient(circle_at_1px_1px,theme(colors.zinc.800)_1px,transparent_0)]' />
      <div className='relative flex h-full w-full items-center justify-center'>
        <div className='flex flex-col items-center gap-4'>
          <div className='relative'>
            <div className='bg-primary/30 absolute inset-0 animate-pulse rounded-full blur-2xl' />
            <div className='relative'>
              <IconLoader2 className='text-primary h-10 w-10 animate-spin' />
            </div>
          </div>
          <div className='text-center'>
            <p className='text-lg font-semibold tracking-tight'>
              {graphName || 'Loading Graph'}
            </p>
            <p className='text-muted-foreground text-sm'>Loading nodes...</p>
          </div>
        </div>
      </div>
    </div>
  );
}
