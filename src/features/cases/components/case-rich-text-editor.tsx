'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  Extension,
  mergeAttributes,
  Node as TiptapNode,
  type Editor
} from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import Mention from '@tiptap/extension-mention';
import Placeholder from '@tiptap/extension-placeholder';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Fragment as ProseMirrorFragment, Slice } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  ClipboardPaste,
  Code,
  CodeXml,
  Copy,
  Delete,
  Download,
  ExternalLink,
  Heading1,
  Heading2,
  Hash,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Minus,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Pilcrow,
  Plus,
  Quote,
  Redo2,
  RemoveFormatting,
  Save,
  Scissors,
  Strikethrough,
  Subscript as SubscriptIcon,
  Sun,
  Superscript as SuperscriptIcon,
  Trash2,
  Underline,
  Unlink,
  Undo2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import {
  getGraphNodeClipboardCopyId,
  readGraphNodeClipboard
} from '@/features/graph/utils/node-clipboard';
import type { CaseReference } from './case-note-types';
import {
  createSuggestion,
  getReferenceVisualUrls,
  renderReferenceMention
} from './reference-mention';

interface CaseRichTextEditorProps {
  readOnly?: boolean;
  content: string;
  references: CaseReference[];
  onChange: (html: string) => void;
  onOpenReference?: (reference: CaseReference) => void;
  minHeight?: number;
  placeholder?: string;
  className?: string;
  documentMode?: boolean;
  documentTitle?: string;
  isDirty?: boolean;
  isSaving?: boolean;
  onSave?: () => void;
  compactMode?: boolean;
  compactHeaderEnd?: React.ReactNode;
  compactHeaderClassName?: string;
  onCompactHeaderPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  onStatsChange?: (stats: { words: number; characters: number }) => void;
}

type DocumentExportFormat = 'pdf' | 'word' | 'markdown' | 'text';
type PaperTheme = 'dark' | 'light';
type EditorContextTarget =
  | { kind: 'general'; position: number }
  | { kind: 'selection'; from: number; to: number }
  | { kind: 'reference'; position: number; referenceId: string };

const REFERENCE_RENDER_LIMIT = 280;
const DEFAULT_PARAGRAPH_FONT_SIZE = '16px';
const PARAGRAPH_FONT_SIZES = ['14px', '16px', '18px', '20px', '24px'] as const;
const PARAGRAPH_FONT_SIZE_VALUES = new Set<string>(PARAGRAPH_FONT_SIZES);
const EDITOR_DROPZONE_ID = 'case-note-editor-dropzone';
const DOCUMENT_ZOOM_MIN = 50;
const DOCUMENT_ZOOM_MAX = 150;
const DOCUMENT_ZOOM_STEP = 10;
const dropCaretPluginKey = new PluginKey<DecorationSet>(
  'case-note-entity-drop-caret'
);

function clampDocumentZoom(value: number) {
  return Math.min(DOCUMENT_ZOOM_MAX, Math.max(DOCUMENT_ZOOM_MIN, value));
}

const DraggableMention = Mention.extend({
  draggable: true
});

const SizedParagraph = TiptapNode.create({
  name: 'paragraph',
  priority: 1000,
  group: 'block',
  content: 'inline*',
  addAttributes() {
    return {
      fontSize: {
        default: null,
        parseHTML: (element) => {
          const fontSize = element.style.fontSize;
          return PARAGRAPH_FONT_SIZE_VALUES.has(fontSize) ? fontSize : null;
        },
        renderHTML: ({ fontSize }) =>
          typeof fontSize === 'string' &&
          PARAGRAPH_FONT_SIZE_VALUES.has(fontSize)
            ? { style: `font-size: ${fontSize}` }
            : {}
      }
    };
  },
  parseHTML() {
    return [{ tag: 'p' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes), 0];
  }
});

const CaseNoteDropCaret = Extension.create({
  name: 'caseNoteEntityDropCaret',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: dropCaretPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, decorations) {
            const position = transaction.getMeta(dropCaretPluginKey) as
              | number
              | null
              | undefined;
            if (position === undefined) {
              return decorations.map(transaction.mapping, transaction.doc);
            }
            if (position === null) return DecorationSet.empty;

            const safePosition = Math.max(
              0,
              Math.min(position, transaction.doc.content.size)
            );
            return DecorationSet.create(transaction.doc, [
              Decoration.widget(
                safePosition,
                () => {
                  const caret = document.createElement('span');
                  caret.className = 'case-note-drop-caret';
                  caret.setAttribute('aria-hidden', 'true');
                  return caret;
                },
                { side: -1 }
              )
            ]);
          }
        },
        props: {
          decorations: (state) => dropCaretPluginKey.getState(state)
        }
      })
    ];
  }
});

function ReferenceVisual({ reference }: { reference: CaseReference }) {
  const urls = getReferenceVisualUrls(reference);
  if (urls.length === 0) return null;

  return (
    <span
      aria-hidden='true'
      className='case-reference-mention-favicon'
      style={
        {
          '--reference-accent': reference.accentColor,
          backgroundImage: urls
            .map((url) => `url(${JSON.stringify(url)})`)
            .join(', ')
        } as CSSProperties
      }
    />
  );
}

function ReferenceGroupHeader({ label }: { label: string }) {
  return (
    <div className='mb-2 min-w-0 px-0.5'>
      <span className='text-muted-foreground block truncate text-[11px] font-semibold tracking-wide uppercase'>
        {label}
      </span>
    </div>
  );
}

function EntityPillContent({ reference }: { reference: CaseReference }) {
  return (
    <>
      <ReferenceVisual reference={reference} />
      <span className='max-w-48 truncate text-left'>{reference.label}</span>
    </>
  );
}

