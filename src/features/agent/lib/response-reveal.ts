import type { Element, Root, RootContent } from 'hast';

// Animate parsed Markdown, never partial source: formatting and graph references
// stay intact, with no per-character React renders or duplicate accessible text.
export function responseRevealPlugin() {
  return (tree: Root) => {
    const units: Element[] = [];
    const visit = (parent: Root | Element) => {
      parent.children = parent.children.flatMap((child): RootContent[] => {
        if (child.type === 'text') {
          return (child.value.match(/\S+\s*|\s+/g) ?? []).map((value) => {
            if (!value.trim()) return { type: 'text', value };
            const span: Element = {
              type: 'element',
              tagName: 'span',
              properties: { 'data-response-word': true },
              children: [{ type: 'text', value }]
            };
            units.push(span);
            return span;
          });
        }
        if (child.type === 'element') {
          // A link can become a graph-node button. Reveal it as one intact unit.
          if (['a', 'code', 'pre'].includes(child.tagName)) {
            const span: Element = {
              type: 'element',
              tagName: child.tagName === 'pre' ? 'div' : 'span',
              properties: { 'data-response-word': true },
              children: [child]
            };
            units.push(span);
            return [span];
          }
          visit(child);
        }
        return [child];
      });
    };
    visit(tree);
    const step = Math.min(24, 1200 / Math.max(1, units.length - 1));
    units.forEach((unit, index) => {
      unit.properties.style = `animation-delay:${Math.round(index * step)}ms`;
    });
  };
}
