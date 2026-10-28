/**
 * Runner — astrazione per l'esecuzione di container (tool OSINT, workspace).
 *
 * OSS: LocalDockerRunner (container-runner sul Docker dell'utente).
 */

export interface RunnerJob {
  /** Immagine Docker da eseguire. */
  image: string;
  /** argv completo dentro il container. */
  cmd: string[];
  /** Timeout esecuzione in ms. */
  timeoutMs: number;
}

export interface RunnerResult {
  exitCode: number | null;
  output: string;
}

export interface Runner {
  run(job: RunnerJob): Promise<RunnerResult>;
}
