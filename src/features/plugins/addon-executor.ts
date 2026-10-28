/**
 * Addon Executor
 * Handles execution of transforms from installed addons (install-from-URL).
 */

import { db } from '@/lib/db';
import type { OSINTEntity } from './types';
import type { TransformDefinition } from '@/types/addons';
import { buildAppUrl } from '@/lib/url';
import { safeFetch } from '@/lib/security/safe-fetch';
import { createAddonRequestHeaders } from '@/lib/security/addon-request';
import { decryptSecret } from '@/lib/security/secrets';
import { parseStoredAddonManifest } from './addon-storage';
import { AddonTransformResponseSchema } from './addon-payload';
import { matchesInputType } from './registry';
import { checkPluginRateLimit } from '@/lib/middleware/rate-limit';
import { parseAddonResult } from '@/lib/validators/addon-result';
import { settleAddonJob } from '@/lib/jobs/settle-job';

export class AddonExecutor {
  /**
   * Esegue una transform da un addon installato.
   */
  static async executeTransform(
    workspaceId: string,
    addonId: string,
    transformId: string,
    entity: OSINTEntity,
    graphId: string,
    _config?: Record<string, unknown>,
    userId?: string
  ): Promise<{
    success: boolean;
    async: boolean;
    jobId?: string;
    result?: any;
    error?: string;
  }> {
    let createdJobId: string | undefined;
    try {
      if (!userId) throw new Error('Authenticated user required');
      const membership = await db.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } }
      });
      if (!membership) throw new Error('Workspace access denied');
      const graph = await db.graph.findFirst({
        where: {
          id: graphId,
          workspaceId,
          OR: [{ userId }, { visibility: 'workspace' }]
        },
        select: { id: true }
      });
      if (!graph) throw new Error('Graph not found or access denied');
      // 1. Get addon from DB
      const addon = await db.workspaceAddonInstall.findUnique({
        where: {
          workspaceId_addonId: {
            workspaceId: workspaceId,
            addonId
          }
        }
      });

      if (!addon || addon.uninstalledAt) {
        return {
          success: false,
          async: false,
          error: 'Addon not found or not installed'
        };
      }

      if (!addon.enabled) {
        return {
          success: false,
          async: false,
          error: 'Addon is disabled'
        };
      }

      const manifest = parseStoredAddonManifest(addon.manifestData);

      // NB: il manifest addon non può dichiarare campi config in-app (deciso
      // 2026-07-08, anti-phishing): l'auth dell'addon passa dalla manifest URL
      // personalizzata (stile Stremio), non da settings/secret della piattaforma.

      // 2. Find transform in manifest
      const transform: TransformDefinition | undefined =
        manifest.plugin.transforms.find(
          (candidate) => candidate.id === transformId
        );

      if (!transform) {
        return {
          success: false,
          async: false,
          error: `Transform "${transformId}" not found in addon`
        };
      }

      console.log(`🚀 Executing addon transform: ${addonId}/${transformId}`);
      if (!matchesInputType(entity.type, transform.inputType))
        throw new Error('Unsupported addon transform input');
      const rateLimit = await checkPluginRateLimit(workspaceId, addonId);
      if (!rateLimit.allowed) throw new Error('Addon rate limit exceeded');
      console.log(`   Entity: ${entity.type} = ${entity.value}`);

      // 3. Create job in DB FIRST to get the real job ID
      const job = await db.transformJob.create({
        data: {
          workspaceId: workspaceId,
          graphId,
          addonId,
          transformId,
          status: 'PENDING',
          inputEntity: JSON.stringify(entity),
          // Solo la config client (mai i secret decifrati) va persistita sul job
          config: null,
          webhookUrl: '' // Will be set after we have the job ID
        }
      });
      createdJobId = job.id;

      console.log(`📋 Job created: ${job.id}`);

      // 4. Update job with correct webhook URL using the job ID
      const webhookPath = `/api/webhooks/transforms/${job.id}`;

      await db.transformJob.update({
        where: { id: job.id },
        data: { webhookUrl: webhookPath }
      });

      const callbackUrl = buildAppUrl(webhookPath);

      const payload = {
        transformId,
        input: {
          entity: {
            id: entity.id,
            type: entity.type,
            value: entity.value,
            metadata: entity.metadata || {}
          },
          config: {}
        },
        callbackUrl
      };
      const requestBody = JSON.stringify(payload);
      const webhookSecret = decryptSecret(addon.webhookSecret);

      // 5. Determine timeout based on async/sync
      const timeout = transform.async ? 5000 : 30000;
      console.log(
        `⏱️  Timeout: ${timeout}ms (${transform.async ? 'async' : 'sync'})`
      );

      // 6. Call addon endpoint
      const response = await safeFetch(transform.endpoint, {
        method: 'POST',
        headers: createAddonRequestHeaders(
          requestBody,
          workspaceId,
          webhookSecret
        ),
        body: requestBody,
        timeoutMs: timeout,
        maxResponseBytes: 5 * 1024 * 1024
      });

      if (!response.ok) {
        throw new Error(
          `Addon returned ${response.status}: ${response.statusText}`
        );
      }

      const data = AddonTransformResponseSchema.parse(
        await response.json<unknown>()
      );

      console.log(`📨 Addon response: ${data.async ? 'ASYNC' : 'SYNC'}`);

      // 7. Handle response based on async/sync
      if (data.async) {
        if (!transform.async)
          throw new Error('Unexpected async addon response');
        // ASYNC - Job submitted, will complete later via webhook
        await db.transformJob.updateMany({
          where: { id: job.id, status: 'PENDING' },
          data: {
            status: 'SUBMITTED',
            submittedAt: new Date(),
            externalJobId: data.jobId
          }
        });

        console.log(`✅ Async job submitted`);
        console.log(`   External Job ID: ${data.jobId}`);
        console.log(`   Estimated time: ${data.estimatedTime || 'unknown'}s`);

        return {
          success: true,
          async: true,
          jobId: job.id
        };
      } else {
        parseAddonResult(data.result, entity.id);
        // SYNC - Job completed immediately
        const changed = await settleAddonJob(job.id, 'COMPLETED', {
          result: JSON.stringify(data.result)
        });
        if (!changed) return { success: true, async: true, jobId: job.id };

        const entityCount = data.result?.entities?.length || 0;
        console.log(`✅ Sync job completed: ${entityCount} entities`);

        return {
          success: true,
          async: false,
          result: data.result
        };
      }
    } catch (error) {
      console.error(`❌ Transform execution failed:`, error);

      try {
        if (createdJobId) {
          await db.transformJob.updateMany({
            where: {
              id: createdJobId,
              status: 'PENDING'
            },
            data: {
              status: 'FAILED',
              error: error instanceof Error ? error.message : 'Unknown error',
              completedAt: new Date()
            }
          });
        }
      } catch (updateError) {
        console.error('Failed to update job status:', updateError);
      }

      return {
        success: false,
        async: false,
        error:
          error instanceof Error ? error.message : 'Transform execution failed'
      };
    }
  }
}
