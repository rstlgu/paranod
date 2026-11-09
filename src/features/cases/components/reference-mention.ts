import { mergeAttributes } from '@tiptap/core';
import type { DOMOutputSpec } from '@tiptap/pm/model';
import type { MentionNodeAttrs } from '@tiptap/extension-mention';
import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps
} from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import type { CaseReference } from './case-note-types';
import { cn } from '@/lib/utils';

type ReferenceSuggestion = Omit<
  SuggestionOptions<CaseReference, MentionNodeAttrs>,
  'editor'
>;

export function renderReferenceMention(
  node: { attrs: Record<string, any> },
  htmlAttributes: Record<string, any>,
  reference?: CaseReference
): DOMOutputSpec {
  const label = node.attrs.label ?? String(node.attrs.id);
  const attributes = mergeAttributes(htmlAttributes, {
    'data-reference-id': node.attrs.id,
    'data-reference-kind': reference?.kind ?? 'entity',
    style: `--reference-accent: ${reference?.accentColor ?? '#6366f1'}`
  });

  const visualUrls = reference ? getReferenceVisualUrls(reference) : [];
  if (visualUrls.length > 0) {
    return [
      'span',
      attributes,
      [
        'img',
        {
          'aria-hidden': 'true',
          class: 'case-reference-mention-favicon',
          src: visualUrls[0],
          alt: ''
        }
      ],
      ['span', { class: 'case-reference-mention-label' }, label]
    ];
  }

  return [
    'span',
    attributes,
    [
      'svg',
      {
        'aria-hidden': 'true',
        class: 'case-reference-mention-favicon',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2'
      },
      ['circle', { cx: '12', cy: '12', r: '3' }],
      ['path', { d: 'M4 12h5m6 0h5M12 4v5m0 6v5' }]
    ],
    ['span', { class: 'case-reference-mention-label' }, label]
  ];
}

export function getReferenceVisualUrls(reference: CaseReference) {
  return [reference.faviconUrl, reference.iconUrl].filter(
    (value): value is string => Boolean(value)
  );
}

function suggestionRenderer(trigger: '@' | '/') {
  let root: HTMLElement | null = null;
  let unmount: (() => void) | null = null;
  let current: SuggestionProps<CaseReference, MentionNodeAttrs> | null = null;
  let selectedIndex = 0;

  const paint = (scrollActive = false) => {
    if (!root || !current) return;
    root.replaceChildren();

    if (current.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'case-reference-menu-empty';
      empty.textContent = 'No results';
      root.appendChild(empty);
      return;
    }

    current.items.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = cn(
        'case-reference-menu-item',
        index === selectedIndex && 'is-active'
      );
      button.style.setProperty('--reference-accent', item.accentColor);

      const main = document.createElement('span');
      main.className = 'case-reference-menu-main';
      const visual = document.createElement('span');
      visual.className = 'case-reference-menu-visual';

      const visualUrls = getReferenceVisualUrls(item);
      if (visualUrls[0]) {
        const favicon = document.createElement('img');
        let visualIndex = 0;
        favicon.src = visualUrls[visualIndex];
        favicon.alt = '';
        favicon.loading = 'lazy';
        favicon.addEventListener('error', () => {
          visualIndex += 1;
          if (visualUrls[visualIndex]) {
            favicon.src = visualUrls[visualIndex];
            return;
          }
          favicon.remove();
        });
        visual.appendChild(favicon);
      }

      const label = document.createElement('span');
      label.className = 'case-reference-menu-label';
      label.textContent = item.label;
      main.append(visual, label);

      const subtitle = document.createElement('small');
      subtitle.textContent = item.category;
      button.append(main, subtitle);
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        current?.command({
          id: item.id,
          label: item.label,
          mentionSuggestionChar: trigger
        });
      });
      root?.appendChild(button);
    });

    if (scrollActive) {
      root
        .querySelector<HTMLButtonElement>('.case-reference-menu-item.is-active')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };

  return {
    onStart(props: SuggestionProps<CaseReference, MentionNodeAttrs>) {
      current = props;
      selectedIndex = 0;
      root = document.createElement('div');
      root.className = 'case-reference-menu paranod-scrollbar';
      unmount = props.mount(root);
      paint();
    },
    onUpdate(props: SuggestionProps<CaseReference, MentionNodeAttrs>) {
      current = props;
      selectedIndex = 0;
      paint();
    },
    onKeyDown({ event }: SuggestionKeyDownProps) {
      if (!current || current.items.length === 0) return false;
      if (event.key === 'ArrowUp') {
        selectedIndex =
          (selectedIndex + current.items.length - 1) % current.items.length;
        paint(true);
        return true;
      }
      if (event.key === 'ArrowDown') {
        selectedIndex = (selectedIndex + 1) % current.items.length;
        paint(true);
        return true;
      }
      if (event.key === 'Tab') {
        const direction = event.shiftKey ? -1 : 1;
        selectedIndex =
          (selectedIndex + direction + current.items.length) %
          current.items.length;
        paint(true);
        return true;
      }
      if (event.key === 'Enter') {
        const item = current.items[selectedIndex];
        current.command({
          id: item.id,
          label: item.label,
          mentionSuggestionChar: trigger
        });
        return true;
      }
      return false;
    },
    onExit() {
      unmount?.();
      root = null;
      unmount = null;
      current = null;
    }
  };
}

export function createSuggestion(
  trigger: '@' | '/',
  getReferences: () => CaseReference[]
): ReferenceSuggestion {
  return {
    char: trigger,
    pluginKey: new PluginKey(
      `case-reference-${trigger === '@' ? 'at' : 'slash'}`
    ),
    allowSpaces: true,
    allowedPrefixes: null,
    items: ({ query }) => {
      const search = query.trim().toLocaleLowerCase();
      return getReferences().filter((reference) =>
        (
          reference.searchText ||
          `${reference.label} ${reference.subtitle} ${reference.graphName}`
        )
          .toLocaleLowerCase()
          .includes(search)
      );
    },
    render: () => suggestionRenderer(trigger)
  };
}
