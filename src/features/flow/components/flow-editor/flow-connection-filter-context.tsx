'use client';

import * as React from 'react';

export interface FlowConnectionFilterValue {
  activeOutType: string | null;
  sourceNodeId: string | null;
  canEdit: boolean;
  transformGroups: FlowTransformPickerGroup[];
  onAddTransformFromSource:
    | ((args: {
        sourceNodeId: string;
        outType: string;
        transform: FlowTransformPickerItem;
      }) => void)
    | null;
}

export interface FlowTransformPickerItem {
  pluginId: string;
  pluginName: string;
  pluginIcon: string | null;
  pluginLogoUrl: string | null;
  transformId: string;
  name: string;
  description: string;
  inputType: string | null;
  outputTypes: string[] | null;
}

export interface FlowTransformPickerGroup {
  pluginId: string;
  pluginName: string;
  transforms: FlowTransformPickerItem[];
}

const FlowConnectionFilterContext =
  React.createContext<FlowConnectionFilterValue>({
    activeOutType: null,
    sourceNodeId: null,
    canEdit: false,
    transformGroups: [],
    onAddTransformFromSource: null
  });

export function FlowConnectionFilterProvider(props: {
  value: FlowConnectionFilterValue;
  children: React.ReactNode;
}) {
  return (
    <FlowConnectionFilterContext.Provider value={props.value}>
      {props.children}
    </FlowConnectionFilterContext.Provider>
  );
}

export function useFlowConnectionFilter() {
  return React.useContext(FlowConnectionFilterContext);
}
