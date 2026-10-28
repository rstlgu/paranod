const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const createLoader = require('../scripts/test-support/load-typescript.cjs');
const load = createLoader();
const { emailHeadersPluginExecutor: headers } = load(
  'src/features/plugins/builtin/email-headers-plugin.ts'
);
const { hashEvidencePluginExecutor: hashes } = load(
  'src/features/plugins/builtin/hash-evidence-plugin.ts'
);
const registry = load('src/features/plugins/registry.ts');
const input = (type, value, metadata) => ({
  entity: { id: 'source', type, value, metadata }
});

test('header parsing bounds malformed address and bracket candidates', async () => {
  const result = await headers.execute(
    'email-headers-extract',
    input('note', `From: ${'a'.repeat(60000)}\nReceived: ${'['.repeat(60000)}`)
  );
  assert.equal(result.success, true);
  assert.equal(result.entities.length, 1);
});

function assertGraph(result) {
  assert.equal(result.success, true, result.error);
  const ids = new Set(['source', ...result.entities.map((e) => e.id)]);
  assert.equal(ids.size, result.entities.length + 1);
  for (const edge of result.edges) {
    assert.ok(ids.has(edge.sourceId));
    assert.ok(ids.has(edge.targetId));
  }
  assert.ok(result.entities.every((e) => e.verified !== true));
}

test('headers unfold continuations, deduplicate addresses and ignore the body', async () => {
  const result = await headers.execute(
    'email-headers-extract',
    input(
      'note',
      [
        'From: Analyst <analyst@EXAMPLE.COM>',
        'To: analyst@example.com',
        'Received: from mail.example.com ([203.0.113.9])',
        '\tby gateway.example.org; Tue, 08 Sep 2026 10:00:00 +0000',
        'Received: from [IPv6:2001:db8::1]',
        'Authentication-Results: gateway.example.org; spf=pass;',
        ' dkim=fail; dmarc=fail',
        '',
        'From: hidden@example.net'
      ].join('\r\n')
    )
  );
  assertGraph(result);
  assert.equal(result.entities.filter((e) => e.type === 'email').length, 1);
  assert.deepEqual(
    result.entities.find((e) => e.type === 'email').metadata.headerFields,
    ['from', 'to']
  );
  assert.deepEqual(
    result.entities.filter((e) => e.type === 'ip').map((e) => e.value),
    ['203.0.113.9', '2001:db8::1']
  );
  assert.ok(!result.entities.some((e) => e.value === 'hidden@example.net'));
  const summary = result.entities.find((e) => e.type === 'note');
  assert.match(summary.value, /dkim=fail; dmarc=fail/);
  assert.match(summary.value, /not independently verified/);
});

test('headers reject malformed text, orphan continuations and excessive input', async () => {
  for (const text of [
    'not headers',
    ' continuation',
    'From: x\ninvalid',
    'x'.repeat(131073),
    'From: x\n'.repeat(501)
  ]) {
    assert.equal(
      (await headers.execute('email-headers-extract', input('note', text)))
        .success,
      false
    );
  }
  assert.equal(
    (await headers.execute('bad-id', input('note', 'From: x'))).success,
    false
  );
  assert.equal(
    (await headers.execute('email-headers-extract', input('email', 'From: x')))
      .success,
    false
  );
});

test('headers validate IPs and cap graph expansion', async () => {
  const addresses = Array.from(
    { length: 300 },
    (_, i) => `person${i}@example.com`
  ).join(', ');
  const result = await headers.execute(
    'email-headers-extract',
    input('note', `To: ${addresses}\nReceived: [999.999.1.1]\n`)
  );
  assertGraph(result);
  assert.equal(result.entities.length, 201);
  assert.equal(
    result.entities.find((e) => e.type === 'note').metadata.truncated,
    true
  );
  assert.ok(!result.entities.some((e) => e.type === 'ip'));
});

