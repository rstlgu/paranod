import type { AddonManifest } from '@/types/addons';

/**
 * Strip server-only endpoint URLs before addon metadata reaches the browser.
 * Personalized addon URLs may contain installation credentials.
 */
export function sanitizeAddonManifestForClient(manifest: AddonManifest) {
  const { configuration: _configuration, ...plugin } = manifest.plugin;
  return {
    ...manifest,
    plugin: {
      ...plugin,
      logoUrl: undefined,
      transforms: plugin.transforms.map(
        ({ endpoint: _endpoint, ...transform }) => transform
      )
    }
  };
}
