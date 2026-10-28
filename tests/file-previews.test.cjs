const test = require('node:test');
const assert = require('node:assert/strict');
const { zipSync, strToU8 } = require('fflate');
const { DOMParser } = require('@xmldom/xmldom');
const createLoader = require('../scripts/test-support/load-typescript.cjs');
const load = createLoader();
const base = 'src/features/graph/components/graph-editor/utils/';
const {
  getFilePreviewKind,
  filePreviewDimensions,
  csvPreview,
  readPreviewBytes,
  decodePreviewText,
  OFFICE_PREVIEW_BYTES
} = load(`${base}file-preview.ts`);
const { extractOfficeXml } = load(`${base}office-preview-archive.ts`);
const { parseOfficeExcerpt } = load(`${base}office-preview.ts`);
const { createGraphStateHash } = load(`${base}graph-hash.ts`);
global.DOMParser = DOMParser;

test('preview classification distinguishes OOXML from legacy binary Office and unrelated nodes', () => {
  for (const [extension, expected] of Object.entries({
    TXT: 'text',
    MD: 'markdown',
    JSON: 'json',
    CSV: 'csv',
    TSV: 'csv',
    JS: 'text',
    HTML: 'text',
    SVG: 'text',
    DOCX: 'docx',
    XLSX: 'xlsx',
    PPTX: 'pptx',
    PDF: 'pdf',
    DOC: null,
    XLS: null,
    PPT: null,
    ZIP: null
  })) {
    assert.equal(
      getFilePreviewKind({ type: 'document', label: `file.${extension}` }),
      expected
    );
  }
  assert.equal(getFilePreviewKind({ type: 'docx', label: 'legacy.doc' }), null);
  assert.equal(getFilePreviewKind({ type: 'xlsx', label: 'legacy.xls' }), null);
  assert.equal(
    getFilePreviewKind({ type: 'url', label: 'https://example.com/a.txt' }),
    null
  );
  assert.equal(
    getFilePreviewKind({
      type: 'document',
      metadata: { mimeType: 'text/plain' }
    }),
    'text'
  );
  assert.equal(
    getFilePreviewKind({
      type: 'document',
      metadata: { filename: 'slides.pptx' }
    }),
    'pptx'
  );
});

test('previewable file nodes resize compactly and metadata/source changes trigger autosave', () => {
  const node = {
    id: 'file',
    type: 'osint',
    position: { x: 0, y: 0 },
    data: { type: 'document', label: 'notes.md', metadata: {} }
  };
  assert.deepEqual(filePreviewDimensions(node.data), {
    width: 360,
    height: 260,
    minHeight: 120
  });
  const before = createGraphStateHash([node], []);
  node.data.metadata.fileUrl = '/api/upload/temp/new';
  const after = createGraphStateHash([node], []);
  assert.notEqual(after, before);
  node.style = { width: 400, height: 120 };
  assert.notEqual(createGraphStateHash([node], []), after);
});

test('CSV supports quotes, escaped quotes, multiline cells, semicolons and tabs', () => {
  assert.deepEqual(
    csvPreview(
      'name,description\r\nAlice,"line 1\nline 2, with ""quotes"""\r\nBob,ok'
    ),
    [
      ['name', 'description'],
      ['Alice', 'line 1\nline 2, with "quotes"'],
      ['Bob', 'ok']
    ]
  );
  assert.deepEqual(csvPreview('one;two\n"a,b";c'), [
    ['one', 'two'],
    ['a,b', 'c']
  ]);
  assert.deepEqual(csvPreview('one\ttwo\n1\t2'), [
    ['one', 'two'],
    ['1', '2']
  ]);
  const huge = Array.from({ length: 50 }, () =>
    Array(20).fill('x'.repeat(500)).join(',')
  ).join('\n');
  const rows = csvPreview(huge);
  assert.equal(rows.length, 30);
  assert.equal(rows[0].length, 8);
  assert.equal(rows[0][0].length, 300);
});

test('text reads stop at the byte limit and cancel the remaining stream', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(100).fill(65));
    },
    cancel() {
      cancelled = true;
    }
  });
  const result = await readPreviewBytes(new Response(stream), 150, true);
  assert.equal(result.bytes.length, 150);
  assert.equal(result.truncated, true);
  assert.equal(cancelled, true);
  const complete = await readPreviewBytes(new Response('abc'), 10, true);
  assert.equal(decodePreviewText(complete.bytes), 'abc');
  assert.equal(complete.truncated, false);
  const empty = await readPreviewBytes(new Response(''), 10, true);
  assert.equal(empty.bytes.length, 0);
  assert.equal(decodePreviewText(new Uint8Array([255, 254, 65, 0])), 'A');
  assert.throws(() => decodePreviewText(new Uint8Array([0, 65])), /Binary/);
});

