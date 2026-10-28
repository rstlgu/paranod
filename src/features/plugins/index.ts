/**
 * OSINT Plugin System
 * Export principale
 */

// Types
export type {
  EntityType,
  RelationshipType,
  PluginType,
  PluginRuntime,
  EstimatedTime,
  ConfigField,
  TransformDefinition,
  PluginDefinition,
  OSINTEntity,
  OSINTEdge,
  TransformInput,
  TransformResult,
  TransformRequest,
  TransformResponse,
  PluginExecutor,
  DNSRecord,
  GeoLocation,
  EmailValidation
} from './types';

// Registry
export {
  pluginRegistry,
  getAllPlugins,
  getPlugin,
  getPluginsForInputType,
  getTransformsForEntityType,
  matchesInputType,
  findTransform,
  dnsPlugin,
  emailPlugin,
  ipPlugin,
  urlPlugin,
  whoisPlugin,
  subdomainPlugin,
  blockchainPlugin
} from './registry';

// Executor
export { executeTransform, createTransformInput } from './executor';

// Hooks
export { useEnabledPlugins } from './hooks/use-enabled-plugins';
