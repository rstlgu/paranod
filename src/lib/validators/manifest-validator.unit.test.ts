import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddonManifest } from '@/types/addons';
import { ManifestValidator } from './manifest-validator';

function manifest(): AddonManifest {
  return {
    manifestVersion: '1.0',
    plugin: {
      id: 'test-plugin',
      name: 'Test Plugin',
      description: 'Manifest validation fixture',
      version: '1.0.0',
      author: 'Test Author',
      category: 'network',
      capabilities: {
        inputTypes: ['domain'],
        outputTypes: ['ip'],
        estimatedTime: 'seconds',
        supportsAsync: false
      },
      transforms: [
        {
          id: 'lookup',
          name: 'Lookup',
          description: 'Resolve a domain',
          inputType: 'domain',
          outputTypes: ['ip'],
          endpoint: 'https://addon.example/lookup',
          method: 'POST'
        }
      ],
      metadata: { minimumPlatformVersion: '2.0.0' }
    }
  };
}

function expectRejected(input: unknown, message: string) {
  const result = ManifestValidator.validate(input);
  expect(result.valid).toBe(false);
  expect(result.manifest).toBeUndefined();
  expect(result.errors?.join(' ')).toContain(message);
}

beforeEach(() => {
  vi.stubEnv('PARANOD_ALLOW_LOCAL_ADDONS', 'false');
  vi.stubEnv('PARANOD_ADDON_ALLOWED_HOSTS', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('addon manifest validation', () => {
  it('accepts the synchronous addon contract', () => {
    const input = manifest();
    const result = ManifestValidator.validate(input);
    expect(result.valid).toBe(true);
    expect(result.manifest?.plugin.transforms).toEqual(input.plugin.transforms);
  });

  it('rejects incomplete manifests with useful validation errors', () => {
    const result = ManifestValidator.validate({
      manifestVersion: '1.0',
      plugin: { id: 'test', name: 'Test' }
    });
    expect(result.valid).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
  });

  it('rejects cleartext public transform endpoints', () => {
    const input = manifest();
    input.plugin.transforms[0].endpoint = 'http://addon.example/lookup';
    expectRejected(input, 'HTTPS');
  });

  it('rejects invalid addon identifiers', () => {
    const input = manifest();
    input.plugin.id = 'Invalid_Plugin_ID';
    expectRejected(input, 'lowercase alphanumeric');
  });

  it('rejects malformed addon versions', () => {
    const input = manifest();
    input.plugin.version = 'v1.0';
    expectRejected(input, 'semver');
  });

  it.each(['5.0.0', 'not-a-version'])(
    'rejects unsupported platform requirement %s',
    (version) => {
      const input = manifest();
      input.plugin.metadata.minimumPlatformVersion = version;
      expectRejected(input, version);
    }
  );

  it('rejects ambiguous duplicate transform identifiers', () => {
    const input = manifest();
    input.plugin.transforms.push({ ...input.plugin.transforms[0] });
    expectRejected(input, 'Duplicate transform IDs');
  });

  it('rejects select configuration fields without options', () => {
    const input = manifest();
    input.plugin.configuration = {
      required: true,
      schema: { region: { type: 'select', label: 'Region', options: [] } }
    };
    expectRejected(input, 'has no options');
  });

  it('rejects inverted numeric configuration bounds', () => {
    const input = manifest();
    input.plugin.configuration = {
      required: true,
      schema: { count: { type: 'number', label: 'Count', min: 100, max: 10 } }
    };
    expectRejected(input, 'min > max');
  });

  it.each([true, false])(
    'requires async capability to match declarations (capability %s)',
    (supportsAsync) => {
      const input = manifest();
      input.plugin.capabilities.supportsAsync = supportsAsync;
      input.plugin.transforms[0].async = !supportsAsync;
      expectRejected(input, 'supportsAsync must match');
    }
  );

  it('preserves optional descriptive fields and synchronous/asynchronous transforms', () => {
    const input = manifest();
    Object.assign(input.plugin, {
      authorUrl: 'https://github.com/example',
      homepage: 'https://addon.example',
      documentation: 'https://addon.example/docs',
      license: 'MIT',
      icon: 'IconShield',
      logoUrl: 'https://addon.example/logo.png'
    });
    input.plugin.capabilities.supportsAsync = true;
    input.plugin.transforms.push({
      ...input.plugin.transforms[0],
      id: 'lookup-async',
      endpoint: 'https://addon.example/async',
      async: true
    });
    const result = ManifestValidator.validate(input);
    expect(result.valid).toBe(true);
    expect(result.manifest?.plugin).toMatchObject(input.plugin);
  });

  it('accepts older manifests but strips obsolete platform pricing and configuration fields', () => {
    const input = manifest();
    Object.assign(input.plugin.transforms[0], { premium: true, credits: 10 });
    Object.assign(input.plugin, { pricing: { type: 'paid' } });
    input.plugin.configuration = {
      required: true,
      schema: {
        apiKey: {
          type: 'string',
          label: 'API key',
          required: true,
          secret: true
        },
        maxResults: { type: 'number', label: 'Results', min: 1, max: 100 },
        region: {
          type: 'select',
          label: 'Region',
          options: [{ label: 'EU', value: 'eu' }]
        },
        cache: { type: 'boolean', label: 'Cache', default: true }
      }
    };
    const result = ManifestValidator.validate(input);
    expect(result.valid).toBe(true);
    expect(result.manifest?.plugin).not.toHaveProperty('pricing');
    expect(result.manifest?.plugin.configuration).toBeUndefined();
    expect(result.manifest?.plugin.transforms[0]).not.toHaveProperty('premium');
    expect(result.manifest?.plugin.transforms[0]).not.toHaveProperty('credits');
  });
});
