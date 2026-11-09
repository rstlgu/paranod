export interface CaseReference {
  id: string;
  label: string;
  kind: 'graph' | 'entity';
  graphId: string;
  graphName: string;
  subtitle: string;
  entityType: string | null;
  category: string;
  accentColor: string;
  faviconUrl: string | null;
  iconUrl: string | null;
  searchText: string;
}

export interface CaseNote {
  id: string;
  graphId?: string | null;
  name: string;
  content: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}
