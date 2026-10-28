const test = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('../scripts/test-support/load-typescript.cjs');
const utils = createLoader()(
  'src/features/graph/components/graph-editor/utils/image-node.ts'
);
const png = new File(['image'], 'sample.png', { type: 'image/png' });

test('header visibility changes trigger autosave and survive graph serialization', () => {
  const { createGraphStateHash } = createLoader()('src/features/graph/components/graph-editor/utils/graph-hash.ts');
  const node = { id: 'image', type: 'osint', position: { x: 0, y: 0 }, data: utils.uploadedImageData({ type: 'media_url', label: '' }, png, '/api/upload/temp/id') };
  const before = createGraphStateHash([node], []);
  node.data.metadata.hideImageHeader = true;
  assert.notEqual(createGraphStateHash([node], []), before);
  const restored = JSON.parse(JSON.stringify(node));
  assert.equal(restored.data.metadata.hideImageHeader, true);
  assert.equal(utils.getMediaSource(restored.data), '/api/upload/temp/id');
});

test('image files validate type, size and empty content', () => {
  assert.equal(utils.isImageFile(png), true);
  assert.equal(utils.isImageFile({ name: 'photo.PNG', type: '' }), true);
  assert.doesNotThrow(() => utils.validateImageFile(png));
  assert.throws(() =>
    utils.validateImageFile(
      new File(['svg'], 'a.svg', { type: 'image/svg+xml' })
    )
  );
  assert.throws(() =>
    utils.validateImageFile({
      name: 'a.png',
      type: 'image/png',
      size: 51 * 1024 * 1024
    })
  );
  assert.throws(() =>
    utils.validateImageFile(new File([], 'a.png', { type: 'image/png' }))
  );
});

test('image URLs allow HTTP(S), including extensionless endpoints, but not executable or credential URLs', () => {
  assert.equal(
    utils.normalizeMediaUrl(' https://example.com/photo?id=1 '),
    'https://example.com/photo?id=1'
  );
  for (const url of [
    'javascript:alert(1)',
    'data:image/svg+xml,test',
    'file:///tmp/a.png',
    'https://user:secret@example.com/a.png',
    'not a URL'
  ]) {
    assert.throws(() => utils.normalizeMediaUrl(url));
  }
});

test('files without browser MIME metadata receive a previewable upload content type', () => {
  const file = utils.prepareImageFile(new File(['image'], 'photo.JPG'));
  assert.equal(file.type, 'image/jpeg');
  assert.equal(file.name, 'photo.JPG');
  assert.equal(file.size, 5);
});

test('uploads persist the server URL, retain header preference, and recognize extensionless images', () => {
  const data = utils.uploadedImageData(
    { type: 'media_url', label: 'old', metadata: { hideImageHeader: true } },
    png,
    '/api/upload/temp/id'
  );
  assert.equal(data.label, '/api/upload/temp/id');
  assert.equal(utils.getMediaSource(data), '/api/upload/temp/id');
  assert.equal(utils.isImageNode(data), true);
  assert.equal(data.metadata.hideImageHeader, true);
  assert.equal(data.metadata._uploading, false);
  assert.equal(data.metadata.filename, 'sample.png');
  assert.equal(JSON.stringify(data).includes('base64'), false);
});

test('legacy base64 drops prefer their uploaded file and image URL fragments work', () => {
  assert.equal(
    utils.getMediaSource({
      type: 'media_url',
      label: 'data:image/png;base64,old',
      metadata: { fileUrl: '/api/upload/temp/legacy' }
    }),
    '/api/upload/temp/legacy'
  );
  assert.equal(
    utils.isImageNode({
      type: 'media_url',
      label: 'https://example.com/a.png#image'
    }),
    true
  );
  assert.equal(
    utils.isImageNode({ type: 'url', label: 'https://example.com/a.png' }),
    false
  );
});

