import crypto from 'crypto';

export interface WorkspacePolicy {
  ttlMs: number;
  maxActiveSessionsPerWorkspace: number;
  maxActiveSessionsPerUser: number;
  kasm: {
    chromeImage: string;
    torImage: string;
    shmSizeBytes: number;
    memoryBytes: number;
    nanoCpus: number;
  };
  runner: {
    url: string | null;
    token: string | null;
  };
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function parsePositiveFloat(value: string | undefined, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function getWorkspacePolicy(): WorkspacePolicy {
  const ttlMinutes = parsePositiveInt(process.env.WORKSPACES_TTL_MINUTES, 30);
  const maxActiveSessionsPerWorkspace = parsePositiveInt(
    process.env.WORKSPACES_MAX_ACTIVE_SESSIONS_PER_ORG,
    20
  );
  const maxActiveSessionsPerUser = parsePositiveInt(
    process.env.WORKSPACES_MAX_ACTIVE_SESSIONS_PER_USER,
    3
  );

  const shmSizeMb = parsePositiveInt(process.env.KASM_SHM_SIZE_MB, 512);
  const memoryMb = parsePositiveInt(process.env.KASM_MEMORY_MB, 1024);
  const cpuCores = parsePositiveFloat(process.env.KASM_CPU_CORES, 1);

  return {
    ttlMs: ttlMinutes * 60 * 1000,
    maxActiveSessionsPerWorkspace,
    maxActiveSessionsPerUser,
    kasm: {
      // NOTE: Kasm images typically do NOT publish a `latest` tag on Docker Hub.
      // Prefer pinned rolling tags by default, but allow override via env.
      chromeImage: process.env.KASM_CHROME_IMAGE ?? 'kasmweb/chrome:1.15.0-rolling',
      torImage: process.env.KASM_TOR_IMAGE ?? 'kasmweb/tor-browser:1.15.0-rolling',
      shmSizeBytes: shmSizeMb * 1024 * 1024,
      memoryBytes: memoryMb * 1024 * 1024,
      nanoCpus: Math.max(1, Math.floor(cpuCores * 1_000_000_000))
    },
    runner: {
      url: process.env.WORKSPACES_RUNNER_URL ?? null,
      token: process.env.WORKSPACES_RUNNER_TOKEN ?? null
    }
  };
}

export function generateVncPassword() {
  return crypto.randomBytes(18).toString('base64url');
}
