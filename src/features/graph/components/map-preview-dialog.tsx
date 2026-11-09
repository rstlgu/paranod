'use client';

import {
  Dialog,
  DialogContent,
  DialogTitle
} from '@/components/ui/dialog';
import dynamic from 'next/dynamic';
import { OpenNodeDialogBody, type OpenNodeDialogBodyProps } from './graph-editor/components/open-node-dialog';

// Import MapContent dynamically to avoid SSR issues with Leaflet
const MapContent = dynamic(() => import('./map-content'), {
  ssr: false,
  loading: () => (
    <div className='flex items-center justify-center bg-muted/20 w-full h-full'>
      <span className='text-muted-foreground text-sm'>Loading map...</span>
    </div>
  )
});

export interface MapPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panelProps: OpenNodeDialogBodyProps;
}

export function MapPreviewDialog({
  open,
  onOpenChange,
  panelProps
}: MapPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-none !w-[92vw] !h-[92vh] p-0 gap-0 border-none bg-background/95 backdrop-blur-xl shadow-2xl rounded-3xl overflow-hidden flex flex-col md:flex-row">
        <DialogTitle className="sr-only">Map Preview</DialogTitle>

        {/* Left Column: Map Preview */}
        <div className="relative w-full md:w-[65%] h-[40vh] md:h-full bg-muted/30 flex flex-col border-b md:border-b-0 md:border-r border-border/50">
           <div className="absolute inset-0 z-0">
             <MapContent value={String(panelProps.nodeData.label ?? '')} />
           </div>
        </div>

        {/* Right Column: same UI as OpenNodeDialog */}
        <div className="w-full md:w-[35%] h-full bg-background">
          <div className="h-full p-6 flex flex-col">
            <OpenNodeDialogBody {...panelProps} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