function DraggableEntityPill({
  reference,
  onInsert
}: {
  reference: CaseReference;
  onInsert: (reference: CaseReference) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `case-reference-drag:${reference.id}`,
      data: { reference }
    });
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (isDragging) {
      suppressClickRef.current = true;
      return;
    }

    const timeout = window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [isDragging]);

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onInsert(reference);
  };

  return (
    <button
      ref={setNodeRef}
      type='button'
      className={cn(
        'case-entity-drag-pill',
        isDragging && 'pointer-events-none opacity-30'
      )}
      style={
        {
          '--reference-accent': reference.accentColor,
          transform: CSS.Translate.toString(transform)
        } as CSSProperties
      }
      title={`${reference.label} · ${reference.category}`}
      aria-label={`Insert or drag ${reference.label} into the note`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={handleClick}
      {...listeners}
      {...attributes}
    >
      <EntityPillContent reference={reference} />
    </button>
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeContent(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return '<p></p>';
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return content;
  return trimmed
    .split(/\n{2,}/)
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`
    )
    .join('');
}

function sanitizeFileName(value: string) {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 120) || 'note'
  );
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function openPdfPrintDialog(args: {
  title: string;
  fileName: string;
  editorHtml: string;
}) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.border = '0';
  frame.style.opacity = '0';
  frame.style.pointerEvents = 'none';
  document.body.appendChild(frame);

  const printableHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<base href="${escapeHtml(window.location.origin)}/">
<title>${escapeHtml(args.title)}</title>
<style>
@page { size: A4; margin: 25.4mm 22mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; }
body { color: #18181b; background: #fff; font-family: Aptos, Calibri, "Segoe UI", sans-serif; font-size: 12pt; line-height: 1.55; }
p { margin: 0; }
p + p, p + ul, p + ol { margin-top: 0.65em; }
h1 { margin: 1.25em 0 0.5em; font-size: 24pt; line-height: 1.2; }
h2 { margin: 1em 0 0.4em; font-size: 18pt; line-height: 1.3; }
ul, ol { margin: 0.7em 0; padding-left: 1.5em; }
blockquote { margin: 1em 0; border-left: 3px solid #a1a1aa; padding-left: 1em; color: #52525b; }
pre { margin: 1em 0; border-radius: 8px; background: #f4f4f5; padding: 1em; white-space: pre-wrap; }
code { border-radius: 4px; background: #f4f4f5; padding: 0.1em 0.25em; }
pre code { background: transparent; padding: 0; }
a { color: #2563eb; text-decoration: underline; text-underline-offset: 2px; }
hr { margin: 1.25em 0; border: 0; border-top: 1px solid #d4d4d8; }
mark { border-radius: 3px; background: #fde68a; color: inherit; }
.case-reference-mention { --reference-accent: #6366f1; display: inline-flex; align-items: center; gap: 0.25em; border: 1px solid var(--reference-accent); border-radius: 0.4em; background: color-mix(in srgb, var(--reference-accent) 10%, transparent); padding: 0.08em 0.38em; color: #18181b; font-weight: 600; line-height: 1.45; vertical-align: -0.14em; break-inside: avoid; }
.case-reference-mention[data-reference-kind="entity"] { border: 0; border-radius: 0; background: transparent; padding: 0 0.08em; color: var(--reference-accent); }
.case-reference-mention-favicon { display: block; width: 0.9em; height: 0.9em; flex: none; object-fit: contain; color: var(--reference-accent); }
.case-reference-mention-label { color: inherit; }
</style>
</head>
<body>${args.editorHtml}</body>
</html>`;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('PDF document timed out')),
        5000
      );
      frame.addEventListener(
        'load',
        () => {
          window.clearTimeout(timeout);
          resolve();
        },
        { once: true }
      );
      frame.srcdoc = printableHtml;
    });

    const printWindow = frame.contentWindow;
    const printDocument = frame.contentDocument;
    if (!printWindow || !printDocument) throw new Error('PDF unavailable');

    await printDocument.fonts?.ready;
    const pendingImages = Array.from(printDocument.images)
      .filter((image) => !image.complete)
      .map(
        (image) =>
          new Promise<void>((resolve) => {
            image.addEventListener('load', () => resolve(), { once: true });
            image.addEventListener('error', () => resolve(), { once: true });
          })
      );
    await Promise.race([
      Promise.all(pendingImages),
      new Promise<void>((resolve) => window.setTimeout(resolve, 2500))
    ]);

    const cleanup = () => frame.remove();
    printWindow.addEventListener('afterprint', cleanup, { once: true });
    window.setTimeout(cleanup, 120000);
    printWindow.document.title = args.fileName;
    printWindow.focus();
    printWindow.print();
  } catch (error) {
    frame.remove();
    throw error;
  }
}

function htmlToMarkdown(html: string) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  const renderChildren = (element: Element) =>
    Array.from(element.childNodes).map(renderNode).join('');

  const renderList = (element: Element, ordered: boolean) => {
    const items = Array.from(element.children).filter(
      (child) => child.tagName.toLowerCase() === 'li'
    );
    return `${items
      .map((item, index) => {
        const marker = ordered ? `${index + 1}.` : '-';
        return `${marker} ${renderChildren(item).trim()}`;
      })
      .join('\n')}\n\n`;
  };

  function renderNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? '';
    }
    if (!(node instanceof Element)) return '';

    const tag = node.tagName.toLowerCase();
    const children = renderChildren(node);
    if (tag === 'p') return `${children.trimEnd()}\n\n`;
    if (tag === 'br') return '\n';
    if (tag === 'strong' || tag === 'b') return `**${children}**`;
    if (tag === 'em' || tag === 'i') return `*${children}*`;
    if (tag === 's' || tag === 'strike') return `~~${children}~~`;
    if (tag === 'u') return children;
    if (tag === 'h1') return `# ${children.trim()}\n\n`;
    if (tag === 'h2') return `## ${children.trim()}\n\n`;
    if (tag === 'h3') return `### ${children.trim()}\n\n`;
    if (tag === 'ul') return renderList(node, false);
    if (tag === 'ol') return renderList(node, true);
    if (tag === 'blockquote') {
      return `${children
        .trim()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}\n\n`;
    }
    if (tag === 'pre') return `\`\`\`\n${node.textContent ?? ''}\n\`\`\`\n\n`;
    if (tag === 'code') return `\`${children}\``;
    if (tag === 'hr') return '---\n\n';
    if (tag === 'a') {
      const href = node.getAttribute('href');
      return href ? `[${children}](${href})` : children;
    }
    return children;
  }

  return renderChildren(parsed.body)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type='button'
      variant={active ? 'secondary' : 'ghost'}
      size='icon'
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className='size-8 shrink-0'
    >
      {children}
    </Button>
  );
}

