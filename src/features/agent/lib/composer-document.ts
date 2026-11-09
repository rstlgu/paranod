import type { JSONContent } from '@tiptap/core';
import { NODE_MENTION_PREFIX } from './node-mentions';

export function serializeAgentDraft(doc: JSONContent): string {
  const inline = (node: JSONContent): string => {
    if (node.type === 'mention') {
      const label = String(node.attrs?.label ?? node.attrs?.id ?? '')
        .replace(/[\\\[\]]/g, '\\$&')
        .replace(/[\r\n]+/g, ' ');
      // Parentheses must be encoded too: encodeURIComponent leaves them intact.
      const id = encodeURIComponent(String(node.attrs?.id ?? '')).replace(
        /[()]/g,
        (char) => (char === '(' ? '%28' : '%29')
      );
      return `[${label}](${NODE_MENTION_PREFIX}${id})`;
    }
    if (node.type === 'hardBreak') return '\n';
    return node.text ?? node.content?.map(inline).join('') ?? '';
  };
  return doc.content?.map(inline).join('\n') ?? '';
}

export function parseAgentDraft(text: string): JSONContent {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => {
      const content: JSONContent[] = [];
      const pattern = /\[((?:\\.|[^\]\\])*)\]\(#graph-node=([^\s)]*)\)/g;
      let cursor = 0;
      for (const match of Array.from(line.matchAll(pattern))) {
        let id: string;
        try {
          id = decodeURIComponent(match[2]);
        } catch {
          continue;
        }
        if (!id) continue;
        if (match.index! > cursor)
          content.push({ type: 'text', text: line.slice(cursor, match.index) });
        content.push({
          type: 'mention',
          attrs: {
            id,
            label: match[1].replace(/\\([\\\[\]])/g, '$1'),
            mentionSuggestionChar: null
          }
        });
        cursor = match.index! + match[0].length;
      }
      if (cursor < line.length)
        content.push({ type: 'text', text: line.slice(cursor) });
      return { type: 'paragraph', content };
    })
  };
}
