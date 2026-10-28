/**
 * Manifest Validator
 * Validates external plugin manifest JSON files
 */

import { z } from 'zod';
import semver from 'semver';
import type { AddonManifest as PluginManifest } from '@/types/addons';
import {
  checkPublicUrl,
  isExplicitlyAllowedAddonHost,
  localAddonsAllowed
} from '@/lib/security/ssrf';
import { safeFetch } from '@/lib/security/safe-fetch';

const PLATFORM_VERSION = '2.0.0';

// ============================================
// Zod Schemas
// ============================================

const ConfigFieldSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'select']),
  label: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  required: z.boolean().optional(),
  secret: z.boolean().optional(),
  default: z.unknown().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z
    .array(
      z.object({
        label: z.string().max(100),
        value: z.string().max(500)
      })
    )
    .max(100)
    .optional()
});

const TransformDefinitionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9-]+$/,
      'Transform ID must be lowercase alphanumeric with hyphens'
    ),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  inputType: z.string().min(1).max(100),
  outputTypes: z.array(z.string().min(1).max(100)).min(1).max(50),
  endpoint: z.string().max(2048).url(),
  method: z.literal('POST'),
  async: z.boolean().optional()
});

const ManifestSchema = z.object({
  manifestVersion: z.string().min(1).max(20),
  plugin: z.object({
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(
        /^[a-z0-9-]+$/,
        'Plugin ID must be lowercase alphanumeric with hyphens'
      ),
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'Version must be in semver format (x.y.z)'),
    author: z.string().min(1).max(100),
    authorUrl: z.string().max(2048).url().optional(),
    homepage: z.string().max(2048).url().optional(),
    documentation: z.string().max(2048).url().optional(),
    license: z.string().max(100).optional(),

    icon: z.string().max(200).optional(),
    logoUrl: z.string().max(2048).url().optional(),
    category: z.string().min(1).max(50),

    capabilities: z.object({
      inputTypes: z.array(z.string().min(1).max(100)).min(1).max(50),
      outputTypes: z.array(z.string().min(1).max(100)).min(1).max(50),
      estimatedTime: z.enum(['instant', 'seconds', 'minutes']),
      supportsAsync: z.boolean()
    }),

    configuration: z
      .object({
        required: z.boolean(),
        schema: z.record(z.string(), ConfigFieldSchema)
      })
      .optional(),

    transforms: z.array(TransformDefinitionSchema).min(1).max(100),

    metadata: z.object({
      tags: z.array(z.string().max(50)).max(50).optional(),
      minimumPlatformVersion: z.string().max(50)
    })
  })
});

// ============================================
// Validator Class
// ============================================

