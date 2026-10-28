const test = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('../scripts/test-support/load-typescript.cjs');
const load = createLoader();
const { nodeHeaderKey, isNodeHeaderHidden, NOTE_MIN_HEIGHT } = load('src/features/graph/components/graph-editor/utils/node-header.ts');
const { formatNoteSelection } = load('src/features/graph/components/graph-editor/utils/note-formatting.ts');
const { createGraphStateHash } = load('src/features/graph/components/graph-editor/utils/graph-hash.ts');

test('notes support compact heights and retain their size after serialization', () => {
  assert.equal(NOTE_MIN_HEIGHT.plain, 40);
  assert.equal(NOTE_MIN_HEIGHT.withHeader, 80);
  const node = { id: 'compact', type: 'osint', position: { x: 0, y: 0 }, style: { width: 350, height: 140 }, data: { type: 'note', label: 'One line', metadata: { hideNoteHeader: true } } };
  const before = createGraphStateHash([node], []);
  node.style.height = NOTE_MIN_HEIGHT.plain;
  assert.notEqual(createGraphStateHash([node], []), before);
  assert.equal(JSON.parse(JSON.stringify(node)).style.height, 40);
});

test('notes can hide their header in Manual/Auto but not Analysis', () => {
  const note = { type: 'note', label: 'Description', metadata: { hideNoteHeader: true } };
  assert.equal(nodeHeaderKey(note), 'hideNoteHeader');
  assert.equal(isNodeHeaderHidden(note, 'free'), true);
  assert.equal(isNodeHeaderHidden(note, 'locked'), true);
  assert.equal(isNodeHeaderHidden(note, 'analysis'), false);
  assert.equal(isNodeHeaderHidden({ ...note, metadata: {} }, 'free'), false);
  assert.equal(isNodeHeaderHidden({ type: 'email', label: 'a@example.com', metadata: note.metadata }, 'free'), false);
});

test('existing image header preferences still work independently of notes', () => {
  const image = { type: 'media_url', label: 'https://example.com/a.png', metadata: { hideImageHeader: true } };
  assert.equal(nodeHeaderKey(image), 'hideImageHeader');
  assert.equal(isNodeHeaderHidden(image, 'free'), true);
  assert.equal(isNodeHeaderHidden({ type: 'note', label: '', metadata: image.metadata }, 'free'), false);
});

test('note titles, visibility and resizing all trigger autosave and persist', () => {
  const node = { id: 'note', type: 'osint', position: { x: 0, y: 0 }, data: { type: 'note', label: '**Text**', metadata: {} } };
  let hash = createGraphStateHash([node], []);
  for (const update of [() => { node.data.metadata.noteTitle = 'Title'; }, () => { node.data.metadata.hideNoteHeader = true; }, () => { node.style = { width: 650, height: 180 }; }]) {
    update();
    const next = createGraphStateHash([node], []);
    assert.notEqual(next, hash);
    hash = next;
  }
  const restored = JSON.parse(JSON.stringify(node));
  assert.equal(restored.data.metadata.noteTitle, 'Title');
  assert.equal(restored.data.label, '**Text**');
  assert.equal(isNodeHeaderHidden(restored.data, 'free'), true);
});

test('toolbar formats selected text without changing surrounding content', () => {
  assert.equal(formatNoteSelection('one two three', 4, 7, 'bold').text, 'one **two** three');
  assert.equal(formatNoteSelection('one two', 4, 7, 'italic').text, 'one *two*');
  const empty = formatNoteSelection('', 0, 0, 'bold');
  assert.deepEqual(empty, { text: '**text**', start: 2, end: 6 });
});

test('toolbar adds headings and lists while preserving legacy Markdown', () => {
  assert.equal(formatNoteSelection('Title\nBody', 2, 2, 'heading').text, '# Title\nBody');
  assert.equal(formatNoteSelection('# Title', 2, 7, 'subheading').text, '## Title');
  assert.equal(formatNoteSelection('One\nTwo', 0, 7, 'list').text, '- One\n- Two');
  assert.equal(formatNoteSelection('\nBody', 0, 0, 'heading').text, '# \nBody');
});
