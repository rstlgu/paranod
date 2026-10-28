import type { Prisma } from '@prisma/client';
import {
  getAllPlugins,
  getPlugin,
  matchesInputType
} from '@/features/plugins/registry';
import { parseStoredAddonManifest } from '@/features/plugins/addon-storage';
import type { TransformInput } from '@/features/plugins/types';
import { argumentsHash, publicText } from './policy';
import { isEntityType } from '@/features/osint/entity-types';
import { ManifestValidator } from '@/lib/validators/manifest-validator';
import {
  checkedModuleInput,
  moduleAvailability,
  MODULE_POLICY_VERSION,
  MODULE_LIMITS,
  planModule
} from './module-policy';
import { executeAgentModule, type ModuleExecution } from './module-execution';
import { addonAvailability, prepareAgentAddon } from './module-addon';

export interface ModuleScope {
  runId: string;
  graphId: string;
  userId: string;
  generation: number;
}

function limitations(transformId: string) {
  if (transformId === 'whatsmyname-search')
    return 'Only GitLab, Hacker News and Reddit. Matches are unverified candidates; failure is not absence.';
  if (transformId === 'email-validate')
    return 'MX records only; does not verify that a mailbox exists or accepts mail.';
  if (transformId === 'cidr-to-ips')
    return 'IPv4 blocks /26 through /32 only (maximum 64 addresses).';
  if (transformId === 'domain-to-root')
    return 'Heuristic root-domain parser; not a full public-suffix-list determination.';
  if (transformId.startsWith('social-'))
    return 'Local derivation only; does not verify account existence.';
  return null;
}

async function collectAgentModules(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  inputType: string
) {
  if (!isEntityType(inputType))
    throw new Error('agent_entity_type_not_supported');
  const settings = await tx.workspacePluginSetting.findMany({
    where: { workspaceId },
    select: { pluginId: true, enabled: true }
  });
  const disabled = new Set(
    settings
      .filter((setting) => !setting.enabled)
      .map((setting) => setting.pluginId)
  );
  const builtin = getAllPlugins()
    .filter((plugin) => plugin.enabled !== false && !disabled.has(plugin.id))
    .flatMap((plugin) =>
      plugin.transforms
        .filter((transform) => matchesInputType(inputType, transform.inputType))
        .map((transform) => {
          const availability = moduleAvailability(plugin, transform);
          return {
            moduleId: plugin.id,
            transformId: transform.id,
            name: publicText(transform.name, 200),
            inputType: transform.inputType,
            outputTypes: transform.outputTypes,
            executable: availability.kind !== null,
            requiresApproval:
              availability.kind !== null && availability.kind !== 'local',
            reason: availability.reason,
            limitations: limitations(transform.id)
          };
        })
    );
  const installed = await tx.workspaceAddonInstall.findMany({
    where: { workspaceId, enabled: true, uninstalledAt: null },
    orderBy: { addonId: 'asc' },
    take: 51,
    select: { addonId: true, manifestData: true }
  });
  const addons = installed.slice(0, 50).flatMap((addon) => {
    try {
      const validated = ManifestValidator.validate(
        parseStoredAddonManifest(addon.manifestData)
      );
      if (
        !validated.valid ||
        !validated.manifest ||
        validated.manifest.plugin.id !== addon.addonId
      )
        return [];
      const manifest = validated.manifest;
      return manifest.plugin.transforms
        .slice(0, 100)
        .filter((transform) => matchesInputType(inputType, transform.inputType))
        .map((transform) => ({
          moduleId: `addon:${addon.addonId}`,
          transformId: transform.id,
          // Publisher prose can contain private endpoints/credentials. Only
          // validated identifiers and known types enter the model's catalog.
          name: `Addon: ${transform.id}`,
          inputType,
          outputTypes: transform.outputTypes.slice(0, 20).filter(isEntityType),
          executable: addonAvailability(transform, inputType) === null,
          requiresApproval: true,
          reason: addonAvailability(transform, inputType),
          limitations:
            'Only free synchronous HTTPS execution. No callbacks, private result types, or model-provided configuration.'
        }));
    } catch {
      return [];
    }
  });
  const modules = [...builtin, ...addons];
  return {
    modules,
    truncated: installed.length > 50
  };
}

export async function listAgentModules(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  inputType: string
) {
  const result = await collectAgentModules(tx, workspaceId, inputType);
  return {
    modules: result.modules.slice(0, 200),
    truncated: result.truncated || result.modules.length > 200
  };
}

