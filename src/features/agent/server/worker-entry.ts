import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { AGENT_QUEUE, createAgentQueue, initializeAgentQueue } from './queue';
import {
  AGENT_WORKER_HEARTBEAT_MS,
  AGENT_WORKER_QUEUE,
  heartbeatAgentWorker,
  removeAgentWorker
} from './readiness';

async function main() {
  if (process.env.PARANOD_AGENT_WORKER_ENABLED !== 'true') {
    process.stdout.write('[agent] Worker disabled.\n');
    return;
  }
  if (!process.env.DATABASE_URL)
    throw new Error('agent_database_not_configured');
  if (!process.env.SECRETS_ENCRYPTION_KEY)
    throw new Error('agent_encryption_key_not_configured');
  if (AGENT_QUEUE !== AGENT_WORKER_QUEUE)
    throw new Error('agent_worker_protocol_mismatch');

  // Install the quiet client before loading modules that use the shared client.
  // Prisma errors can include connection URLs, so never enable its raw logging.
  const db = new PrismaClient({ log: [] });
  global.prisma = db;
  const { processAgentJob } = await import('./worker');
  const { getWorkspaceAgentProvider } = await import('./provider');
  const queue = createAgentQueue(process.env.DATABASE_URL);
  const workerId = randomUUID();
  const abort = new AbortController();
  let startup: Promise<void> = Promise.resolve();
  let heartbeat: Promise<void> = Promise.resolve();
  let stopping: Promise<void> | undefined;
  const stop = () => {
    if (stopping) return stopping;
    abort.abort();
    const deadline = setTimeout(() => {
      process.stderr.write('[agent] Worker shutdown timed out.\n');
      process.exit(1);
    }, 25_000);
    deadline.unref();
    stopping = (async () => {
      // Drain any in-flight heartbeat before removal, including startup writes.
      await startup.catch(() => undefined);
      await heartbeat;
      await removeAgentWorker(db, workerId).catch(() => {
        process.stderr.write(
          '[agent] Readiness removal failed; it will expire.\n'
        );
      });
      try {
        await queue.stop({ graceful: true, timeout: 20_000 });
      } finally {
        await db.$disconnect();
        clearTimeout(deadline);
        process.removeListener('SIGTERM', onSignal);
        process.removeListener('SIGINT', onSignal);
      }
    })();
    return stopping;
  };
  const onSignal = () => {
    void stop().catch(() => {
      process.exitCode = 1;
      process.stderr.write('[agent] Worker shutdown failed.\n');
    });
  };
  const failClosed = () => {
    process.exitCode = 1;
    process.stderr.write('[agent] Worker unavailable; stopping execution.\n');
    onSignal();
  };
  queue.on('error', failClosed);
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  try {
    startup = (async () => {
      await initializeAgentQueue(queue);
      abort.signal.throwIfAborted();
      await queue.work(
        AGENT_QUEUE,
        { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 1 },
        async (jobs) => {
          try {
            for (const job of jobs) {
              abort.signal.throwIfAborted();
              const { runId } = z
                .object({ runId: z.string().uuid() })
                .strict()
                .parse(job.data);
              await processAgentJob({
                db,
                runId,
                signal: abort.signal,
                getProvider: getWorkspaceAgentProvider
              });
            }
          } catch {
            // pg-boss persists callback failures. Never give it raw SDK/DB errors.
            throw new Error('agent_job_failed');
          }
        }
      );
      abort.signal.throwIfAborted();
      await heartbeatAgentWorker(db, workerId);
      abort.signal.throwIfAborted();
      heartbeat = (async () => {
        try {
          while (!abort.signal.aborted) {
            await delay(AGENT_WORKER_HEARTBEAT_MS, undefined, {
              signal: abort.signal
            });
            await heartbeatAgentWorker(db, workerId);
          }
        } catch {
          if (!abort.signal.aborted) failClosed();
        }
      })();
      process.stdout.write('[agent] Worker ready.\n');
    })();
    await startup;
  } catch (error) {
    const interrupted = abort.signal.aborted;
    await stop();
    if (interrupted && process.exitCode !== 1) return;
    throw error instanceof Error
      ? error
      : new Error('agent_worker_start_failed');
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : '';
  const publicCodes = new Set([
    'agent_database_not_configured',
    'agent_encryption_key_not_configured',
    'agent_worker_protocol_mismatch'
  ]);
  const code = publicCodes.has(message) ? message : 'agent_worker_start_failed';
  process.stderr.write(`[agent] Worker unavailable (${code}).\n`);
  process.exitCode = 1;
});
