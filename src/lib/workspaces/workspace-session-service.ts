import { db } from '@/lib/db';
import { getWorkspacePolicy, generateVncPassword } from './workspace-policy';

// NOTE:
// In some local editor setups, Prisma Client types may not be hydrated (pnpm build approvals),
// which makes `db.workspaceSession` appear missing to TypeScript even though runtime works.
// Keep the rest of the file typed, but access the delegate via a narrow cast.
const workspaceSession = (db as any).workspaceSession as {
  count: (args: unknown) => Promise<number>;
  findMany: (args: unknown) => Promise<any[]>;
  findFirst: (args: unknown) => Promise<any | null>;
  create: (args: unknown) => Promise<any>;
  update: (args: unknown) => Promise<any>;
};

export interface CreateWorkspaceSessionArgs {
  workspaceId: string;
  createdByUserId: string;
  browser: 'chrome' | 'tor';
  targetUrl: string;
  requestOrigin: string;
}

export interface WorkspaceSessionView {
  id: string;
  browser: 'chrome' | 'tor';
  targetUrl: string;
  status: 'STARTING' | 'READY' | 'STOPPED' | 'FAILED';
  streamUrl: string | null;
  hostPort: number | null;
  vncPassword: string | null;
  expiresAt: string;
  error: string | null;
}

function isHttpUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildStreamUrl(args: { requestOrigin: string; sessionId: string; hostPort: number | null }) {
  const mode = String(process.env.WORKSPACES_STREAM_MODE ?? 'traefik');

  // Same-origin path behind reverse proxy (recommended).
  if (mode === 'traefik') {
    const origin = args.requestOrigin.replace(/\/$/, '');
    return `${origin}/w/${encodeURIComponent(args.sessionId)}/`;
  }

  // Direct port mode (debug/legacy).
  if (!args.hostPort) return null;
  const originUrl = new URL(args.requestOrigin);
  const protocol = (process.env.KASM_STREAM_PROTOCOL ?? 'https').replace(':', '');
  const hostname = originUrl.hostname;
  return `${protocol}://${hostname}:${args.hostPort}`;
}

function mapToView(args: {
  session: {
    id: string;
    browser: string;
    targetUrl: string;
    status: string;
    hostPort: number | null;
    vncPassword: string | null;
    expiresAt: Date;
    error: string | null;
  };
  requestOrigin: string;
}): WorkspaceSessionView {
  const hostPort = args.session.hostPort ?? null;
  return {
    id: args.session.id,
    browser: args.session.browser === 'tor' ? 'tor' : 'chrome',
    targetUrl: args.session.targetUrl,
    status:
      args.session.status === 'READY'
        ? 'READY'
        : args.session.status === 'STOPPED'
          ? 'STOPPED'
          : args.session.status === 'FAILED'
            ? 'FAILED'
            : 'STARTING',
    streamUrl: buildStreamUrl({
      requestOrigin: args.requestOrigin,
      sessionId: args.session.id,
      hostPort
    }),
    hostPort,
    vncPassword: args.session.vncPassword ?? null,
    expiresAt: args.session.expiresAt.toISOString(),
    error: args.session.error ?? null
  };
}

async function enforceSessionLimits(args: { workspaceId: string; createdByUserId: string }) {
  const policy = getWorkspacePolicy();
  const now = new Date();
  const activeWhere = {
    expiresAt: { gt: now },
    status: { in: ['STARTING', 'READY'] as string[] }
  };

  const [workspaceCount, userCount] = await Promise.all([
    workspaceSession.count({
      where: { workspaceId: args.workspaceId, ...activeWhere }
    }),
    workspaceSession.count({
      where: { workspaceId: args.workspaceId, createdByUserId: args.createdByUserId, ...activeWhere }
    })
  ]);

  if (workspaceCount >= policy.maxActiveSessionsPerWorkspace)
    throw new Error(`Limit reached: maximum ${policy.maxActiveSessionsPerWorkspace} active sessions per workspace.`);

  if (userCount >= policy.maxActiveSessionsPerUser)
    throw new Error(`Limit reached: maximum ${policy.maxActiveSessionsPerUser} active sessions per user.`);
}