function dropHarness({ active = true, fail = false } = {}) {
  let nodes = [];
  const uploads = [];
  const errors = [];
  const useGraphFileDrop = createLoader({
    react: {
      useCallback: (fn) => fn,
      useRef: (value) => ({ current: value }),
      useState: (value) => [value, () => {}]
    },
    sonner: {
      toast: {
        loading() {},
        success() {},
        info() {},
        error(message) {
          errors.push(message);
        }
      }
    },
    '../utils/graph-import': { readGraphJsonFile: async () => null },
    '../utils/upload-file': {
      uploadTempFileWithProgress: async ({ file }) => {
        uploads.push(file);
        if (fail) throw new Error('Upload unavailable');
        return { url: `/api/upload/temp/${uploads.length}` };
      }
    }
  })(
    'src/features/graph/components/graph-editor/hooks/use-graph-file-drop.ts'
  ).useGraphFileDrop;
  const handlers = useGraphFileDrop({
    isActive: active,
    dndNodeTypeMime: 'application/node',
    reactFlowInstance: {
      screenToFlowPosition: ({ x, y }) => ({ x: x / 2, y: y / 2 })
    },
    addNode() {},
    setNodes: (updater) => {
      nodes = updater(nodes);
    },
    setEdges() {}
  });
  return {
    get nodes() {
      return nodes;
    },
    uploads,
    errors,
    async drop(files) {
      handlers.handleDrop({
        preventDefault() {},
        stopPropagation() {},
        clientX: 400,
        clientY: 200,
        dataTransfer: { files, types: ['Files'], getData: () => '' }
      });
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
}

test('multiple image drops create distinct uploaded nodes at viewport-correct positions', async () => {
  const h = dropHarness();
  await h.drop([png, png]);
  assert.equal(h.nodes.length, 2);
  assert.notEqual(h.nodes[0].id, h.nodes[1].id);
  assert.deepEqual(h.nodes[0].position, { x: 100, y: 50 });
  assert.deepEqual(h.nodes[1].position, { x: 120, y: 70 });
  assert.ok(
    h.nodes.every(
      (node) =>
        node.data.type === 'media_url' &&
        node.data.metadata.mediaType === 'image'
    )
  );
  assert.equal(h.nodes[1].data.label, '/api/upload/temp/2');
});

test('inactive/Analysis file drop does not create nodes or upload files', async () => {
  const h = dropHarness({ active: false });
  await h.drop([png]);
  assert.equal(h.nodes.length, 0);
  assert.equal(h.uploads.length, 0);
});

test('a PDF drop creates a preview-sized PDF node with its uploaded source', async () => {
  const h = dropHarness();
  await h.drop([new File(['pdf'], 'report.pdf', { type: 'application/pdf' })]);
  assert.equal(h.nodes[0].data.type, 'pdf');
  assert.equal(h.nodes[0].data.metadata.fileUrl, '/api/upload/temp/1');
  assert.equal(h.nodes[0].data.metadata.mimeType, 'application/pdf');
  assert.deepEqual(h.nodes[0].style, { width: 280, height: 360 });
});

test('PDF MIME identifies files without a filename extension', async () => {
  const h = dropHarness();
  await h.drop([new File(['pdf'], 'report', { type: 'application/pdf' })]);
  assert.equal(h.nodes[0].data.type, 'pdf');
  assert.equal(h.nodes[0].data.metadata.extension, 'PDF');
  assert.equal(h.nodes[0].data.metadata._uploading, false);
});

test('text, tables and Office drops create resizable preview nodes with uploaded metadata', async () => {
  for (const filename of ['notes.md', 'data.csv', 'report.docx', 'book.xlsx', 'slides.pptx', 'source.py']) {
    const harness = dropHarness();
    await harness.drop([new File(['test'], filename)]);
    assert.equal(harness.nodes.length, 1);
    assert.deepEqual(harness.nodes[0].style, { width: 360, height: 260 });
    assert.equal(harness.nodes[0].data.metadata.fileUrl, '/api/upload/temp/1');
    assert.equal(harness.nodes[0].data.metadata.filename, filename);
  }
});

test('failed upload removes the placeholder and reports the failure', async () => {
  const h = dropHarness({ fail: true });
  await h.drop([png]);
  assert.equal(h.nodes.length, 0);
  assert.match(h.errors[0], /Upload unavailable/);
});

test('unsupported image drops do not leave broken placeholders', async () => {
  const h = dropHarness();
  await h.drop([new File(['svg'], 'a.svg', { type: 'image/svg+xml' })]);
  assert.equal(h.nodes.length, 0);
  assert.equal(h.uploads.length, 0);
  assert.match(h.errors[0], /PNG/);
});
