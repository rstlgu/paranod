import { useRef, useState } from 'react';
import { useGuardedReactFlow as useReactFlow } from '../../contexts/graph-mutation-context';
import {
  TextBIcon,
  TextItalicIcon,
  TextHOneIcon,
  TextHTwoIcon,
  ListBulletsIcon
} from '@/components/icons';
import { Markdown } from '@/components/markdown/markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { OSINTNodeData } from '../../types';
import {
  formatNoteSelection,
  type NoteFormat
} from '../graph-editor/utils/note-formatting';

const formats = [
  { format: 'heading', label: 'Heading', Icon: TextHOneIcon },
  { format: 'subheading', label: 'Subheading', Icon: TextHTwoIcon },
  { format: 'bold', label: 'Bold', Icon: TextBIcon },
  { format: 'italic', label: 'Italic', Icon: TextItalicIcon },
  { format: 'list', label: 'Bullet list', Icon: ListBulletsIcon }
] as const;

function NoteEditor({
  id,
  data,
  onDone
}: {
  id: string;
  data: OSINTNodeData;
  onDone: () => void;
}) {
  const { setNodes, canEdit } = useReactFlow<OSINTNodeData>();
  const [title, setTitle] = useState(String(data.metadata?.noteTitle ?? ''));
  const [body, setBody] = useState(data.label);
  const textarea = useRef<HTMLTextAreaElement>(null);

  function save() {
    if (!canEdit()) return;
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                label: body,
                metadata: { ...node.data.metadata, noteTitle: title.trim() }
              }
            }
          : node
      )
    );
    onDone();
  }

  function formatSelection(format: NoteFormat) {
    if (!canEdit()) return;
    const field = textarea.current;
    if (!field) return;
    const next = formatNoteSelection(
      body,
      field.selectionStart,
      field.selectionEnd,
      format
    );
    setBody(next.text);
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(next.start, next.end);
    });
  }

  return (
    <div
      className='nodrag nopan nowheel flex h-full min-h-[220px] flex-col gap-2'
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onDone();
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          save();
        }
      }}
    >
      <Input
        aria-label='Note title'
        placeholder='Title (optional)'
        value={title}
        readOnly={!canEdit()}
        onChange={(event) => setTitle(event.target.value)}
        className='h-8 shrink-0 font-semibold'
      />
      <div
        role='toolbar'
        aria-label='Note formatting'
        className='flex shrink-0 gap-1'
      >
        {formats.map(({ format, label, Icon }) => (
          <button
            key={format}
            type='button'
            title={label}
            aria-label={label}
            disabled={!canEdit()}
            className='hover:bg-muted rounded p-1.5 focus-visible:outline focus-visible:outline-2'
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => formatSelection(format)}
          >
            <Icon className='h-4 w-4' />
          </button>
        ))}
      </div>
      <textarea
        ref={textarea}
        aria-label='Note text'
        autoFocus
        value={body}
        readOnly={!canEdit()}
        onChange={(event) => setBody(event.target.value)}
        className='focus-visible:ring-ring min-h-[80px] w-full flex-1 resize-none rounded border bg-transparent p-2 text-sm outline-none focus-visible:ring-1'
        placeholder='Write your note… Markdown formatting is supported.'
      />
      <div className='flex shrink-0 justify-end gap-2'>
        <Button type='button' size='sm' variant='ghost' onClick={onDone}>
          Cancel
        </Button>
        <Button type='button' size='sm' disabled={!canEdit()} onClick={save}>
          Save note
        </Button>
      </div>
    </div>
  );
}

export function NoteNodeContent({
  id,
  data,
  editing,
  onEdit,
  onDone
}: {
  id: string;
  data: OSINTNodeData;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  if (editing) return <NoteEditor id={id} data={data} onDone={onDone} />;
  const title = String(data.metadata?.noteTitle ?? '');
  return (
    <div
      className='nowheel min-h-full cursor-text break-words'
      onDoubleClick={(event) => {
        event.stopPropagation();
        onEdit();
      }}
    >
      {title && (
        <h2 className='text-foreground mb-1 text-[22px] leading-tight font-semibold tracking-tight whitespace-pre-wrap'>
          {title}
        </h2>
      )}
      <Markdown
        value={data.label}
        className='text-muted-foreground [&_h1]:text-foreground [&_h2]:text-foreground [&_h3]:text-foreground [&_strong]:text-foreground space-y-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h3]:text-lg [&_ol]:text-base [&_p]:text-base [&_p]:leading-relaxed [&_strong]:font-semibold [&_ul]:text-base'
      />
      {!title && !data.label && (
        <p className='text-muted-foreground text-sm'>
          Double-click to write a note
        </p>
      )}
    </div>
  );
}