test('SHA-256 uses exact UTF-8 content, including whitespace and line endings', async () => {
  const result = await hashes.execute('evidence-sha256', input('note', 'abc'));
  assertGraph(result);
  assert.equal(
    result.entities[0].value,
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  const metadataResult = await hashes.execute(
    'evidence-sha256',
    input('note', 'Title', { content: 'abc' })
  );
  assert.equal(metadataResult.entities[0].value, result.entities[0].value);
  const crlf = await hashes.execute(
    'evidence-sha256',
    input('note', 'abc\r\n')
  );
  const lf = await hashes.execute('evidence-sha256', input('note', 'abc\n'));
  assert.notEqual(crlf.entities[0].value, lf.entities[0].value);
  const unicode = await hashes.execute('evidence-sha256', input('note', 'è'));
  assert.equal(unicode.entities[0].metadata.byteLength, 2);
});

test('hash identification reports ambiguity and rejects unsupported digests', async () => {
  const result = await hashes.execute(
    'hash-identify',
    input('hash', 'A'.repeat(32))
  );
  assertGraph(result);
  assert.ok(result.entities[0].metadata.candidateAlgorithms.includes('MD5'));
  assert.ok(result.entities[0].metadata.candidateAlgorithms.length > 1);
  for (const digest of ['', 'xyz', 'a'.repeat(33), 'ph_example']) {
    assert.equal(
      (await hashes.execute('hash-identify', input('hash', digest))).success,
      false
    );
  }
  assert.equal(
    (await hashes.execute('evidence-sha256', input('note', 'è'.repeat(70000))))
      .success,
    false
  );
  assert.equal(
    (await hashes.execute('evidence-sha256', input('hash', 'abc'))).success,
    false
  );
});

test('new transforms are discoverable in the graph and respect enabled IDs', () => {
  const transforms = registry.getTransformsForEntityType('note', [
    'email-headers',
    'hash-evidence'
  ]);
  assert.deepEqual(transforms.map((t) => t.transform.id).sort(), [
    'email-headers-extract',
    'evidence-sha256'
  ]);
  assert.equal(registry.getTransformsForEntityType('note', []).length, 0);
  assert.equal(
    registry.getTransformsForEntityType('hash', ['hash-evidence'])[0].transform
      .id,
    'hash-identify'
  );
});

test('existing DNS transforms produce graph entities from resolver fixtures', async () => {
  const mocked = createLoader({
    dns: {
      promises: {
        resolve4: async () => ['203.0.113.9'],
        resolveMx: async () => [{ exchange: 'mx.example.com', priority: 10 }],
        resolveNs: async () => ['ns.example.com'],
        resolveTxt: async () => [['v=spf1 ', '-all']],
        resolve6: async () => ['2001:db8::1'],
        resolveCname: async () => ['alias.example.com'],
        resolveSoa: async () => ({
          nsname: 'ns.example.com',
          hostmaster: 'hostmaster.example.com',
          serial: 1,
          refresh: 1,
          retry: 1,
          expire: 1,
          minttl: 1
        }),
        resolveCaa: async () => [{ critical: 0, issue: 'example.org' }]
      }
    }
  });
  const { dnsPluginExecutor } = mocked(
    'src/features/plugins/builtin/dns-plugin.ts'
  );
  for (const transform of registry.getPlugin('dns-lookup').transforms) {
    const result = await dnsPluginExecutor.execute(
      transform.id,
      input('domain', 'example.com')
    );
    assert.equal(result.success, true, transform.id);
    assert.ok(result.entities.length > 0, transform.id);
    const ids = new Set(result.entities.map((e) => e.id));
    assert.ok(
      result.edges.every((e) => e.sourceId === 'source' && ids.has(e.targetId))
    );
  }
});

test('existing email and disposable transforms work with synthetic local inputs', async () => {
  const { emailPluginExecutor } = load(
    'src/features/plugins/builtin/email-plugin.ts'
  );
  const email = await emailPluginExecutor.execute(
    'email-extract-domain',
    input('email', 'analyst@example.com')
  );
  assert.equal(email.success, true);
  assert.equal(email.entities[0].value, 'example.com');
  const { disposableEmailPluginExecutor } = load(
    'src/features/plugins/builtin/disposable-email-plugin.ts'
  );
  const disposable = await disposableEmailPluginExecutor.execute(
    'disposable-check-domain',
    input('domain', 'mailinator.com')
  );
  assert.equal(disposable.metadata.disposable, true);
  const ordinary = await disposableEmailPluginExecutor.execute(
    'disposable-check-domain',
    input('domain', 'example.com')
  );
  assert.equal(ordinary.metadata.disposable, false);
});

test('existing container parsers map synthetic CLI output to graph entities', () => {
  const { getContainerTool } = load('src/features/container-tools/registry.ts');
  for (const toolId of ['sherlock', 'maigret']) {
    const result = getContainerTool(toolId).parseOutput({
      input: input('username', 'synthetic-audit'),
      exitCode: 0,
      output: '[+] GitHub: https://github.com/synthetic-audit\n'
    });
    assert.equal(result.success, true, toolId);
    assert.ok(
      result.entities.some(
        (e) => e.value === 'https://github.com/synthetic-audit'
      ),
      toolId
    );
  }
  const result = getContainerTool('holehe').parseOutput({
    input: input('email', 'synthetic@example.com'),
    exitCode: 0,
    output: '[+] example.org\n'
  });
  assert.equal(result.success, true);
  assert.equal(result.entities[0].value, 'https://example.org');
});

test('every builtin plugin has a client endpoint and an existing API route', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/features/plugins/executor.ts'),
    'utf8'
  );
  for (const plugin of registry
    .getAllPlugins()
    .filter((p) => p.type === 'builtin-js')) {
    const entry = new RegExp(
      `(?:'${plugin.id}'|\\b${plugin.id}):\\s*'([^']+)'`
    ).exec(source);
    assert.ok(entry, `Missing client endpoint: ${plugin.id}`);
    assert.ok(
      fs.existsSync(path.join(__dirname, '../src/app', entry[1], 'route.ts')),
      plugin.id
    );
    assert.equal(
      new Set(plugin.transforms.map((t) => t.id)).size,
      plugin.transforms.length,
      plugin.id
    );
  }
});

