'use client';

import React, { createContext, useContext } from 'react';

export interface GraphLayoutSettingsContextValue {
  graphViewMode: 'free' | 'locked' | 'analysis' | 'map';
  lockedAxis: 'vertical' | 'horizontal';
  spacingPreset: 'compact' | 'normal' | 'relaxed';
}

const GraphLayoutSettingsContext =
  createContext<GraphLayoutSettingsContextValue | null>(null);

export function GraphLayoutSettingsProvider({
  value,
  children
}: {
  value: GraphLayoutSettingsContextValue;
  children: React.ReactNode;
}) {
  return (
    <GraphLayoutSettingsContext.Provider value={value}>
      {children}
    </GraphLayoutSettingsContext.Provider>
  );
}

export function useGraphLayoutSettings() {
  const ctx = useContext(GraphLayoutSettingsContext);
  if (!ctx) {
    throw new Error(
      'useGraphLayoutSettings must be used within GraphLayoutSettingsProvider'
    );
  }
  return ctx;
}
