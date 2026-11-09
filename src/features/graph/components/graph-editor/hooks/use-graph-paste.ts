'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import type { Node as FlowNode, Edge, ReactFlowInstance } from 'reactflow';
import type { OSINTNodeData } from '@/features/graph/types';

interface UseGraphPasteArgs {
  isActive: boolean;
  reactFlowInstance: ReactFlowInstance;
  setNodes: React.Dispatch<React.SetStateAction<FlowNode<OSINTNodeData>[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  handlePasteNodesFromCache: (copyId: string) => Promise<void>;
}

export function useGraphPaste(args: UseGraphPasteArgs) {
  useEffect(() => {
    if (!args.isActive) return;

    const handlePaste = async (e: ClipboardEvent) => {
      // Ignore paste events when typing in input/textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      e.preventDefault();
      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      // Prima controlla se c'è un marcatore nella clipboard
      const textData = clipboardData.getData('text/plain');
      if (textData && textData.startsWith('__OSINT_MARKER__')) {
        // È un marcatore dei nostri nodi
        const copyId = textData.replace('__OSINT_MARKER__', '');
        await args.handlePasteNodesFromCache(copyId);
        return; // Esci, abbiamo gestito il paste di nodi
      }

      // Check for images in multiple ways
      const items = Array.from(clipboardData.items);
      const imageItem = items.find((item) => item.type.startsWith('image/'));

      // Try direct image from clipboard
      if (imageItem) {
        const file = imageItem.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const dataUrl = event.target?.result as string;
            if (dataUrl) {
              // Create image node with data, not in edit mode
              const { x, y, zoom } = args.reactFlowInstance.getViewport();
              const centerX = -x / zoom + window.innerWidth / 2 / zoom;
              const centerY = -y / zoom + window.innerHeight / 2 / zoom;
              const position = { x: centerX - 140, y: centerY - 100 };

              const nodeId = `node-${Date.now()}`;
              const newNode: FlowNode<OSINTNodeData> = {
                id: nodeId,
                type: 'osint',
                position: position,
                selected: false, // Don't auto-select to avoid edit mode
                data: {
                  label: dataUrl,
                  type: 'media_url',
                  metadata: {}
                },
                style: { width: 280, height: 200 }
              };

              args.setNodes((nds) => [...nds, newNode]);
              toast.success('Image pasted');
            }
          };
          reader.readAsDataURL(file);
          return;
        }
      }

      // Check for images in HTML (from Word/Docs)
      const html = clipboardData.getData('text/html');
      if (html) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const imgTags = tempDiv.querySelectorAll('img');

        if (imgTags.length > 0) {
          // Found images in HTML - extract first one
          const img = imgTags[0];
          const src = img.src;

          if (src && (src.startsWith('data:') || src.startsWith('http'))) {
            // Create image node with the extracted image
            const { x, y, zoom } = args.reactFlowInstance.getViewport();
            const centerX = -x / zoom + window.innerWidth / 2 / zoom;
            const centerY = -y / zoom + window.innerHeight / 2 / zoom;
            const position = { x: centerX - 140, y: centerY - 100 };

            const nodeId = `node-${Date.now()}`;
            const newNode: FlowNode<OSINTNodeData> = {
              id: nodeId,
              type: 'osint',
              position: position,
              selected: false,
              data: {
                label: src,
                type: 'media_url',
                metadata: {}
              },
              style: { width: 280, height: 200 }
            };

            args.setNodes((nds) => [...nds, newNode]);
            toast.success('Image pasted from document');
            return;
          }
        }
      }

      // Handle text paste - try multiple formats for Word compatibility
      let text = clipboardData.getData('text/plain');

      // If text/plain is empty, try text/html and strip tags
      if (!text || !text.trim()) {
        if (html) {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = html;
          text = tempDiv.textContent || tempDiv.innerText || '';
        }
      }

      if (text && text.trim()) {
        const trimmedText = text.trim();
        const { x, y, zoom } = args.reactFlowInstance.getViewport();
        const centerX = -x / zoom + window.innerWidth / 2 / zoom;
        const centerY = -y / zoom + window.innerHeight / 2 / zoom;

        // Verifica se il testo è un URL
        const isUrl =
          /^(https?:\/\/)|(www\.)/i.test(trimmedText) ||
          /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(trimmedText);

        let nodeType: 'url' | 'note' = 'note';
        let label = trimmedText;

        if (isUrl) {
          nodeType = 'url';
          // Assicurati che l'URL abbia il protocollo
          if (!/^https?:\/\//i.test(trimmedText)) {
            label = 'https://' + trimmedText;
          }
        }

        const position = {
          x: centerX - (nodeType === 'url' ? 90 : 110),
          y: centerY - 60
        };

        const nodeId = `node-${Date.now()}`;
        const newNode: FlowNode<OSINTNodeData> = {
          id: nodeId,
          type: 'osint',
          position: position,
          selected: false, // Don't auto-select
          data: {
            label: label,
            type: nodeType,
            metadata: {}
          }
        };

        args.setNodes((nds) => [...nds, newNode]);
        toast.success(nodeType === 'url' ? 'URL pasted' : 'Text pasted as note');
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [args.isActive, args.setNodes, args.setEdges, args.reactFlowInstance, args.handlePasteNodesFromCache]);
}
