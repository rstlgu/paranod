import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { URL } from 'node:url';
import Docker from 'dockerode';
import { z } from 'zod';

const PORT = Number(process.env.PORT ?? 4050);
const DOCKER_SOCKET_PATH =
  process.env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock';
const RUNNER_TOKEN = process.env.RUNNER_TOKEN ?? null;
if (!RUNNER_TOKEN || RUNNER_TOKEN.length < 32)
  throw new Error('RUNNER_TOKEN must contain at least 32 characters');
let activeJobs = 0;
const MAX_CONCURRENT_JOBS = Math.max(
  1,
  Math.min(16, Number(process.env.RUNNER_MAX_CONCURRENT_JOBS) || 4)
);
const RUNNER_JOB_NETWORK = process.env.RUNNER_JOB_NETWORK || 'bridge';
const RUNNER_NETWORK = process.env.RUNNER_NETWORK ?? null;
const RUNNER_INSTANCE = process.env.RUNNER_INSTANCE || 'paranod';
if (!/^[a-zA-Z0-9_-]+$/.test(RUNNER_INSTANCE))
  throw new Error('RUNNER_INSTANCE must be a valid container name prefix');
if (
  ['host', 'paranod-network', RUNNER_NETWORK].includes(RUNNER_JOB_NETWORK) ||
  RUNNER_JOB_NETWORK.startsWith('container:')
)
  throw new Error('Jobs must use a dedicated network');
const DEFAULT_ALLOWED_IMAGES = [
  'kasmweb/chrome:1.15.0-rolling',
  'kasmweb/tor-browser:1.15.0-rolling',
  'soxoj/maigret:latest',
  'sherlock/sherlock:latest',
  'python:3.11-slim'
];

const docker = new Docker({ socketPath: DOCKER_SOCKET_PATH });
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

if (!RUNNER_TOKEN) {
  throw new Error('RUNNER_TOKEN is required');
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return null;
  return JSON.parse(raw);
}

function isAuthorized(req) {
  if (!RUNNER_TOKEN) return false;
  const auth = req.headers['authorization'];
  if (!auth) return false;
  const expected = Buffer.from(`Bearer ${RUNNER_TOKEN}`);
  const provided = Buffer.from(auth);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

function getAllowedImages() {
  const raw = String(process.env.RUNNER_ALLOWED_IMAGES ?? '').trim();
  const list = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (list.length) return new Set(list);

  // Safe defaults cover every built-in workspace and container tool.
  return new Set(DEFAULT_ALLOWED_IMAGES);
}

function assertAllowedImage(image) {
  const allow = getAllowedImages();
  if (allow.has(image)) return;
  throw new Error('image_not_allowed');
}

function decodeDockerLogs(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value ?? '');
  const stdout = [];
  const stderr = [];
  const combined = [];
  let offset = 0;

  while (offset + 8 <= buffer.length) {
    const stream = buffer[offset];
    const size = buffer.readUInt32BE(offset + 4);
    const end = offset + 8 + size;
    if ((stream !== 1 && stream !== 2) || end > buffer.length) {
      const raw = buffer.toString('utf8');
      return { stdout: raw, stderr: '', combined: raw };
    }

    const chunk = buffer.subarray(offset + 8, end).toString('utf8');
    combined.push(chunk);
    if (stream === 1) stdout.push(chunk);
    else stderr.push(chunk);
    offset = end;
  }

  if (offset !== buffer.length) {
    const raw = buffer.toString('utf8');
    return { stdout: raw, stderr: '', combined: raw };
  }

  return {
    stdout: stdout.join(''),
    stderr: stderr.join(''),
    combined: combined.join('')
  };
}

async function ensureImageAvailable(image) {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch {
    // not present locally -> pull
  }

  const stream = await docker.pull(image);
  await new Promise((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err) => {
        if (err) reject(err);
        else resolve(null);
      },
      () => {}
    );
  });
}

