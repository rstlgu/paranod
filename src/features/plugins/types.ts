/**
 * OSINT Plugin System - Type Definitions
 */

// ============================================
// Entity Types (PURE: no UI imports)
// ============================================

import type { EntityType } from '@/features/osint/entity-types';
export type { EntityType };

export type RelationshipType =
  | 'resolves_to'
  | 'belongs_to'
  | 'owns'
  | 'associated_with'
  | 'related_to'
  | 'hosts'
  | 'located_at'
  | 'registered_by'
  | 'contains'
  | 'extracted_from'
  | 'has_balance'
  | 'has_transaction'
  | 'sent_to'
  | 'received_from'
  | 'uses_nameserver'
  | 'sent'
  | 'received'
  | 'transacted_with'
  | 'tx_sender'
  | 'tx_receiver'
  | 'connected_wallet';

// ============================================
// Plugin Definitions
// ============================================

export type PluginType =
  | 'builtin-js'
  | 'builtin-python'
  | 'custom'
  | 'external' // @deprecated use 'addon'
  | 'addon'
  | 'container-tool'; // OSINT tool executed in a local container
export type PluginRuntime =
  | 'nextjs'
  | 'python-worker'
  | 'external'
  | 'container';
export type EstimatedTime = 'instant' | 'seconds' | 'minutes';

// Categorie plugin
export type PluginCategory =
  | 'network' // DNS, IP, URL, Subdomain
  | 'identity' // Email, Username, Phone
  | 'media' // Image, Video
  | 'location' // Geolocation, Maps
  | 'blockchain' // Crypto, Wallets
  | 'ai' // AI-powered analysis
  | 'osint' // General OSINT tools
  | 'social' // Social media
  | 'documents' // Document analysis
  | 'other'; // Misc

export interface ConfigField {
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: Array<{ label: string; value: string }>;
  secret?: boolean; // Per API keys
}

export interface TransformDefinition {
  id: string;
  name: string;
  description: string;
  // inputType supports:
  // - specific type: 'email', 'instagram_user'
  // - 'all': all entity types
  // - wildcard: 'social:*' (all social types), 'telegram:*' (all telegram types)
  inputType: EntityType | 'all' | string;
  outputTypes: EntityType[];
  icon?: string;

  /** Richiede API key dell'utente (configSchema del plugin) per funzionare. */
  requiresApiKey?: boolean;
}

export interface PluginDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  icon?: string;
  logoUrl?: string; // Custom logo URL (preferred over icon)
  category: PluginCategory;

  // Tipo e runtime
  type: PluginType;
  runtime: PluginRuntime;

  // Capabilities
  inputTypes: EntityType[] | string[]; // Supports wildcards like 'social:*'
  outputTypes: EntityType[];

  // Transforms disponibili
  transforms: TransformDefinition[];

  // Timing
  estimatedTime: EstimatedTime;

  // Configurazione
  requiresConfig?: boolean;
  configSchema?: Record<string, ConfigField>;

  // Stato
  enabled?: boolean;
}

// ============================================
// Entities & Results
// ============================================

export interface OSINTEntity {
  id: string;
  type: EntityType;
  value: string;
  label: string;
  metadata: Record<string, unknown>;
  source?: string;
  verified?: boolean;
  timestamp: string;
}

export interface OSINTEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  relationship: RelationshipType;
  metadata?: Record<string, unknown>;
}

export interface TransformInput {
  entity: {
    id: string;
    type: EntityType;
    value: string;
    metadata?: Record<string, unknown>;
  };
  config?: Record<string, unknown>;
}

export interface TransformResult {
  success: boolean;
  entities: OSINTEntity[];
  edges: OSINTEdge[];
  error?: string;
  message?: string;
  metadata?: Record<string, unknown>;
  executionTime?: number;
  async?: boolean; // For async/external plugins
  jobId?: string; // For async/external plugins
  /** True when execution was rejected before dispatch, for example by a graph lock. */
  denied?: boolean;
}

// ============================================
// API Types
// ============================================

export interface TransformRequest {
  pluginId: string;
  transformId: string;
  input: TransformInput;
}

export interface TransformResponse {
  success: boolean;
  data?: TransformResult;
  error?: string;
  jobId?: string; // Per transform async
  status?: 'completed' | 'processing' | 'failed';
}

// ============================================
// Plugin Executor Interface
// ============================================

/** What a long transform reports while it runs. */
export interface TransformProgress {
  message: string;
  /** 0-100, when the transform can estimate it. */
  progress?: number;
}

/** Server-derived identity; never taken from transformation input or config. */
export interface PluginExecutionContext {
  userId: string;
  workspaceId: string;
}

export interface PluginExecutor {
  execute(
    transformId: string,
    input: TransformInput,
    onProgress?: (update: TransformProgress) => void,
    context?: PluginExecutionContext
  ): Promise<TransformResult>;
}

// ============================================
// Helper Types
// ============================================

export interface DNSRecord {
  type: 'A' | 'AAAA' | 'MX' | 'TXT' | 'NS' | 'CNAME' | 'SOA';
  value: string;
  priority?: number;
  ttl?: number;
}

export interface GeoLocation {
  country: string;
  countryCode: string;
  region: string;
  regionName: string;
  city: string;
  zip: string;
  lat: number;
  lon: number;
  timezone: string;
  isp: string;
  org: string;
  as: string;
}

export interface EmailValidation {
  valid: boolean;
  domain: string;
  local: string;
  disposable?: boolean;
  format: boolean;
}
