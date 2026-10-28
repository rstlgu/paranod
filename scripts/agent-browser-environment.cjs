// Disposable browser QA environment. Never uses the application's database URL.
const { execFileSync, spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  if (process.env.PARANOD_AGENT_LIVE_TEST !== 'true')
    throw new Error('Explicit PARANOD_AGENT_LIVE_TEST=true is required.');
  const context = execFileSync('docker', ['context', 'show'], {
    encoding: 'utf8'
  }).trim();
  if (context !== process.env.PARANOD_TEST_DOCKER_CONTEXT)
    throw new Error('The verified test Docker context is required.');
  const docker = (args) =>
    execFileSync('docker', ['--context', context, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  const mutate = (args) => {
    if (
      execFileSync('docker', ['context', 'show'], {
        encoding: 'utf8'
      }).trim() !== context
    )
      throw new Error('Docker context changed.');
    docker(['info', '--format', '{{.ServerVersion}}']);
    return docker(args);
  };
  const endpoint = docker([
    'context',
    'inspect',
    context,
    '--format',
    '{{.Endpoints.docker.Host}}'
  ]);
  if (!endpoint.startsWith('ssh://') && !endpoint.startsWith('unix://'))
    throw new Error('Only local or SSH Docker contexts are supported.');
  const name = `paranod-agent-browser-test-${randomBytes(6).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  const children = [];
  let created = false;
  let db;
  let logFd;
  let cleanup;
  const done = new Promise((resolve) => {
    cleanup = resolve;
  });
  const stop = () => cleanup();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const deadline = setTimeout(stop, 30 * 60_000);
  const start = (command, args, options = {}) => {
    const child = spawn(command, args, { stdio: 'ignore', ...options });
    children.push(child);
    child.once('error', stop);
    return child;
  };
  try {
    mutate([
      'run',
      '-d',
      '--name',
      name,
      '--label',
      'paranod.test=agent-browser',
      '--memory',
      '384m',
      '--cpus',
      '1',
      '--publish',
      '127.0.0.1::5432',
      '--tmpfs',
      '/var/lib/postgresql/data',
      '--env',
      'POSTGRES_DB=paranod_agent_browser_test',
      '--env',
      `POSTGRES_PASSWORD=${password}`,
      'postgres:16'
    ]);
    created = true;
    for (let attempt = 0; ; attempt++) {
      try {
        docker(['exec', name, 'pg_isready', '-U', 'postgres']);
        break;
      } catch {
        if (attempt > 50) throw new Error('Test database unavailable.');
        await delay(200);
      }
    }
    let port = Number(docker(['port', name, '5432/tcp']).split(':').at(-1));
    if (endpoint.startsWith('ssh://')) {
      const local = await freePort();
      const host = new URL(endpoint);
      const tunnel = start('ssh', [
        '-N',
        '-o',
        'BatchMode=yes',
        '-o',
        'ExitOnForwardFailure=yes',
        ...(host.port ? ['-p', host.port] : []),
        '-L',
        `127.0.0.1:${local}:127.0.0.1:${port}`,
        `${host.username ? `${decodeURIComponent(host.username)}@` : ''}${host.hostname}`
      ]);
      await delay(700);
      if (tunnel.exitCode !== null)
        throw new Error('Test database tunnel failed.');
      port = local;
    }
    const url = `postgresql://postgres:${password}@127.0.0.1:${port}/paranod_agent_browser_test`;
    const webPort = await freePort();
    const origin = `http://127.0.0.1:${webPort}`;
    const env = {
      ...process.env,
      DATABASE_URL: url,
      DIRECT_URL: url,
      NODE_ENV: 'production',
      BETTER_AUTH_URL: origin,
      APP_URL: origin,
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64'),
      SECRETS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      PARANOD_AGENT_WORKER_ENABLED: 'true',
      NEXT_TELEMETRY_DISABLED: '1'
    };
    execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'db',
        'push',
        '--skip-generate'
      ],
      {
        env,
        stdio: 'pipe'
      }
    );
    const output = path.resolve('output/playwright/agent-live');
    fs.mkdirSync(output, { recursive: true, mode: 0o700 });
    logFd = fs.openSync(path.join(output, 'server.log'), 'w', 0o600);
    const web = start(
      process.execPath,
      [
        'node_modules/next/dist/bin/next',
        'start',
        '-H',
        '127.0.0.1',
        '-p',
        String(webPort)
      ],
      {
        env,
        stdio: ['ignore', logFd, logFd]
      }
    );
    for (let attempt = 0; ; attempt++) {
      if (web.exitCode !== null) throw new Error('Test web server exited.');
      const ready = await fetch(`${origin}/api/health`)
        .then((r) => r.ok)
        .catch(() => false);
      if (ready) break;
      if (attempt > 80) throw new Error('Test web server unavailable.');
      await delay(250);
    }
    // Ordinary first-user signup exercises the real authentication bootstrap.
    const response = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({
        name: 'Agent QA',
        email: 'agent-qa@example.test',
        password: 'Agent-QA-Disposable-2026!'
      })
    });
    if (!response.ok)
      throw new Error(`Test signup failed (${response.status}).`);
    const { user } = await response.json();
    db = new PrismaClient({ datasources: { db: { url } }, log: [] });
    const member = await db.workspaceMember.findFirstOrThrow({
      where: { userId: user.id }
    });
    const apiKey = dotenv.parse(fs.readFileSync('.env.local')).OPENAI_API_KEY;
    if (!apiKey) throw new Error('Local OpenAI credential missing.');
    execFileSync(process.execPath, ['dist/agent-configure.cjs'], {
      env,
      input: JSON.stringify({
        workspaceId: member.workspaceId,
        userId: user.id,
        apiKey
      }),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const testCase = await db.case.create({
      data: {
        workspaceId: member.workspaceId,
        createdByUserId: user.id,
        name: 'Agent QA - disposable'
      }
    });
    const graph = await db.graph.create({
      data: {
        workspaceId: member.workspaceId,
        userId: user.id,
        caseId: testCase.id,
        name: 'Agent QA graph',
        nodes: [],
        edges: [],
        notes: ''
      }
    });
    const worker = start(process.execPath, ['dist/agent-worker.cjs'], {
      env,
      stdio: ['ignore', logFd, logFd]
    });
    for (let attempt = 0; ; attempt++) {
      if (worker.exitCode !== null) throw new Error('Test worker exited.');
      if (
        await db.agentWorker.count({ where: { expiresAt: { gt: new Date() } } })
      )
        break;
      if (attempt > 100) throw new Error('Test worker unavailable.');
      await delay(250);
    }
    const info = {
      origin,
      graphId: graph.id,
      caseId: testCase.id,
      email: 'agent-qa@example.test'
    };
    fs.writeFileSync(
      path.join(output, 'environment.json'),
      JSON.stringify(info, null, 2),
      { mode: 0o600 }
    );
    console.log(JSON.stringify({ ready: true, ...info }));
    await done;
  } finally {
    clearTimeout(deadline);
    for (const child of children.reverse()) {
      if (child.exitCode !== null) continue;
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(5000)
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    if (db) await db.$disconnect();
    if (logFd !== undefined) fs.closeSync(logFd);
    if (created) mutate(['rm', '-f', name]);
  }
}
main().catch(() => {
  // Child command failures can include database credentials; keep output fixed.
  console.error(
    'Disposable agent environment failed; no credentials were logged.'
  );
  process.exitCode = 1;
});
