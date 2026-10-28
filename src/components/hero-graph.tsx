'use client';

import ReactFlow, {
  Node,
  Edge,
  Handle,
  Position,
  ReactFlowProvider,
  ConnectionMode,
  Background,
  Controls,
  useNodesState,
  useEdgesState
} from 'reactflow';
import 'reactflow/dist/style.css';
import { cn } from '@/lib/utils';
import { nodeTypeByType, type NodeType } from '@/features/osint/node-registry';

function getHeroNodeConfig(type: string) {
  const resolvedType = (type as NodeType) in nodeTypeByType
    ? (type as NodeType)
    : 'domain';
  const def = nodeTypeByType[resolvedType];
  return {
    icon: def.icon,
    label: def.label,
    headerBg: def.ui.headerBg,
    headerText: def.ui.headerText,
    bodyBg: 'bg-white/80 dark:bg-zinc-950/80',
    borderColor: def.ui.borderColor
  };
}

const HeroNode = ({ data }: { data: any }) => {
  const config = getHeroNodeConfig(data.type);
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'group relative min-w-[200px] rounded-xl border-2 shadow-sm backdrop-blur-sm transition-all duration-200 hover:shadow-lg',
        config.borderColor,
        config.bodyBg
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center gap-2 border-b px-3 py-2 text-xs font-semibold tracking-wider uppercase',
          config.borderColor,
          config.headerBg,
          config.headerText
        )}
      >
        <Icon className='h-3.5 w-3.5' />
        {config.label}
      </div>

      {/* Content */}
      <div className='p-3'>
        <div className='font-mono text-sm font-medium break-all'>
          {data.label}
        </div>
      </div>

      {/* Handles - Hidden */}
      <Handle
        type='target'
        position={Position.Top}
        className='pointer-events-none opacity-0'
      />
      <Handle
        type='source'
        position={Position.Bottom}
        className='pointer-events-none opacity-0'
      />
      <Handle
        type='target'
        position={Position.Left}
        className='pointer-events-none opacity-0'
      />
      <Handle
        type='source'
        position={Position.Right}
        className='pointer-events-none opacity-0'
      />
    </div>
  );
};

const nodeTypes = {
  osint: HeroNode
};

interface HeroGraphViewport {
  x: number;
  y: number;
  zoom: number;
}

interface HeroGraphProps {
  isInteractive?: boolean;
  defaultViewport?: HeroGraphViewport;
}

// Arranged to leave center space empty for hero text
const initialNodes: Node[] = [
  // Left side cluster
  {
    id: '1',
    type: 'osint',
    position: { x: -400, y: -100 },
    data: { label: 'target@example.com', type: 'email' }
  },
  {
    id: '2',
    type: 'osint',
    position: { x: -650, y: 50 },
    data: { label: 'example.com', type: 'domain' }
  },
  {
    id: '3',
    type: 'osint',
    position: { x: -450, y: 200 },
    data: { label: 'john_doe_88', type: 'username' }
  },

  // Right side cluster
  {
    id: '4',
    type: 'osint',
    position: { x: 400, y: -150 },
    data: { label: '192.168.1.100', type: 'ip' }
  },
  {
    id: '5',
    type: 'osint',
    position: { x: 650, y: 0 },
    data: { label: 'John Doe', type: 'person' }
  },
  {
    id: '6',
    type: 'osint',
    position: { x: 450, y: 150 },
    data: { label: '+1-555-0123', type: 'phone' }
  },

  // Bottom/Top scattered
  {
    id: '7',
    type: 'osint',
    position: { x: 0, y: 350 },
    data: { label: 'Acme Corp', type: 'organization' }
  },
  {
    id: '8',
    type: 'osint',
    position: { x: 0, y: -300 },
    data: { label: 'Crypto Wallet', type: 'wallet' } // Fallback to default/wallet style if defined or domain
  }
];

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', type: 'smoothstep', animated: true },
  { id: 'e1-3', source: '1', target: '3', type: 'smoothstep', animated: true },
  { id: 'e4-5', source: '4', target: '5', type: 'smoothstep', animated: true },
  { id: 'e5-6', source: '5', target: '6', type: 'smoothstep', animated: true },
  { id: 'e3-7', source: '3', target: '7', type: 'smoothstep', animated: true },
  { id: 'e1-8', source: '1', target: '8', type: 'smoothstep', animated: true },
  // Cross connections
  {
    id: 'e2-4',
    source: '2',
    target: '4',
    type: 'smoothstep',
    animated: true,
    style: { strokeDasharray: '5,5' }
  }
];

export function HeroGraph({
  isInteractive = false,
  defaultViewport
}: HeroGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div
      className={cn('h-full w-full', !isInteractive && 'pointer-events-none')}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView={!isInteractive}
          fitViewOptions={!isInteractive ? { padding: 0.2 } : undefined}
          defaultViewport={
            isInteractive
              ? (defaultViewport ?? { x: -150, y: -80, zoom: 1.6 })
              : undefined
          }
          proOptions={{ hideAttribution: true }}
          minZoom={0.3}
          maxZoom={3}
          nodesDraggable={isInteractive}
          nodesConnectable={false}
          elementsSelectable={isInteractive}
          zoomOnScroll={isInteractive}
          panOnScroll={false}
          panOnDrag={isInteractive}
          zoomOnPinch={isInteractive}
          zoomOnDoubleClick={isInteractive}
          preventScrolling={isInteractive}
          connectionMode={ConnectionMode.Loose}
          className='bg-transparent'
        >
          <Background color='#888' gap={20} size={1} className='opacity-10' />
          {isInteractive && (
            <Controls className='!border-zinc-800 !bg-zinc-900 !text-white [&>button]:!border-b-zinc-800 [&>button]:!fill-white hover:[&>button]:!bg-zinc-800' />
          )}
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
