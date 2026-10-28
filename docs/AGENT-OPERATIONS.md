# Agent operations

## Enable and configure

Enable `PARANOD_AGENT_WORKER_ENABLED=true` and the Compose `agent` profile in `.env.docker`, then start the stack with `docker/compose.sh up -d --build`. An administrator configures provider credentials in Settings → Graph agent. Credentials are encrypted in PostgreSQL using the persistent application key. The worker reads the credential and uploaded-file encryption keys from the read-only application volume.

Image operations use the persisted run owner's workspace access. The worker checks current membership before decrypting an uploaded image; it does not rely on browser cookies or HTTP request headers. External image URLs remain subject to public-network validation and response-size limits.

Both a usable provider configuration and a current worker heartbeat are required to start a run. `/api/health` and container logs help diagnose deployment problems. The worker does not migrate the application database; it starts after the web application's health check passes.

The operator command `node dist/agent-configure.cjs` accepts configuration through standard input for an existing workspace administrator. Avoid credentials in command-line arguments, shell history or logs. The graph agent's credentials are independent from the AI Analysis plugin.

## Graph ownership and recovery

Starting a run confirms pending saves, checks the graph snapshot and atomically records the run, lease and queue job. While the agent owns the graph, browsing and selection remain available but conflicting manual writes are blocked. Revision checks and lease fencing prevent an old request or stale worker from overwriting newer state.

Stop revokes ownership and aborts work. Requests already sent to a provider may still incur charges. A crashed run is not blindly replayed. When a run finishes, the editor reloads the authoritative graph before re-enabling writes; if that reload fails, editing stays protected and local drafts can be exported.

## Approvals and tool access

The selected policy is stored with each run and enforced by application code:

- `ask` requests confirmation for transformations and graph changes.
- `guarded` requests confirmation for external transformations and inferred relationships.
- `auto` permits supported operations without interactive confirmation, while retaining validation, permissions and resource limits.

The model first discovers a bounded list of modules, then requests a detailed description of the selected operation. Execution revalidates the module, its configuration and the graph lease. Changing module configuration invalidates an earlier approval.

Only reviewed builtin operations and supported synchronous addons are available to the agent. Container tools and asynchronous addon operations remain outside the implemented agent path. A module visible in the manual catalogue is not automatically available to the agent. Keep those capability boundaries explicit when adding tools.

## Results and context

Tool results become graph data only after validation. Inferred relationships remain hypotheses, and source information must be evaluated by the user. When capacity limits produce a partial import, the agent reports the omission rather than repeating the operation to bypass the limit.

Conversation checkpoints preserve context across related requests. Compaction summarizes prior exchanges without granting approvals, introducing authorized targets or replaying completed tools. Clear context starts a new memory boundary while preserving visible messages and graph data.

The UI reports estimated context occupation and provider-reported token usage when available. These numbers are diagnostic and do not represent an exact monetary limit. Time, tool-call, payload and graph-capacity limits protect the instance. Their implementation is in the agent server's limits, context and gateway modules.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm build:agent
pnpm build
```

Database and browser integration tests must use disposable environments. `scripts/test-graph-agent-lease.cjs` requires an explicit `PARANOD_TEST_DOCKER_CONTEXT`; it must not use the application's database. Live provider calls are opt-in, use real account usage and require a separately supplied test configuration.
