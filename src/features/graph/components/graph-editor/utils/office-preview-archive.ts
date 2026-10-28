import { unzipSync, strFromU8 } from 'fflate';
import { OFFICE_PREVIEW_BYTES } from './file-preview';

// Only bounded XML parts are extracted, never relationships to external URLs,
// embedded files, macros or media. Decompression runs in a disposable worker.
export function extractOfficeXml(
  bytes: Uint8Array,
  kind: 'docx' | 'xlsx' | 'pptx'
) {
  if (bytes.length < 22 || bytes.length > OFFICE_PREVIEW_BYTES)
    throw new Error('Invalid archive size');
  let total = 0,
    count = 0;
  const selected = new Set<string>();
  const files = unzipSync(bytes, {
    filter(entry) {
      if (++count > 4096) throw new Error('Too many archive entries');
      const wanted =
        kind === 'docx'
          ? entry.name === 'word/document.xml'
          : kind === 'pptx'
            ? entry.name === 'ppt/slides/slide1.xml'
            : [
                'xl/workbook.xml',
                'xl/_rels/workbook.xml.rels',
                'xl/sharedStrings.xml'
              ].includes(entry.name) ||
              /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name);
      if (!wanted) return false;
      if (selected.has(entry.name)) throw new Error('Duplicate archive entry');
      selected.add(entry.name);
      total += entry.originalSize;
      if (
        selected.size > 64 ||
        entry.originalSize > 2 * 1024 * 1024 ||
        entry.size > 2 * 1024 * 1024 ||
        total > 8 * 1024 * 1024
      ) {
        throw new Error('Document too complex for a lightweight preview');
      }
      return true;
    }
  });
  const result: Record<string, string> = Object.create(null);
  for (const [name, content] of Object.entries(files)) {
    if (content.length > 2 * 1024 * 1024) throw new Error('XML part too large');
    result[name] = strFromU8(content);
  }
  return result;
}
