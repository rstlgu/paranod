'use client';

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react';
import ReactMarkdown from 'react-markdown';
import type { Node } from 'reactflow';
import { Crosshair } from 'lucide-react';
import { nodeTypeByType, type NodeType } from '@/features/osint/node-registry';
import { getOsintNodeVisualTokens } from '@/features/graph/components/osint-node-visual';
import {
  indexNodeMentions,
  nodeMentionPlugin,
  NODE_MENTION_PREFIX,
  type MentionIndex
} from '../lib/node-mentions';
import type { AgentGraphReferences } from '../store/agent-graph-references';
import { responseRevealPlugin } from '../lib/response-reveal';
import styles from './agent-panel.module.css';

const EMPTY_NODES: readonly Node[] = [];
const EMPTY_INDEX = indexNodeMentions(EMPTY_NODES);
const MentionContext = createContext<{
  references?: AgentGraphReferences;
  index: MentionIndex;
}>({ index: EMPTY_INDEX });

export function AgentMentionProvider({
  value,
  children
}: {
  value?: AgentGraphReferences;
  children: ReactNode;
}) {
  const nodes = value?.nodes ?? EMPTY_NODES;
  const index = useMemo(() => indexNodeMentions(nodes), [nodes]);
  const context = useMemo(() => ({ references: value, index }), [value, index]);
  return (
    <MentionContext.Provider value={context}>
      {children}
    </MentionContext.Provider>
  );
}

const REVEAL_PLUGINS = [responseRevealPlugin];

export function AgentMarkdown({
  text,
  animate = false,
  onRevealProgress
}: {
  text: string;
  animate?: boolean;
  onRevealProgress?: () => void;
}) {
  const { index } = useContext(MentionContext);
  const plugins = useMemo(() => [nodeMentionPlugin(index)], [index]);
  const revealRef = useRef<HTMLDivElement>(null);
  const progress = useRef(onRevealProgress);
  progress.current = onRevealProgress;
  useLayoutEffect(() => {
    const container = revealRef.current;
    if (
      !animate ||
      !container ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const words = Array.from(
      container.querySelectorAll<HTMLElement>('[data-response-word]')
    );
    if (!words.length) return;
    let heights: number[] = [];
    const delays = words.map(
      (word) => Number.parseFloat(word.style.animationDelay) || 0
    );
    const measure = () => {
      const top = container.getBoundingClientRect().top;
      let bottom = 0;
      heights = words.map((word) => {
        bottom = Math.max(bottom, word.getBoundingClientRect().bottom - top);
        return Math.ceil(bottom) + 2;
      });
    };
    measure();
    container.style.overflow = 'hidden';
    container.style.height = `${heights[0]}px`;
    container.dataset.revealing = 'true';
    const started = performance.now();
    let frame = 0;
    let shown = -1;
    let width = container.clientWidth;
    const resize = new ResizeObserver(() => {
      if (container.clientWidth !== width) {
        width = container.clientWidth;
        measure();
        shown = -1;
      }
    });
    resize.observe(container);
    const clear = () => {
      container.style.height = '';
      container.style.overflow = '';
      delete container.dataset.revealing;
    };
    const tick = (now: number) => {
      const elapsed = now - started;
      if (elapsed >= delays[delays.length - 1] + 180) {
        clear();
        resize.disconnect();
        progress.current?.();
        return;
      }
      let next = 0;
      while (next + 1 < delays.length && delays[next + 1] <= elapsed) next++;
      if (next !== shown) {
        shown = next;
        container.style.height = `${heights[next]}px`;
        progress.current?.();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      clear();
    };
  }, [animate, text]);
  return (
    <div ref={revealRef} className={styles.responseBody}>
      <ReactMarkdown
        remarkPlugins={plugins}
        rehypePlugins={animate ? REVEAL_PLUGINS : undefined}
        components={MARKDOWN_COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

const MARKDOWN_COMPONENTS = { img: () => null, a: AgentLink };

function AgentLink({
  href,
  children
}: {
  href?: string;
  children?: ReactNode;
}) {
  const { references, index } = useContext(MentionContext);
  let id: string | undefined;
  if (href?.startsWith(NODE_MENTION_PREFIX)) {
    try {
      id = decodeURIComponent(href.slice(NODE_MENTION_PREFIX.length));
    } catch {
      /* Invalid reference stays text. */
    }
  }
  const node = id ? index.byId.get(id) : undefined;
  if (node && references)
    return (
      <AgentNodeMention
        key={node.id}
        node={node}
        onSelectNode={references.onSelectNode}
      />
    );
  if (href?.startsWith(NODE_MENTION_PREFIX)) return <>{children}</>;
  return (
    <a href={href} target='_blank' rel='noopener noreferrer'>
      {children}
    </a>
  );
}

function AgentNodeMention({
  node,
  onSelectNode
}: {
  node: Node;
  onSelectNode: (id: string) => void;
}) {
  const type = String(node.data?.type ?? 'custom');
  const label = String(node.data?.label || node.id);
  const { logoUrl, iconHex } = getOsintNodeVisualTokens({
    type,
    label,
    metadata: node.data?.metadata
  });
  const Icon = nodeTypeByType[type as NodeType]?.icon ?? Crosshair;
  const [failedLogo, setFailedLogo] = useState<string | undefined>();
  return (
    <button
      type='button'
      className={`case-reference-mention ${styles.nodeMention}`}
      data-reference-kind='entity'
      data-node-id={node.id}
      style={{ '--reference-accent': iconHex } as CSSProperties}
      title={`Show ${label} on graph`}
      onClick={() => onSelectNode(node.id)}
    >
      {logoUrl && failedLogo !== logoUrl ? (
        // Same internal site-logo endpoint as the graph; never a model-supplied URL.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className='case-reference-mention-favicon'
          src={logoUrl}
          alt=''
          onError={() => setFailedLogo(logoUrl)}
        />
      ) : (
        // Inline SVG inherits the node color, unlike the fixed-color SVG endpoint.
        <Icon className='case-reference-mention-favicon' aria-hidden />
      )}
      <span>{label}</span>
    </button>
  );
}
