const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const createLoader = require('../scripts/test-support/load-typescript.cjs');

test('image hash uses decoded pixels, not the URL; EXIF ignores supplied GPS claims', async () => {
  const sharp = require('sharp');
  const pixels = Buffer.alloc(32 * 32 * 3);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++)
      for (let c = 0; c < 3; c++)
        pixels[(y * 32 + x) * 3 + c] = x < 16 ? 30 : 220;
  const a = await sharp(pixels, { raw: { width: 32, height: 32, channels: 3 } })
    .png()
    .toBuffer();
  const b = await sharp(pixels, { raw: { width: 32, height: 32, channels: 3 } })
    .flop()
    .png()
    .toBuffer();
  const load = createLoader({
    '@/lib/security/image-bytes': {
      loadImageBytes: async (url) => (url === 'different' ? b : a)
    },
    '@/lib/security/safe-fetch': {
      safePublicFetch: async () => {
        throw Error('Unexpected external request');
      }
    }
  });
  const { imagePluginExecutor } = load(
    'src/features/plugins/builtin/image-plugin.ts'
  );
  const input = (value) => ({
    entity: {
      id: 'in',
      type: 'media_url',
      value,
      metadata: { hasGps: true, latitude: 50, longitude: 10 }
    }
  });
  const hash1 = await imagePluginExecutor.execute(
    'image-hash',
    input('first-url')
  );
  const hash2 = await imagePluginExecutor.execute(
    'image-hash',
    input('second-url')
  );
  const hash3 = await imagePluginExecutor.execute(
    'image-hash',
    input('different')
  );
  assert.equal(hash1.success, true, hash1.error);
  assert.match(hash1.entities[0].value, /^[a-f0-9]{16}$/);
  assert.equal(hash1.entities[0].value, hash2.entities[0].value);
  assert.notEqual(hash1.entities[0].value, hash3.entities[0].value);
  const exif = await imagePluginExecutor.execute(
    'image-exif',
    input('first-url')
  );
  assert.equal(exif.success, true, exif.error);
  assert.equal(exif.entities[0].metadata.width, 32);
  assert.ok(!exif.entities.some((e) => e.type === 'location'));
});

test('OCR returns provider text and fails honestly without a key or on provider errors', async () => {
  let response = {
    responses: [{ textAnnotations: [{ description: 'Evidence text' }] }]
  };
  let calls = 0;
  const load = createLoader({
    '@/lib/security/image-bytes': {
      loadImageBytes: async () => Buffer.from('image-fixture')
    },
    '@/lib/security/safe-fetch': {
      safePublicFetch: async (url, init) => {
        calls++;
        assert.equal(url, 'https://vision.googleapis.com/v1/images:annotate');
        assert.equal(
          JSON.parse(init.body).requests[0].image.content,
          Buffer.from('image-fixture').toString('base64')
        );
        return Response.json(response);
      }
    }
  });
  const { imagePluginExecutor } = load(
    'src/features/plugins/builtin/image-plugin.ts'
  );
  const input = { entity: { id: 'in', type: 'media_url', value: 'image' } };
  assert.equal(
    (await imagePluginExecutor.execute('image-ocr', input)).success,
    false
  );
  assert.equal(calls, 0);
  const result = await imagePluginExecutor.execute('image-ocr', {
    ...input,
    config: { ocrApiKey: 'test-key' }
  });
  assert.equal(result.entities[0].value, 'Evidence text');
  response = { responses: [{ error: { code: 400 } }] };
  assert.equal(
    (
      await imagePluginExecutor.execute('image-ocr', {
        ...input,
        config: { ocrApiKey: 'test-key' }
      })
    ).success,
    false
  );
});

test('revoked workspace preference cannot authorize access', async () => {
  let member = null;
  const load = createLoader({
    '@/lib/auth-session': { auth: async () => ({ userId: 'user' }) },
    '@/lib/db': {
      db: {
        userPreference: {
          findUnique: async () => ({ activeWorkspaceId: 'workspace' })
        },
        workspaceMember: { findUnique: async () => member }
      }
    }
  });
  const { getActiveWorkspaceId } = load('src/lib/auth-utils.ts');
  assert.equal(await getActiveWorkspaceId(), null);
  member = { id: 'membership' };
  assert.equal(await getActiveWorkspaceId(), 'workspace');
});