function routeFixture({ authorized = true, enabled = true } = {}) {
  const mocked = createLoader({
    '@/app/api/cases/_utils': {
      requireActiveWorkspaceMember: async () =>
        authorized
          ? {
              ok: true,
              ctx: {
                userId: 'audit-user',
                workspaceId: 'audit-workspace',
                role: 'user'
              }
            }
          : { ok: false, status: 401, error: 'Unauthorized' }
    },
    '@/lib/db': {
      db: { workspacePluginSetting: { findUnique: async () => ({ enabled }) } }
    }
  });
  return mocked('src/app/api/transforms/hash-evidence/route.ts').POST;
}

const request = (body) =>
  new Request('http://localhost/api/transforms/hash-evidence', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });

test('graph/flow dispatcher reaches the new API and returns its graph result', async (t) => {
  const post = routeFixture();
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'http://localhost/api/transforms/hash-evidence');
    return post(new Request(url, init));
  });
  const clientLoad = createLoader({
    '@/lib/url': { buildAppUrl: (pathname) => `http://localhost${pathname}` }
  });
  const { executeTransform } = clientLoad('src/features/plugins/executor.ts');
  const result = await executeTransform(
    'hash-evidence',
    'evidence-sha256',
    input('note', 'abc')
  );
  assertGraph(result);
  assert.equal(
    result.entities[0].value,
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});

test('new API refuses anonymous users and disabled plugins', async () => {
  assert.equal(
    (await routeFixture({ authorized: false })(request('{}'))).status,
    401
  );
  assert.equal(
    (await routeFixture({ enabled: false })(request('{}'))).status,
    403
  );
});

test('new API validates JSON, transform, type and body limits', async () => {
  const post = routeFixture();
  for (const body of [
    '{',
    {},
    { transformId: 'wrong', input: input('note', 'abc') },
    { transformId: 'evidence-sha256', input: input('hash', 'abc') }
  ]) {
    assert.equal((await post(request(body))).status, 400);
  }
  assert.equal((await post(request('a'.repeat(256 * 1024 + 1)))).status, 413);
  const res = await post(
    request({ transformId: 'evidence-sha256', input: input('note', 'abc') })
  );
  assert.equal(res.status, 200);
  assertGraph((await res.json()).data);
});
