import { nodeTypeByType, type NodeType } from '@/features/osint/node-registry';
import { IconGraph } from '@tabler/icons-react';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ type: string }> };
type IconElement = {
  type?: unknown;
  props?: Record<string, unknown>;
};

const GRAPH_ACCENT = '#6366f1';

const SVG_TAGS = new Set([
  'circle',
  'ellipse',
  'g',
  'line',
  'path',
  'polygon',
  'polyline',
  'rect'
]);
const SVG_ATTRIBUTES = new Set([
  'clipRule',
  'cx',
  'cy',
  'd',
  'fill',
  'fillRule',
  'height',
  'opacity',
  'points',
  'r',
  'rx',
  'ry',
  'stroke',
  'strokeDasharray',
  'strokeLinecap',
  'strokeLinejoin',
  'strokeWidth',
  'transform',
  'width',
  'x',
  'x1',
  'x2',
  'y',
  'y1',
  'y2'
]);

function escapeXml(value: unknown) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function toSvgAttribute(name: string) {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function renderIconChildren(value: unknown): string {
  if (Array.isArray(value)) return value.map(renderIconChildren).join('');
  if (!value || typeof value !== 'object') return '';

  const element = value as IconElement;
  if (typeof element.type !== 'string' || !SVG_TAGS.has(element.type)) {
    return '';
  }

  const props = element.props ?? {};
  const attributes = Object.entries(props)
    .filter(
      ([name, attribute]) =>
        SVG_ATTRIBUTES.has(name) &&
        (typeof attribute === 'string' || typeof attribute === 'number')
    )
    .map(
      ([name, attribute]) => `${toSvgAttribute(name)}="${escapeXml(attribute)}"`
    )
    .join(' ');
  const children = renderIconChildren(props.children);
  return `<${element.type}${attributes ? ` ${attributes}` : ''}>${children}</${element.type}>`;
}

export async function GET(_request: Request, context: RouteContext) {
  const { type } = await context.params;
  const definition =
    type === 'graph'
      ? { icon: IconGraph, colorHex: GRAPH_ACCENT }
      : nodeTypeByType[type as NodeType];
  if (!definition) return new Response(null, { status: 404 });

  const render = (
    definition.icon as unknown as {
      render?: (props: Record<string, unknown>, ref: null) => IconElement;
    }
  ).render;
  if (!render) return new Response(null, { status: 404 });

  const icon = render(
    { size: 32, color: definition.colorHex, stroke: 1.8 },
    null
  );
  const content = renderIconChildren(icon.props?.children);
  if (!content) return new Response(null, { status: 404 });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${escapeXml(definition.colorHex)}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
