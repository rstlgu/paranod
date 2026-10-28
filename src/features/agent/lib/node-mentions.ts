import type { Node } from 'reactflow';

export interface MentionIndex {
  byId: Map<string, Node>;
  byText: Map<string, Node>;
  pattern: RegExp | null;
}

export function indexNodeMentions(nodes: readonly Node[]): MentionIndex {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const candidates = new Map<string, Node | null>();
  for (const node of nodes) {
    for (const text of Array.from(
      new Set([node.id, String(node.data?.label ?? '').trim()])
    )) {
      if (!text || text.length > 500) continue;
      candidates.set(text, candidates.has(text) ? null : node);
    }
  }
  const byText = new Map(
    Array.from(candidates).filter(
      (entry): entry is [string, Node] => entry[1] !== null
    )
  );
  const alternatives = Array.from(byText.keys())
    .sort((a, b) => b.length - a.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return {
    byId,
    byText,
    pattern: alternatives.length
      ? new RegExp(
          `(?<![\\p{L}\\p{N}_@/.-])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}_@/-]|\\.[\\p{L}\\p{N}])`,
          'gu'
        )
      : null
  };
}

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

export const NODE_MENTION_PREFIX = '#graph-node=';

// Operate on Markdown's parsed text, not its source: never rewrite code blocks,
// image URLs or external link destinations. Ambiguous labels remain plain text.
export function nodeMentionPlugin(index: MentionIndex) {
  return () => (tree: MarkdownNode) => {
    const visit = (parent: MarkdownNode) => {
      if (!parent.children || ['code', 'image', 'html'].includes(parent.type))
        return;
      parent.children = parent.children.flatMap((child): MarkdownNode[] => {
        if (child.type === 'link') {
          // Explicit composer mentions retain their exact identity, even when
          // labels are duplicated, changed, or the original node was removed.
          if (child.url?.startsWith(NODE_MENTION_PREFIX)) return [child];
          const text = child.children?.map((item) => item.value ?? '').join('');
          const node =
            index.byText.get(child.url ?? '') ?? index.byText.get(text ?? '');
          if (node)
            child.url = `${NODE_MENTION_PREFIX}${encodeURIComponent(node.id)}`;
          return [child];
        }
        if (
          ['text', 'inlineCode'].includes(child.type) &&
          child.value &&
          index.pattern
        ) {
          const parts: MarkdownNode[] = [];
          let cursor = 0;
          for (const match of Array.from(child.value.matchAll(index.pattern))) {
            const node = index.byText.get(match[0])!;
            if (match.index! > cursor)
              parts.push({
                type: child.type,
                value: child.value.slice(cursor, match.index)
              });
            parts.push({
              type: 'link',
              url: `${NODE_MENTION_PREFIX}${encodeURIComponent(node.id)}`,
              children: [
                { type: 'text', value: String(node.data?.label || node.id) }
              ]
            });
            cursor = match.index! + match[0].length;
          }
          if (!parts.length) return [child];
          if (cursor < child.value.length)
            parts.push({ type: child.type, value: child.value.slice(cursor) });
          return parts;
        }
        visit(child);
        return [child];
      });
    };
    visit(tree);
  };
}
