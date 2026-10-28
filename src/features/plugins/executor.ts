/**
 * Plugin Executor
 * Gestisce l'esecuzione delle transform
 */

import type {
  TransformInput,
  TransformProgress,
  TransformResult,
  TransformResponse
} from './types';
import { findTransform } from './registry';
import { buildAppUrl } from '@/lib/url';
import { graphClientCoordinator } from '@/features/graph/lib/graph-client-coordinator';

/**
 * Mappa plugin ID → endpoint API
 */
const pluginEndpoints: Record<string, string> = {
  'email-headers': '/api/transforms/email-headers',
  'hash-evidence': '/api/transforms/hash-evidence',
  'dns-lookup': '/api/transforms/dns',
  'email-parser': '/api/transforms/email',
  'ip-geolocation': '/api/transforms/ip',
  'url-parser': '/api/transforms/url',
  'whois-lookup': '/api/transforms/whois',
  'subdomain-finder': '/api/transforms/subdomain',
  blockchain: '/api/transforms/blockchain',
  blockcypher: '/api/transforms/blockcypher',
  'image-analysis': '/api/transforms/image',
  'video-analysis': '/api/transforms/video',
  'location-intelligence': '/api/transforms/location',
  'note-analysis': '/api/transforms/note',
  'social-media': '/api/transforms/social',
  hudsonrock: '/api/transforms/hudsonrock',
  'breach-vip': '/api/transforms/breach-vip',
  hibp: '/api/transforms/hibp',
  'osint-industries': '/api/transforms/osint-industries',
  etherscan: '/api/transforms/etherscan',
  'whois-history': '/api/transforms/whois-history',
  'disposable-email': '/api/transforms/disposable-email',
  whatsmyname: '/api/transforms/whatsmyname',
  emailrep: '/api/transforms/emailrep',
  breachdirectory: '/api/transforms/breachdirectory'
};

/**
 * Esegue una transform chiamando l'API appropriata
 * Gestisce sia plugin builtin che plugin esterni
 */
export interface ExecuteTransformOptions {
  /** Live updates from transforms that stream their progress. */
  onProgress?: (update: TransformProgress) => void;
}

export async function executeTransform(
  pluginId: string,
  transformId: string,
  input: TransformInput,
  graphId?: string,
  options: ExecuteTransformOptions = {}
): Promise<TransformResult> {
  if (typeof window === 'undefined')
    return executeTransformRequest(
      pluginId,
      transformId,
      input,
      graphId,
      options
    );
  let job: ReturnType<typeof graphClientCoordinator.beginManual>;
  try {
    job = graphClientCoordinator.beginManual(graphId);
  } catch {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Graph is read-only',
      denied: true
    };
  }
  let asyncJob = false;
  try {
    const result = await executeTransformRequest(
      pluginId,
      transformId,
      input,
      graphId,
      options
    );
    if (result.async && result.jobId) {
      asyncJob = true;
      // Keep tracking the server job even if its node, log, or panel is closed.
      const monitor = async () => {
        try {
          const response = await fetch(
            `/api/jobs/${encodeURIComponent(result.jobId!)}`,
            { cache: 'no-store' }
          );
          const state = response.ok ? await response.json() : null;
          if (state?.isCompleted || state?.isFailed) {
            job.finish();
            return;
          }
        } catch {
          /* An unknown job state must continue blocking starts. */
        }
        setTimeout(() => void monitor(), 5000);
      };
      void monitor();
    }
    if (!job.current())
      return {
        success: false,
        entities: [],
        edges: [],
        error: 'Graph snapshot changed',
        denied: true
      };
    return result;
  } finally {
    if (!asyncJob) job.finish();
  }
}

