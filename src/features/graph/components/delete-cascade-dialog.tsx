import { useGraphCanEdit } from '@/features/graph/contexts/graph-mutation-context';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';

interface DeleteCascadeDialogProps {
  open: boolean;
  childCount: number;
  onOpenChange: (open: boolean) => void;
  onDeleteParent: () => void;
  onDeleteParentAndChildren: () => void;
}

export function DeleteCascadeDialog(props: DeleteCascadeDialogProps) {
  const canEdit = useGraphCanEdit();
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete child nodes too?</AlertDialogTitle>
          <AlertDialogDescription>
            This node has {props.childCount} child nodes that are currently hidden.
            Do you want to delete only the parent node, or the parent node plus all
            hidden children?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!canEdit()} onClick={() => { if (canEdit()) props.onDeleteParent(); }}>
            Parent only
          </AlertDialogAction>
          <AlertDialogAction
            className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            disabled={!canEdit()}
            onClick={() => { if (canEdit()) props.onDeleteParentAndChildren(); }}
          >
            Parent + children
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