export class ManifestValidator {
  /**
   * Valida manifest JSON completo
   */
  static validate(manifest: unknown): {
    valid: boolean;
    manifest?: PluginManifest;
    errors?: string[];
  } {
    try {
      // 1. Schema validation con Zod
      const parsed = ManifestSchema.parse(manifest);

      // 2. Additional validations
      const errors: string[] = [];

      // Check platform version compatibility
      const minVersion = parsed.plugin.metadata.minimumPlatformVersion;
      if (!semver.valid(minVersion)) {
        errors.push(
          `Invalid minimumPlatformVersion: ${minVersion}. Must be valid semver.`
        );
      } else if (!semver.gte(PLATFORM_VERSION, minVersion)) {
        errors.push(
          `Plugin requires platform v${minVersion} but current version is v${PLATFORM_VERSION}`
        );
      }

      // Validate HTTPS endpoints (localhost only in development)
      const allowLocal = localAddonsAllowed();
      for (const transform of parsed.plugin.transforms) {
        try {
          const endpointUrl = new URL(transform.endpoint);
          const explicitlyAllowed = isExplicitlyAllowedAddonHost(
            endpointUrl.hostname
          );

          if (endpointUrl.protocol !== 'https:' && !explicitlyAllowed) {
            errors.push(
              `Transform "${transform.id}" must use an HTTPS endpoint${allowLocal ? ' (except an explicitly allowed local host)' : ''}`
            );
          }
        } catch {
          errors.push(
            `Transform "${transform.id}" has an invalid endpoint URL`
          );
        }
      }

      // Validate unique transform IDs
      const transformIds = parsed.plugin.transforms.map((t) => t.id);
      const duplicates = transformIds.filter(
        (id, i) => transformIds.indexOf(id) !== i
      );
      if (duplicates.length > 0) {
        errors.push(
          `Duplicate transform IDs found: ${Array.from(new Set(duplicates)).join(', ')}`
        );
      }

      const hasAsyncTransform = parsed.plugin.transforms.some(
        (transform) => transform.async
      );
      if (parsed.plugin.capabilities.supportsAsync !== hasAsyncTransform) {
        errors.push(
          'capabilities.supportsAsync must match the declared transforms'
        );
      }

      // Validate configuration schema if present
      if (parsed.plugin.configuration) {
        const configSchema = parsed.plugin.configuration.schema;
        for (const [fieldName, field] of Object.entries(configSchema)) {
          // Validate select fields have options
          if (
            field.type === 'select' &&
            (!field.options || field.options.length === 0)
          ) {
            errors.push(
              `Configuration field "${fieldName}" is type 'select' but has no options`
            );
          }

          // Validate number fields with min/max
          if (field.type === 'number') {
            if (
              field.min !== undefined &&
              field.max !== undefined &&
              field.min > field.max
            ) {
              errors.push(`Configuration field "${fieldName}" has min > max`);
            }
          }
        }
      }

      if (errors.length > 0) {
        return { valid: false, errors };
      }

      return {
        valid: true,
        manifest: {
          ...parsed,
          plugin: {
            ...parsed.plugin,
            configuration: undefined
          }
        } as PluginManifest
      };
    } catch (error) {
      // Check if it's a Zod validation error
      if (
        error &&
        typeof error === 'object' &&
        'errors' in error &&
        Array.isArray((error as any).errors)
      ) {
        const zodError = error as any;
        const errorMessages = zodError.errors.map((e: any) => {
          const path =
            e.path && e.path.length > 0 ? `${e.path.join('.')}: ` : '';
          return `${path}${e.message}`;
        });

        return {
          valid: false,
          errors: errorMessages
        };
      }

      return {
        valid: false,
        errors: [
          error instanceof Error ? error.message : 'Invalid manifest format'
        ]
      };
    }
  }

  /**
   * Scarica e valida manifest da URL
   */
  static async fetchAndValidate(manifestUrl: string): Promise<{
    valid: boolean;
    manifest?: PluginManifest;
    errors?: string[];
  }> {
    try {
      const response = await safeFetch(manifestUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'PARANOD/2.0'
        },
        timeoutMs: 10_000,
        maxResponseBytes: 1024 * 1024,
        maxRedirects: 3
      });

      if (!response.ok) {
        return {
          valid: false,
          errors: [
            `Failed to fetch manifest: HTTP ${response.status}`
          ]
        };
      }

      // Check content type
      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.includes('application/json')) {
        console.warn(
          `Manifest URL returned non-JSON content-type: ${contentType}`
        );
      }

      // Parse JSON
      let data: unknown;
      try {
        data = await response.json();
      } catch (error) {
        return {
          valid: false,
          errors: ['Manifest is not valid JSON']
        };
      }

      // Validate manifest
      return this.validate(data);
    } catch {
      // Network errors can contain the personalized manifest URL or request headers.
      return {
        valid: false,
        errors: ['Failed to fetch manifest; verify its URL and availability']
      };
    }
  }

  /**
   * Valida un endpoint: protocollo HTTPS (salvo localhost in dev) e SSRF guard
   * (l'host non deve risolvere a un indirizzo privato/interno).
   */
  static async verifyEndpoint(endpoint: string): Promise<{
    valid: boolean;
    error?: string;
  }> {
    const check = await checkPublicUrl(endpoint);
    if (!check.ok) {
      return { valid: false, error: check.error };
    }
    return { valid: true };
  }

  /**
   * Valida tutti gli endpoint di un manifest (protocollo + SSRF).
   */
  static async validateAllEndpoints(manifest: PluginManifest): Promise<{
    valid: boolean;
    errors?: string[];
  }> {
    const errors: string[] = [];

    // Check all transform endpoints
    for (const transform of manifest.plugin.transforms) {
      const endpointCheck = await this.verifyEndpoint(transform.endpoint);
      if (!endpointCheck.valid) {
        errors.push(
          `Transform "${transform.id}" endpoint is not allowed: ${endpointCheck.error}`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }
}
