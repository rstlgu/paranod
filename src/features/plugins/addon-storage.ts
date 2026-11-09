import { decryptSecret, encryptSecret } from '@/lib/security/secrets';
import type { AddonManifest } from '@/types/addons';

export function serializeStoredAddonManifest(manifest: AddonManifest): string {
  return encryptSecret(JSON.stringify(manifest));
}

export function parseStoredAddonManifest(value: string): AddonManifest {
  return JSON.parse(decryptSecret(value)) as AddonManifest;
}
