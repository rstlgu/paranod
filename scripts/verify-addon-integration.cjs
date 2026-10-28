// Run after building the SDK: node scripts/verify-addon-integration.cjs /path/to/plugin-sdk/dist
// Real HTTP/signatures; only persistence is isolated in memory.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const createLoader = require('./test-support/load-typescript.cjs');

async function main() {
  if (!process.argv[2]) throw new Error('Provide the built SDK dist directory');
  const { ParanodPlugin, ExpressServer, JobProgressTracker } = require(
    path.resolve(process.argv[2])
  );
  const servers = [];
  const listen = async (handler) => {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  };
  let secret,
    terminalTransitions = 0;
  const job = {
    id: 'platform-job',
    status: 'PENDING',
    inputEntity: '{"id":"input"}'
  };
  const events = new Map(),
    callbacks = [];
  const load = createLoader({
    '@/lib/db': {
      db: {
        transformJob: {
          findUnique: async () => ({ ...job, addon: { webhookSecret: secret } })
        },
        transformWebhookEvent: {
          findUnique: async ({ where }) => events.get(where.eventId)
        },
        $transaction: async (fn) => {
          let staged;
          await fn({
            transformWebhookEvent: {
              create: async ({ data }) => {
                if (events.has(data.eventId))
                  throw Object.assign(new Error('duplicate'), {
                    code: 'P2002'
                  });
                staged = data;
              }
            },
            transformJob: {
              updateMany: async ({ where, data }) => {
                if (!where.status.in.includes(job.status)) return { count: 0 };
                Object.assign(job, data);
                terminalTransitions++;
                return { count: 1 };
              }
            }
          });
          if (staged) events.set(staged.eventId, staged);
        }
      }
    },
    '@/lib/security/secrets': { decryptSecret: (value) => value }
  });
  const { POST } = load('src/app/api/webhooks/transforms/[jobId]/route.ts');
  const { createAddonRequestHeaders } = load(
    'src/lib/security/addon-request.ts'
  );
  const { AddonTransformResponseSchema } = load(
    'src/features/plugins/addon-payload.ts'
  );
  let callbackReceived;
  const completed = new Promise((resolve) => {
    callbackReceived = resolve;
  });
  try {
    const platform = await listen(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString();
        const response = await POST(
          new Request('http://localhost' + req.url, {
            method: 'POST',
            headers: req.headers,
            body
          }),
          { params: Promise.resolve({ jobId: req.url.split('/').pop() }) }
        );
        callbacks.push({ body: JSON.parse(body), status: response.status });
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(await response.text());
        callbackReceived();
      } catch (error) {
        res.writeHead(500);
        res.end();
        callbackReceived(error);
      }
    });
    const plugin = new ParanodPlugin({
      id: 'integration',
      name: 'Integration',
      version: '1.0.0',
      author: 'Test',
      description: 'Protocol test',
      category: 'network'
    });
    plugin.enableMultiTenantInMemory();
    const result = {
      entities: [{ id: 'out', type: 'ip', value: '8.8.8.8' }],
      edges: []
    };
    plugin.transform({
      id: 'lookup',
      name: 'Lookup',
      description: 'Test',
      inputType: 'domain',
      outputTypes: ['ip'],
      handler: async () => result
    });
    plugin.asyncTransform({
      id: 'scan',
      name: 'Scan',
      description: 'Test',
      inputType: 'domain',
      outputTypes: ['ip'],
      handler: async () => result
    });
    const token = 'integration-test-token-'.repeat(3);
    const base = await listen(
      new ExpressServer(plugin, {
        port: 0,
        multiTenant: true,
        installationToken: token
      }).getApp()
    );
    const send = (route, body, headers) =>
      fetch(base + route, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', ...headers }
      });
    const registration = await send(
      '/register',
      { workspaceId: 'workspace', platformUrl: platform },
      { Authorization: `Bearer ${token}` }
    );
    assert.equal(registration.status, 200);
    secret = (await registration.json()).webhookSecret;
    const input = {
      entity: { id: 'input', type: 'domain', value: 'example.com' },
      config: {}
    };
    const sync = { transformId: 'lookup', input };
    const headers = createAddonRequestHeaders(
      JSON.stringify(sync),
      'workspace',
      secret
    );
    const response = await send('/lookup', sync, headers);
    assert.equal(response.status, 200);
    assert.equal(
      AddonTransformResponseSchema.parse(await response.json()).async,
      false
    );
    assert.equal((await send('/lookup', sync, headers)).status, 409);
    assert.equal(
      (
        await send(
          '/lookup',
          sync,
          createAddonRequestHeaders(
            JSON.stringify(sync),
            'workspace',
            'wrong-secret'
          )
        )
      ).status,
      401
    );
    const invalid = {
      transformId: 'scan',
      input,
      callbackUrl: platform + '/admin'
    };
    assert.equal(
      (
        await send(
          '/scan',
          invalid,
          createAddonRequestHeaders(
            JSON.stringify(invalid),
            'workspace',
            secret
          )
        )
      ).status,
      400
    );
    const asyncBody = {
      transformId: 'scan',
      input,
      callbackUrl: platform + '/api/webhooks/transforms/platform-job'
    };
    const asyncResponse = await send(
      '/scan',
      asyncBody,
      createAddonRequestHeaders(JSON.stringify(asyncBody), 'workspace', secret)
    );
    assert.equal(asyncResponse.status, 200);
    assert.equal(
      AddonTransformResponseSchema.parse(await asyncResponse.json()).async,
      true
    );
    const deadline = setTimeout(
      () => callbackReceived(new Error('Webhook timeout')),
      5000
    );
    const error = await completed;
    clearTimeout(deadline);
    if (error) throw error;
    assert.equal(callbacks[0].status, 200);
    assert.equal(callbacks[0].body.jobId, 'platform-job');
    assert.equal(job.status, 'COMPLETED');
    assert.equal(terminalTransitions, 1);

    // A transient webhook error must reuse the exact signed event on retry.
    const attempts = [];
    const retryBase = await listen(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      attempts.push({
        body: Buffer.concat(chunks).toString(),
        signature: req.headers['x-plugin-signature']
      });
      res.writeHead(attempts.length === 1 ? 503 : 200);
      res.end();
    });
    await new JobProgressTracker(
      'sdk-internal-job',
      retryBase + '/api/webhooks/transforms/platform-job',
      secret
    ).fail('test');
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[0], attempts[1]);
    assert.equal(JSON.parse(attempts[0].body).jobId, 'platform-job');
    console.log(
      'PASS: registration, sync, async callback, request replay, bad signature, callback isolation, stable event retry.'
    );
  } finally {
    await Promise.all(
      servers.map((server) => new Promise((resolve) => server.close(resolve)))
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