async function executeTransformRequest(
  pluginId: string,
  transformId: string,
  input: TransformInput,
  graphId?: string,
  options: ExecuteTransformOptions = {}
): Promise<TransformResult> {
  // Esecuzione client-side per alcuni plugin: le chiamate partono dal browser dell'utente
  // (utile per API pubbliche e per evitare proxy lato server).
  if (
    (pluginId === 'blockchain' || pluginId === 'blockcypher') &&
    typeof window !== 'undefined'
  ) {
    try {
      const mod = await import('@/features/plugins/builtin/blockchain-plugin');
      if (pluginId === 'blockchain')
        return await mod.blockchainComPluginExecutor.execute(
          transformId,
          input
        );
      return await mod.blockcypherPluginExecutor.execute(transformId, input);
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'Client execution error';
      return { success: false, entities: [], edges: [], error: errorMsg };
    }
  }

  // Verifica che il plugin e la transform esistano
  const found = findTransform(pluginId, transformId);

  // Se non trovato nel registry builtin, potrebbe essere un addon
  if (!found) {
    // Try addon execution
    console.log(
      `🔍 Transform not found in builtin registry, trying addon: ${pluginId}/${transformId}`
    );

    try {
      const apiUrl = buildAppUrl(`/api/addons/${pluginId}/execute`);
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          transformId,
          input,
          graphId
        })
      });

      const responseData = await response.json().catch(() => ({}));

      console.log(
        '📦 External plugin API response:',
        JSON.stringify(responseData, null, 2)
      );

      if (!response.ok) {
        const errorMsg = responseData.error || `API error: ${response.status}`;
        return {
          success: false,
          entities: [],
          edges: [],
          error: errorMsg
        };
      }

      // External plugins now return the same format as builtin: { success, data, status }
      if (responseData.success && responseData.data) {
        console.log('✅ Returning responseData.data:', {
          success: responseData.data.success,
          entitiesCount: responseData.data.entities?.length || 0,
          edgesCount: responseData.data.edges?.length || 0
        });
        return responseData.data;
      }

      // Fallback to direct response if format is different
      console.log('⚠️ Using fallback - returning responseData directly');
      return responseData;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Network error';
      return {
        success: false,
        entities: [],
        edges: [],
        error: `Transform not found: ${pluginId}/${transformId} - ${errorMsg}`
      };
    }
  }

  // Container tools execute through the local Docker runner and an authenticated route.
  if (found.plugin.type === 'container-tool') {
    try {
      const apiUrl = buildAppUrl(`/api/container-tools/${pluginId}/execute`);
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, graphId })
      });
      const responseData = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          success: false,
          entities: [],
          edges: [],
          error: responseData.error || `Tool error: ${response.status}`
        };
      }
      return responseData.data ?? responseData;
    } catch (error) {
      return {
        success: false,
        entities: [],
        edges: [],
        error: error instanceof Error ? error.message : 'Container tool error'
      };
    }
  }

  // Trova l'endpoint API per builtin plugins
  const endpoint = pluginEndpoints[pluginId];
  if (!endpoint) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: `No API endpoint for plugin: ${pluginId}`
    };
  }

  try {
    const apiUrl = buildAppUrl(endpoint);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Routes that can stream progress answer in NDJSON; the rest in JSON.
        ...(options.onProgress
          ? { Accept: 'application/x-ndjson, application/json' }
          : {})
      },
      body: JSON.stringify({
        transformId,
        input,
        graphId
      })
    });

    const responseData = response.headers
      .get('content-type')
      ?.includes('application/x-ndjson')
      ? await readTransformStream(response, options.onProgress)
      : await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = responseData.error || `API error: ${response.status}`;
      return {
        success: false,
        entities: [],
        edges: [],
        error: errorMsg
      };
    }

    const result: TransformResponse = responseData;

    if (!result.success || !result.data) {
      const errorMsg = result.error || result.data?.error || 'Transform failed';
      return {
        success: false,
        entities: [],
        edges: [],
        error: errorMsg
      };
    }

    return result.data;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Network error';
    return {
      success: false,
      entities: [],
      edges: [],
      error: errorMsg
    };
  }
}

/**
 * Reads an NDJSON transform stream: progress lines, then one result line.
 */
export async function readTransformStream(
  response: Response,
  onProgress?: (update: TransformProgress) => void
): Promise<TransformResponse> {
  const missing: TransformResponse = {
    success: false,
    error: 'The transform stream ended without a result'
  };
  const reader = response.body?.getReader();
  if (!reader) return missing;
  const decoder = new TextDecoder();
  let buffer = '';
  let final: TransformResponse | null = null;
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let event: {
      type?: unknown;
      message?: unknown;
      progress?: unknown;
      response?: unknown;
    };
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === 'progress' && typeof event.message === 'string') {
      onProgress?.({
        message: event.message,
        progress:
          typeof event.progress === 'number' ? event.progress : undefined
      });
    } else if (event.type === 'result' && event.response) {
      final = event.response as TransformResponse;
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(handleLine);
    }
    handleLine(buffer + decoder.decode());
  } catch {
    return { success: false, error: 'The transform stream was interrupted' };
  }
  return final ?? missing;
}

/**
 * Helper per creare l'input della transform
 */
export function createTransformInput(
  entityId: string,
  entityType: string,
  entityValue: string,
  metadata?: Record<string, unknown>,
  config?: Record<string, unknown>
): TransformInput {
  return {
    entity: {
      id: entityId,
      type: entityType as TransformInput['entity']['type'],
      value: entityValue,
      metadata
    },
    config
  };
}