function CaseNoteEditorContextMenu({
  editor,
  target,
  reference,
  onOpenReference,
  onSave,
  isDirty,
  isSaving,
  onOpenReferences
}: {
  editor: Editor;
  target: EditorContextTarget;
  reference?: CaseReference;
  onOpenReference?: (reference: CaseReference) => void;
  onSave?: () => void;
  isDirty: boolean;
  isSaving: boolean;
  onOpenReferences: () => void;
}) {
  const restoreContextSelection = () => {
    if (target.kind === 'reference') return;
    const documentSize = editor.state.doc.content.size;
    if (target.kind === 'general') {
      const position = Math.max(0, Math.min(target.position, documentSize));
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.near(editor.state.doc.resolve(position))
        )
      );
      return;
    }

    const from = Math.max(1, Math.min(target.from, documentSize));
    const to = Math.max(from, Math.min(target.to, documentSize));
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, from, to)
      )
    );
  };

  const runWithContext = (command: () => void) => {
    restoreContextSelection();
    command();
  };

  const writeClipboard = async (value: string, successMessage: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Unavailable');
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
      return true;
    } catch {
      toast.error('Clipboard access is unavailable');
      return false;
    }
  };

  const selectedText =
    target.kind === 'selection'
      ? editor.state.doc.textBetween(target.from, target.to, '\n')
      : '';

  const copySelection = () =>
    writeClipboard(selectedText, 'Selected text copied');

  const cutSelection = async () => {
    if (!(await copySelection()) || target.kind !== 'selection') return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: target.from, to: target.to })
      .run();
  };

  const pastePlainText = async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error('Unavailable');
      const text = await navigator.clipboard.readText();
      if (!text) return;
      restoreContextSelection();
      const range =
        target.kind === 'selection'
          ? { from: target.from, to: target.to }
          : editor.state.selection.from;
      editor
        .chain()
        .focus()
        .insertContentAt(
          range,
          escapeHtml(text.replaceAll('\r\n', '\n')).replaceAll('\n', '<br>')
        )
        .run();
    } catch {
      toast.error('Clipboard access is unavailable');
    }
  };

  const activeAlignment =
    (['center', 'right', 'justify'].find((alignment) =>
      editor.isActive({ textAlign: alignment })
    ) as 'center' | 'right' | 'justify' | undefined) ?? 'left';

  const alignmentMenu = (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <AlignLeft />
        Alignment
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className='w-48'>
        <ContextMenuGroup>
          {[
            { value: 'left', label: 'Align left', icon: AlignLeft },
            { value: 'center', label: 'Align center', icon: AlignCenter },
            { value: 'right', label: 'Align right', icon: AlignRight },
            { value: 'justify', label: 'Justify', icon: AlignJustify }
          ].map(({ value, label, icon: Icon }) => (
            <ContextMenuItem
              key={value}
              onSelect={() =>
                runWithContext(() =>
                  editor.chain().focus().setTextAlign(value).run()
                )
              }
            >
              <Icon />
              {label}
              {activeAlignment === value ? <Check className='ml-auto' /> : null}
            </ContextMenuItem>
          ))}
        </ContextMenuGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );

  const paragraphMenu = (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Pilcrow />
        Paragraph
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className='w-52'>
        <ContextMenuGroup>
          <ContextMenuItem
            onSelect={() =>
              runWithContext(() => editor.chain().focus().setParagraph().run())
            }
          >
            <Pilcrow />
            Paragraph
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              runWithContext(() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              )
            }
          >
            <Heading1 />
            Heading 1
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              runWithContext(() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              )
            }
          >
            <Heading2 />
            Heading 2
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem
            onSelect={() =>
              runWithContext(() =>
                editor.chain().focus().toggleBulletList().run()
              )
            }
          >
            <List />
            Bulleted list
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              runWithContext(() =>
                editor.chain().focus().toggleOrderedList().run()
              )
            }
          >
            <ListOrdered />
            Numbered list
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              runWithContext(() =>
                editor.chain().focus().toggleBlockquote().run()
              )
            }
          >
            <Quote />
            Blockquote
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              runWithContext(() =>
                editor.chain().focus().toggleCodeBlock().run()
              )
            }
          >
            <Code />
            Code block
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );

  if (target.kind === 'reference' && reference) {
    const referenceNode = editor.state.doc.nodeAt(target.position);
    const referenceSize =
      referenceNode?.type.name === 'mention' ? referenceNode.nodeSize : 1;
    return (
      <ContextMenuContent className='w-64'>
        <ContextMenuGroup>
          <ContextMenuItem
            disabled={!onOpenReference}
            onSelect={() => onOpenReference?.(reference)}
          >
            <ExternalLink />
            {reference.kind === 'graph' ? 'Open graph' : 'Open entity'}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              void writeClipboard(reference.label, 'Reference name copied')
            }
          >
            <Copy />
            Copy name
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              void writeClipboard(reference.id, 'Reference ID copied')
            }
          >
            <Hash />
            Copy identifier
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem
            variant='destructive'
            onSelect={() =>
              editor
                .chain()
                .focus()
                .deleteRange({
                  from: target.position,
                  to: target.position + referenceSize
                })
                .run()
            }
          >
            <Trash2 />
            Remove reference
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    );
  }

  return (
    <ContextMenuContent className='w-64'>
      <ContextMenuGroup>
        {target.kind === 'selection' ? (
          <>
            <ContextMenuItem onSelect={() => void copySelection()}>
              <Copy />
              Copy
              <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void cutSelection()}>
              <Scissors />
              Cut
              <ContextMenuShortcut>Ctrl+X</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        ) : null}
        <ContextMenuItem onSelect={() => void pastePlainText()}>
          <ClipboardPaste />
          Paste as plain text
          <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
        </ContextMenuItem>
        {target.kind === 'selection' ? (
          <ContextMenuItem
            variant='destructive'
            onSelect={() =>
              editor
                .chain()
                .focus()
                .deleteRange({ from: target.from, to: target.to })
                .run()
            }
          >
            <Delete />
            Delete selection
          </ContextMenuItem>
        ) : (
          <ContextMenuItem
            onSelect={() => editor.chain().focus().selectAll().run()}
          >
            <Check />
            Select all
            <ContextMenuShortcut>Ctrl+A</ContextMenuShortcut>
          </ContextMenuItem>
        )}
      </ContextMenuGroup>

      <ContextMenuSeparator />
      <ContextMenuGroup>
        {target.kind === 'selection' ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Bold />
              Format
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className='w-52'>
              <ContextMenuGroup>
                <ContextMenuCheckboxItem
                  checked={editor.isActive('bold')}
                  onSelect={() =>
                    runWithContext(() =>
                      editor.chain().focus().toggleBold().run()
                    )
                  }
                >
                  <Bold />
                  Bold
                </ContextMenuCheckboxItem>
                <ContextMenuCheckboxItem
                  checked={editor.isActive('italic')}
                  onSelect={() =>
                    runWithContext(() =>
                      editor.chain().focus().toggleItalic().run()
                    )
                  }
                >
                  <Italic />
                  Italic
                </ContextMenuCheckboxItem>
                <ContextMenuCheckboxItem
                  checked={editor.isActive('underline')}
                  onSelect={() =>
                    runWithContext(() =>
                      editor.chain().focus().toggleUnderline().run()
                    )
                  }
                >
                  <Underline />
                  Underline
                </ContextMenuCheckboxItem>
                <ContextMenuCheckboxItem
                  checked={editor.isActive('strike')}
                  onSelect={() =>
                    runWithContext(() =>
                      editor.chain().focus().toggleStrike().run()
                    )
                  }
                >
                  <Strikethrough />
                  Strikethrough
                </ContextMenuCheckboxItem>
                <ContextMenuCheckboxItem
                  checked={editor.isActive('highlight')}
                  onSelect={() =>
                    runWithContext(() =>
                      editor.chain().focus().toggleHighlight().run()
                    )
                  }
                >
                  <Highlighter />
                  Highlight
                </ContextMenuCheckboxItem>
                <ContextMenuCheckboxItem
                  checked={editor.isActive('code')}
                  onSelect={() =>
                    runWithContext(() =>
                      editor.chain().focus().toggleCode().run()
                    )
                  }
                >
                  <CodeXml />
                  Inline code
                </ContextMenuCheckboxItem>
              </ContextMenuGroup>
              <ContextMenuSeparator />
              <ContextMenuGroup>
                <ContextMenuCheckboxItem
                  checked={editor.isActive('superscript')}
                  onSelect={() =>
                    runWithContext(() =>
                      editor
                        .chain()
                        .focus()
                        .unsetSubscript()
                        .toggleSuperscript()
                        .run()
                    )
                  }
                >
                  <SuperscriptIcon />
                  Superscript
                </ContextMenuCheckboxItem>
                <ContextMenuCheckboxItem
                  checked={editor.isActive('subscript')}
                  onSelect={() =>
                    runWithContext(() =>
                      editor
                        .chain()
                        .focus()
                        .unsetSuperscript()
                        .toggleSubscript()
                        .run()
                    )
                  }
                >
                  <SubscriptIcon />
                  Subscript
                </ContextMenuCheckboxItem>
              </ContextMenuGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : null}

        {paragraphMenu}
        {alignmentMenu}

        {target.kind === 'selection' ? (
          <>
            <ContextMenuItem
              onSelect={() =>
                runWithContext(() => {
                  const previous = editor.getAttributes('link').href as
                    | string
                    | undefined;
                  const href = window.prompt(
                    'Link URL',
                    previous ?? 'https://'
                  );
                  if (href === null) return;
                  const chain = editor.chain().focus().extendMarkRange('link');
                  if (href.trim()) chain.setLink({ href }).run();
                  else chain.unsetLink().run();
                })
              }
            >
              <Link2 />
              {editor.isActive('link') ? 'Edit link' : 'Add link'}
            </ContextMenuItem>
            {editor.isActive('link') ? (
              <ContextMenuItem
                onSelect={() =>
                  runWithContext(() =>
                    editor
                      .chain()
                      .focus()
                      .extendMarkRange('link')
                      .unsetLink()
                      .run()
                  )
                }
              >
                <Unlink />
                Remove link
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem
              onSelect={() =>
                runWithContext(() =>
                  editor.chain().focus().unsetAllMarks().clearNodes().run()
                )
              }
            >
              <RemoveFormatting />
              Clear formatting
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Plus />
                Insert
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className='w-52'>
                <ContextMenuGroup>
                  <ContextMenuItem
                    onSelect={() =>
                      runWithContext(() =>
                        editor.chain().focus().setHorizontalRule().run()
                      )
                    }
                  >
                    <Minus />
                    Horizontal divider
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={onOpenReferences}>
                    <PanelRightOpen />
                    Graph or entity reference
                  </ContextMenuItem>
                </ContextMenuGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        )}
      </ContextMenuGroup>

      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem
          disabled={!editor.can().undo()}
          onSelect={() => editor.chain().focus().undo().run()}
        >
          <Undo2 />
          Undo
          <ContextMenuShortcut>Ctrl+Z</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!editor.can().redo()}
          onSelect={() => editor.chain().focus().redo().run()}
        >
          <Redo2 />
          Redo
          <ContextMenuShortcut>Ctrl+Y</ContextMenuShortcut>
        </ContextMenuItem>
        {onSave ? (
          <ContextMenuItem disabled={!isDirty || isSaving} onSelect={onSave}>
            <Save />
            {isSaving ? 'Saving note…' : isDirty ? 'Save note' : 'Note saved'}
            <ContextMenuShortcut>Ctrl+S</ContextMenuShortcut>
          </ContextMenuItem>
        ) : null}
      </ContextMenuGroup>
    </ContextMenuContent>
  );
}

