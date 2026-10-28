import type { OSINTNodeData } from '@/features/graph/types';

export const PDF_NODE_SIZE = { width: 280, height: 360 };

export function isPdfNode(data: OSINTNodeData) {
  return (
    data.type === 'pdf' ||
    (data.type === 'document' &&
      (data.metadata?.mimeType === 'application/pdf' ||
        String(data.metadata?.extension ?? '').toLowerCase() === 'pdf' ||
        /\.pdf$/i.test(String(data.metadata?.filename ?? data.label))))
  );
}

export function pdfPreviewScale(width: number, height: number) {
  if (
    !(
      width > 0 &&
      height > 0 &&
      Number.isFinite(width) &&
      Number.isFinite(height)
    )
  ) {
    throw new Error('Invalid PDF page dimensions');
  }
  return Math.min(720 / width, 900 / height, 2);
}
