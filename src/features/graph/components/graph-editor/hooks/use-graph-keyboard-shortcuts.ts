'use client';

import { useEffect } from 'react';

interface UseGraphKeyboardShortcutsArgs<TNode extends { selected?: boolean }> {
  isActive: boolean;
  canEditSnapshot?: () => boolean;
  nodes: TNode[];
  undo: () => void;
  redo: () => void;
  handleCopySelection: () => void;
  handleDeleteSelection: () => void;
  handleMergeSelection?: () => void;
  handleUnmergeSelection?: () => void;
  toggleSidebar?: () => void;
  toggleRightPanel?: () => void;
  toggleConsole?: () => void;
  openCommandPalette?: () => void;
}

export function useGraphKeyboardShortcuts<TNode extends { selected?: boolean }>(
  args: UseGraphKeyboardShortcutsArgs<TNode>
) {
  useEffect(() => {
    if (!args.isActive) return;

    const handleKeyDown = async (e: KeyboardEvent) => {
      // Ignora se si sta digitando in un input
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Undo/Redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (args.canEditSnapshot?.() === false) return;
        if (e.shiftKey) {
          args.redo();
        } else {
          args.undo();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        if (args.canEditSnapshot?.() === false) return;
        args.redo();
      }

      // Navigation & panels
      if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
        if (!args.toggleSidebar) return;
        e.preventDefault();
        e.stopPropagation();
        (
          e as unknown as { stopImmediatePropagation?: () => void }
        ).stopImmediatePropagation?.();
        args.toggleSidebar();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'l' || e.key === 'L')) {
        if (!args.toggleRightPanel) return;
        e.preventDefault();
        e.stopPropagation();
        (
          e as unknown as { stopImmediatePropagation?: () => void }
        ).stopImmediatePropagation?.();
        args.toggleRightPanel();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        if (!args.toggleConsole) return;
        e.preventDefault();
        e.stopPropagation();
        (
          e as unknown as { stopImmediatePropagation?: () => void }
        ).stopImmediatePropagation?.();
        args.toggleConsole();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
        if (!args.openCommandPalette) return;
        e.preventDefault();
        e.stopPropagation();
        (
          e as unknown as { stopImmediatePropagation?: () => void }
        ).stopImmediatePropagation?.();
        args.openCommandPalette();
      }

      // Copy - copia i nodi selezionati nella clipboard di sistema
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        const hasSelectedNodes = args.nodes.some((n) => n.selected);
        if (hasSelectedNodes) {
          e.preventDefault();
          args.handleCopySelection();
        }
        // Se non ci sono nodi selezionati, lascia che il browser gestisca il copy standard
      }

      // Paste - gestito dall'evento paste del window per supportare immagini
      // Non preveniamo il default qui per permettere il funzionamento normale

      // Delete - elimina nodi e edge selezionati
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (args.canEditSnapshot?.() === false) return;
        args.handleDeleteSelection();
      }

      // Merge (M) - solo se ci sono almeno 2 nodi selezionati
      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        (e.key === 'm' || e.key === 'M')
      ) {
        if (!args.handleMergeSelection) return;
        if (args.canEditSnapshot?.() === false) return;
        const selectedCount = args.nodes.filter((n) =>
          Boolean((n as any)?.selected)
        ).length;
        if (selectedCount < 2) return;
        e.preventDefault();
        e.stopPropagation();
        (
          e as unknown as { stopImmediatePropagation?: () => void }
        ).stopImmediatePropagation?.();
        args.handleMergeSelection();
      }

      // Unmerge (U) - solo se la selezione contiene almeno un nodo merged
      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        (e.key === 'u' || e.key === 'U')
      ) {
        if (!args.handleUnmergeSelection) return;
        if (args.canEditSnapshot?.() === false) return;
        const selectedNodes = args.nodes.filter((n) =>
          Boolean((n as any)?.selected)
        );
        if (!selectedNodes.length) return;
        const hasMergedSelected = selectedNodes.some((n) =>
          Boolean((n as any)?.data?.metadata?.__merge)
        );
        if (!hasMergedSelected) return;
        e.preventDefault();
        e.stopPropagation();
        (
          e as unknown as { stopImmediatePropagation?: () => void }
        ).stopImmediatePropagation?.();
        args.handleUnmergeSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener('keydown', handleKeyDown, {
        capture: true
      } as any);
  }, [
    args.isActive,
    args.canEditSnapshot,
    args.undo,
    args.redo,
    args.toggleSidebar,
    args.toggleRightPanel,
    args.toggleConsole,
    args.openCommandPalette,
    args.handleCopySelection,
    args.handleDeleteSelection,
    args.handleMergeSelection,
    args.handleUnmergeSelection,
    args.nodes
  ]);
}
