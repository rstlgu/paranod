export type NoteFormat = 'heading' | 'subheading' | 'bold' | 'italic' | 'list';

export function formatNoteSelection(
  text: string,
  start: number,
  end: number,
  format: NoteFormat
) {
  if (format === 'bold' || format === 'italic') {
    const marker = format === 'bold' ? '**' : '*';
    const selected = text.slice(start, end) || 'text';
    return {
      text: text.slice(0, start) + marker + selected + marker + text.slice(end),
      start: start + marker.length,
      end: start + marker.length + selected.length
    };
  }
  const lineStart = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  const lastNewline = text.indexOf('\n', end);
  const lineEnd = lastNewline < 0 ? text.length : lastNewline;
  const prefix =
    format === 'heading' ? '# ' : format === 'subheading' ? '## ' : '- ';
  const replacement = text
    .slice(lineStart, lineEnd)
    .split('\n')
    .map((line) => prefix + line.replace(/^(?:#{1,6}\s+|[-*+]\s+)/, ''))
    .join('\n');
  return {
    text: text.slice(0, lineStart) + replacement + text.slice(lineEnd),
    start: lineStart,
    end: lineStart + replacement.length
  };
}