const createSessionSchema = z.object({
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  image: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
  labels: z.record(z.string(), z.string()).optional(),
  networkMode: z.string().optional(),
  shmSizeBytes: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024 * 1024)
    .optional(),
  memoryBytes: z
    .number()
    .int()
    .min(64 * 1024 * 1024)
    .max(4 * 1024 * 1024 * 1024)
    .optional(),
  nanoCpus: z.number().int().min(100_000_000).max(4_000_000_000).optional(),
  expose: z
    .object({
      containerPort: z.number().int().positive(),
      hostPort: z.number().int().nonnegative()
    })
    .optional()
});

const runJobSchema = z.object({
  jobId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,128}$/)
    .optional(),
  image: z.string().min(1),
  cmd: z.array(z.string().max(16384)).min(1).max(128),
  env: z.record(z.string(), z.string()).optional(),
  workdir: z.string().optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  memoryBytes: z
    .number()
    .int()
    .min(64 * 1024 * 1024)
    .max(4 * 1024 * 1024 * 1024)
    .optional(),
  nanoCpus: z.number().int().min(100_000_000).max(4_000_000_000).optional()
});

async function createSession(body) {
  const parsed = createSessionSchema.parse(body);
  assertAllowedImage(parsed.image);
  await ensureImageAvailable(parsed.image);

  const name = `${RUNNER_INSTANCE}-ws-${parsed.sessionId}`;
  const networkMode = RUNNER_NETWORK || 'bridge';
  if (parsed.networkMode && parsed.networkMode !== networkMode)
    throw new Error('network_not_allowed');
  const exposedKey = parsed.expose
    ? `${parsed.expose.containerPort}/tcp`
    : null;

  const container = await docker.createContainer({
    name,
    Image: parsed.image,
    Env: Object.entries(parsed.env ?? {}).map(([k, v]) => `${k}=${v}`),
    ...(exposedKey ? { ExposedPorts: { [exposedKey]: {} } } : {}),
    Labels: {
      'paranod.kind': 'workspace',
      'paranod.sessionId': parsed.sessionId,
      ...(parsed.labels ?? {}),
      'paranod.instance': RUNNER_INSTANCE
    },
    HostConfig: {
      // Keep session containers until explicitly stopped.
      // This prevents Traefik from returning 502 if the container exits/restarts briefly,
      // and makes debugging easier (we can inspect logs/status after exit).
      AutoRemove: false,
      ShmSize: parsed.shmSizeBytes ?? 512 * 1024 * 1024,
      Memory: parsed.memoryBytes ?? 1024 * 1024 * 1024,
      NanoCpus: parsed.nanoCpus ?? 1_000_000_000,
      PidsLimit: 512,
      SecurityOpt: ['no-new-privileges'],
      LogConfig: {
        Type: 'json-file',
        Config: { 'max-size': '2m', 'max-file': '1' }
      },
      NetworkMode: networkMode,
      ...(exposedKey
        ? {
            PortBindings: {
              [exposedKey]: [
                {
                  HostIp: '127.0.0.1',
                  HostPort: String(parsed.expose?.hostPort ?? 0)
                }
              ]
            }
          }
        : {})
    }
  });

  await container.start();

  const inspected = await container.inspect();

  if (!exposedKey) {
    return { containerId: inspected.Id, hostPort: null };
  }

  const ports = inspected?.NetworkSettings?.Ports?.[exposedKey];
  const hostPortRaw = Array.isArray(ports) ? ports[0]?.HostPort : null;
  const hostPort = hostPortRaw ? Number(hostPortRaw) : NaN;
  if (!Number.isFinite(hostPort) || hostPort <= 0)
    throw new Error('port_bind_failed');

  return { containerId: inspected.Id, hostPort };
}

