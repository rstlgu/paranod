import type { Node as FlowNode } from 'reactflow';
import { filePreviewDimensions } from './file-preview';
import { cardSize, isCardNode } from './card-node';

export const CLASSIC_NODE_WIDTH_PX = 200;
export const CLASSIC_NODE_HEIGHT_PX = 85;

const RESIZABLE_NODE_TYPES = new Set([
  'media_url',
  'ai_insight',
  'note',
  'maps',
  'group',
  'text'
]);

/**
 * The size each node is drawn at. Previews, cards and resizable types keep
 * their own size; every other entity node shares the classic size.
 */
export function projectNodeDimensionsForCanvas(node: FlowNode): FlowNode {
  const previewSize = filePreviewDimensions(node.data);
  if (previewSize) {
    const width = Number(node.style?.width ?? node.width ?? 0);
    const height = Number(node.style?.height ?? node.height ?? 0);
    return {
      ...node,
      style: { ...node.style,
        width: width >= 200 ? width : previewSize.width,
        height: height >= previewSize.minHeight ? height : previewSize.height
      }
    };
  }
  const data = (node.data ?? {}) as Record<string, any>;
  const nodeType = String(data.type ?? '');

  if (isCardNode({ type: nodeType, metadata: data.metadata })) {
    // A card is always taller than a classic node, so a classic or missing
    // size comes from a path that did not size it: start from its rows.
    const width = Number(node.style?.width);
    const height = Number(node.style?.height);
    if (width >= CLASSIC_NODE_WIDTH_PX && height > CLASSIC_NODE_HEIGHT_PX)
      return node;
    return {
      ...node,
      style: { ...(node.style ?? {}), ...cardSize(data.metadata) }
    };
  }

  const isResizable = RESIZABLE_NODE_TYPES.has(nodeType);
  const wasClassicFixed = Boolean(data._uiClassicFixed);

  if (isResizable) {
    if (!wasClassicFixed) return node;
    const nextData = { ...data };
    delete nextData._uiClassicFixed;
    const nextStyle = { ...(node.style ?? {}) };
    delete nextStyle.width;
    delete nextStyle.height;
    return { ...node, data: nextData, style: nextStyle };
  }

  if (
    node.style?.width === CLASSIC_NODE_WIDTH_PX &&
    node.style?.height === CLASSIC_NODE_HEIGHT_PX
  ) {
    return node;
  }

  return {
    ...node,
    style: {
      ...(node.style ?? {}),
      width: CLASSIC_NODE_WIDTH_PX,
      height: CLASSIC_NODE_HEIGHT_PX
    }
  };
}
