'use client';

import { useEffect } from 'react';
import type { ReactFlowInstance } from 'reactflow';

interface UseConnectionPreviewArgs {
  isActive: boolean;
  connectingNodeId: React.MutableRefObject<{ nodeId: string; handleId: string | null } | null>;
  sourceNodePosition: React.MutableRefObject<{ x: number; y: number } | null>;
  previewNodePosition: { x: number; y: number } | null;
  setPreviewNodePosition: React.Dispatch<
    React.SetStateAction<{ x: number; y: number } | null>
  >;
  setPreviewNodeOffset: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  reactFlowInstance: ReactFlowInstance;
}

export function useConnectionPreview(args: UseConnectionPreviewArgs) {
  useEffect(() => {
    if (!args.isActive) return;
    if (!args.connectingNodeId.current || !args.sourceNodePosition.current) return;

    const handleMouseMove = (event: MouseEvent | TouchEvent) => {
      // Verifica che sia ancora attiva una connessione in corso
      if (!args.connectingNodeId.current || !args.sourceNodePosition.current) return;

      const { clientX, clientY } =
        'touches' in event ? (event as TouchEvent).touches[0] : (event as MouseEvent);

      // Verifica se il cursore è sopra un nodo esistente
      const elementUnderCursor = document.elementFromPoint(clientX, clientY);
      const isOverNode = elementUnderCursor?.closest('.react-flow__node') !== null;

      if (args.previewNodePosition !== null && args.sourceNodePosition.current) {
        // Nascondi l'anteprima se il cursore è sopra un nodo
        if (isOverNode) {
          args.setPreviewNodePosition(null);
          return;
        }

        const cursorPosition = args.reactFlowInstance.screenToFlowPosition({
          x: clientX,
          y: clientY
        });

        // Calcola la posizione del cursore rispetto al nodo di partenza
        const deltaX = cursorPosition.x - args.sourceNodePosition.current.x;
        const deltaY = cursorPosition.y - args.sourceNodePosition.current.y;

        // Offset base in pixel (distanza dal cursore) - molto ridotta
        const offsetDistance = 30;

        // Determina l'asse principale basandosi sulla distanza dal nodo di partenza
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          // Asse orizzontale prevalente
          if (deltaX > 0) {
            // Cursore a destra del nodo -> preview ancora più a destra
            args.setPreviewNodeOffset({ x: offsetDistance, y: -50 });
          } else {
            // Cursore a sinistra del nodo -> preview ancora più a sinistra
            args.setPreviewNodeOffset({ x: -offsetDistance - 200, y: -50 });
          }
        } else {
          // Asse verticale prevalente
          if (deltaY > 0) {
            // Cursore sotto il nodo -> preview ancora più sotto
            args.setPreviewNodeOffset({ x: -100, y: offsetDistance });
          } else {
            // Cursore sopra il nodo -> preview ancora più sopra
            args.setPreviewNodeOffset({ x: -100, y: -offsetDistance - 100 });
          }
        }

        args.setPreviewNodePosition(cursorPosition);
      } else if (!isOverNode && !args.previewNodePosition && args.connectingNodeId.current) {
        // Rimostra l'anteprima SOLO se c'è ancora una connessione attiva
        const cursorPosition = args.reactFlowInstance.screenToFlowPosition({
          x: clientX,
          y: clientY
        });
        args.setPreviewNodePosition(cursorPosition);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleMouseMove);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleMouseMove);
    };
  }, [
    args.isActive,
    args.connectingNodeId,
    args.sourceNodePosition,
    args.previewNodePosition,
    args.setPreviewNodeOffset,
    args.setPreviewNodePosition,
    args.reactFlowInstance
  ]);
}
