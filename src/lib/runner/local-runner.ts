/**
 * LocalDockerRunner (OSS) — esegue container tramite il `container-runner` locale
 * (endpoint /jobs/run). Compute sull'host dell'utente.
 */

import { getWorkspacePolicy } from '@/lib/workspaces/workspace-policy';
import type { Runner, RunnerJob, RunnerResult } from './types';

export class LocalDockerRunner implements Runner {
  async run(
    job: RunnerJob,
    options?: { signal?: AbortSignal; requireCancellation?: boolean }
  ): Promise<RunnerResult> {
    const policy = getWorkspacePolicy();
    if (!policy.runner.url) throw new Error('container_runner_not_configured');
    options?.signal?.throwIfAborted();
    if (options?.requireCancellation) {
      const readiness = await fetch(
        `${policy.runner.url.replace(/\/$/, '')}/healthz`,
        {
          headers: policy.runner.token
            ? { Authorization: `Bearer ${policy.runner.token}` }
            : {},
          signal: AbortSignal.any([
            ...(options.signal ? [options.signal] : []),
            AbortSignal.timeout(5000)
          ]),
          redirect: 'error'
        }
      );
      const status = readiness.ok ? await readiness.json() : null;
      if (
        status?.protocolVersion !== 2 ||
        status?.capabilities?.cancellableJobs !== true ||
        status?.capabilities?.immutableJobImages !== true
      )
        throw new Error('container_runner_upgrade_required');
    }

    const res = await fetch(
      `${policy.runner.url.replace(/\/$/, '')}/jobs/run`,
      {
        method: 'POST',
        signal: AbortSignal.any([
          ...(options?.signal ? [options.signal] : []),
          AbortSignal.timeout(job.timeoutMs + 15_000)
        ]),
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(policy.runner.token
            ? { Authorization: `Bearer ${policy.runner.token}` }
            : {})
        },
        body: JSON.stringify({
          image: job.image,
          cmd: job.cmd,
          timeoutMs: job.timeoutMs
        })
      }
    );

    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`runner_error_${res.status}`);
    }

    const data = (await res.json()) as {
      exitCode: number | null;
      output: string;
    };
    return { exitCode: data.exitCode ?? null, output: data.output ?? '' };
  }
}
