'use client';

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { Extension } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Mention from '@tiptap/extension-mention';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { CaseReference } from '@/features/cases/components/case-note-types';
import {
  createSuggestion,
  renderReferenceMention
} from '@/features/cases/components/reference-mention';
import { getOsintNodeVisualTokens } from '@/features/graph/components/osint-node-visual';
import { nodeTypeByType, type NodeType } from '@/features/osint/node-registry';
import type { AgentGraphReferences } from '../store/agent-graph-references';
import { parseAgentDraft, serializeAgentDraft } from '../lib/composer-document';
import styles from './agent-panel.module.css';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  readOnly: boolean;
  placeholder: string;
  references?: AgentGraphReferences;
  focusRef: RefObject<{ focus: () => void } | null>;
}

export function AgentComposer(props: Props) {
  const current = useRef(props);
  current.current = props;
  const applying = useRef(false);
  const references = useMemo(
    () =>
      (props.references?.nodes ?? []).map((node): CaseReference => {
        const type = String(node.data?.type ?? 'custom');
        const label = String(node.data?.label || node.id);
        const definition = nodeTypeByType[type as NodeType];
        const visual = getOsintNodeVisualTokens({
          type,
          label,
          metadata: node.data?.metadata
        });
        return {
          id: node.id,
          label,
          kind: 'entity',
          graphId: '',
          graphName: '',
          subtitle: type,
          entityType: type,
          category: definition?.category ?? 'Other',
          accentColor: visual.iconHex,
          faviconUrl: visual.logoUrl ?? null,
          iconUrl: definition
            ? `/api/public/entity-icons/${encodeURIComponent(type)}`
            : null,
          searchText: `${label} ${type} ${node.id}`
        };
      }),
    [props.references?.nodes]
  );
  const referencesRef = useRef(references);
  referencesRef.current = references;
  const byId = useRef(new Map<string, CaseReference>());
  byId.current = new Map(
    references.map((reference) => [reference.id, reference])
  );
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        underline: false
      }),
      Placeholder.configure({ placeholder: () => current.current.placeholder }),
      Mention.extend({ priority: 1000 }).configure({
        HTMLAttributes: { class: 'case-reference-mention' },
        suggestions: [
          createSuggestion('@', () => referencesRef.current),
          createSuggestion('/', () => referencesRef.current)
        ],
        renderText: ({ node }) => String(node.attrs.label ?? node.attrs.id),
        renderHTML: ({ node, options }) =>
          renderReferenceMention(
            node,
            options.HTMLAttributes,
            byId.current.get(String(node.attrs.id))
          )
      }),
      Extension.create({
        name: 'agentComposerGuard',
        // Let the mention menu consume Enter before the submit shortcut.
        priority: 500,
        addKeyboardShortcuts() {
          return {
            Enter: () => {
              if (this.editor.view.composing) return false;
              if (!current.current.readOnly) current.current.onSubmit();
              return true;
            }
          };
        },
        addProseMirrorPlugins: () => [
          new Plugin({
            key: new PluginKey('agentComposerGuard'),
            filterTransaction: (transaction) =>
              !transaction.docChanged ||
              applying.current ||
              (!current.current.readOnly &&
                serializeAgentDraft(transaction.doc.toJSON()).length <= 8000)
          })
        ]
      })
    ],
    []
  );
  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: parseAgentDraft(props.value),
    editable: !props.readOnly,
    editorProps: {
      attributes: {
        class: `${styles.composerInput} paranod-scrollbar`,
        role: 'textbox',
        'aria-label': 'Message to agent',
        'aria-multiline': 'true',
        'data-allow-text-selection': 'true'
      }
    },
    onUpdate: ({ editor }) =>
      current.current.onChange(serializeAgentDraft(editor.getJSON()))
  });
  useEffect(() => {
    if (!editor) return;
    const focus = { focus: () => editor.commands.focus() };
    props.focusRef.current = focus;
    editor.commands.focus();
    return () => {
      if (props.focusRef.current === focus) props.focusRef.current = null;
    };
  }, [editor, props.focusRef]);
  useEffect(() => {
    if (!editor) return;
    // Changing run/scope also changes the draft. A synthetic update here would
    // write the previous scope's text into the new scope and cause a render loop.
    editor.setEditable(!props.readOnly, false);
    if (serializeAgentDraft(editor.getJSON()) !== props.value) {
      applying.current = true;
      try {
        editor.commands.setContent(parseAgentDraft(props.value), {
          emitUpdate: false
        });
      } finally {
        applying.current = false;
      }
    }
  }, [editor, props.value, props.readOnly]);
  return <EditorContent editor={editor} />;
}
