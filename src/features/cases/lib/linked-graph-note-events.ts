export const LINKED_GRAPH_NOTE_UPDATED_EVENT =
  'paranod:linked-graph-note-updated';

export interface LinkedGraphNoteUpdatedDetail {
  graphId: string;
  writeVersion: number;
  note: {
    id: string;
    caseId: string;
    name: string;
  };
  content: string;
}

export function dispatchLinkedGraphNoteUpdated(
  detail: LinkedGraphNoteUpdatedDetail
) {
  window.dispatchEvent(
    new CustomEvent<LinkedGraphNoteUpdatedDetail>(
      LINKED_GRAPH_NOTE_UPDATED_EVENT,
      { detail }
    )
  );
}
