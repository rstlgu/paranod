/**
 * Addon Types
 * Types for the addon system (install-from-URL, Stremio-style external providers).
 */

import type { Prisma } from '@prisma/client';

// ============================================
// Manifest JSON Structure
// ============================================

export interface AddonManifest {
  manifestVersion: string;
  plugin: {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    authorUrl?: string;
    homepage?: string;
    documentation?: string;
    license?: string;

    icon?: string;
    logoUrl?: string;
    category: string;

    capabilities: {
      inputTypes: string[];
      outputTypes: string[];
      estimatedTime: 'instant' | 'seconds' | 'minutes';
      supportsAsync: boolean;
    };

    /**
     * @deprecated Ignorata dalla piattaforma (deciso 2026-07-08): il manifest
     * non può dichiarare campi config da mostrare in app (anti-phishing).
     * Auth addon via manifest URL personalizzata (stile Stremio).
     */
    configuration?: {
      required: boolean;
      schema: Record<string, ConfigField>;
    };

    transforms: TransformDefinition[];

    metadata: {
      tags?: string[];
      minimumPlatformVersion: string;
    };
  };
}

/** @deprecated use AddonManifest */
export type PluginManifest = AddonManifest;

export interface ConfigField {
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  description?: string;
  required?: boolean;
  secret?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  options?: Array<{ label: string; value: string }>;
}

export interface TransformDefinition {
  id: string;
  name: string;
  description: string;
  inputType: string;
  outputTypes: string[];
  endpoint: string;
  method: 'POST';
  async?: boolean;
}

// ============================================
// Job Status Types
// ============================================

export type JobStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'TIMEOUT'
  | 'CANCELLED';

// ============================================
// Prisma Include Types
// ============================================

export type AddonWithJobs = Prisma.WorkspaceAddonInstallGetPayload<{
  include: { jobs: true };
}>;

export type TransformJobWithAddon = Prisma.TransformJobGetPayload<{
  include: { addon: true };
}>;

export type TransformJobFull = Prisma.TransformJobGetPayload<{
  include: {
    addon: true;
    workspace: true;
    graph: true;
  };
}>;

// ============================================
// API Request/Response Types
// ============================================

export interface InstallAddonRequest {
  manifestUrl: string;
}

export interface InstallAddonResponse {
  success: boolean;
  addon?: {
    id: string;
    addonId: string;
    name: string;
    version: string;
    installedAt: Date;
  };
  error?: string;
  details?: string[];
}

export interface ManifestPreviewRequest {
  manifestUrl: string;
}

export interface ManifestPreviewResponse {
  success: boolean;
  preview?: {
    addonId: string;
    name: string;
    description: string;
    version: string;
    author: string;
    authorUrl?: string;
    transformsCount: number;
    endpointOrigins: string[];
    supportsAsync: boolean;
  };
  error?: string;
  details?: string[];
}

export interface WebhookPayload {
  eventId: string;
  jobId: string;
  status: 'processing' | 'completed' | 'failed';
  progress?: number;
  progressMessage?: string;
  result?: {
    success: boolean;
    entities: unknown[];
    edges: unknown[];
    metadata?: Record<string, unknown>;
  };
  error?: string;
  timestamp: string;
}

// ============================================
// Transform Execution Types
// ============================================

export interface TransformRequestPayload {
  transformId: string;
  input: {
    entity: {
      id: string;
      type: string;
      value: string;
      metadata?: Record<string, unknown>;
    };
    config?: Record<string, unknown>;
  };
  callbackUrl: string;
}

export interface TransformResponseSync {
  async: false;
  result: {
    success: boolean;
    entities: unknown[];
    edges: unknown[];
    message?: string;
  };
}

export interface TransformResponseAsync {
  async: true;
  jobId: string;
  estimatedTime?: number;
  message?: string;
}

export type TransformResponse = TransformResponseSync | TransformResponseAsync;

// ============================================
// Validation Types
// ============================================

export interface ManifestValidationResult {
  valid: boolean;
  manifest?: AddonManifest;
  errors?: string[];
}
