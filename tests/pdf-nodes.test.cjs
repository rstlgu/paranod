const test = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('../scripts/test-support/load-typescript.cjs');
const { isPdfNode, pdfPreviewScale } = createLoader()('src/features/graph/components/graph-editor/utils/pdf-node.ts');

test('PDF nodes are recognized by type, MIME, extension or legacy filename', () => {
  assert.equal(isPdfNode({ type: 'pdf', label: 'Report' }), true);
  assert.equal(isPdfNode({ type: 'document', label: 'Report', metadata: { mimeType: 'application/pdf' } }), true);
  assert.equal(isPdfNode({ type: 'document', label: 'Report.PDF' }), true);
  assert.equal(isPdfNode({ type: 'document', label: 'Report', metadata: { extension: 'PDF' } }), true);
  assert.equal(isPdfNode({ type: 'url', label: 'https://example.com/report.pdf' }), false);
  assert.equal(isPdfNode({ type: 'docx', label: 'Report.docx' }), false);
});

test('thumbnail resolution is bounded for portrait, landscape and oversized pages', () => {
  for (const [width, height] of [[595, 842], [842, 595], [14400, 14400], [20, 30]]) {
    const scale = pdfPreviewScale(width, height);
    assert.ok(width * scale <= 720);
    assert.ok(height * scale <= 900);
    assert.ok(scale <= 2);
  }
  for (const width of [0, -1, Infinity, NaN]) assert.throws(() => pdfPreviewScale(width, 300));
});

function samplePdf() {
  const drawing = '0.9 0.1 0.1 rg 20 20 160 260 re f\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${drawing.length} >>\nstream\n${drawing}endstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf));
}

test('PDF renderer produces first-page pixels, not just a file icon', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: samplePdf() });
  try {
    const doc = await task.promise;
    assert.equal(doc.numPages, 1);
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: pdfPreviewScale(200, 300) });
    const { canvas, context } = doc.canvasFactory.create(viewport.width, viewport.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const pixel = context.getImageData(200, 300, 1, 1).data;
    assert.ok(pixel[0] > 200 && pixel[1] < 40 && pixel[2] < 40, 'The red document content is visible');
  } finally {
    await task.destroy();
  }
});

test('corrupt PDF data fails without silently displaying an empty preview', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(Buffer.from('not a PDF')) });
  try {
    await assert.rejects(task.promise);
  } finally {
    await task.destroy();
  }
});