async function deleteSession(sessionId) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId))
    throw new Error('invalid_session_id');
  const name = `${RUNNER_INSTANCE}-ws-${sessionId}`;
  try {
    const container = docker.getContainer(name);
    const inspected = await container.inspect();
    if (inspected.Config?.Labels?.['paranod.instance'] !== RUNNER_INSTANCE)
      throw new Error('session_instance_mismatch');
    await container.stop({ t: 10 }).catch(() => {});
    await container.remove({ force: true }).catch(() => {});
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

async function runJob(body) {
  const parsed = runJobSchema.parse(body);
  assertAllowedImage(parsed.image);
  await ensureImageAvailable(parsed.image);

  const name = parsed.jobId
    ? `${RUNNER_INSTANCE}-job-${parsed.jobId}`
    : undefined;
  const timeoutMs = parsed.timeoutMs ?? 120_000;

  const container = await docker.createContainer({
    ...(name ? { name } : {}),
    Image: parsed.image,
    Cmd: parsed.cmd,
    Env: Object.entries(parsed.env ?? {}).map(([k, v]) => `${k}=${v}`),
    WorkingDir: parsed.workdir,
    Tty: false,
    AttachStdout: true,
    AttachStderr: true,
    Labels: {
      'paranod.kind': 'job',
      'paranod.instance': RUNNER_INSTANCE,
      ...(parsed.jobId ? { 'paranod.jobId': parsed.jobId } : {})
    },
    HostConfig: {
      AutoRemove: false,
      Memory: parsed.memoryBytes ?? 512 * 1024 * 1024,
      NanoCpus: parsed.nanoCpus ?? 1_000_000_000,
      PidsLimit: 128,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      NetworkMode: RUNNER_JOB_NETWORK,
      LogConfig: {
        Type: 'json-file',
        Config: { 'max-size': '2m', 'max-file': '1' }
      }
    }
  });

  const startedAt = Date.now();
  try {
    await container.start();

    const timeout = setTimeout(() => {
      void container.kill().catch(() => {});
    }, timeoutMs);

    let statusCode = null;
    try {
      const res = await container.wait();
      statusCode = Number(res?.StatusCode ?? null);
    } finally {
      clearTimeout(timeout);
    }

    const stream = await container.logs({
      stdout: true,
      stderr: true,
      timestamps: false,
      follow: true
    });
    const chunks = [];
    let outputBytes = 0;
    for await (const chunk of stream) {
      outputBytes += chunk.length;
      if (outputBytes > 2_000_000) {
        stream.destroy();
        throw new Error('output_limit_exceeded');
      }
      chunks.push(chunk);
    }
    const logs = Buffer.concat(chunks);

    const decodedLogs = decodeDockerLogs(logs);

    return {
      exitCode: Number.isFinite(statusCode) ? statusCode : null,
      durationMs: Date.now() - startedAt,
      output: decodedLogs.combined,
      stdout: decodedLogs.stdout,
      stderr: decodedLogs.stderr
    };
  } finally {
    await container.remove({ force: true }).catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return sendJson(res, 400, { error: 'bad_request' });
    if (!isAuthorized(req))
      return sendJson(res, 401, { error: 'unauthorized' });

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';

    if (method === 'GET' && url.pathname === '/healthz')
      return sendJson(res, 200, { ok: true });

    if (method === 'POST' && url.pathname === '/sessions') {
      const body = await readJson(req);
      const data = await createSession(body);
      return sendJson(res, 200, data);
    }

    if (method === 'DELETE' && url.pathname.startsWith('/sessions/')) {
      const sessionId = decodeURIComponent(
        url.pathname.split('/').slice(2).join('/')
      );
      const data = await deleteSession(sessionId);
      return sendJson(res, 200, data);
    }

    if (method === 'POST' && url.pathname === '/jobs/run') {
      const body = await readJson(req);
      if (activeJobs >= MAX_CONCURRENT_JOBS)
        return sendJson(res, 429, { error: 'runner_busy' });
      activeJobs++;
      try {
        const data = await runJob(body);
        return sendJson(res, 200, data);
      } finally {
        activeJobs--;
      }
    }

    return sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'internal_error';
    // Do not log command arguments because they can contain investigation targets.
    console.error('container-runner request failed', {
      method: req.method,
      path: req.url,
      error: message
    });
    return sendJson(
      res,
      error instanceof z.ZodError
        ? 400
        : message === 'request_too_large'
          ? 413
          : 500,
      { error: error instanceof z.ZodError ? 'invalid_request' : message }
    );
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`container-runner listening on :${server.address().port}`);
});
