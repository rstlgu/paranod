export type OfficeExcerpt = { text?: string; rows?: string[][]; label: string };

function xml(source: string | undefined) {
  if (!source || /<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error('Invalid document XML');
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror').length)
    throw new Error('Invalid document XML');
  return document;
}
function elements(parent: Document | Element, name: string) {
  return Array.from(parent.getElementsByTagNameNS('*', name));
}
function textRuns(parent: Element) {
  return elements(parent, 't')
    .map((el) => el.textContent || '')
    .join('');
}

export function parseOfficeExcerpt(
  files: Record<string, string>,
  kind: 'docx' | 'xlsx' | 'pptx'
): OfficeExcerpt {
  if (kind !== 'xlsx') {
    const document = xml(
      files[kind === 'docx' ? 'word/document.xml' : 'ppt/slides/slide1.xml']
    );
    return {
      text: elements(document, 'p')
        .slice(0, 150)
        .map(textRuns)
        .join('\n')
        .slice(0, 12000),
      label: kind === 'docx' ? 'DOCX · Text excerpt' : 'PPTX · First slide text'
    };
  }
  const workbook = xml(files['xl/workbook.xml']);
  const sheet = elements(workbook, 'sheet')[0];
  const relationId = sheet?.getAttribute('r:id');
  const relationships = xml(files['xl/_rels/workbook.xml.rels']);
  const relationship = elements(relationships, 'Relationship').find(
    (el) => el.getAttribute('Id') === relationId
  );
  if (!relationship || relationship.getAttribute('TargetMode') === 'External')
    throw new Error('Worksheet unavailable');
  const target = relationship.getAttribute('Target') || '';
  // Resolve archive-relative parts without ever fetching a relationship URL.
  const path = new URL(target, 'https://archive.invalid/xl/workbook.xml');
  if (path.origin !== 'https://archive.invalid')
    throw new Error('Invalid worksheet path');
  const document = xml(files[path.pathname.slice(1)]);
  const strings = files['xl/sharedStrings.xml']
    ? elements(xml(files['xl/sharedStrings.xml']), 'si').map(textRuns)
    : [];
  const rows = elements(document, 'row')
    .slice(0, 30)
    .map((row) => {
      const values: string[] = [];
      for (const cell of elements(row, 'c')) {
        const column = /^[A-Z]+/.exec(cell.getAttribute('r') || '')?.[0];
        if (!column) continue;
        let index = 0;
        for (const char of column) index = index * 26 + char.charCodeAt(0) - 64;
        if (index > 8) continue;
        const raw = elements(cell, 'v')[0]?.textContent || '';
        const type = cell.getAttribute('t');
        // Cached formula values only; no formula evaluation or external lookups.
        const value =
          type === 's'
            ? strings[Number(raw)] || ''
            : type === 'inlineStr'
              ? textRuns(cell)
              : type === 'b'
                ? raw === '1'
                  ? 'TRUE'
                  : 'FALSE'
                : raw;
        while (values.length < index) values.push('');
        values[index - 1] = value.slice(0, 300);
      }
      return values;
    });
  return {
    rows,
    label: `XLSX · ${sheet?.getAttribute('name') || 'First sheet'} · up to 30 rows × 8 columns`
  };
}
