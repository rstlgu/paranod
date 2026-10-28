import dns from 'node:dns/promises';
import net from 'node:net';

export function localAddonsAllowed(): boolean {
  return allowedAddonHosts().size > 0;
}

function allowedAddonHosts() {
  return new Set(
    [
      ...(process.env.NODE_ENV === 'development' ||
      process.env.PARANOD_ALLOW_LOCAL_ADDONS === 'true'
        ? ['localhost', '127.0.0.1', '::1']
        : []),
      ...(process.env.PARANOD_ADDON_ALLOWED_HOSTS || '').split(','),
      ...(process.env.PARANOD_ALLOW_LOCAL_ADDONS === 'true'
        ? process.env.PARANOD_LOCAL_ADDON_HOSTS || ''
        : ''
      ).split(',')
    ]
      .map((host) =>
        host
          .trim()
          .toLowerCase()
          .replace(/^\[|\]$/g, '')
      )
      .filter(Boolean)
  );
}

export function isExplicitlyAllowedAddonHost(hostname: string) {
  return allowedAddonHosts().has(
    hostname.toLowerCase().replace(/^\[|\]$/g, '')
  );
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (net.isIP(ip) === 6) {
    const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    // Only native global unicast. Reject mapped IPv4, local, multicast,
    // documentation, Teredo and 6to4 rather than guessing their routing.
    return (
      !/^[23][0-9a-f]{3}:/i.test(normalized) ||
      /^2001:(?:db8|0|:)/i.test(normalized) ||
      /^2002:/i.test(normalized)
    );
  }
  return true;
}

export async function resolveSafeTarget(
  rawUrl: string,
  allowLocalAddon = false
) {
  const url = new URL(rawUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('Invalid HTTP(S) URL');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const local = allowLocalAddon && isExplicitlyAllowedAddonHost(host);
  if (!local && ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host)) {
    throw new Error('Local/loopback hosts are not allowed');
  }
  if (allowLocalAddon && url.protocol !== 'https:' && !local)
    throw new Error('Remote addon URLs must use HTTPS');
  const addresses = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await dns.lookup(host, { all: true });
  if (
    !addresses.length ||
    (!local && addresses.some((a) => isPrivateIp(a.address)))
  )
    throw new Error('Private/internal addresses are not allowed');
  return { url, address: addresses[0].address, family: addresses[0].family };
}

export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  return (await resolveSafeTarget(rawUrl, true)).url;
}

export async function resolvePublicUrl(rawUrl: string) {
  const target = await resolveSafeTarget(rawUrl, true);
  return {
    url: target.url,
    addresses: [{ address: target.address, family: target.family }]
  };
}

export async function checkPublicUrl(
  rawUrl: string
): Promise<{ ok: boolean; url?: URL; error?: string }> {
  try {
    return { ok: true, url: await assertPublicUrl(rawUrl) };
  } catch {
    return { ok: false, error: 'Unsafe or unresolvable addon URL' };
  }
}
