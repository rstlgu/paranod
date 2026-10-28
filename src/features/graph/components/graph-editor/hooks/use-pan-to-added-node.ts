import { useEffect, useRef } from 'react';

/** Follow additions, not edits/removals or the initial graph load. */
export function usePanToAddedNode({
  nodes,
  scope,
  ready,
  panToNode
}: {
  nodes: ReadonlyArray<{ id: string }>;
  scope: string;
  ready: boolean;
  panToNode: (id: string) => void;
}) {
  const previous = useRef<Set<string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPan = useRef(panToNode);
  latestPan.current = panToNode;
  const latestNodes = useRef(nodes);
  latestNodes.current = nodes;

  useEffect(() => {
    previous.current = null;
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [scope, ready]);

  useEffect(() => {
    if (!ready) return;
    const known = previous.current;
    previous.current = new Set(nodes.map((node) => node.id));
    if (!known) return;
    const added = nodes.filter((node) => !known.has(node.id));
    const target = added[added.length - 1];
    if (!target) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (latestNodes.current.some((node) => node.id === target.id)) {
        latestPan.current(target.id);
      }
    }, 450);
  }, [nodes, scope, ready]);
}
