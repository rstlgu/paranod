import { useCallback, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Node as FlowNode, Edge } from 'reactflow';
import type { NodeType } from '@/features/osint/node-registry';
import type { OSINTNodeData } from '@/features/graph/types';
import { toast } from 'sonner';

import { readGraphJsonFile } from '../utils/graph-import';
import { uploadTempFileWithProgress } from '../utils/upload-file';
import { isImageFile, prepareImageFile, uploadedImageData } from '../utils/image-node';
import { filePreviewDimensions } from '../utils/file-preview';

interface UseGraphFileDropArgs {
  isActive: boolean;
  dndNodeTypeMime: string;
  reactFlowInstance: { screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number } };
  addNode: (type: OSINTNodeData['type'], position?: { x: number; y: number }) => void;
  setNodes: (updater: (prev: FlowNode[]) => FlowNode[]) => void;
  setEdges: (updater: (prev: Edge[]) => Edge[]) => void;
}

export function useGraphFileDrop({
  isActive,
  dndNodeTypeMime,
  reactFlowInstance,
  addNode,
  setNodes,
  setEdges
}: UseGraphFileDropArgs) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dropPositionRef = useRef<{ x: number; y: number } | null>(null);

  function detectFileType(filename: string): NodeType {
    const ext = filename.toLowerCase().split('.').pop() || '';

    if (ext === 'pdf') return 'pdf';
    if (ext === 'doc' || ext === 'docx') return 'docx';
    if (ext === 'xls' || ext === 'xlsx') return 'xlsx';
    if (ext === 'txt') return 'txt';
    if (ext === 'csv') return 'csv';
    if (ext === 'json') return 'json';

    if (['rtf', 'odt', 'md', 'markdown'].includes(ext)) return 'document';
    return 'document';
  }

  const uploadFileAndUpdateNode = useCallback(
    async (nodeId: string, file: File, image = false) => {
      let toastId: string | number | undefined;

      try {
        toastId = toast.loading(`Uploading ${file.name}...`, { description: '0%' });

        const result = await uploadTempFileWithProgress({
          file,
          onProgress: (percentComplete) => {
            toast.loading(`Uploading ${file.name}...`, {
              id: toastId,
              description: `${percentComplete}%`
            });
          }
        });

        setNodes((prev) =>
          prev.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: image ? uploadedImageData(n.data, file, result.url) : {
                    ...(n.data as any),
                    label: (n.data as any)?.label,
                    metadata: {
                      ...((n.data as any)?.metadata ?? {}),
                      fileUrl: result.url,
                      _uploading: false
                    }
                  } as any
                }
              : n
          )
        );

        toast.success(`File uploaded: ${file.name}`, { id: toastId });
      } catch (error) {
        setNodes((prev) => prev.filter((n) => n.id !== nodeId));
        toast.error(
          `Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          { id: toastId }
        );
      }
    },
    [setNodes]
  );

  const createNodeAndUpload = useCallback(
    async (
      nodeId: string,
      nodeType: NodeType,
      file: File,
      flowPosition: { x: number; y: number },
      customTitle?: string
    ) => {
      const extension = file.name.toLowerCase().split('.').pop() || 'file';
      const extensionUpper = nodeType === 'pdf' ? 'PDF' : extension.toUpperCase();

      const newNode: FlowNode<OSINTNodeData> = {
        id: nodeId,
        type: 'osint',
        position: { x: flowPosition.x - 100, y: flowPosition.y - 90 },
        data: {
          type: nodeType as any,
          label: file.name,
          metadata: {
            filename: file.name,
            mimeType: file.type,
            extension: extensionUpper,
            size: file.size,
            _uploading: true,
            ...(customTitle && { customTitle })
          }
        }
      };

      const previewSize = filePreviewDimensions(newNode.data);
      if (previewSize) newNode.style = { width: previewSize.width, height: previewSize.height };

      setNodes((prev) => [...prev, newNode as any]);
      await uploadFileAndUpdateNode(nodeId, file);
    },
    [setNodes, uploadFileAndUpdateNode]
  );

  const handleFileDrop = useCallback(
    async (file: File, dropPosition: { x: number; y: number }) => {
      const fileName = file.name.toLowerCase();
      const fileType = file.type;

      const flowPosition = reactFlowInstance.screenToFlowPosition(dropPosition);
      const nodeId = `node-${uuidv4()}`;

      if (fileName.endsWith('.json') || fileType === 'application/json') {
        try {
          const payload = await readGraphJsonFile(file);
          if (payload) {
            setNodes(() => payload.nodes as any);
            setEdges(() => payload.edges as any);
            toast.success(`Graph imported from ${file.name}`);
            return;
          }
          await createNodeAndUpload(nodeId, 'json', file, flowPosition);
        } catch {
          toast.error('Failed to parse JSON file');
        }
        return;
      }

      if (isImageFile(file)) {
        try {
          file = prepareImageFile(file);
          const newNode: FlowNode<OSINTNodeData> = {
            id: nodeId,
            type: 'osint',
            position: { x: flowPosition.x - 100, y: flowPosition.y - 50 },
            style: { width: 300, height: 240 },
            data: {
              type: 'media_url',
              label: '',
              metadata: { mediaType: 'image', filename: file.name, _uploading: true }
            }
          };

          setNodes((prev) => [...prev, newNode as any]);
          await uploadFileAndUpdateNode(nodeId, file, true);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Invalid image');
        }
        return;
      }

      const detectedType = file.type === 'application/pdf' ? 'pdf' : detectFileType(file.name);
      if (detectedType === 'pdf' && !file.type) {
        file = new File([file], file.name, { type: 'application/pdf', lastModified: file.lastModified });
      }
      const extension = file.name.toLowerCase().split('.').pop() || 'file';
      const extensionUpper = extension.toUpperCase();
      const isGenericFile =
        detectedType === 'document' &&
        !['pdf', 'docx', 'xlsx', 'txt', 'csv', 'json'].includes(extension);

      await createNodeAndUpload(
        nodeId,
        detectedType,
        file,
        flowPosition,
        isGenericFile ? `File ${extensionUpper}` : undefined
      );
    },
    [createNodeAndUpload, reactFlowInstance, setEdges, setNodes, uploadFileAndUpdateNode]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isActive) return;

      const isNodeTypeDrag = Array.from(e.dataTransfer.types).includes(dndNodeTypeMime);
      setIsDraggingOver(!isNodeTypeDrag);
      dropPositionRef.current = { x: e.clientX, y: e.clientY };
    },
    [dndNodeTypeMime, isActive]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isActive) return;

      const rect = e.currentTarget.getBoundingClientRect();
      if (
        e.clientX <= rect.left ||
        e.clientX >= rect.right ||
        e.clientY <= rect.top ||
        e.clientY >= rect.bottom
      ) {
        setIsDraggingOver(false);
      }
    },
    [isActive]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isActive) return;

      setIsDraggingOver(false);

      // IMPORTANT: prioritize real file drops from OS over any custom dataTransfer payload.
      // Some browsers/extensions can populate custom types unexpectedly; files must win.
      const files = Array.from(e.dataTransfer.files);
      const types = Array.from(e.dataTransfer.types);
      const isNodeTypeDrag = types.includes(dndNodeTypeMime);
      const droppedNodeType = isNodeTypeDrag ? e.dataTransfer.getData(dndNodeTypeMime) : '';

      if (files.length > 0) {
        const dropPosition = { x: e.clientX, y: e.clientY };
        if (files.every(isImageFile)) {
          // Sequential uploads limit memory/network use; distinct positions keep every image accessible.
          void (async () => {
            for (let index = 0; index < files.length; index++) {
              await handleFileDrop(files[index], { x: dropPosition.x + index * 40, y: dropPosition.y + index * 40 });
            }
          })();
          return;
        }
        const file = files[0];
        void handleFileDrop(file, dropPosition);
        if (files.length > 1)
          toast.info(`Processing only the first file. ${files.length - 1} files ignored.`);
        return;
      }

      if (droppedNodeType) {
        const flowPos = reactFlowInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        addNode(droppedNodeType as any, flowPos);
        return;
      }
    },
    [addNode, dndNodeTypeMime, handleFileDrop, isActive, reactFlowInstance]
  );

  return {
    isDraggingOver,
    dropPositionRef,
    handleDragOver,
    handleDragLeave,
    handleDrop
  };
}
