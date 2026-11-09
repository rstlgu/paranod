import { Agent, fetch as undiciFetch } from 'undici';
import { resolveSafeTarget } from './ssrf';

type SafeFetchInit = RequestInit & {
  timeoutMs?: number;
  maxBytes?: number;
  allowLocalAddon?: boolean;
  maxRedirects?: number;
};

/** DNS is pinned to the address checked by the policy. Timeout includes body IO. */
export async function safePublicFetch(
  rawUrl: string,
  init: SafeFetchInit = {}
): Promise<Response> {
  const timeout = AbortSignal.timeout(init.timeoutMs ?? 20000);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  let current = rawUrl;
  const headers = new Headers(init.headers);
  for (let redirects = 0; redirects <= (init.maxRedirects ?? 3); redirects++) {
    const target = await Promise.race([
      resolveSafeTarget(current, init.allowLocalAddon),
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error('Request timed out'));
        else
          signal.addEventListener(
            'abort',
            () => reject(new Error('Request timed out')),
            { once: true }
          );
      })
    ]);
    const dispatcher = new Agent({
      connect: {
        lookup: (_host, options, callback) => {
          if (options.all)
            callback(null, [
              { address: target.address, family: target.family }
            ]);
          else callback(null, target.address, target.family);
        }
      }
    });
    try {
      const response = await undiciFetch(target.url, {
        method: init.method,
        headers: Object.fromEntries(headers.entries()),
        body: init.body as string | undefined,
        signal,
        redirect: 'manual',
        dispatcher
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        if (
          init.redirect === 'error' ||
          !['GET', 'HEAD'].includes(init.method || 'GET')
        )
          throw new Error('Redirects are not allowed');
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect without location');
        const next = new URL(location, target.url);
        if (next.origin !== target.url.origin) {
          headers.delete('authorization');
          headers.delete('cookie');
        }
        current = next.toString();
        continue;
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (reader) {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > (init.maxBytes ?? 3_000_000)) {
              await reader.cancel();
              throw new Error('Response exceeds size limit');
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      const outHeaders = new Headers(
        Object.fromEntries(response.headers.entries())
      );
      outHeaders.delete('content-encoding');
      outHeaders.delete('content-length');
      const body =
        init.method === 'HEAD' || [204, 205, 304].includes(response.status)
          ? null
          : new Uint8Array(Buffer.concat(chunks));
      const result = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: outHeaders
      });
      Object.defineProperty(result, 'url', { value: target.url.toString() });
      return result;
    } finally {
      await dispatcher.close();
    }
  }
  throw new Error('Too many redirects');
}

export function safeAddonFetch(url: string, init: SafeFetchInit = {}) {
  return safePublicFetch(url, {
    ...init,
    allowLocalAddon: true,
    redirect: 'error',
    maxBytes: init.maxBytes ?? 1_000_000
  });
}

/** Compatibility API for the signed addon protocol, backed by the same pinned,
 * bounded transport used by media and builtin transforms. */
export async function safeFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
    timeoutMs?: number;
    maxResponseBytes?: number;
    maxRedirects?: number;
  } = {}
) {
  const response = await safePublicFetch(url, {
    ...options,
    body: options.body as BodyInit | undefined,
    allowLocalAddon: true,
    maxBytes: options.maxResponseBytes ?? 1024 * 1024,
    maxRedirects: options.maxRedirects ?? 0,
    redirect: options.maxRedirects ? 'follow' : 'error'
  });
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    url: response.url,
    text: () => response.text(),
    json: async <T = unknown>(): Promise<T> => response.json() as Promise<T>
  };
}