export function CaseRichTextEditor({
  readOnly = false,
  content,
  references,
  onChange,
  onOpenReference,
  minHeight = 220,
  placeholder = 'Write your note. Use @ or / to link graphs and entities…',
  className,
  documentMode = false,
  documentTitle = 'Note',
  isDirty = false,
  isSaving = false,
  onSave,
  compactMode = false,
  compactHeaderEnd,
  compactHeaderClassName,
  onCompactHeaderPointerDown,
  onStatsChange
}: CaseRichTextEditorProps) {
  const [entityPanelOpen, setEntityPanelOpen] = useState(false);
  const [entitySearch, setEntitySearch] = useState('');
  const [paperTheme, setPaperTheme] = useState<PaperTheme>('dark');
  const [documentZoom, setDocumentZoom] = useState(100);
  const [editorContextTarget, setEditorContextTarget] =
    useState<EditorContextTarget>({ kind: 'general', position: 1 });
  const [documentStats, setDocumentStats] = useState({
    words: 0,
    characters: 0
  });
  const [draggedReference, setDraggedReference] =
    useState<CaseReference | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const dragPositionRef = useRef<number | null>(null);
  const initialSelectionRef = useRef<number | null>(null);
  const editorShellRef = useRef<HTMLDivElement>(null);
  const documentCanvasRef = useRef<HTMLDivElement>(null);
  const wheelDeltaRef = useRef(0);
  const referencePanelId = useId();
  const referencesRef = useRef(references);
  referencesRef.current = references;
  const referenceById = useMemo(
    () => new Map(references.map((reference) => [reference.id, reference])),
    [references]
  );
  const referenceByIdRef = useRef(referenceById);
  referenceByIdRef.current = referenceById;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const applyingSnapshotRef = useRef(false);
  const extensions = useMemo(
    () => [
      Extension.create({
        name: 'graphWriteGuard',
        addProseMirrorPlugins: () => [
          new Plugin({
            key: new PluginKey('graphWriteGuard'),
            filterTransaction: (transaction) =>
              !transaction.docChanged ||
              !readOnlyRef.current ||
              applyingSnapshotRef.current
          })
        ]
      }),
      StarterKit.configure({ paragraph: false }),
      SizedParagraph,
      CaseNoteDropCaret,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight,
      Subscript,
      Superscript,
      Placeholder.configure({ placeholder }),
      DraggableMention.configure({
        HTMLAttributes: { class: 'case-reference-mention' },
        suggestions: [
          createSuggestion('@', () => referencesRef.current),
          createSuggestion('/', () => referencesRef.current)
        ],
        renderText: ({ node }) => node.attrs.label ?? String(node.attrs.id),
        renderHTML: ({ node, options }) =>
          renderReferenceMention(
            node,
            options.HTMLAttributes,
            referenceByIdRef.current.get(String(node.attrs.id))
          )
      })
    ],
    [placeholder]
  );

  const editor = useEditor({
    editable: !readOnly,
    extensions,
    content: normalizeContent(content),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'case-rich-editor-body',
        'data-allow-text-selection': 'true'
      },
      handleClickOn: (_view, _position, node) => {
        if (node.type.name !== 'mention') return false;
        const reference = referenceByIdRef.current.get(String(node.attrs.id));
        if (!reference) return false;
        onOpenReference?.(reference);
        return true;
      },
      handlePaste: (view, event) => {
        const clipboardText = event.clipboardData?.getData('text/plain') ?? '';
        if (!getGraphNodeClipboardCopyId(clipboardText)) return false;

        const copiedNodes = readGraphNodeClipboard(clipboardText);
        const mentionType = view.state.schema.nodes.mention;
        if (!copiedNodes || !mentionType) {
          toast.error('Copied node is no longer available');
          return true;
        }

        const references = copiedNodes
          .map(({ graphId, nodeId }) =>
            referenceByIdRef.current.get(
              `entity:${graphId}:${encodeURIComponent(nodeId)}`
            )
          )
          .filter((reference): reference is CaseReference =>
            Boolean(reference)
          );

        if (references.length === 0) {
          toast.error('Copied node is not available in this note');
          return true;
        }

        event.preventDefault();
        const content = references.flatMap((reference) => [
          mentionType.create({
            id: reference.id,
            label: reference.label,
            mentionSuggestionChar: null
          }),
          view.state.schema.text(' ')
        ]);
        const transaction = view.state.tr
          .replaceSelection(
            new Slice(ProseMirrorFragment.fromArray(content), 0, 0)
          )
          .scrollIntoView();
        view.dispatch(transaction);
        return true;
      }
    },
    onUpdate: ({ editor: currentEditor }) => onChange(currentEditor.getHTML())
  });

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor) return;
    const nextContent = normalizeContent(content);
    if (editor.getHTML() === nextContent) return;
    applyingSnapshotRef.current = true;
    try {
      editor.commands.setContent(nextContent, { emitUpdate: true });
    } finally {
      applyingSnapshotRef.current = false;
    }
  }, [content, editor]);

  const active = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor?.isActive('bold') ?? false,
      italic: currentEditor?.isActive('italic') ?? false,
      underline: currentEditor?.isActive('underline') ?? false,
      strike: currentEditor?.isActive('strike') ?? false,
      highlight: currentEditor?.isActive('highlight') ?? false,
      subscript: currentEditor?.isActive('subscript') ?? false,
      superscript: currentEditor?.isActive('superscript') ?? false,
      inlineCode: currentEditor?.isActive('code') ?? false,
      textAlign:
        (['center', 'right', 'justify'].find((alignment) =>
          currentEditor?.isActive({ textAlign: alignment })
        ) as 'center' | 'right' | 'justify' | undefined) ?? 'left',
      heading1: currentEditor?.isActive('heading', { level: 1 }) ?? false,
      heading2: currentEditor?.isActive('heading', { level: 2 }) ?? false,
      bulletList: currentEditor?.isActive('bulletList') ?? false,
      orderedList: currentEditor?.isActive('orderedList') ?? false,
      blockquote: currentEditor?.isActive('blockquote') ?? false,
      codeBlock: currentEditor?.isActive('codeBlock') ?? false,
      paragraphFontSize:
        (currentEditor?.getAttributes('paragraph').fontSize as
          | string
          | undefined) ?? DEFAULT_PARAGRAPH_FONT_SIZE
    })
  });

  const matchingReferences = useMemo(() => {
    const search = entitySearch.trim().toLocaleLowerCase();
    return search
      ? references.filter((reference) =>
          reference.searchText.toLocaleLowerCase().includes(search)
        )
      : references;
  }, [references, entitySearch]);
  const visibleReferences = useMemo(
    () => matchingReferences.slice(0, REFERENCE_RENDER_LIMIT),
    [matchingReferences]
  );
  const referenceGroups = useMemo(() => {
    const graphs = visibleReferences.filter(
      (reference) => reference.kind === 'graph'
    );
    const entitiesByCategory = new Map<string, CaseReference[]>();
    visibleReferences.forEach((reference) => {
      if (reference.kind !== 'entity') return;
      const category = reference.category || 'Other';
      const current = entitiesByCategory.get(category) ?? [];
      current.push(reference);
      entitiesByCategory.set(category, current);
    });

    return [
      ...(graphs.length > 0 ? [{ label: 'Graphs', references: graphs }] : []),
      ...Array.from(entitiesByCategory.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, groupedReferences]) => ({
          label,
          references: groupedReferences
        }))
    ];
  }, [visibleReferences]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );
  const { setNodeRef: setDropzoneRef, isOver: isEditorDropTarget } =
    useDroppable({ id: EDITOR_DROPZONE_ID });

  const setDocumentCanvasNode = useCallback(
    (node: HTMLDivElement | null) => {
      documentCanvasRef.current = node;
      setDropzoneRef(node);
    },
    [setDropzoneRef]
  );

  const adjustDocumentZoom = useCallback((delta: number) => {
    setDocumentZoom((current) => clampDocumentZoom(current + delta));
  }, []);

  useEffect(() => {
    if (!editor || !documentMode) return;
    const shell = editorShellRef.current;
    const canvas = documentCanvasRef.current;
    if (!shell || !canvas) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;

      if (event.key.toLocaleLowerCase() === 's' && onSave) {
        event.preventDefault();
        event.stopPropagation();
        if (isDirty && !isSaving) onSave();
        return;
      }

      const isIncrease =
        event.key === '+' || event.key === '=' || event.code === 'NumpadAdd';
      const isDecrease =
        event.key === '-' ||
        event.key === '_' ||
        event.code === 'NumpadSubtract';
      const isReset = event.key === '0' || event.code === 'Numpad0';
      if (!isIncrease && !isDecrease && !isReset) return;

      event.preventDefault();
      event.stopPropagation();
      if (isReset) {
        setDocumentZoom(100);
      } else {
        adjustDocumentZoom(
          isIncrease ? DOCUMENT_ZOOM_STEP : -DOCUMENT_ZOOM_STEP
        );
      }
    };

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();

      const deltaMultiplier =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      wheelDeltaRef.current += event.deltaY * deltaMultiplier;
      if (Math.abs(wheelDeltaRef.current) < 32) return;

      adjustDocumentZoom(
        wheelDeltaRef.current < 0 ? DOCUMENT_ZOOM_STEP : -DOCUMENT_ZOOM_STEP
      );
      wheelDeltaRef.current = 0;
    };

    shell.addEventListener('keydown', handleKeyDown, true);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      shell.removeEventListener('keydown', handleKeyDown, true);
      canvas.removeEventListener('wheel', handleWheel);
      wheelDeltaRef.current = 0;
    };
  }, [adjustDocumentZoom, documentMode, editor, isDirty, isSaving, onSave]);

  useEffect(() => {
    if (!editor) return;

    const updateDocumentStats = () => {
      const plainText = editor.getText({ blockSeparator: '\n' });
      const words = plainText.trim() ? plainText.trim().split(/\s+/).length : 0;
      const nextStats = { words, characters: plainText.length };
      onStatsChange?.(nextStats);
      setDocumentStats((current) =>
        current.words === nextStats.words &&
        current.characters === nextStats.characters
          ? current
          : nextStats
      );
    };

    editor.on('update', updateDocumentStats);
    updateDocumentStats();
    return () => {
      editor.off('update', updateDocumentStats);
    };
  }, [editor, onStatsChange]);

  if (!editor) return <div style={{ minHeight }} />;

  const handleEditorContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const editorRoot = editor.view.dom as HTMLElement;
    const referenceElement =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-reference-id]')
        : null;

    if (referenceElement && editorRoot.contains(referenceElement)) {
      const referenceId = referenceElement.dataset.referenceId;
      if (referenceId) {
        let position = 0;
        try {
          position = editor.view.posAtDOM(referenceElement, 0);
        } catch {
          position =
            editor.view.posAtCoords({
              left: event.clientX,
              top: event.clientY
            })?.pos ?? 0;
        }

        const resolved = editor.state.doc.resolve(
          Math.max(0, Math.min(position, editor.state.doc.content.size))
        );
        if (
          editor.state.doc.nodeAt(position)?.type.name !== 'mention' &&
          resolved.nodeBefore?.type.name === 'mention'
        ) {
          position -= resolved.nodeBefore.nodeSize;
        }
        setEditorContextTarget({
          kind: 'reference',
          position: Math.max(0, position),
          referenceId
        });
        return;
      }
    }

    const coordinates = editor.view.posAtCoords({
      left: event.clientX,
      top: event.clientY
    });
    if (!coordinates) return;

    const { from, to } = editor.state.selection;
    if (from !== to && coordinates.pos >= from && coordinates.pos <= to) {
      setEditorContextTarget({ kind: 'selection', from, to });
      return;
    }

    const selection = TextSelection.near(
      editor.state.doc.resolve(coordinates.pos)
    );
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    setEditorContextTarget({
      kind: 'general',
      position: selection.from
    });
  };

  const insertReference = (reference: CaseReference, position?: number) => {
    const contentToInsert = [
      {
        type: 'mention',
        attrs: {
          id: reference.id,
          label: reference.label,
          mentionSuggestionChar: null
        }
      },
      { type: 'text', text: ' ' }
    ];
    const chain = editor.chain().focus();
    if (typeof position === 'number') {
      chain.insertContentAt(position, contentToInsert).run();
      return;
    }
    chain.insertContent(contentToInsert).run();
  };

  const handleDragStart = (event: DragStartEvent) => {
    const reference = event.active.data.current?.reference as
      | CaseReference
      | undefined;
    const pointer = event.activatorEvent as PointerEvent;
    dragOriginRef.current = {
      x: pointer.clientX,
      y: pointer.clientY
    };
    dragPositionRef.current = null;
    initialSelectionRef.current = editor.state.selection.from;
    setDraggedReference(reference ?? null);
  };

  const clearDropCaret = (restoreSelection: boolean) => {
    let transaction = editor.state.tr.setMeta(dropCaretPluginKey, null);
    const initialPosition = initialSelectionRef.current;
    if (restoreSelection && initialPosition !== null) {
      const safePosition = Math.min(
        initialPosition,
        transaction.doc.content.size
      );
      transaction = transaction.setSelection(
        TextSelection.near(transaction.doc.resolve(safePosition))
      );
    }
    editor.view.dispatch(transaction);
    dragOriginRef.current = null;
    dragPositionRef.current = null;
    initialSelectionRef.current = null;
    setDraggedReference(null);
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const origin = dragOriginRef.current;
    if (!origin) return;

    const pointer = {
      left: origin.x + event.delta.x,
      top: origin.y + event.delta.y
    };
    const editorBounds = editor.view.dom.getBoundingClientRect();
    const isInsideEditor =
      pointer.left >= editorBounds.left &&
      pointer.left <= editorBounds.right &&
      pointer.top >= editorBounds.top &&
      pointer.top <= editorBounds.bottom;

    if (!isInsideEditor) {
      if (dragPositionRef.current !== null) {
        editor.view.dispatch(editor.state.tr.setMeta(dropCaretPluginKey, null));
        dragPositionRef.current = null;
      }
      return;
    }

    const coordinates = editor.view.posAtCoords(pointer);
    if (!coordinates) return;
    const selection = TextSelection.near(
      editor.state.doc.resolve(coordinates.pos)
    );
    if (dragPositionRef.current === selection.from) return;
    dragPositionRef.current = selection.from;
    editor.view.dispatch(
      editor.state.tr
        .setSelection(selection)
        .setMeta(dropCaretPluginKey, selection.from)
    );
    editor.view.focus();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const reference = event.active.data.current?.reference as
      | CaseReference
      | undefined;
    const position = dragPositionRef.current;
    if (!reference || position === null) {
      clearDropCaret(true);
      return;
    }

    clearDropCaret(false);
    insertReference(reference, position);
  };

  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt('Link URL', previous ?? 'https://');
    if (href === null) return;
    if (!href.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  };

  const setParagraphFontSize = (fontSize: string) => {
    if (fontSize === DEFAULT_PARAGRAPH_FONT_SIZE) {
      editor.chain().focus().resetAttributes('paragraph', 'fontSize').run();
      return;
    }
    editor.chain().focus().updateAttributes('paragraph', { fontSize }).run();
  };

  const exportDocument = async (format: DocumentExportFormat) => {
    const baseName = sanitizeFileName(documentTitle);
    const editorHtml = editor.getHTML();

    if (format === 'pdf') {
      try {
        await openPdfPrintDialog({
          title: documentTitle,
          fileName: baseName,
          editorHtml
        });
        toast.success('PDF export opened');
      } catch {
        toast.error('Unable to export PDF');
      }
      return;
    }

    if (format === 'markdown') {
      downloadBlob(
        new Blob([htmlToMarkdown(editorHtml)], {
          type: 'text/markdown;charset=utf-8'
        }),
        `${baseName}.md`
      );
      toast.success('Markdown exported');
      return;
    }

    if (format === 'text') {
      downloadBlob(
        new Blob([editor.getText({ blockSeparator: '\n\n' })], {
          type: 'text/plain;charset=utf-8'
        }),
        `${baseName}.txt`
      );
      toast.success('Text exported');
      return;
    }

    const wordDocument = new DOMParser().parseFromString(
      editorHtml,
      'text/html'
    );
    wordDocument
      .querySelectorAll('.case-reference-mention-favicon')
      .forEach((icon) => icon.remove());
    const wordEditorHtml = wordDocument.body.innerHTML;

    const wordHtml = `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(documentTitle)}</title>
<style>
@page WordSection1 { size: 210mm 297mm; margin: 25.4mm 22mm; }
div.WordSection1 { page: WordSection1; }
body { font-family: Aptos, Calibri, Arial, sans-serif; font-size: 12pt; line-height: 1.5; color: #18181b; }
h1 { font-size: 24pt; } h2 { font-size: 18pt; }
blockquote { border-left: 3px solid #a1a1aa; margin-left: 0; padding-left: 12pt; color: #52525b; }
pre { background: #f4f4f5; padding: 10pt; white-space: pre-wrap; }
a { color: #2563eb; }
</style>
</head>
<body><div class="WordSection1">${wordEditorHtml}</div></body>
</html>`;
    downloadBlob(
      new Blob([`\ufeff${wordHtml}`], {
        type: 'application/msword;charset=utf-8'
      }),
      `${baseName}.doc`
    );
    toast.success('Word document exported');
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragCancel={() => clearDropCaret(true)}
      onDragEnd={handleDragEnd}
    >
      <div
        ref={editorShellRef}
        className={cn(
          'relative flex min-w-0 items-stretch',
          (documentMode || compactMode) && 'h-full min-h-0 overflow-hidden'
        )}
      >
        <div
          className={cn(
            'case-rich-editor min-w-0 flex-1 overflow-hidden',
            documentMode || compactMode
              ? 'flex min-h-0 flex-col'
              : 'border-border/70 bg-background/65 rounded-xl border',
            compactMode && 'border-0 bg-transparent',
            compactMode && '[container-type:inline-size]',
            className
          )}
        >
          <div
            onPointerDown={compactMode ? onCompactHeaderPointerDown : undefined}
            className={cn(
              'paranod-scrollbar flex shrink-0 items-center gap-0.5 overflow-x-auto',
              documentMode
                ? 'border-border/40 bg-background/90 supports-[backdrop-filter]:bg-background/70 h-11 border-b px-1.5 shadow-sm backdrop-blur select-none dark:border-white/10'
                : compactMode
                  ? 'border-border/40 bg-background/90 supports-[backdrop-filter]:bg-background/70 graph-notes-editor-toolbar h-11 overflow-x-auto overflow-y-hidden border-b px-1.5 py-0 shadow-sm backdrop-blur select-none dark:border-white/10 [&_svg]:!size-3.5'
                  : 'border-border/60 border-b px-2 py-1.5',
              compactMode && compactHeaderClassName
            )}
          >
            <ToolbarButton
              label='Undo'
              disabled={!editor.can().undo()}
              onClick={() => editor.chain().focus().undo().run()}
            >
              <Undo2 />
            </ToolbarButton>
            <ToolbarButton
              label='Redo'
              disabled={!editor.can().redo()}
              onClick={() => editor.chain().focus().redo().run()}
            >
              <Redo2 />
            </ToolbarButton>
            <Separator orientation='vertical' className='mx-1 h-5' />
            {compactMode ? (
              <div className='graph-notes-toolbar-medium items-center gap-0.5'>
                <Select
                  value={
                    active?.paragraphFontSize ?? DEFAULT_PARAGRAPH_FONT_SIZE
                  }
                  onValueChange={setParagraphFontSize}
                >
                  <SelectTrigger
                    size='sm'
                    className='graph-notes-font-size-trigger h-6 w-12 shrink-0 border-0 bg-transparent px-1 text-[11px] shadow-none'
                    aria-label='Paragraph font size'
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align='start'>
                    <SelectGroup>
                      {PARAGRAPH_FONT_SIZES.map((fontSize) => (
                        <SelectItem key={fontSize} value={fontSize}>
                          {fontSize.replace('px', '')}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Separator orientation='vertical' className='mx-1 h-4' />
              </div>
            ) : null}
            {!compactMode ? (
              <>
                <Select
                  value={
                    active?.paragraphFontSize ?? DEFAULT_PARAGRAPH_FONT_SIZE
                  }
                  onValueChange={setParagraphFontSize}
                >
                  <SelectTrigger
                    size='sm'
                    className='w-[76px] shrink-0 border-0 bg-transparent px-2 text-xs shadow-none'
                    aria-label='Paragraph font size'
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align='start'>
                    <SelectGroup>
                      {PARAGRAPH_FONT_SIZES.map((fontSize) => (
                        <SelectItem key={fontSize} value={fontSize}>
                          {fontSize.replace('px', '')}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Separator orientation='vertical' className='mx-1 h-5' />
                <ToolbarButton
                  label='Heading 1'
                  active={active?.heading1}
                  onClick={() =>
                    editor.chain().focus().toggleHeading({ level: 1 }).run()
                  }
                >
                  <Heading1 />
                </ToolbarButton>
                <ToolbarButton
                  label='Heading 2'
                  active={active?.heading2}
                  onClick={() =>
                    editor.chain().focus().toggleHeading({ level: 2 }).run()
                  }
                >
                  <Heading2 />
                </ToolbarButton>
                <Separator orientation='vertical' className='mx-1 h-5' />
                <ToggleGroup
                  type='single'
                  size='sm'
                  value={active?.textAlign ?? 'left'}
                  className='shrink-0'
                  aria-label='Text alignment'
                  onValueChange={(alignment) => {
                    if (!alignment) return;
                    editor.chain().focus().setTextAlign(alignment).run();
                  }}
                >
                  <ToggleGroupItem
                    value='left'
                    className='size-8 flex-none'
                    aria-label='Align left'
                    title='Align left'
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <AlignLeft />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value='center'
                    className='size-8 flex-none'
                    aria-label='Align center'
                    title='Align center'
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <AlignCenter />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value='right'
                    className='size-8 flex-none'
                    aria-label='Align right'
                    title='Align right'
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <AlignRight />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value='justify'
                    className='size-8 flex-none'
                    aria-label='Justify text'
                    title='Justify text'
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <AlignJustify />
                  </ToggleGroupItem>
                </ToggleGroup>
                <Separator orientation='vertical' className='mx-1 h-5' />
              </>
            ) : null}
            <ToolbarButton
              label='Bold'
              active={active?.bold}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold />
            </ToolbarButton>
            <ToolbarButton
              label='Italic'
              active={active?.italic}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic />
            </ToolbarButton>
            <ToolbarButton
              label='Underline'
              active={active?.underline}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
              <Underline />
            </ToolbarButton>
            <ToolbarButton
              label='Link'
              active={editor.isActive('link')}
              onClick={setLink}
            >
              <Link2 />
            </ToolbarButton>
            {compactMode ? (
              <div className='graph-notes-toolbar-medium items-center gap-0.5'>
                <ToolbarButton
                  label='Strikethrough'
                  active={active?.strike}
                  onClick={() => editor.chain().focus().toggleStrike().run()}
                >
                  <Strikethrough />
                </ToolbarButton>
                <ToolbarButton
                  label='Highlight'
                  active={active?.highlight}
                  onClick={() => editor.chain().focus().toggleHighlight().run()}
                >
                  <Highlighter />
                </ToolbarButton>
              </div>
            ) : null}
            {!compactMode ? (
              <>
                <ToolbarButton
                  label='Strikethrough'
                  active={active?.strike}
                  onClick={() => editor.chain().focus().toggleStrike().run()}
                >
                  <Strikethrough />
                </ToolbarButton>
                <ToolbarButton
                  label='Highlight'
                  active={active?.highlight}
                  onClick={() => editor.chain().focus().toggleHighlight().run()}
                >
                  <Highlighter />
                </ToolbarButton>
                <ToolbarButton
                  label='Inline code'
                  active={active?.inlineCode}
                  onClick={() => editor.chain().focus().toggleCode().run()}
                >
                  <CodeXml />
                </ToolbarButton>
                <ToolbarButton
                  label='Superscript'
                  active={active?.superscript}
                  onClick={() =>
                    editor
                      .chain()
                      .focus()
                      .unsetSubscript()
                      .toggleSuperscript()
                      .run()
                  }
                >
                  <SuperscriptIcon />
                </ToolbarButton>
                <ToolbarButton
                  label='Subscript'
                  active={active?.subscript}
                  onClick={() =>
                    editor
                      .chain()
                      .focus()
                      .unsetSuperscript()
                      .toggleSubscript()
                      .run()
                  }
                >
                  <SubscriptIcon />
                </ToolbarButton>
                <ToolbarButton
                  label='Clear formatting'
                  onClick={() =>
                    editor.chain().focus().unsetAllMarks().clearNodes().run()
                  }
                >
                  <RemoveFormatting />
                </ToolbarButton>
              </>
            ) : null}
            <Separator orientation='vertical' className='mx-1 h-5' />
            <ToolbarButton
              label='Bulleted list'
              active={active?.bulletList}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List />
            </ToolbarButton>
            <ToolbarButton
              label='Numbered list'
              active={active?.orderedList}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered />
            </ToolbarButton>
            {compactMode ? (
              <>
                <div className='graph-notes-toolbar-wide items-center gap-0.5'>
                  <Separator orientation='vertical' className='mx-1 h-4' />
                  <ToggleGroup
                    type='single'
                    size='sm'
                    value={active?.textAlign ?? 'left'}
                    className='shrink-0 gap-0.5'
                    aria-label='Text alignment'
                    onValueChange={(alignment) => {
                      if (!alignment) return;
                      editor.chain().focus().setTextAlign(alignment).run();
                    }}
                  >
                    <ToggleGroupItem
                      value='left'
                      className='size-6 flex-none'
                      aria-label='Align left'
                      title='Align left'
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      <AlignLeft />
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value='center'
                      className='size-6 flex-none'
                      aria-label='Align center'
                      title='Align center'
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      <AlignCenter />
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value='right'
                      className='size-6 flex-none'
                      aria-label='Align right'
                      title='Align right'
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      <AlignRight />
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value='justify'
                      className='size-6 flex-none'
                      aria-label='Justify text'
                      title='Justify text'
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      <AlignJustify />
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <div className='graph-notes-toolbar-extra items-center gap-0.5'>
                  <Separator orientation='vertical' className='mx-1 h-4' />
                  <ToolbarButton
                    label='Heading 1'
                    active={active?.heading1}
                    onClick={() =>
                      editor.chain().focus().toggleHeading({ level: 1 }).run()
                    }
                  >
                    <Heading1 />
                  </ToolbarButton>
                  <ToolbarButton
                    label='Heading 2'
                    active={active?.heading2}
                    onClick={() =>
                      editor.chain().focus().toggleHeading({ level: 2 }).run()
                    }
                  >
                    <Heading2 />
                  </ToolbarButton>
                  <ToolbarButton
                    label='Blockquote'
                    active={active?.blockquote}
                    onClick={() =>
                      editor.chain().focus().toggleBlockquote().run()
                    }
                  >
                    <Quote />
                  </ToolbarButton>
                  <ToolbarButton
                    label='Clear formatting'
                    onClick={() =>
                      editor.chain().focus().unsetAllMarks().clearNodes().run()
                    }
                  >
                    <RemoveFormatting />
                  </ToolbarButton>
                </div>
              </>
            ) : null}
            {!compactMode ? (
              <>
                <ToolbarButton
                  label='Blockquote'
                  active={active?.blockquote}
                  onClick={() =>
                    editor.chain().focus().toggleBlockquote().run()
                  }
                >
                  <Quote />
                </ToolbarButton>
                <ToolbarButton
                  label='Code block'
                  active={active?.codeBlock}
                  onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                >
                  <Code />
                </ToolbarButton>
                <ToolbarButton
                  label='Divider'
                  onClick={() =>
                    editor.chain().focus().setHorizontalRule().run()
                  }
                >
                  <Minus />
                </ToolbarButton>
              </>
            ) : null}
            {!compactMode ? (
              <>
                <Separator orientation='vertical' className='mx-1 h-5' />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className="ml-auto size-8 shrink-0 [&_svg:not([class*='size-'])]:!size-5"
                  aria-label={`Switch document to ${paperTheme === 'dark' ? 'light' : 'dark'} mode`}
                  title={`Switch to ${paperTheme === 'dark' ? 'light' : 'dark'} paper`}
                  onClick={() =>
                    setPaperTheme((current) =>
                      current === 'dark' ? 'light' : 'dark'
                    )
                  }
                >
                  {paperTheme === 'dark' ? <Sun /> : <Moon />}
                </Button>
              </>
            ) : null}
            {!compactMode ? (
              <Button
                type='button'
                variant={entityPanelOpen ? 'secondary' : 'ghost'}
                size='sm'
                className='h-8 shrink-0 rounded-md px-2.5 text-xs'
                aria-expanded={entityPanelOpen}
                aria-controls={referencePanelId}
                onClick={() => setEntityPanelOpen((open) => !open)}
              >
                {entityPanelOpen ? (
                  <PanelRightClose data-icon='inline-start' />
                ) : (
                  <PanelRightOpen data-icon='inline-start' />
                )}
                References
              </Button>
            ) : null}
            {onSave && !compactMode ? (
              <>
                <Separator orientation='vertical' className='mx-1 h-6' />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className="size-8 shrink-0 [&_svg:not([class*='size-'])]:!size-5"
                  disabled={!isDirty || isSaving}
                  aria-label={isSaving ? 'Saving note' : 'Save note'}
                  title={isSaving ? 'Saving…' : isDirty ? 'Save' : 'Saved'}
                  onClick={onSave}
                >
                  {isSaving ? <Loader2 className='animate-spin' /> : <Save />}
                </Button>
              </>
            ) : null}
            {!compactMode ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className="size-8 shrink-0 [&_svg:not([class*='size-'])]:!size-5"
                    aria-label='Export note'
                    title='Export'
                  >
                    <Download />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem onSelect={() => void exportDocument('pdf')}>
                    PDF document (.pdf)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void exportDocument('word')}
                  >
                    Word document (.doc)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void exportDocument('markdown')}
                  >
                    Markdown (.md)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void exportDocument('text')}
                  >
                    Plain text (.txt)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {compactMode && compactHeaderEnd ? (
              <div className='bg-background/95 sticky right-0 z-10 ml-auto flex h-full shrink-0 items-center gap-1 pl-2 shadow-[-10px_0_14px_-12px_rgba(0,0,0,0.65)]'>
                {compactHeaderEnd}
              </div>
            ) : null}
          </div>
          <div
            ref={setDocumentCanvasNode}
            className={cn(
              'transition-shadow',
              documentMode &&
                'case-note-document-canvas paranod-scrollbar min-h-0 flex-1 overflow-auto px-4 py-8 sm:px-8 sm:py-10',
              compactMode &&
                'graph-notes-editor-canvas paranod-scrollbar min-h-0 flex-1 overflow-y-auto',
              isEditorDropTarget &&
                'ring-primary/35 shadow-[inset_0_0_28px_color-mix(in_oklab,var(--primary)_8%,transparent)] ring-2 ring-inset'
            )}
          >
            {documentMode ? (
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    className='case-note-page-stack'
                    data-paper-theme={paperTheme}
                    style={{ zoom: documentZoom / 100 }}
                    onContextMenuCapture={handleEditorContextMenu}
                  >
                    <EditorContent
                      editor={editor}
                      className='case-note-editor-surface'
                    />
                  </div>
                </ContextMenuTrigger>
                {!readOnly && (
                  <CaseNoteEditorContextMenu
                    editor={editor}
                    target={editorContextTarget}
                    reference={
                      editorContextTarget.kind === 'reference'
                        ? referenceById.get(editorContextTarget.referenceId)
                        : undefined
                    }
                    onOpenReference={onOpenReference}
                    onSave={onSave}
                    isDirty={isDirty}
                    isSaving={isSaving}
                    onOpenReferences={() => setEntityPanelOpen(true)}
                  />
                )}
              </ContextMenu>
            ) : (
              <EditorContent
                editor={editor}
                className={
                  compactMode ? 'graph-notes-editor-surface' : undefined
                }
                style={{ minHeight }}
              />
            )}
          </div>
          {documentMode ? (
            <footer className='border-border/40 bg-background/90 text-muted-foreground flex h-8 shrink-0 items-center gap-4 border-t px-3 text-[11px] tabular-nums dark:border-white/10'>
              <div className='flex min-w-0 items-center gap-4'>
                <span>
                  {documentStats.characters.toLocaleString()} characters
                </span>
                <span>{documentStats.words.toLocaleString()} words</span>
              </div>
              <div className='ml-auto flex shrink-0 items-center gap-1'>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='size-6 rounded-md'
                  disabled={documentZoom <= DOCUMENT_ZOOM_MIN}
                  aria-label='Zoom out document'
                  title='Zoom out (Ctrl+-)'
                  onClick={() => adjustDocumentZoom(-DOCUMENT_ZOOM_STEP)}
                >
                  <Minus />
                </Button>
                <Slider
                  className='w-28'
                  min={DOCUMENT_ZOOM_MIN}
                  max={DOCUMENT_ZOOM_MAX}
                  step={DOCUMENT_ZOOM_STEP}
                  value={[documentZoom]}
                  aria-label='Document zoom'
                  aria-valuetext={`${documentZoom}%`}
                  onValueChange={(value) =>
                    setDocumentZoom(clampDocumentZoom(value[0] ?? 100))
                  }
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='size-6 rounded-md'
                  disabled={documentZoom >= DOCUMENT_ZOOM_MAX}
                  aria-label='Zoom in document'
                  title='Zoom in (Ctrl++)'
                  onClick={() => adjustDocumentZoom(DOCUMENT_ZOOM_STEP)}
                >
                  <Plus />
                </Button>
                <Separator orientation='vertical' className='mx-1' />
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='h-6 min-w-12 rounded-md px-1'
                  aria-label={`Reset document zoom, currently ${documentZoom}%`}
                  title='Reset zoom (Ctrl+0)'
                  onClick={() => setDocumentZoom(100)}
                >
                  {documentZoom}%
                </Button>
              </div>
            </footer>
          ) : null}
        </div>

        <AnimatePresence initial={false}>
          {entityPanelOpen && !compactMode ? (
            <motion.aside
              key='case-note-references-panel'
              initial={
                compactMode
                  ? { width: 288, marginLeft: 0, opacity: 0, x: 16 }
                  : { width: 0, marginLeft: 0, opacity: 0, x: 16 }
              }
              animate={{
                width: 288,
                marginLeft: compactMode ? 0 : 12,
                opacity: 1,
                x: 0
              }}
              exit={{ width: 0, marginLeft: 0, opacity: 0, x: 16 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                'shrink-0 overflow-hidden',
                compactMode &&
                  'bg-background absolute inset-y-0 right-0 z-20 h-full border-l shadow-xl',
                documentMode && 'h-full'
              )}
            >
              <Card
                id={referencePanelId}
                className={cn(
                  'bg-background/65 w-72 shrink-0 gap-0 overflow-hidden py-0 shadow-none',
                  (documentMode || compactMode) &&
                    'h-full rounded-none border-y-0 border-r-0'
                )}
                style={
                  documentMode || compactMode
                    ? undefined
                    : { height: Math.max(minHeight + 45, 360) }
                }
              >
                <CardHeader className='border-border/60 flex flex-row items-center gap-2 border-b px-3 py-2.5'>
                  <CardTitle className='sr-only'>References</CardTitle>
                  <Input
                    value={entitySearch}
                    onChange={(event) => setEntitySearch(event.target.value)}
                    placeholder='Search graphs and entities…'
                    aria-label='Search graphs and entities'
                    className='h-8 min-w-0 flex-1 rounded-lg px-2.5 text-xs'
                  />
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='size-7 rounded-md'
                    aria-label='Close references panel'
                    onClick={() => setEntityPanelOpen(false)}
                  >
                    <PanelRightClose data-icon='inline-start' />
                  </Button>
                </CardHeader>
                <CardContent className='flex min-h-0 flex-1 flex-col overflow-hidden px-0'>
                  <div className='paranod-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto'>
                    <div className='flex min-w-0 flex-col gap-3 overflow-x-hidden p-3'>
                      {referenceGroups.map((group, groupIndex) => (
                        <section
                          key={group.label}
                          className='w-full min-w-0'
                          aria-label={group.label}
                        >
                          {groupIndex > 0 ? (
                            <Separator className='mb-3' />
                          ) : null}
                          <ReferenceGroupHeader label={group.label} />
                          <div className='flex min-w-0 flex-col items-start gap-1.5'>
                            {group.references.map((reference) => (
                              <DraggableEntityPill
                                key={reference.id}
                                reference={reference}
                                onInsert={insertReference}
                              />
                            ))}
                          </div>
                        </section>
                      ))}
                      {visibleReferences.length === 0 ? (
                        <p className='text-muted-foreground w-full px-2 py-8 text-center text-xs'>
                          No references found
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {visibleReferences.length < matchingReferences.length ? (
                    <p className='text-muted-foreground border-border/45 border-t px-3 py-2 text-center text-[10px] tabular-nums'>
                      Showing {visibleReferences.length} of{' '}
                      {matchingReferences.length} matches
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </div>

      <DragOverlay dropAnimation={null}>
        {draggedReference ? (
          <div
            className='case-entity-drag-pill shadow-xl'
            style={
              {
                '--reference-accent': draggedReference.accentColor
              } as CSSProperties
            }
          >
            <EntityPillContent reference={draggedReference} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