test('Office downloads are bounded even when content-length is absent or false', async () => {
  await assert.rejects(
    readPreviewBytes(new Response('too much'), 3, false),
    /too large/
  );
  await assert.rejects(
    readPreviewBytes(
      new Response('a', { headers: { 'content-length': '999' } }),
      3,
      false
    ),
    /too large/
  );
  await assert.rejects(
    readPreviewBytes(
      new Response('too much', { headers: { 'content-length': '1' } }),
      3,
      false
    ),
    /too large/
  );
  await assert.rejects(
    readPreviewBytes(new Response('', { status: 403 }), 10, true),
    /unavailable/
  );
});

const wordXml =
  '<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Azat Nasirov</w:t></w:r></w:p><w:p><w:r><w:t>Socio &amp; amministratore</w:t></w:r></w:p></w:body></w:document>';
const slideXml =
  '<p:sld xmlns:p="urn:presentation" xmlns:a="urn:drawing"><p:cSld><a:p><a:r><a:t>OSINT project</a:t></a:r></a:p></p:cSld></p:sld>';
function archive(files) {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, value]) => [name, strToU8(value)])
    )
  );
}

test('DOCX and PPTX previews extract real document text without images, macros or external relationships', () => {
  const files = extractOfficeXml(
    archive({
      'word/document.xml': wordXml,
      'word/vbaProject.bin': 'macro',
      'word/_rels/document.xml.rels': '<external />',
      'word/media/picture.png': 'not an image'
    }),
    'docx'
  );
  assert.deepEqual(Object.keys(files), ['word/document.xml']);
  assert.equal(
    parseOfficeExcerpt(files, 'docx').text,
    'Azat Nasirov\nSocio & amministratore'
  );
  const slides = extractOfficeXml(
    archive({
      'ppt/slides/slide1.xml': slideXml,
      'ppt/slides/slide2.xml': '<ignore />'
    }),
    'pptx'
  );
  assert.equal(parseOfficeExcerpt(slides, 'pptx').text, 'OSINT project');
});

test('XLSX previews resolve the first sheet, shared strings, inline strings and cached formula values', () => {
  const input = {
    'xl/workbook.xml':
      '<workbook xmlns:r="urn:rels"><sheets><sheet name="Evidence" r:id="rId2" /></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId2" Target="worksheets/sheet2.xml" /></Relationships>',
    'xl/sharedStrings.xml':
      '<sst><si><t>Entity</t></si><si><r><t>Azat </t></r><r><t>Nasirov</t></r></si></sst>',
    'xl/worksheets/sheet2.xml':
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Value</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2"><f>1+1</f><v>2</v></c><c r="D2" t="b"><v>1</v></c><c r="ZZ2"><v>ignored</v></c></row></sheetData></worksheet>'
  };
  const files = extractOfficeXml(archive(input), 'xlsx');
  const preview = parseOfficeExcerpt(files, 'xlsx');
  assert.deepEqual(preview.rows, [
    ['Entity', 'Value'],
    ['Azat Nasirov', '', '2', 'TRUE']
  ]);
  assert.match(preview.label, /Evidence/);
  files['xl/_rels/workbook.xml.rels'] =
    '<Relationships><Relationship Id="rId2" TargetMode="External" Target="https://example.com/track" /></Relationships>';
  assert.throws(() => parseOfficeExcerpt(files, 'xlsx'), /unavailable/);
});

test('unsafe XML, invalid files and oversized compressed parts fail safely', () => {
  assert.throws(
    () =>
      parseOfficeExcerpt(
        {
          'word/document.xml':
            '<!DOCTYPE doc [<!ENTITY x SYSTEM "file:///etc/passwd">]><doc>&x;</doc>'
        },
        'docx'
      ),
    /Invalid/
  );
  assert.throws(() => parseOfficeExcerpt({}, 'pptx'), /Invalid/);
  assert.throws(
    () => extractOfficeXml(new Uint8Array(OFFICE_PREVIEW_BYTES + 1), 'docx'),
    /size/
  );
  assert.throws(() =>
    extractOfficeXml(strToU8('not an Office document at all'), 'docx')
  );
  const bomb = archive({
    'word/document.xml': 'x'.repeat(2 * 1024 * 1024 + 1)
  });
  assert.throws(() => extractOfficeXml(bomb, 'docx'), /complex/);
});
