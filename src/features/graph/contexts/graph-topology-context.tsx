'use client';

import { createContext, useContext } from 'react';

const EMPTY_CHILD_COUNTS = new Map<string, number>();
const GraphChildCountsContext =
  createContext<ReadonlyMap<string, number>>(EMPTY_CHILD_COUNTS);

export function GraphChildCountsProvider({
  value,
  children
}: {
  value: ReadonlyMap<string, number>;
  children: React.ReactNode;
}) {
  return (
    <GraphChildCountsContext.Provider value={value}>
      {children}
    </GraphChildCountsContext.Provider>
  );
}

export function useGraphChildCount(nodeId: string) {
  const childCounts = useContext(GraphChildCountsContext);
  return childCounts.get(nodeId) ?? 0;
}
