import { createContext, useContext } from 'react';
import type { Node as FlowNode } from 'reactflow';

export type RecentCaseItem = {
  id: string;
  name: string;
};

export type AddToCaseContextValue = {
  recentCases: RecentCaseItem[];
  refreshRecentCases: () => Promise<void>;
  addNodesToCase: (args: { caseId: string; nodes: FlowNode[] }) => Promise<void>;
  openAllCasesDialog: (nodes: FlowNode[]) => void;
  openNewCaseDialog: (nodes: FlowNode[]) => void;
};

const AddToCaseContext = createContext<AddToCaseContextValue | null>(null);

export function AddToCaseProvider({
  value,
  children
}: {
  value: AddToCaseContextValue;
  children: React.ReactNode;
}) {
  return (
    <AddToCaseContext.Provider value={value}>
      {children}
    </AddToCaseContext.Provider>
  );
}

export function useAddToCase() {
  const ctx = useContext(AddToCaseContext);
  if (!ctx) return null;
  return ctx;
}