test('transforms reject anonymous callers and disabled plugins before execution', async () => {
  let authorized = false, enabled = true;
  const load = createLoader({
    '@/lib/auth-utils': { getActiveWorkspaceAccess: async () => authorized ? { userId: 'u', workspaceId: 'w', role: 'admin' } : null },
    '@/lib/db': { db: { workspacePluginSetting: { findUnique: async () => ({ enabled }) } } },
    '@/features/graph/server/manual-transform-guard': { manualTransformGraphError: async () => null }
  });
  const { gateTransformRoute } = load('src/features/plugins/route-handler.ts');
  const request = () => new Request('http://localhost/api/transforms/dns', { method: 'POST', body: '{}' });
  assert.equal((await gateTransformRoute('dns-lookup', request())).status, 401);
  authorized = true; enabled = false;
  assert.equal((await gateTransformRoute('dns-lookup', request())).status, 403);
  enabled = true;
  assert.equal(await gateTransformRoute('dns-lookup', request()), null);
});

test('SSRF policy blocks private, mapped, unusual numeric IPs and mixed DNS answers', async () => {
  const load = createLoader({
    'node:dns/promises': {
      lookup: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 }
      ]
    }
  });
  const { isPrivateIp, resolveSafeTarget } = load('src/lib/security/ssrf.ts');
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    'fc00::1',
    '2002:7f00:1::'
  ])
    assert.equal(isPrivateIp(ip), true, ip);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('2606:4700:4700::1111'), false);
  for (const url of [
    'http://2130706433',
    'http://0x7f000001',
    'http://[::ffff:7f00:1]',
    'http://mixed.example',
    'file:///etc/hosts',
    'https://user:secret@example.com'
  ])
    await assert.rejects(resolveSafeTarget(url));
});

test('safe fetch pins validated DNS and blocks redirect into private network', async () => {
  let calls = 0,
    pinned;
  const load = createLoader({
    'node:dns/promises': {
      lookup: async () => [{ address: '8.8.8.8', family: 4 }]
    },
    undici: {
      Agent: class {
        constructor(options) {
          options.connect.lookup('example.com', {}, (_err, ip) => {
            pinned = ip;
          });
        }
        async close() {}
      },
      fetch: async () => {
        calls++;
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/private' }
        });
      }
    }
  });
  await assert.rejects(
    load('src/lib/security/safe-fetch.ts').safePublicFetch(
      'https://example.com'
    )
  );
  assert.equal(calls, 1);
  assert.equal(pinned, '8.8.8.8');
});

test('safe fetch caps response bodies and disallows addon redirects', async () => {
  const load = createLoader({
    './ssrf': {
      resolveSafeTarget: async (url) => ({
        url: new URL(url),
        address: '8.8.8.8',
        family: 4
      })
    },
    undici: {
      Agent: class {
        async close() {}
      },
      fetch: async () => new Response('12345')
    }
  });
  await assert.rejects(
    load('src/lib/security/safe-fetch.ts').safePublicFetch(
      'https://example.com',
      { maxBytes: 4 }
    ),
    /size limit/
  );
  const redirects = createLoader({
    './ssrf': {
      resolveSafeTarget: async (url) => ({
        url: new URL(url),
        address: '8.8.8.8',
        family: 4
      })
    },
    undici: {
      Agent: class {
        async close() {}
      },
      fetch: async () =>
        new Response(null, { status: 302, headers: { location: '/other' } })
    }
  });
  await assert.rejects(
    redirects('src/lib/security/safe-fetch.ts').safeAddonFetch(
      'https://example.com'
    ),
    /Redirects/
  );
});

test('HTML and SVG uploads are sandboxed attachments; filenames cannot inject headers', () => {
  const { fileDeliveryHeaders, privateFilePath } = createLoader()(
    'src/lib/security/file-delivery.ts'
  );
  for (const mime of ['text/html', 'image/svg+xml', 'application/xml']) {
    const headers = fileDeliveryHeaders(mime, 'a"\r\nInjected: yes.html');
    assert.equal(headers['Content-Type'], 'application/octet-stream');
    assert.match(headers['Content-Disposition'], /^attachment/);
    assert.ok(!headers['Content-Disposition'].includes('\r'));
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.match(headers['Content-Security-Policy'], /sandbox/);
  }
  assert.match(
    fileDeliveryHeaders('image/png', 'a.png')['Content-Disposition'],
    /^inline/
  );
  assert.throws(() => privateFilePath('workspace', '../secret'));
});

