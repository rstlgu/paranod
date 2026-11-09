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

The agent can discover and execute enabled builtin plugins, installed synchronous and asynchronous addons, and the registered Sherlock, Maigret and Holehe container tools. They all use `run_transform`: the server waits for the operation, validates its result and imports it into the graph before the model continues. Provider configuration, images, command arguments and credentials are selected by application code, not by the model.

Asynchronous addons with `pollingEndpoint` use signed outbound status requests. The platform may remain on local HTTP. Legacy asynchronous addons can use callbacks when the platform has a reachable HTTPS address; discovery marks those actions unavailable on HTTP installations. The agent displays waiting/progress activity and rechecks its graph lease, permissions and exact approved configuration before each poll and before importing results. Agent-owned polling is not dispatched by the generic maintenance worker. Stop ends polling, settles the local job as cancelled and prevents late graph writes; it cannot undo work already started at the provider. A crashed agent run is not automatically replayed. A database relation associates each addon job with its run. Run termination cancels pending owned jobs, and maintenance clears orphaned jobs after the run or its graph lease expires; manual addon jobs are unaffected.

Remote addons require HTTPS. Explicit hostnames in the administrator's `PARANOD_ADDON_ALLOWED_HOSTS` also apply to agent addon requests, allowing a trusted local addon service. Certificate validation remains active, and every request uses DNS validation, bounded responses and disabled redirects. Endpoint URLs, manifest tokens and signing secrets remain server-side. Recognized graph entity types, including wallets and note text, can be inputs; credential/payment entities, request headers and arbitrary file contents remain excluded. Note outputs become observations.

Container tools use the configured local runner. Rebuild both the app and runner when upgrading (`docker/compose.sh --profile agent up -d --build`). The agent checks runner protocol 2 and cancellation/image capabilities before submitting a container job; an older runner is rejected with an upgrade message. Each job resolves the allowlisted image to an immutable local image ID before creation; image tags remain administrator-managed. The tool registry constructs the command from the selected node. The runner applies its dedicated job network, CPU, memory and process limits, drops capabilities, and removes each job container after completion. Aborting the agent closes the request and kills that container. A timeout or nonzero exit is a failed operation, not evidence that no account exists. Tool findings are imported as unverified leads. Container code still needs to be trusted by the administrator; the dedicated Docker network is not an outbound destination firewall.

Limits are explicit: ordinary module calls have a two-minute budget, container tools three minutes, asynchronous addons eight minutes, and an entire agent run ten minutes. These bounds are shared with cancellation and do not permit the model to repeat an operation to evade a limit. The configured runner and required addon/provider credentials must be available. See [Addon compatibility](ADDON-SECURITY-AND-PUBLISHING.md#agent-compatibility).

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

For real PostgreSQL, SDK HTTP and worker lifecycle checks, build the companion addon SDK and run:

```sh
PARANOD_TEST_DOCKER_CONTEXT=<verified-context> \
PARANOD_TEST_ADDON_SDK_DIST=/absolute/path/to/paranod-addon-sdk/dist \
node scripts/test-graph-agent-lease.cjs
```

The harness creates a disposable database and uses a deterministic model; it makes no live AI provider calls. Runner HTTP/cancellation tests use a disposable Docker API double: `cd services/container-runner && npm test`.
