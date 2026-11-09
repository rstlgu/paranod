'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';

export interface AnalysisEditNodeLabelDialogProps {
  open: boolean;
  title?: string;
  description?: string;
  initialValue: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (nextLabel: string) => void;
}

export function AnalysisEditNodeLabelDialog(props: AnalysisEditNodeLabelDialogProps) {
  const [value, setValue] = React.useState(props.initialValue);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!props.open) return;
    setValue(props.initialValue);
  }, [props.open, props.initialValue]);

  React.useEffect(() => {
    if (!props.open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [props.open]);

  function submit() {
    props.onSubmit(value.trim());
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title ?? 'Edit label'}</DialogTitle>
          {props.description ? <DialogDescription>{props.description}</DialogDescription> : null}
        </DialogHeader>

        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder='Label…'
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />

        <DialogFooter>
          <Button variant='ghost' type='button' onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button type='button' onClick={submit}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
