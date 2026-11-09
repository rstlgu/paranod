const secret = process.env.CRON_SECRET;
if (!secret) {
  throw new Error('CRON_SECRET is required for the maintenance worker');
}

const configuredInterval = Number(
  process.env.MAINTENANCE_INTERVAL_MS || 300_000
);
const intervalMs = Number.isFinite(configuredInterval)
  ? Math.min(Math.max(configuredInterval, 60_000), 3_600_000)
  : 300_000;
const endpoints = ['/api/cron/check-timeouts', '/api/cron/purge-history'];

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function runMaintenance() {
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`http://127.0.0.1:3000${endpoint}`, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) {
        console.error(
          `[maintenance] ${endpoint} returned HTTP ${response.status}`
        );
      }
    } catch (error) {
      console.error(`[maintenance] ${endpoint} failed:`, error);
    }
  }
}

async function maintenanceLoop() {
  await sleep(20_000);
  while (true) {
    await runMaintenance();
    await sleep(intervalMs);
  }
}

async function addonPollingLoop() {
  await sleep(5_000);
  while (true) {
    try {
      const response = await fetch(
        'http://127.0.0.1:3000/api/cron/poll-addons',
        {
          headers: { Authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(20_000)
        }
      );
      if (!response.ok)
        console.error(
          `[maintenance] Addon polling returned HTTP ${response.status}`
        );
    } catch {
      console.error('[maintenance] Addon polling temporarily unavailable');
    }
    await sleep(5_000);
  }
}

await Promise.all([maintenanceLoop(), addonPollingLoop()]);
