/**
 * LocalDockerRunner (OSS) — esegue container tramite il `container-runner` locale
 * (endpoint /jobs/run). Compute sull'host dell'utente.
 */

import { getWorkspacePolicy } from '@/lib/workspaces/workspace-policy';
import type { Runner, RunnerJob, RunnerResult } from './types';

export class LocalDockerRunner implements Runner {
  async run(job: RunnerJob): Promise<RunnerResult> {
    const policy = getWorkspacePolicy();
    if (!policy.runner.url) throw new Error('container_runner_not_configured');

    const res = await fetch(`${policy.runner.url.replace(/\/$/, '')}/jobs/run`, {
      method: 'POST',
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
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`runner_error_${res.status}:${body || res.statusText}`);
    }

    const data = (await res.json()) as {
      exitCode: number | null;
      output: string;
    };
    return { exitCode: data.exitCode ?? null, output: data.output ?? '' };
  }
}