test('cron fails closed with absent, short or wrong secrets', () => {
  const previous = process.env.CRON_SECRET;
  const { isCronAuthorized } = createLoader()('src/lib/security/cron-auth.ts');
  try {
    delete process.env.CRON_SECRET;
    assert.equal(isCronAuthorized(new Request('http://localhost')), false);
    process.env.CRON_SECRET = 'short';
    assert.equal(
      isCronAuthorized(
        new Request('http://localhost', {
          headers: { authorization: 'Bearer short' }
        })
      ),
      false
    );
    process.env.CRON_SECRET = 'c'.repeat(32);
    assert.equal(
      isCronAuthorized(
        new Request('http://localhost', {
          headers: { authorization: 'Bearer ' + 'c'.repeat(32) }
        })
      ),
      true
    );
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test('bounded body rejects oversized payloads without trusting Content-Length', async () => {
  const { readBoundedBody } = createLoader()(
    'src/lib/security/bounded-body.ts'
  );
  await assert.rejects(
    readBoundedBody(
      new Request('http://localhost', { method: 'POST', body: '12345' }),
      4
    ),
    RangeError
  );
  assert.equal(
    await readBoundedBody(
      new Request('http://localhost', { method: 'POST', body: '1234' }),
      4
    ),
    '1234'
  );
});

test('terminal job state is claimed once under concurrent cancellation and timeout', async () => {
  let job = { id: 'j', status: 'PENDING' };
  let transitions = 0;
  const { settleAddonJob } = createLoader({
    '@/lib/db': { db: { transformJob: {
      updateMany: async ({ where, data }) => {
        assert.equal(where.id, job.id);
        if (!where.status.in.includes(job.status)) return { count: 0 };
        Object.assign(job, data);
        transitions++;
        return { count: 1 };
      }
    } } }
  })('src/lib/jobs/settle-job.ts');
  const results = await Promise.all([settleAddonJob('j', 'FAILED'), settleAddonJob('j', 'TIMEOUT')]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(transitions, 1);
  assert.equal(await settleAddonJob('j', 'COMPLETED'), false);
  assert.equal(job.status, 'FAILED');
  assert.ok(job.completedAt instanceof Date);
});

test('addon results reject malformed data and dangling or duplicated graph IDs', () => {
  const { parseAddonResult } = createLoader()(
    'src/lib/validators/addon-result.ts'
  );
  const good = {
    entities: [{ id: 'out', type: 'domain', value: 'example.com' }],
    edges: [{ id: 'edge', sourceId: 'in', targetId: 'out', label: 'related' }]
  };
  assert.equal(parseAddonResult(good, 'in').entities.length, 1);
  assert.throws(() =>
    parseAddonResult(
      { ...good, entities: [...good.entities, ...good.entities] },
      'in'
    )
  );
  assert.throws(() =>
    parseAddonResult(
      { ...good, edges: [{ ...good.edges[0], targetId: 'missing' }] },
      'in'
    )
  );
  assert.throws(() =>
    parseAddonResult({ ...good, success: false, error: 'failed' }, 'in')
  );
});

test('webhook is bound to the platform job and cannot replay onto another job', async () => {
  const secret = 's'.repeat(32);
  let terminalTransitions = 0;
  const events = new Map();
  const job = {
    status: 'PENDING',
    inputEntity: '{"id":"in"}',
    addon: { webhookSecret: secret }
  };
  const { POST } = createLoader({
    '@/lib/db': {
      db: {
        transformJob: { findUnique: async () => job },
        transformWebhookEvent: {
          findUnique: async ({ where }) => events.get(where.eventId)
        },
        $transaction: async (fn) =>
          fn({
            transformWebhookEvent: {
              create: async ({ data }) => events.set(data.eventId, data)
            },
            transformJob: {
              updateMany: async ({ where, data }) => {
                if (!where.status.in.includes(job.status)) return { count: 0 };
                Object.assign(job, data);
                terminalTransitions++;
                return { count: 1 };
              }
            }
          })
      }
    },
    '@/lib/security/secrets': { decryptSecret: (s) => s }
  })('src/app/api/webhooks/transforms/[jobId]/route.ts');
  async function request(platformJobId, timestamp = new Date().toISOString()) {
    const body = JSON.stringify({
      jobId: platformJobId,
      eventId: '12345678-1234-4123-8123-123456789abc',
      timestamp,
      status: 'failed',
      error: 'failed'
    });
    return POST(
      new Request('http://localhost', {
        method: 'POST',
        body,
        headers: {
          'X-Plugin-Signature':
            'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
        }
      }),
      { params: Promise.resolve({ jobId: 'target' }) }
    );
  }
  assert.equal((await request('other')).status, 400);
  assert.equal(terminalTransitions, 0);
  assert.equal((await request('target')).status, 200);
  assert.equal(terminalTransitions, 1);
  assert.equal((await request('target')).status, 200);
  assert.equal(terminalTransitions, 1);
  assert.equal(
    (await request('target', '2000-01-01T00:00:00.000Z')).status,
    401
  );
  events.set('12345678-1234-4123-8123-123456789abc', { jobId: 'other' });
  assert.equal((await request('target')).status, 409);
});



test('an early async callback cannot be regressed by the HTTP acknowledgement', async () => {
  const job = { id: 'early-job', status: 'PENDING' };
  const { AddonExecutor } = createLoader({
    '@/lib/db': {
      db: {
        workspaceMember: { findUnique: async () => ({ id: 'member' }) },
        graph: { findFirst: async () => ({ id: 'graph' }) },
        workspaceAddonInstall: {
          findUnique: async () => ({
            enabled: true,
            webhookSecret: 'test',
            manifestData: '{}'
          })
        },
        transformJob: {
          create: async () => job,
          update: async () => job,
          updateMany: async ({ where, data }) => {
            if (where.status !== job.status) return { count: 0 };
            Object.assign(job, data);
            return { count: 1 };
          }
        }
      }
    },
    './addon-storage': {
      parseStoredAddonManifest: () => ({
        plugin: {
          transforms: [
            {
              id: 'scan',
              async: true,
              inputType: 'domain',
              endpoint: 'https://addon.example/scan'
            }
          ]
        }
      })
    },
    './registry': { matchesInputType: () => true },
    '@/lib/url': { buildAppUrl: (path) => 'https://platform.example' + path },
    '@/lib/security/secrets': { decryptSecret: (value) => value },
    '@/lib/middleware/rate-limit': {
      checkPluginRateLimit: async () => ({ allowed: true })
    },
    '@/lib/security/safe-fetch': {
      safeFetch: async () => {
        job.status = 'COMPLETED';
        return {
          ok: true,
          json: async () => ({ async: true, jobId: 'sdk-job' })
        };
      }
    }
  })('src/features/plugins/addon-executor.ts');
  const result = await AddonExecutor.executeTransform(
    'workspace',
    'addon',
    'scan',
    { id: 'in', type: 'domain', value: 'example.com' },
    'graph',
    {},
    'user'
  );
  assert.equal(result.success, true);
  assert.equal(result.jobId, 'early-job');
  assert.equal(job.status, 'COMPLETED');
});



test('entrypoint generates an independent encryption key and reuses it after auth-key rotation', () => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const state = fs.mkdtempSync(
    path.join(os.tmpdir(), 'paranod-key-migration-')
  );
  try {
    const bootstrap = fs
      .readFileSync(path.join(__dirname, '../docker/entrypoint.sh'), 'utf8')
      .split('echo "[paranod] Waiting for DB..."')[0];
    const env = {
      ...process.env,
      AUTH_STATE_DIR: state,
      BETTER_AUTH_SECRET: 'legacy-test-auth-key',
      SECRETS_ENCRYPTION_KEY: '',
      CRON_SECRET: 'test-cron',
      TEMP_FILE_ENCRYPTION_KEY: 'test-file-key'
    };
    execFileSync('sh', ['-c', bootstrap], { env });
    const keyPath = path.join(state, 'secrets-encryption-key');
    const persisted = fs.readFileSync(keyPath, 'utf8');
    assert.notEqual(persisted.trim(), 'legacy-test-auth-key');
    assert.equal(Buffer.from(persisted.trim(), 'base64').length, 32);
    assert.equal(fs.statSync(keyPath).mode & 0o777, 0o600);
    execFileSync('sh', ['-c', bootstrap], {
      env: { ...env, BETTER_AUTH_SECRET: 'rotated-auth-key' }
    });
    assert.equal(fs.readFileSync(keyPath, 'utf8'), persisted);
  } finally {
    fs.rmSync(state, { recursive: true });
  }
});
