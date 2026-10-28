// Uses only a disposable PostgreSQL container; never reads the application's DB URL.
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const context = execFileSync('docker', ['context', 'show'], {
    encoding: 'utf8'
  }).trim();
  if (process.env.PARANOD_TEST_DOCKER_CONTEXT !== context) {
    throw new Error(
      'Set PARANOD_TEST_DOCKER_CONTEXT to the verified current context.'
    );
  }
  const docker = (args) =>
    execFileSync('docker', ['--context', context, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  docker(['info', '--format', '{{.ServerVersion}}']);
  docker(['image', 'inspect', 'postgres:16', '--format', '{{.Id}}']);
  const endpoint = docker([
    'context',
    'inspect',
    context,
    '--format',
    '{{.Endpoints.docker.Host}}'
  ]);
  if (!endpoint.startsWith('ssh://') && !endpoint.startsWith('unix://')) {
    throw new Error('Only local Unix or SSH Docker contexts are supported.');
  }
  const name = `paranod-agent-lease-test-${randomBytes(6).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  let created = false;
  let tunnel;
  let db;
  try {
    docker([
      'run',
      '-d',
      '--name',
      name,
      '--label',
      'paranod.test=graph-agent-lease',
      '--memory',
      '256m',
      '--cpus',
      '1',
      '--publish',
      '127.0.0.1::5432',
      '--tmpfs',
      '/var/lib/postgresql/data',
      '--env',
      'POSTGRES_DB=paranod_agent_lease_test',
      '--env',
      `POSTGRES_PASSWORD=${password}`,
      'postgres:16'
    ]);
    created = true;
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        docker([
          'exec',
          name,
          'pg_isready',
          '-U',
          'postgres',
          '-d',
          'paranod_agent_lease_test'
        ]);
        ready = true;
        break;
      } catch {
        await delay(250);
      }
    }
    assert.ok(ready, 'Disposable PostgreSQL did not become ready');
    const published = docker(['port', name, '5432/tcp']);
    assert.match(published, /^127\.0\.0\.1:\d+$/);
    let port = Number(published.split(':').at(-1));
    if (endpoint.startsWith('ssh://')) {
      const server = net.createServer();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const localPort = server.address().port;
      await new Promise((resolve) => server.close(resolve));
      const host = new URL(endpoint);
      const destination = `${host.username ? `${decodeURIComponent(host.username)}@` : ''}${host.hostname}`;
      tunnel = spawn(
        'ssh',
        [
          '-N',
          '-o',
          'BatchMode=yes',
          '-o',
          'ExitOnForwardFailure=yes',
          ...(host.port ? ['-p', host.port] : []),
          '-L',
          `127.0.0.1:${localPort}:127.0.0.1:${port}`,
          destination
        ],
        { stdio: 'ignore' }
      );
      port = localPort;
      await delay(700);
      assert.equal(tunnel.exitCode, null, 'SSH tunnel failed');
    }
    const url = `postgresql://postgres:${password}@127.0.0.1:${port}/paranod_agent_lease_test`;
    db = new PrismaClient({ datasources: { db: { url } } });
    // Every transitive server module must share this disposable client rather
    // than resolving the application's environment-backed singleton.
    const load = require('./test-support/load-typescript.cjs')({
      '@/lib/db': { db }
    });
    const service = load('src/features/graph/server/graph-agent-lease.ts');
    const runs = load('src/features/agent/server/runs.ts');
    let connected = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await db.$connect();
        connected = true;
        break;
      } catch {
        await delay(250);
      }
    }
    assert.ok(connected, 'Cannot connect to disposable PostgreSQL');
    // Exercise the same fresh-install path as Docker, with both connection
    // variables forcibly pointed at this disposable database. Reapplying must
    // be a no-op; the application's environment is never used as a target.
    const deployMigrations = () =>
      execFileSync(
        process.execPath,
        [
          require.resolve('prisma/build/index.js'),
          'migrate',
          'deploy',
          '--schema',
          path.resolve(__dirname, '../prisma/schema.prisma')
        ],
        {
          cwd: path.resolve(__dirname, '..'),
          env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
          stdio: 'pipe'
        }
      );
    deployMigrations();
    deployMigrations();

    await db.workspace.create({
      data: { id: 'workspace', name: 'Test workspace', slug: 'test-workspace' }
    });
    await db.user.create({
      data: { id: 'user', name: 'Test user', email: 'user@example.test' }
    });
    await db.case.create({
      data: {
        id: 'case',
        workspaceId: 'workspace',
        createdByUserId: 'user',
        name: 'Test case'
      }
    });
    await db.graph.create({
      data: {
        id: 'graph',
        name: 'Test graph',
        userId: 'user',
        workspaceId: 'workspace',
        caseId: 'case'
      }
    });
    await db.workspaceMember.create({
      data: { id: 'member', userId: 'user', workspaceId: 'workspace' }
    });

    const checks = await db.$queryRawUnsafe(
      `SELECT conname FROM pg_constraint WHERE contype = 'c' AND conrelid IN ('"GraphAgentLease"'::regclass, '"AgentRun"'::regclass, '"AgentEvent"'::regclass)`
    );
    assert.deepEqual(
      checks.map((row) => row.conname).sort(),
      [
        'GraphAgentLease_generation_check',
        'GraphAgentLease_complete_check',
        'AgentRun_status_check',
        'AgentRun_eventCount_check',
        'AgentRun_approvalMode_check',
        'AgentEvent_sequence_check'
      ].sort()
    );
    console.log(
      'PASS: fresh database migrations include all agent constraints and redeploy idempotently'
    );

    const input = {
      graphId: 'graph',
      runId: 'run',
      userId: 'user',
      expectedWriteVersion: 0
    };
    const read = () =>
      db.$transaction((tx) => service.getGraphWriteState(tx, 'graph'));
    assert.deepEqual(await read(), {
      version: 0,
      locked: false,
      expiresAt: null
    });

    // The second transaction must wait for the graph row, then see the new owner.
    let unlockTransaction;
    let notifyAcquired;
    const held = new Promise((resolve) => {
      unlockTransaction = resolve;
    });
    const acquired = new Promise((resolve) => {
      notifyAcquired = resolve;
    });
    const first = db.$transaction(async (tx) => {
      const handle = await service.acquireAgentGraphLease(tx, input);
      notifyAcquired();
      await held;
      return handle;
    });
    await acquired;
    const second = db
      .$transaction((tx) =>
        service.acquireAgentGraphLease(tx, { ...input, runId: 'second' })
      )
      .then(
        () => ({ accepted: true }),
        (error) => ({ code: error.code })
      );
    await delay(100);
    unlockTransaction();
    const handle = await first;
    assert.equal((await second).code, 'graph_agent_running');
    console.log('PASS: concurrent acquisitions have a single owner');

    for (const scope of [{ caseId: 'case' }, { workspaceId: 'workspace' }]) {
      await assert.rejects(
        db.$transaction((tx) => service.assertGraphScopeEditable(tx, scope)),
        { code: 'graph_agent_running' }
      );
    }
    await assert.rejects(
      db.$transaction((tx) => service.assertGraphEditable(tx, 'graph')),
      { code: 'graph_agent_running' }
    );
    console.log('PASS: manual writes and parent deletion are blocked');

    await db.$transaction((tx) => service.releaseAgentGraphLease(tx, handle));
    await assert.rejects(
      db.$transaction((tx) =>
        service.assertGraphEditable(tx, 'graph', {
          snapshot: true,
          expectedWriteVersion: 0
        })
      ),
      { code: 'graph_changed' }
    );
    await db.$transaction(async (tx) => {
      await service.assertGraphEditable(tx, 'graph', {
        snapshot: true,
        expectedWriteVersion: 2
      });
      await tx.graph.update({
        where: { id: 'graph' },
        data: { nodes: [{ id: 'preserved' }] },
        select: { id: true }
      });
    });
    console.log(
      'PASS: old snapshots rejected after release; current snapshot accepted'
    );

    const expired = await db.$transaction((tx) =>
      service.acquireAgentGraphLease(tx, { ...input, expectedWriteVersion: 2 })
    );
    await db.graphAgentLease.update({
      where: { graphId: 'graph' },
      data: { expiresAt: new Date(0) }
    });
    assert.equal((await read()).version, 4);
    await assert.rejects(
      db.$transaction((tx) => service.renewAgentGraphLease(tx, expired)),
      { code: 'graph_lease_lost' }
    );
    const successor = await db.$transaction((tx) =>
      service.acquireAgentGraphLease(tx, { ...input, expectedWriteVersion: 4 })
    );
    assert.equal(
      await db.$transaction((tx) =>
        service.releaseAgentGraphLease(tx, expired)
      ),
      false
    );
    assert.equal((await read()).locked, true);
    console.log(
      'PASS: expired workers cannot renew or release a successor lease'
    );

    await db.workspaceMember.delete({
      where: {
        userId_workspaceId: { userId: 'user', workspaceId: 'workspace' }
      },
      select: { id: true }
    });
    await assert.rejects(
      db.$transaction((tx) => service.assertAgentGraphLease(tx, successor)),
      { code: 'workspace_access_revoked' }
    );
    await db.$transaction((tx) =>
      service.releaseAgentGraphLease(tx, successor)
    );
    assert.equal((await read()).locked, false);
    console.log(
      'PASS: membership revocation stops writes without preventing cleanup'
    );

    const graph = await db.graph.findUnique({
      where: { id: 'graph' },
      select: { nodes: true }
    });
    assert.deepEqual(graph.nodes, [{ id: 'preserved' }]);
    console.log('PASS: graph data preserved throughout recovery');

    await db.workspaceMember.create({
      data: { id: 'member', userId: 'user', workspaceId: 'workspace' }
    });
    const begin = async () =>
      db.$transaction((tx) =>
        runs.beginAgentRun(tx, {
          graphId: 'graph',
          userId: 'user',
          expectedWriteVersion: 6,
          goal: 'Inspect example.org',
          model: 'test-model',
          reasoning: 'high'
        })
      );
    const agent = await begin();
    await db.$transaction((tx) =>
      runs.publishAgentActivity(tx, agent, {
        type: 'phase',
        phase: 'planning',
        summary: 'Test activity'
      })
    );
    await assert.rejects(
      db.$transaction((tx) => runs.readOwnedAgentRun(tx, agent.runId, 'other')),
      { code: 'agent_run_not_found' }
    );
    await assert.rejects(
      db.$transaction((tx) =>
        runs.publishAgentActivity(tx, agent, {
          type: 'decision',
          approvalId: 'approval',
          approved: true
        })
      ),
      { code: 'invalid_agent_event' }
    );
    console.log(
      'PASS: public activity is owner-scoped; workers cannot approve themselves'
    );

    const approval = {
      type: 'approval',
      approvalId: 'approval',
      tool: 'test-tool',
      summary: 'Test approval',
      destination: 'example.org',
      argumentsHash: 'a'.repeat(64)
    };
    await db.$transaction((tx) =>
      runs.publishAgentActivity(tx, agent, approval)
    );
    await assert.rejects(
      db.$transaction((tx) => runs.publishAgentActivity(tx, agent, approval)),
      { code: 'duplicate_approval' }
    );
    await db.$transaction((tx) =>
      runs.decideAgentApproval(tx, agent.runId, 'user', 'approval', false)
    );
    await db.$transaction((tx) =>
      runs.decideAgentApproval(tx, agent.runId, 'user', 'approval', false)
    );
    await assert.rejects(
      db.$transaction((tx) =>
        runs.decideAgentApproval(tx, agent.runId, 'user', 'approval', true)
      ),
      { code: 'approval_already_decided' }
    );
    await assert.rejects(
      db.$transaction((tx) =>
        runs.decideAgentApproval(tx, agent.runId, 'user', 'missing', true)
      ),
      { code: 'approval_not_found' }
    );
    assert.equal(
      await db.agentEvent.count({ where: { runId: agent.runId } }),
      3
    );
    console.log(
      'PASS: approvals are unique and decisions are immutable/idempotent'
    );

    await db.$transaction((tx) => runs.cancelAgentRun(tx, agent.runId, 'user'));
    await db.$transaction((tx) => runs.cancelAgentRun(tx, agent.runId, 'user'));
    assert.equal(
      await db.agentEvent.count({ where: { runId: agent.runId } }),
      4
    );
    assert.equal((await read()).locked, false);
    await assert.rejects(
      db.$transaction((tx) =>
        runs.publishAgentActivity(tx, agent, {
          type: 'message',
          text: 'late',
          sources: []
        })
      ),
      { code: 'graph_lease_lost' }
    );
    console.log(
      'PASS: cancellation is idempotent and fences late worker writes'
    );

    const staleRun = await db.$transaction((tx) =>
      runs.beginAgentRun(tx, {
        graphId: 'graph',
        userId: 'user',
        expectedWriteVersion: 8,
        goal: 'Expiry test',
        model: 'test-model',
        reasoning: 'high'
      })
    );
    await db.graphAgentLease.update({
      where: { graphId: 'graph' },
      data: { expiresAt: new Date(0) }
    });
    const recovered = await db.$transaction((tx) =>
      runs.readOwnedAgentRun(tx, staleRun.runId, 'user')
    );
    assert.equal(recovered.status, 'interrupted');
    await db.$transaction((tx) =>
      runs.readOwnedAgentRun(tx, staleRun.runId, 'user')
    );
    assert.equal(
      await db.agentEvent.count({ where: { runId: staleRun.runId } }),
      1
    );
    console.log(
      'PASS: expired activities reconcile once and release the graph'
    );
    await require('../tests/fixtures/agent-worker-scenarios.cjs')({
      db,
      url,
      load,
      read
    });
  } catch (error) {
    throw new Error(String(error.message).replaceAll(password, '[redacted]'));
  } finally {
    if (db) await db.$disconnect();
    if (tunnel && tunnel.exitCode === null) {
      tunnel.kill('SIGTERM');
      await new Promise((resolve) => tunnel.once('exit', resolve));
    }
    if (created) docker(['rm', '-f', name]);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
