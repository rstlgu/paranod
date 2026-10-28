import type { Prisma, PrismaClient } from '@prisma/client';
import { isIP } from 'node:net';
import { parseStoredAddonManifest } from '@/features/plugins/addon-storage';
import { ManifestValidator } from '@/lib/validators/manifest-validator';
import { matchesInputType } from '@/features/plugins/registry';
import { isEntityType } from '@/features/osint/entity-types';
import { AddonTransformResponseSchema } from '@/features/plugins/addon-payload';
import { createAddonRequestHeaders } from '@/lib/security/addon-request';
import { decryptSecret } from '@/lib/security/secrets';
import { safePublicFetch } from '@/lib/security/safe-fetch';
import { checkPluginRateLimit } from '@/lib/middleware/rate-limit';
import { settleAddonJob } from '@/lib/jobs/settle-job';
import type { TransformInput } from '@/features/plugins/types';
import type { TransformDefinition } from '@/types/addons';
import type { ModuleScope } from './modules';
import { argumentsHash, publicText } from './policy';
import {
  checkedDomain,
  checkedPublicIp,
  checkedModuleInput,
  MODULE_LIMITS,
  MODULE_POLICY_VERSION
} from './module-policy';
import { validateModuleResult, type ModuleExecution } from './module-execution';

const PRIVATE_TYPES = new Set([
  'credential',
  'credit_card',
  'bank_account',
  'note',
  'document',
  'pdf',
  'docx',
  'xlsx',
  'txt',
  'csv',
  'json',
  'http_request',
  'http_response'
]);
const SAFE_INPUT_TYPES = new Set([
  'username',
  'email',
  'domain',
  'ip',
  'organization',
  'person',
  'phone',
  'url',
  'asn',
  'cidr'
]);

function checkedEndpoint(raw: string) {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.port
  )
    throw new Error('agent_addon_requires_public_https_endpoint');
  if (isIP(url.hostname.replace(/^\[|\]$/g, '')))
    checkedPublicIp(url.hostname.replace(/^\[|\]$/g, ''));
  else checkedDomain(url.hostname, true);
  return url.toString();
}

export function addonAvailability(
  transform: TransformDefinition,
  inputType?: string
) {
  if (inputType && !SAFE_INPUT_TYPES.has(inputType))
    return 'agent_addon_input_schema_not_supported';
  if (transform.async)
    return 'agent_addon_requires_cancellable_async_job_handoff';
  if (
    !transform.outputTypes.every(
      (type) => isEntityType(type) && !PRIVATE_TYPES.has(type)
    )
  )
    return 'agent_addon_output_schema_not_supported';
  try {
    checkedEndpoint(transform.endpoint);
  } catch {
    return 'agent_addon_requires_public_https_endpoint';
  }
  return null;
}

export interface AddonModuleExecution extends ModuleExecution {
  addon: {
    id: string;
    installId: string;
    endpoint: string;
    manifestUrl: string;
    encryptedWebhookSecret: string;
  };
}

export async function prepareAgentAddon(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  moduleId: string,
  transformId: string,
  input: TransformInput['entity'],
  scope?: ModuleScope
) {
  const addonId = moduleId.slice('addon:'.length);
  if (!/^[a-z0-9-]{1,100}$/.test(addonId))
    throw new Error('agent_addon_unavailable');
  const install = await tx.workspaceAddonInstall.findUnique({
    where: { workspaceId_addonId: { workspaceId, addonId } },
    select: {
      id: true,
      addonId: true,
      enabled: true,
      uninstalledAt: true,
      updatedAt: true,
      manifestData: true,
      manifestUrl: true,
      manifestVersion: true,
      config: true,
      webhookSecret: true
    }
  });
  if (!install || !install.enabled || install.uninstalledAt)
    throw new Error('agent_addon_unavailable');
  let manifestUrl: string;
  try {
    // Installation URLs are encrypted at rest and may carry credentials.
    // Resolve only in this server-side execution context, before URL validation.
    manifestUrl = checkedEndpoint(decryptSecret(install.manifestUrl));
  } catch {
    throw new Error('agent_addon_requires_public_https_manifest');
  }
  let manifest;
  try {
    const parsed = ManifestValidator.validate(
      parseStoredAddonManifest(install.manifestData)
    );
    if (
      !parsed.valid ||
      !parsed.manifest ||
      parsed.manifest.plugin.id !== addonId
    )
      throw new Error('manifest');
    manifest = parsed.manifest;
  } catch {
    throw new Error('agent_addon_invalid_manifest');
  }
  const transform = manifest.plugin.transforms.find(
    (entry) => entry.id === transformId
  );
  if (
    !transform ||
    !matchesInputType(input.type, transform.inputType) ||
    !SAFE_INPUT_TYPES.has(input.type)
  )
    throw new Error('agent_transform_unavailable');
  const reason = addonAvailability(transform);
  if (reason) throw new Error(reason);
  const entity = checkedModuleInput(input, true);
  const execution: AddonModuleExecution = {
    moduleId,
    transformId,
    input: entity,
    outputTypes: [...transform.outputTypes],
    plan: {
      kind: 'http',
      destination: `Addon installato: ${addonId}`,
      requests: [],
      dnsServers: []
    },
    addon: {
      id: addonId,
      installId: install.id,
      endpoint: checkedEndpoint(transform.endpoint),
      manifestUrl,
      encryptedWebhookSecret: install.webhookSecret
    }
  };
  const permit = {
    fingerprint: argumentsHash({
      policyVersion: MODULE_POLICY_VERSION,
      limits: MODULE_LIMITS,
      workspaceId,
      scope: scope ?? null,
      execution,
      manifest,
      installVersion: install.manifestVersion,
      manifestData: install.manifestData,
      config: install.config,
      updatedAt: install.updatedAt.toISOString()
    }),
    requiresApproval: true,
    destination: execution.plan.destination,
    summary: publicText(
      `Addon ${addonId} v${manifest.plugin.version}: ${transformId}, ${entity.type}: ${entity.value}. Single request to an external service; no async callbacks.`
    )
  };
  return { permit, execution };
}