/** Model-facing discovery: a small index, not every tool's full description. */
export async function searchAgentModules(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  inputType: string,
  query = '',
  offset = 0
) {
  const catalog = await collectAgentModules(tx, workspaceId, inputType);
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const matched = catalog.modules
    .filter((entry) => {
      // Search reviewed builtin prose locally; never send publisher prose or
      // configuration to the model, including when a search has no matches.
      const description = entry.moduleId.startsWith('addon:')
        ? ''
        : (getPlugin(entry.moduleId)?.transforms.find(
            (t) => t.id === entry.transformId
          )?.description ?? '');
      const haystack =
        `${entry.moduleId} ${entry.transformId} ${entry.name} ${entry.outputTypes.join(' ')} ${description}`.toLocaleLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort(
      (a, b) =>
        Number(b.executable) - Number(a.executable) ||
        `${a.moduleId}/${a.transformId}`.localeCompare(
          `${b.moduleId}/${b.transformId}`
        )
    );
  const page = matched.slice(offset, offset + 20);
  return {
    inputType,
    query,
    total: matched.length,
    modules: page.map(
      ({ moduleId, transformId, name, outputTypes, executable }) => ({
        moduleId,
        transformId,
        name,
        outputTypes,
        executable
      })
    ),
    nextOffset:
      offset + page.length < matched.length ? offset + page.length : null,
    truncated: catalog.truncated,
    hint: 'Use describe_module for details of a selected transform. Search again or pass the returned nextOffset as offset for more matches.'
  };
}

export async function describeAgentModule(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  inputType: string,
  moduleId: string,
  transformId: string
) {
  const catalog = await collectAgentModules(tx, workspaceId, inputType);
  const entry = catalog.modules.find(
    (item) => item.moduleId === moduleId && item.transformId === transformId
  );
  if (!entry) throw new Error('agent_transform_unavailable');
  const description = moduleId.startsWith('addon:')
    ? 'Installed addon. Receives the selected node value and returns the listed entity types. Publisher configuration stays server-side.'
    : (getPlugin(moduleId)?.transforms.find((item) => item.id === transformId)
        ?.description ?? '');
  return { ...entry, description: publicText(description, 1200) };
}

export async function prepareAgentTransform(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  moduleId: string,
  transformId: string,
  input: TransformInput['entity'],
  scope?: ModuleScope
) {
  if (moduleId.startsWith('addon:'))
    return prepareAgentAddon(
      tx,
      workspaceId,
      moduleId,
      transformId,
      input,
      scope
    );
  const plugin = getPlugin(moduleId);
  const transform = plugin?.transforms.find(
    (entry) => entry.id === transformId
  );
  if (
    !plugin ||
    !transform ||
    !matchesInputType(input.type, transform.inputType)
  )
    throw new Error('agent_transform_unavailable');
  const availability = moduleAvailability(plugin, transform);
  if (!availability.kind) throw new Error(availability.reason!);
  const setting = await tx.workspacePluginSetting.findUnique({
    where: { workspaceId_pluginId: { workspaceId, pluginId: moduleId } },
    select: { enabled: true, updatedAt: true, config: true }
  });
  if (setting?.enabled === false) throw new Error('agent_module_disabled');
  const entity = checkedModuleInput(input, availability.kind !== 'local');
  let plan;
  try {
    plan = planModule(availability.kind, transformId, entity);
  } catch {
    plan = {
      kind: availability.kind,
      destination:
        availability.kind === 'local'
          ? 'Local processing'
          : availability.kind === 'dns'
            ? 'DNS resolvers configured on the server'
            : publicText(plugin.name, 80),
      requests: [],
      dnsServers: []
    };
  }
  const execution: ModuleExecution = {
    moduleId,
    transformId,
    input: entity,
    outputTypes: [...transform.outputTypes],
    plan
  };
  const permit = {
    fingerprint: argumentsHash({
      policyVersion: MODULE_POLICY_VERSION,
      limits: MODULE_LIMITS,
      workspaceId,
      scope: scope ?? null,
      moduleId,
      version: plugin.version,
      definition: transform,
      execution,
      settingsVersion: setting?.updatedAt.toISOString() ?? null,
      // Hash ciphertext in place; no decryption or secret loading for keyless adapters.
      configuration: setting?.config ?? null
    }),
    requiresApproval: availability.kind !== 'local',
    destination: plan.destination,
    summary: publicText(
      `${transform.name}: ${entity.value}. ${limitations(transformId) ?? ''}`
    )
  };
  return { permit, execution };
}

// Compatibility for existing internal callers of the two-parser API. These
// helpers intentionally cannot grow into a bypass for network approval.
const OFFLINE_TRANSFORMS = new Set([
  'email-parser/email-extract-domain',
  'url-parser/url-extract-domain'
]);
export async function describeOfflineTransform(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  moduleId: string,
  transformId: string,
  input: TransformInput['entity']
) {
  if (!OFFLINE_TRANSFORMS.has(`${moduleId}/${transformId}`))
    throw new Error('agent_transform_unavailable');
  return (
    await prepareAgentTransform(tx, workspaceId, moduleId, transformId, input)
  ).permit;
}

export async function executeOfflineTransform(
  moduleId: string,
  transformId: string,
  input: TransformInput['entity']
) {
  if (!OFFLINE_TRANSFORMS.has(`${moduleId}/${transformId}`))
    throw new Error('agent_transform_unavailable');
  const plugin = getPlugin(moduleId)!;
  const transform = plugin.transforms.find(
    (entry) => entry.id === transformId
  )!;
  const availability = moduleAvailability(plugin, transform);
  if (
    availability.kind !== 'local' ||
    !matchesInputType(input.type, transform.inputType)
  )
    throw new Error('agent_transform_unavailable');
  const entity = checkedModuleInput(input, false);
  const output = await executeAgentModule(
    {
      moduleId,
      transformId,
      input: entity,
      outputTypes: transform.outputTypes,
      plan: planModule('local', transformId, entity)
    },
    new AbortController().signal,
    async () => {}
  );
  return output.result;
}