async function cleanupExpiredWorkspaceSessions(args: { workspaceId: string }) {
  const now = new Date();
  const expired = (await workspaceSession.findMany({
    where: {
      workspaceId: args.workspaceId,
      expiresAt: { lte: now },
      status: { in: ['STARTING', 'READY'] },
      NOT: { containerId: null }
    },
    select: { id: true, containerId: true }
  })) as Array<{ id: string; containerId: string | null }>;

  if (!expired.length) return;

  await Promise.allSettled(
    expired.map(async (s: { id: string; containerId: string | null }) => {
      if (s.containerId) await stopKasmContainer({ sessionId: s.id, containerId: s.containerId });
      await workspaceSession.update({
        where: { id: s.id },
        data: { status: 'STOPPED', stoppedAt: new Date(), error: 'Expired (TTL)' }
      });
    })
  );
}

async function createKasmContainer(args: {
  sessionId: string;
  browser: 'chrome' | 'tor';
  targetUrl: string;
  vncPassword: string;
}): Promise<{ containerId: string; hostPort: number | null }> {
  const policy = getWorkspacePolicy();
  const image = args.browser === 'tor' ? policy.kasm.torImage : policy.kasm.chromeImage;

  if (!policy.runner.url) throw new Error('WORKSPACES_RUNNER_URL is not configured');

  const streamMode = String(process.env.WORKSPACES_STREAM_MODE ?? 'traefik');
  const traefikNetwork = process.env.WORKSPACES_TRAEFIK_NETWORK ?? 'paranod-network';
  const username = process.env.KASM_BASIC_AUTH_USERNAME ?? 'kasm_user';
  const authB64 = Buffer.from(`${username}:${args.vncPassword}`).toString('base64');
  const pathPrefix = `/w/${args.sessionId}`;
  const appArgs =
    args.browser === 'tor'
      ? (process.env.KASM_TOR_APP_ARGS ?? '--kiosk')
      : (process.env.KASM_SAFE_APP_ARGS ?? '--kiosk');

  const res = await fetch(`${policy.runner.url.replace(/\/$/, '')}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(policy.runner.token ? { Authorization: `Bearer ${policy.runner.token}` } : {})
    },
    body: JSON.stringify({
      sessionId: args.sessionId,
      image,
      env: {
        // Kasm images commonly use LAUNCH_URL; keep KASM_URL too for compatibility.
        LAUNCH_URL: args.targetUrl,
        KASM_URL: args.targetUrl,
        // Start the browser in kiosk mode so the system window decorations/titlebar
        // are hidden by default (can be overridden via env).
        APP_ARGS: appArgs,
        VNC_PW: args.vncPassword,
        KASM_SVC_AUDIO: '1',
        KASM_SVC_KEYBOARD: '1',
        KASM_SVC_CLIPBOARD: '1'
      },
      shmSizeBytes: policy.kasm.shmSizeBytes,
      memoryBytes: policy.kasm.memoryBytes,
      nanoCpus: policy.kasm.nanoCpus,
      ...(streamMode === 'port' ? { expose: { containerPort: 6901, hostPort: 0 } } : {}),
      networkMode: streamMode === 'traefik' ? traefikNetwork : undefined,
      labels:
        streamMode === 'traefik'
          ? {
              'traefik.enable': 'true',
              'traefik.docker.network': traefikNetwork,
              [`traefik.http.routers.ws-${args.sessionId}.rule`]: `PathPrefix(\`${pathPrefix}/\`)`,
              [`traefik.http.routers.ws-${args.sessionId}.entrypoints`]: 'web',
              [`traefik.http.routers.ws-${args.sessionId}.priority`]: '100',
              [`traefik.http.routers.ws-${args.sessionId}.middlewares`]: `ws-${args.sessionId}-strip,ws-${args.sessionId}-auth`,
              [`traefik.http.middlewares.ws-${args.sessionId}-strip.stripprefix.prefixes`]: `${pathPrefix}`,
              [`traefik.http.middlewares.ws-${args.sessionId}-auth.headers.customrequestheaders.Authorization`]: `Basic ${authB64}`,
              // IMPORTANT: When proxying same-origin, browsers send application cookies on `/w/<id>/websockify`.
              // Browser cookies can be large, and KasmVNC rejects oversized websocket handshakes.
              // Strip cookies before reaching KasmVNC.
              [`traefik.http.middlewares.ws-${args.sessionId}-auth.headers.customrequestheaders.Cookie`]: '',
              [`traefik.http.services.ws-${args.sessionId}.loadbalancer.server.port`]: '6901',
              [`traefik.http.services.ws-${args.sessionId}.loadbalancer.server.scheme`]: 'https',
              [`traefik.http.services.ws-${args.sessionId}.loadbalancer.serverstransport`]:
                'kasm-transport@file'
            }
          : undefined
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Container runner error (${res.status}): ${body || res.statusText}`);
  }

  const data = (await res.json()) as { containerId: string; hostPort: number | null };
  if (!data?.containerId) throw new Error('Container runner response incomplete');
  return {
    containerId: data.containerId,
    hostPort: typeof data.hostPort === 'number' ? Number(data.hostPort) : null
  };
}

async function stopKasmContainer(args: { sessionId: string; containerId: string }) {
  const policy = getWorkspacePolicy();

  if (!policy.runner.url) return;

  const res = await fetch(`${policy.runner.url.replace(/\/$/, '')}/sessions/${encodeURIComponent(args.sessionId)}`, {
    method: 'DELETE',
    headers: {
      ...(policy.runner.token ? { Authorization: `Bearer ${policy.runner.token}` } : {})
    }
  });
  if (!res.ok) return;
}

export async function createWorkspaceSession(
  args: CreateWorkspaceSessionArgs
): Promise<WorkspaceSessionView> {
  if (!isHttpUrl(args.targetUrl)) throw new Error('Invalid URL (HTTP/HTTPS only).');

  await cleanupExpiredWorkspaceSessions({ workspaceId: args.workspaceId });
  await enforceSessionLimits({
    workspaceId: args.workspaceId,
    createdByUserId: args.createdByUserId
  });

  const policy = getWorkspacePolicy();
  const now = Date.now();
  const expiresAt = new Date(now + policy.ttlMs);
  const vncPassword = generateVncPassword();

  const session = await workspaceSession.create({
    data: {
      workspaceId: args.workspaceId,
      createdByUserId: args.createdByUserId,
      kind: 'kasm',
      browser: args.browser,
      targetUrl: args.targetUrl,
      status: 'STARTING',
      expiresAt,
      vncPassword
    },
    select: {
      id: true,
      browser: true,
      targetUrl: true,
      status: true,
      hostPort: true,
      vncPassword: true,
      expiresAt: true,
      error: true
    }
  });

  try {
    const started = await createKasmContainer({
      sessionId: session.id,
      browser: args.browser,
      targetUrl: args.targetUrl,
      vncPassword
    });

    const updated = await workspaceSession.update({
      where: { id: session.id },
      data: {
        containerId: started.containerId,
        hostPort: started.hostPort,
        status: 'READY',
        readyAt: new Date()
      },
      select: {
        id: true,
        browser: true,
        targetUrl: true,
        status: true,
        hostPort: true,
        vncPassword: true,
        expiresAt: true,
        error: true
      }
    });

    return mapToView({ session: updated, requestOrigin: args.requestOrigin });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start the session.';
    const updated = await workspaceSession.update({
      where: { id: session.id },
      data: { status: 'FAILED', error: message, stoppedAt: new Date() },
      select: {
        id: true,
        browser: true,
        targetUrl: true,
        status: true,
        hostPort: true,
        vncPassword: true,
        expiresAt: true,
        error: true
      }
    });
    return mapToView({ session: updated, requestOrigin: args.requestOrigin });
  }
}

export async function getWorkspaceSessionById(args: {
  workspaceId: string;
  sessionId: string;
  requestOrigin: string;
}): Promise<WorkspaceSessionView | null> {
  const session = await workspaceSession.findFirst({
    where: { id: args.sessionId, workspaceId: args.workspaceId },
    select: {
      id: true,
      browser: true,
      targetUrl: true,
      status: true,
      hostPort: true,
      vncPassword: true,
      expiresAt: true,
      error: true
    }
  });
  if (!session) return null;
  return mapToView({ session, requestOrigin: args.requestOrigin });
}

export async function listActiveWorkspaceSessions(args: {
  workspaceId: string;
  requestOrigin: string;
}): Promise<WorkspaceSessionView[]> {
  await cleanupExpiredWorkspaceSessions({ workspaceId: args.workspaceId });
  const now = new Date();
  const sessions = await workspaceSession.findMany({
    where: {
      workspaceId: args.workspaceId,
      expiresAt: { gt: now },
      status: { in: ['STARTING', 'READY'] }
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      browser: true,
      targetUrl: true,
      status: true,
      hostPort: true,
      vncPassword: true,
      expiresAt: true,
      error: true
    }
  });
  return (sessions as any[]).map((session: any) => mapToView({ session, requestOrigin: args.requestOrigin }));
}

export async function stopWorkspaceSession(args: {
  workspaceId: string;
  sessionId: string;
}): Promise<boolean> {
  const session = await workspaceSession.findFirst({
    where: { id: args.sessionId, workspaceId: args.workspaceId },
    select: { id: true, status: true, containerId: true }
  });
  if (!session) return false;

  const containerId = session.containerId;
  if (containerId) await stopKasmContainer({ sessionId: session.id, containerId });

  await workspaceSession.update({
    where: { id: session.id },
    data: { status: 'STOPPED', stoppedAt: new Date() }
  });

  return true;
}

export async function stopWorkspaceSessionForUser(args: {
  workspaceId: string;
  userId: string;
  sessionId: string;
}): Promise<boolean> {
  const session = await workspaceSession.findFirst({
    where: {
      id: args.sessionId,
      workspaceId: args.workspaceId,
      createdByUserId: args.userId
    },
    select: { id: true, containerId: true }
  });
  if (!session) return false;

  if (session.containerId)
    await stopKasmContainer({ sessionId: session.id, containerId: session.containerId });

  await workspaceSession.update({
    where: { id: session.id },
    data: { status: 'STOPPED', stoppedAt: new Date(), error: 'Stopped by user' }
  });
  return true;
}

export async function cleanupWorkspaceSessionsForUser(args: {
  workspaceId: string;
  userId: string;
  keepSessionIds: string[];
  confirmNoTabs: boolean;
}): Promise<{ stopped: number }> {
  const now = new Date();
  const keep = new Set(args.keepSessionIds.map((v) => String(v)));

  // Safety guard: an empty keep list is ambiguous (it can happen before client-side hydration).
  // Only allow "stop all sessions" when the client explicitly confirms there are no open tabs.
  if (keep.size === 0 && !args.confirmNoTabs) return { stopped: 0 };

  const sessions = (await workspaceSession.findMany({
    where: {
      workspaceId: args.workspaceId,
      createdByUserId: args.userId,
      expiresAt: { gt: now },
      status: { in: ['STARTING', 'READY'] },
      ...(keep.size ? { id: { notIn: Array.from(keep) } } : {})
    },
    select: { id: true, containerId: true }
  })) as Array<{ id: string; containerId: string | null }>;

  if (!sessions.length) return { stopped: 0 };

  await Promise.allSettled(
    sessions.map(async (s: { id: string; containerId: string | null }) => {
      if (s.containerId) await stopKasmContainer({ sessionId: s.id, containerId: s.containerId });
      await workspaceSession.update({
        where: { id: s.id },
        data: { status: 'STOPPED', stoppedAt: new Date(), error: 'Cleaned up (no open tab)' }
      });
    })
  );

  return { stopped: sessions.length };
}
