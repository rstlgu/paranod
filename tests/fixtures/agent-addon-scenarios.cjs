// Opt-in real HTTP SDK + real PostgreSQL + actual agent runtime.
// Only the model is deterministic; no AI provider credentials or paid calls.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const createLoader = require('../../scripts/test-support/load-typescript.cjs');

module.exports = async function agentAddonScenarios({ db }) {
  const sdk = require(path.resolve(process.env.PARANOD_TEST_ADDON_SDK_DIST));
  const env = {};
  for (const name of [
    'SECRETS_ENCRYPTION_KEY',
    'PARANOD_ADDON_ALLOWED_HOSTS',
    'APP_URL',
    'NEXT_PUBLIC_APP_URL'
  ])
    env[name] = process.env[name];
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  process.env.PARANOD_ADDON_ALLOWED_HOSTS = '127.0.0.1';
  process.env.APP_URL = 'http://localhost:3002';
  process.env.NEXT_PUBLIC_APP_URL = '';
  const load = createLoader({ '@/lib/db': { db } });
  const { encryptSecret } = load('src/lib/security/secrets.ts');
  const runs = load('src/features/agent/server/runs.ts');
  const { processAgentJob } = load('src/features/agent/server/worker.ts');
  const { createAgentGateway } = load('src/features/agent/server/gateway.ts');
  const plugin = new sdk.ParanodPlugin({
    id: 'agent-async-fixture',
    name: 'Agent integration',
    version: '1.0.0',
    author: 'Test',
    description: 'Isolated integration fixture',
    category: 'network'
  });
  plugin.enableMultiTenantInMemory();
  let executions = 0;
  let slowStarted;
  const started = new Promise((resolve) => {
    slowStarted = resolve;
  });
  for (const id of ['scan', 'slow-scan'])
    plugin.asyncTransform({
      id,
      name: id,
      description: 'Fixture',
      inputType: 'domain',
      outputTypes: ['ip'],
      handler: async (input, _config, job) => {
        executions++;
        await job.updateProgress(25);
        if (id === 'slow-scan') slowStarted();
        await delay(id === 'scan' ? 100 : 500);
        return {
          entities: [{ id: 'found-ip', type: 'ip', value: '8.8.8.8' }],
          edges: [
            {
              id: 'found-edge',
              sourceId: input.entity.id,
              targetId: 'found-ip',
              label: 'Resolves to'
            }
          ]
        };
      }
    });
  const token = randomBytes(32).toString('hex');
  const server = http.createServer(
    new sdk.ExpressServer(plugin, {
      port: 0,
      multiTenant: true,
      installationToken: token
    }).getApp()
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const workspaceId = randomUUID(),
      userId = randomUUID(),
      caseId = randomUUID();
    await db.workspace.create({
      data: { id: workspaceId, name: 'Agent tools test', slug: workspaceId }
    });
    await db.user.create({
      data: { id: userId, name: 'Test', email: `${userId}@example.test` }
    });
    await db.workspaceMember.create({ data: { workspaceId, userId } });
    await db.case.create({
      data: {
        id: caseId,
        workspaceId,
        createdByUserId: userId,
        name: 'Tools test'
      }
    });
    const registration = await fetch(`${base}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ workspaceId, platformUrl: process.env.APP_URL })
    });
    assert.equal(registration.status, 200);
    const { webhookSecret } = await registration.json();
    const manifest = plugin.generateManifest({ endpoint: base });
    await db.workspaceAddonInstall.create({
      data: {
        workspaceId,
        addonId: 'agent-async-fixture',
        enabled: true,
        manifestUrl: encryptSecret(`${base}/manifest.json?token=${token}`),
        manifestVersion: '1.0',
        manifestData: encryptSecret(JSON.stringify(manifest)),
        webhookSecret: encryptSecret(webhookSecret)
      }
    });
    async function start() {
      const graphId = randomUUID();
      await db.graph.create({
        data: {
          id: graphId,
          name: 'Tool graph',
          userId,
          workspaceId,
          caseId,
          nodes: [
            {
              id: 'source',
              position: { x: 0, y: 0 },
              data: { type: 'domain', label: 'example.org' }
            }
          ],
          edges: [],
          nodeCount: 1
        }
      });
      const handle = await db.$transaction((tx) =>
        runs.beginAgentRun(tx, {
          graphId,
          userId,
          goal: 'Run the requested test scan',
          model: 'gpt-6-astra',
          reasoning: 'high',
          approvalMode: 'auto',
          expectedWriteVersion: 0
        })
      );
      return { handle, graphId };
    }
    function provider(transformId) {
      let step = 0;
      return {
        provider: {
          getModel: () => ({
            getResponse: () => {
              throw new Error('streaming_required');
            },
            async *getStreamedResponse() {
              const output =
                step++ === 0
                  ? [
                      {
                        type: 'function_call',
                        name: 'run_transform',
                        callId: `fixture-${transformId}`,
                        arguments: JSON.stringify({
                          moduleId: 'addon:agent-async-fixture',
                          transformId,
                          nodeId: 'source'
                        })
                      }
                    ]
                  : [
                      {
                        type: 'message',
                        role: 'assistant',
                        status: 'completed',
                        content: [
                          {
                            type: 'output_text',
                            text: 'Fixture operation finished.'
                          }
                        ]
                      }
                    ];
              yield {
                type: 'response_done',
                response: {
                  id: `fixture-response-${step}`,
                  output,
                  usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 }
                }
              };
            }
          })
        },
        close: async () => {}
      };
    }
    const first = await start();
    const gateway = createAgentGateway(db, first.handle, workspaceId, 'auto');
    assert.ok(
      (await gateway.listModules('domain', 'scan', 0)).modules.some(
        (m) => m.executable && m.moduleId === 'addon:agent-async-fixture'
      )
    );
    await processAgentJob({
      db,
      runId: first.handle.runId,
      signal: new AbortController().signal,
      getProvider: async () => provider('scan'),
      heartbeatMs: 100
    });
    const run = await db.agentRun.findUniqueOrThrow({
      where: { id: first.handle.runId }
    });
    assert.equal(run.status, 'completed');
    const graph = await db.graph.findUniqueOrThrow({
      where: { id: first.graphId }
    });
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.edges.length, 1);
    const job = await db.transformJob.findFirstOrThrow({
      where: { graphId: first.graphId }
    });
    assert.equal(job.agentRunId, first.handle.runId);
    assert.equal(job.status, 'COMPLETED');
    assert.equal(job.resultDelivery, 'polling');
    assert.equal(job.nextPollAt, null);
    const events = await db.agentEvent.findMany({ where: { runId: run.id } });
    assert.ok(
      events.some(
        (e) =>
          e.data.type === 'phase' &&
          e.data.summary.includes('Waiting for addon')
      )
    );
    assert.ok(!JSON.stringify(events).includes(webhookSecret));
    await processAgentJob({
      db,
      runId: run.id,
      signal: new AbortController().signal,
      getProvider: async () => {
        throw new Error('must_not_replay');
      }
    });
    assert.equal(executions, 1);
    console.log(
      'PASS: actual agent runtime discovers, signs, awaits and imports a real SDK async job; worker replay executes nothing'
    );

    const second = await start();
    const controller = new AbortController();
    const pending = processAgentJob({
      db,
      runId: second.handle.runId,
      signal: controller.signal,
      getProvider: async () => provider('slow-scan'),
      heartbeatMs: 100
    });
    await Promise.race([
      started,
      delay(10000).then(() => {
        throw new Error('Async fixture did not start');
      })
    ]);
    await db.$transaction((tx) =>
      runs.cancelAgentRun(tx, second.handle.runId, userId)
    );
    await pending;
    await delay(600);
    const stoppedJob = await db.transformJob.findFirstOrThrow({
      where: { graphId: second.graphId }
    });
    assert.equal(stoppedJob.status, 'CANCELLED');
    assert.equal(
      (await db.graph.findUniqueOrThrow({ where: { id: second.graphId } }))
        .nodes.length,
      1
    );
    assert.equal(executions, 2);
    console.log(
      'PASS: Stop cancels the durable addon job; a late real SDK completion cannot modify the graph'
    );
    const third = await start();
    const abandoned = await db.transformJob.create({
      data: {
        graphId: third.graphId,
        workspaceId,
        addonId: 'agent-async-fixture',
        transformId: 'scan',
        inputEntity: '{"id":"source"}',
        webhookUrl: '',
        status: 'SUBMITTED',
        resultDelivery: 'polling',
        agentRunId: third.handle.runId
      }
    });
    const manual = await db.transformJob.create({
      data: {
        graphId: third.graphId,
        workspaceId,
        addonId: 'agent-async-fixture',
        transformId: 'scan',
        inputEntity: '{"id":"source"}',
        webhookUrl: '',
        status: 'SUBMITTED',
        resultDelivery: 'polling'
      }
    });
    await db.graphAgentLease.update({
      where: { graphId: third.graphId },
      data: { expiresAt: new Date(0) }
    });
    await load('src/lib/jobs/poll-addons.ts').pollAddonJobs();
    assert.equal(
      (await db.transformJob.findUniqueOrThrow({ where: { id: abandoned.id } }))
        .status,
      'CANCELLED'
    );
    assert.equal(
      (await db.transformJob.findUniqueOrThrow({ where: { id: manual.id } }))
        .status,
      'SUBMITTED'
    );
    assert.equal(executions, 2);
    console.log(
      'PASS: expired-agent cleanup cancels only its owned jobs, preserves manual jobs and never replays provider work'
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    for (const [name, value] of Object.entries(env))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
};
