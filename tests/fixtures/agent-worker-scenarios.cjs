const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { randomUUID, randomBytes, createCipheriv } = require('node:crypto');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const sharp = require('sharp');

module.exports = async function agentWorkerScenarios({ db, url, load, read }) {
  const {
    createAgentQueue,
    createAgentProducer,
    initializeAgentQueue,
    enqueueAgentRun,
    AGENT_QUEUE
  } = load('src/features/agent/server/queue.ts');
  const { processAgentJob, claimAgentJob } = load(
    'src/features/agent/server/worker.ts'
  );
  const { createAgentGateway } = load('src/features/agent/server/gateway.ts');
  const runs = load('src/features/agent/server/runs.ts');
  const { readAgentStartSnapshot } = load(
    'src/features/agent/server/snapshot.ts'
  );
  const readiness = load('src/features/agent/server/readiness.ts');
  const queue = createAgentQueue(url);
  queue.on('error', () => {
    throw new Error('Test queue error');
  });
  // The caller deploys the complete application schema in a disposable DB.
  await db.graph.update({
    where: { id: 'graph' },
    data: { nodes: [], edges: [] },
    select: { id: true }
  });
  await initializeAgentQueue(queue);
  const producer = createAgentProducer();
  const snapshot = () =>
    db.$transaction((tx) =>
      readAgentStartSnapshot(tx, {
        graphId: 'graph',
        userId: 'user',
        workspaceId: 'workspace'
      })
    );
  const startInput = async (overrides = {}) => ({
    runId: randomUUID(),
    graphId: 'graph',
    userId: 'user',
    workspaceId: 'workspace',
    goal: 'Analizza research@example.test',
    model: 'gpt-6-astra',
    reasoning: 'high',
    expectedWriteVersion: (await read()).version,
    expectedRevision: (await snapshot()).revision,
    ...overrides
  });
  const start = async (overrides = {}, sender = producer) => {
    await readiness.heartbeatAgentWorker(db, 'fixture-worker');
    return enqueueAgentRun(db, sender, await startInput(overrides));
  };
  const message = {
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: 'Test completato.' }]
  };
  const call = (name, args, callId) => ({
    type: 'function_call',
    name,
    callId,
    arguments: JSON.stringify(args)
  });
  function providerFor(respond) {
    return {
      provider: {
        getModel: () => ({
          getResponse: () => {
            throw new Error('streaming_required');
          },
          async *getStreamedResponse(request) {
            const output = await respond(request);
            yield {
              type: 'response_done',
              response: {
                id: 'fixture-response',
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
  try {
    const unavailableInput = await startInput();
    await assert.rejects(
      enqueueAgentRun(db, producer, unavailableInput),
      /agent_worker_unavailable/
    );
    assert.equal((await read()).locked, false);
    await readiness.heartbeatAgentWorker(db, 'fixture-worker');
    await assert.rejects(
      start({ expectedRevision: '0'.repeat(64) }),
      /agent_snapshot_changed/
    );
    assert.equal((await read()).locked, false);
    const staleNotesInput = await startInput();
    await db.graph.update({
      where: { id: 'graph' },
      data: { notes: 'Changed from another tab' },
      select: { id: true }
    });
    await assert.rejects(
      enqueueAgentRun(db, producer, staleNotesInput),
      /agent_snapshot_changed/
    );
    const pendingAddon = {
      workspaceId: 'workspace',
      addonId: 'pending-test-addon',
      manifestUrl: 'https://example.test/manifest.json',
      manifestVersion: '1.0.0',
      manifestData: '{}',
      enabled: false,
      webhookSecret: 'disposable-test-webhook-secret'
    };
    await db.workspaceAddonInstall.create({ data: pendingAddon });
    await assert.rejects(
      db.workspaceAddonInstall.create({ data: pendingAddon }),
      { code: 'P2002' }
    );
    const pendingJob = {
      id: 'pending',
      graphId: 'graph',
      workspaceId: 'workspace',
      addonId: 'pending-test-addon',
      transformId: 'test-transform',
      status: 'PROCESSING',
      inputEntity: '{}',
      webhookUrl: 'https://example.test/webhook'
    };
    await assert.rejects(
      db.transformJob.create({
        data: { ...pendingJob, addonId: 'not-installed' }
      }),
      { code: 'P2003' }
    );
    const createdJob = await db.transformJob.create({
      data: pendingJob,
      include: { addon: true }
    });
    assert.equal(createdJob.addon.addonId, pendingAddon.addonId);
    assert.equal(createdJob.addon.workspaceId, pendingAddon.workspaceId);
    await assert.rejects(start(), /agent_manual_jobs_active/);
    await db.workspaceAddonInstall.delete({
      where: {
        workspaceId_addonId: {
          workspaceId: 'workspace',
          addonId: 'pending-test-addon'
        }
      }
    });
    assert.equal(await db.transformJob.count({ where: { id: 'pending' } }), 0);
    console.log(
      'PASS: addon installations are unique per workspace, jobs require an installed addon and cascade on removal'
    );
    console.log(
      'PASS: missing workers, changed content/notes and pending manual jobs cannot acquire a lease'
    );

    const before = await db.agentRun.count();
    await assert.rejects(
      start(
        {},
        {
          send: async (...args) => {
            await queue.send(...args);
            throw new Error('forced_transaction_rollback');
          }
        }
      ),
      /forced_transaction_rollback/
    );
    assert.equal(await db.agentRun.count(), before);
    assert.equal(
      (await queue.findJobs(AGENT_QUEUE, { queued: true })).length,
      0
    );
    assert.equal((await read()).locked, false);
    console.log(
      'PASS: queue insertion, run creation and graph lock roll back together'
    );

    const exactInput = await startInput();
    const job = await enqueueAgentRun(db, producer, exactInput);
    assert.deepEqual(await enqueueAgentRun(db, producer, exactInput), job);
    await assert.rejects(
      enqueueAgentRun(db, producer, { ...exactInput, goal: 'Changed goal' }),
      /agent_start_conflict/
    );
    assert.equal(
      (await queue.findJobs(AGENT_QUEUE, { queued: true })).length,
      1
    );
    console.log(
      'PASS: web-only producer enqueues atomically; exact retries create no duplicate job or lease'
    );
    const [fetched] = await queue.fetch(AGENT_QUEUE);
    assert.equal(fetched.data.runId, job.runId);
    assert.deepEqual(Object.keys(fetched.data), ['runId']);
    let turn = 0;
    const provider = providerFor(async (request) => {
      turn++;
      if (turn === 1)
        return [
          call(
            'add_seed',
            { type: 'email', value: 'research@example.test' },
            'seed'
          )
        ];
      if (turn === 2) {
        const output = request.input.find(
          (item) =>
            item.type === 'function_call_result' && item.callId === 'seed'
        ).output;
        const text =
          typeof output === 'string'
            ? output
            : Array.isArray(output)
              ? output.map((part) => part.text ?? '').join('')
              : output.text;
        const { nodeId } = JSON.parse(text);
        return [
          call(
            'run_transform',
            {
              moduleId: 'email-parser',
              transformId: 'email-extract-domain',
              nodeId
            },
            'extract'
          )
        ];
      }
      return [message];
    });
    const controller = new AbortController();
    await processAgentJob({
      db,
      runId: job.runId,
      signal: controller.signal,
      getProvider: async () => provider
    });
    const finished = await db.agentRun.findUniqueOrThrow({
      where: { id: job.runId }
    });
    assert.equal(
      finished.status,
      'completed',
      JSON.stringify(
        await db.agentEvent.findMany({ where: { runId: job.runId } })
      )
    );
    assert.equal(finished.inputTokens, 60);
    const graph = await db.graph.findUniqueOrThrow({
      where: { id: 'graph' },
      select: { nodes: true, edges: true }
    });
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.edges.length, 1);
    assert.ok(
      graph.nodes.some(
        (node) =>
          node.data.type === 'domain' &&
          (node.data.metadata?.value ?? node.data.label) === 'example.test'
      )
    );
    assert.equal((await read()).locked, false);
    assert.deepEqual(await enqueueAgentRun(db, producer, exactInput), job);
    assert.equal(await claimAgentJob(db, job.runId), null);
    console.log(
      'PASS: queued SDK run applies a real local plugin result and releases the graph'
    );

    const imageDirectory = await mkdtemp(
      join(tmpdir(), 'paranod-agent-image-')
    );
    const oldStorage = process.env.TEMP_FILE_STORAGE_DIR;
    const oldKey = process.env.TEMP_FILE_ENCRYPTION_KEY;
    try {
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const bytes = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#336699' }
      })
        .png()
        .toBuffer();
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
      process.env.TEMP_FILE_STORAGE_DIR = imageDirectory;
      process.env.TEMP_FILE_ENCRYPTION_KEY = key.toString('base64');
      await mkdir(join(imageDirectory, 'workspace'));
      await writeFile(
        join(imageDirectory, 'workspace', 'image-file'),
        encrypted
      );
      await db.tempFile.create({
        data: {
          id: 'image-file',
          workspaceId: 'workspace',
          createdByUserId: 'user',
          originalName: 'fixture.png',
          mimeType: 'image/png',
          sizeBytes: bytes.length,
          encIv: iv.toString('base64'),
          encTag: cipher.getAuthTag().toString('base64'),
          storagePath: 'private/temp/workspace/image-file'
        }
      });
      await db.graph.update({
        where: { id: 'graph' },
        data: {
          nodes: [
            ...graph.nodes,
            {
              id: 'image-node',
              position: { x: 0, y: 0 },
              data: {
                type: 'media_url',
                label: 'Uploaded image',
                metadata: { value: '/api/upload/temp/image-file' }
              }
            }
          ],
          nodeCount: graph.nodes.length + 1
        }
      });
      const imageRun = await start({
        goal: 'Calcola l’hash percettivo dell’immagine nel grafo',
        approvalMode: 'auto'
      });
      let imageTurn = 0;
      await processAgentJob({
        db,
        runId: imageRun.runId,
        signal: new AbortController().signal,
        getProvider: async () =>
          providerFor(async () =>
            ++imageTurn === 1
              ? [
                  call(
                    'run_transform',
                    {
                      moduleId: 'image-analysis',
                      transformId: 'image-hash',
                      nodeId: 'image-node'
                    },
                    'hash-image'
                  )
                ]
              : [message]
          )
      });
      const imageResult = await db.graph.findUniqueOrThrow({
        where: { id: 'graph' },
        select: { nodes: true, edges: true }
      });
      assert.equal(
        (await db.agentRun.findUniqueOrThrow({ where: { id: imageRun.runId } }))
          .status,
        'completed'
      );
      assert.ok(
        imageResult.nodes.some(
          (node) =>
            node.data.type === 'hash' &&
            /^[a-f0-9]{16}$/.test(node.data.metadata?.value ?? node.data.label)
        )
      );
      assert.ok(imageResult.edges.some((edge) => edge.source === 'image-node'));
      assert.equal((await read()).locked, false);
      await db.graph.update({
        where: { id: 'graph' },
        data: {
          nodes: graph.nodes,
          edges: graph.edges,
          nodeCount: graph.nodes.length,
          edgeCount: graph.edges.length
        }
      });
      console.log(
        'PASS: queued SDK worker decrypts a scoped upload and applies its real image hash without an HTTP session'
      );
    } finally {
      await db.tempFile.deleteMany({ where: { id: 'image-file' } });
      await rm(imageDirectory, { recursive: true, force: true });
      if (oldStorage === undefined) delete process.env.TEMP_FILE_STORAGE_DIR;
      else process.env.TEMP_FILE_STORAGE_DIR = oldStorage;
      if (oldKey === undefined) delete process.env.TEMP_FILE_ENCRYPTION_KEY;
      else process.env.TEMP_FILE_ENCRYPTION_KEY = oldKey;
    }

    const claimedRun = await start();
    const claim = await claimAgentJob(db, claimedRun.runId);
    assert.ok(claim);
    assert.equal(await claimAgentJob(db, claimedRun.runId), null);
    const gateway = createAgentGateway(db, claim.handle, 'workspace');
    await assert.rejects(
      gateway.addSeed({ type: 'domain', value: 'not-requested.test' }),
      /agent_seed_outside_request/
    );
    await assert.rejects(
      createAgentGateway(db, claim.handle, 'another-workspace').readGraph(0),
      /agent_scope_changed/
    );
    await db.$transaction((tx) =>
      runs.cancelAgentRun(tx, claimedRun.runId, 'user')
    );
    await assert.rejects(
      gateway.addSeed({ type: 'email', value: 'research@example.test' }),
      /graph_lease_lost/
    );
    console.log(
      'PASS: worker claims are single-use and all writes enforce owner, workspace and request scope'
    );

    const cancelledRun = await start();
    let notifyStarted;
    const started = new Promise((resolve) => {
      notifyStarted = resolve;
    });
    let providerAborted = false;
    const pending = providerFor(async (request) => {
      notifyStarted();
      await delay(5000, undefined, { signal: request.signal }).catch(
        (error) => {
          providerAborted = true;
          throw error;
        }
      );
      return [message];
    });
    const working = processAgentJob({
      db,
      runId: cancelledRun.runId,
      signal: new AbortController().signal,
      heartbeatMs: 50,
      getProvider: async () => pending
    });
    await started;
    await db.$transaction((tx) =>
      runs.cancelAgentRun(tx, cancelledRun.runId, 'user')
    );
    await working;
    assert.equal(providerAborted, true);
    assert.equal(
      (
        await db.agentRun.findUniqueOrThrow({
          where: { id: cancelledRun.runId }
        })
      ).status,
      'cancelled'
    );
    console.log(
      'PASS: persisted Stop aborts the active provider through the worker heartbeat'
    );

    for (const approved of [true, false]) {
      const approvalRun = await start();
      const controller = new AbortController();
      let step = 0;
      const proposer = providerFor(async () =>
        ++step === 1
          ? [
              call(
                'propose_relationship',
                {
                  sourceId: graph.nodes[0].id,
                  targetId: graph.nodes[1].id,
                  hypothesis: 'Relazione sintetica da verificare'
                },
                'hypothesis'
              )
            ]
          : [message]
      );
      const beforeEdges = await db.graph.findUniqueOrThrow({
        where: { id: 'graph' },
        select: { edgeCount: true }
      });
      const working = processAgentJob({
        db,
        runId: approvalRun.runId,
        signal: controller.signal,
        getProvider: async () => proposer
      });
      try {
        let approval;
        for (let attempt = 0; attempt < 100; attempt++) {
          const row = await db.agentEvent.findFirst({
            where: {
              runId: approvalRun.runId,
              data: { path: ['type'], equals: 'approval' }
            }
          });
          if (row) {
            approval = row.data;
            break;
          }
          await delay(50);
        }
        assert.ok(approval, 'Approval was not persisted');
        assert.equal(
          (
            await db.graph.findUniqueOrThrow({
              where: { id: 'graph' },
              select: { edgeCount: true }
            })
          ).edgeCount,
          beforeEdges.edgeCount
        );
        await db.$transaction((tx) =>
          runs.decideAgentApproval(
            tx,
            approvalRun.runId,
            'user',
            approval.approvalId,
            approved
          )
        );
        await working;
        assert.equal(
          (
            await db.agentRun.findUniqueOrThrow({
              where: { id: approvalRun.runId }
            })
          ).status,
          'completed'
        );
        assert.equal(
          (
            await db.graph.findUniqueOrThrow({
              where: { id: 'graph' },
              select: { edgeCount: true }
            })
          ).edgeCount,
          beforeEdges.edgeCount + (approved ? 1 : 0)
        );
      } finally {
        controller.abort();
        await working;
      }
    }
    console.log(
      'PASS: persisted approvals resume the SDK; denial never mutates the graph'
    );

    const revokedRun = await start();
    let notifyRevokedStarted;
    const revokedStarted = new Promise((resolve) => {
      notifyRevokedStarted = resolve;
    });
    const revokedProvider = providerFor(async (request) => {
      notifyRevokedStarted();
      await delay(5000, undefined, { signal: request.signal });
      return [message];
    });
    const revokedWork = processAgentJob({
      db,
      runId: revokedRun.runId,
      signal: new AbortController().signal,
      heartbeatMs: 50,
      getProvider: async () => revokedProvider
    });
    await revokedStarted;
    await db.workspaceMember.deleteMany({
      where: { userId: 'user', workspaceId: 'workspace' }
    });
    await revokedWork;
    assert.equal(
      (await db.agentRun.findUniqueOrThrow({ where: { id: revokedRun.runId } }))
        .status,
      'interrupted'
    );
    assert.equal((await read()).locked, false);
    console.log(
      'PASS: workspace revocation aborts the provider, closes activity and releases only its own lease'
    );
  } finally {
    await queue.stop({ graceful: true, timeout: 2000 });
  }
};