export function isAddonExecution(
  execution: ModuleExecution
): execution is AddonModuleExecution {
  return 'addon' in execution;
}

function assertNoPrivateConfiguration(
  raw: unknown,
  execution: AddonModuleExecution,
  secret: string
) {
  const serialized = JSON.stringify(raw);
  if (Buffer.byteLength(serialized, 'utf8') > MODULE_LIMITS.maxResultBytes)
    throw new Error('agent_invalid_module_result');
  const denied = [
    secret,
    execution.addon.endpoint,
    execution.addon.manifestUrl
  ];
  for (const endpoint of [
    execution.addon.endpoint,
    execution.addon.manifestUrl
  ]) {
    const url = new URL(endpoint);
    denied.push(url.origin);
    for (const value of Array.from(url.searchParams.values()))
      if (value.length >= 8) denied.push(value, encodeURIComponent(value));
    for (const value of url.pathname.split('/'))
      if (value.length >= 16) denied.push(value, decodeURIComponent(value));
  }
  if (denied.some((value) => value && serialized.includes(value)))
    throw new Error('agent_addon_result_contains_private_configuration');
}

export async function executeAgentAddon(input: {
  db: PrismaClient;
  workspaceId: string;
  graphId: string;
  execution: AddonModuleExecution;
  signal: AbortSignal;
  beforeRequest: () => Promise<void>;
}) {
  const { execution, db, workspaceId, graphId } = input;
  const signal = AbortSignal.any([
    input.signal,
    AbortSignal.timeout(MODULE_LIMITS.timeoutMs)
  ]);
  let jobId: string | undefined;
  try {
    signal.throwIfAborted();
    await input.beforeRequest();
    const limit = await checkPluginRateLimit(workspaceId, execution.addon.id);
    if (!limit.allowed) throw new Error('agent_addon_rate_limit');
    signal.throwIfAborted();
    const job = await db.transformJob.create({
      data: {
        workspaceId,
        graphId,
        addonId: execution.addon.id,
        transformId: execution.transformId,
        status: 'PENDING',
        inputEntity: JSON.stringify(execution.input),
        config: null,
        webhookUrl: ''
      },
      select: { id: true }
    });
    jobId = job.id;
    await input.beforeRequest();
    signal.throwIfAborted();
    const currentJob = await db.transformJob.findUnique({
      where: { id: jobId },
      select: { status: true }
    });
    if (currentJob?.status !== 'PENDING')
      throw new Error('agent_addon_job_already_settled');
    signal.throwIfAborted();
    const secret = decryptSecret(execution.addon.encryptedWebhookSecret);
    const body = JSON.stringify({
      transformId: execution.transformId,
      input: { entity: execution.input, config: {} }
    });
    // No callback URL or job ID leaves the server: a synchronous addon cannot
    // acquire an asynchronous completion channel from this adapter.
    const response = await safePublicFetch(execution.addon.endpoint, {
      method: 'POST',
      body,
      headers: createAddonRequestHeaders(body, workspaceId, secret),
      signal,
      timeoutMs: MODULE_LIMITS.timeoutMs,
      maxBytes: MODULE_LIMITS.maxResultBytes,
      allowLocalAddon: false,
      redirect: 'error',
      maxRedirects: 0
    });
    signal.throwIfAborted();
    if (!response.ok) throw new Error('agent_addon_failed');
    const parsed = AddonTransformResponseSchema.parse(await response.json());
    if (parsed.async) throw new Error('agent_addon_unexpected_async_response');
    assertNoPrivateConfiguration(parsed.result, execution, secret);
    const result = validateModuleResult(parsed.result, execution);
    await input.beforeRequest();
    signal.throwIfAborted();
    // Reuse the durable, idempotent terminal state transition.
    const claimed = await settleAddonJob(jobId, 'COMPLETED', {
      result: JSON.stringify(result.result)
    });
    if (!claimed) throw new Error('agent_addon_job_already_settled');
    signal.throwIfAborted();
    return result;
  } catch (error) {
    const code = signal.aborted
      ? 'agent_module_cancelled'
      : error instanceof Error && /^agent_[a-z_]+$/.test(error.message)
        ? error.message
        : 'agent_addon_failed';
    if (jobId)
      await settleAddonJob(jobId, signal.aborted ? 'CANCELLED' : 'FAILED', {
        error: code
      });
    throw new Error(code);
  }
}
