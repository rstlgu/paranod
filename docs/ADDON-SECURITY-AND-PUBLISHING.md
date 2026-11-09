# Plugins and addons

## Execution models

| Type           | Execution             | Configuration                              |
| -------------- | --------------------- | ------------------------------------------ |
| Builtin plugin | Application server    | Administrator-supplied provider keys       |
| External addon | Separate HTTP service | Personalized manifest URL and registration |
| Container tool | Local Docker runner   | Allowlisted image and resource limits      |

An addon does not load JavaScript into the browser or the Paranod server process. It exposes a manifest, registration endpoint and one or more transformation endpoints. The addon author remains responsible for its own server and any external services it uses.

All three extension models are available in the self-hosted application. Workspace identifiers and installation secrets separate installations and access; they do not represent subscriptions. A provider can charge for its own API without changing how Paranod is installed or licensed.

The optional store link helps users discover addons. It is configured with `NEXT_PUBLIC_ADDON_STORE_URL` when building the application. An administrator can also install directly from a manifest URL without using a store.

## Installation and execution

1. An administrator enters the personalized manifest URL. Treat this URL as a credential; do not publish it in screenshots, logs or source code.
2. Paranod validates the manifest and resolves the declared destinations with request size bounds, timeouts, redirect controls, DNS pinning and SSRF protection.
3. The review step describes the provider, destinations and execution model before registration.
4. Registration establishes a per-workspace signing secret. Paranod encrypts the stored manifest, URL and secret.
5. Execution and polling requests carry a workspace identifier, timestamp, nonce and HMAC signature. Synchronous results return directly. For asynchronous transforms declaring `pollingEndpoint`, Paranod requests status and results from that endpoint; it sends no callback URL.
6. Database leases coordinate polling from the UI, background maintenance and replicas. Conditional updates prevent a late response from overwriting cancellation or completion. Failed network requests retry with bounded backoff; they never resubmit the transform. The existing 30-minute job timeout still applies. Legacy callbacks retain event deduplication.

Disabling a module prevents execution. Reinstallation and removal are rejected while its jobs are active, so credentials are not rotated underneath in-flight jobs.

### Network requirements

Paranod 2.1 and [Paranod addon SDK](https://github.com/rstlgu/paranod-addon-sdk) 0.5 support an HTTP platform URL, including localhost and LAN installations. `APP_URL` and `BETTER_AUTH_URL` identify the address used to open Paranod. The SDK stores this address as installation metadata; registration does not contact it. The external addon service still uses HTTPS with normal certificate validation.

| Addon action                        | Network requirement                                                 |
| ----------------------------------- | ------------------------------------------------------------------- |
| Synchronous                         | Outbound HTTPS from Paranod to the addon                            |
| Asynchronous with `pollingEndpoint` | Outbound HTTPS for submission and signed status requests            |
| Legacy asynchronous callback        | A registered HTTPS platform address reachable from the addon server |

For polling, each asynchronous transform declares a `pollingEndpoint` on the same origin as its transform endpoint. Paranod validates it at installation, encrypts a snapshot on the job, and rechecks the destination through the bounded, DNS-pinned transport on each request. A response cannot redirect polling to another URL. `POST` status requests carry `{ action: "status", jobId, transformId }`; results must match both identifiers and pass entity/relationship validation.

The Docker maintenance process checks due jobs every five seconds with bounded batches. Authentication protects the internal maintenance endpoint. Pending jobs, retry timing and polling leases are persisted in PostgreSQL, so an application restart resumes status retrieval without repeating the original operation. In local development, the job status API also polls on authorized reads. To collect results while the browser is closed outside Docker, schedule the authenticated `/api/cron/poll-addons` endpoint. Cancelling a platform job stops collection and rejects late results; it does not guarantee that a provider operation already running has stopped.

After a provider upgrades its SDK, reinstall its manifest while no jobs are active to refresh the stored capabilities. Older manifests without `pollingEndpoint` keep the callback protocol. Preview identifies addons that need public callbacks. For those actions, configure a reachable HTTPS platform URL or ask the addon provider to upgrade. Older SDK servers may also require HTTPS during registration until upgraded. A remote server cannot call back to the user's localhost. New SDK servers reject production HTTP callbacks even though HTTP registration is accepted.

For an addon hosted on a trusted private network, an administrator can set `PARANOD_ADDON_ALLOWED_HOSTS` to its exact hostname, without a scheme or port. This permits that destination for manual installation and execution; it does not disable certificate verification. Private certificate authorities require explicit trust in the relevant runtimes. Leave the allowlist empty for public addons.

### Agent compatibility

Paranod 2.2 supports synchronous and asynchronous addons in the agent. Polling works from local HTTP installations; legacy callbacks require a reachable HTTPS platform URL. Remote addon destinations require HTTPS, and explicit administrator-configured local addon hosts are also supported. The agent waits for completion, reports progress, revalidates the approved operation before subsequent requests and imports only validated results. Credentials and endpoints remain server-side. Cancelling stops collection and rejects late graph changes; an already-started provider operation may continue. See [Agent operations](AGENT-OPERATIONS.md) for execution budgets and supported graph data.

## Security boundaries

- Installation and configuration changes require an administrator.
- Execution validates workspace membership, graph access and graph write ownership on the server.
- Manifest identifiers may not collide with builtin modules.
- Input and result schemas bound payload size, entity counts and relationships.
- Local, private, loopback and metadata destinations are denied by default. Explicit local addon host allowances are for the installation administrator.
- Signed external requests do not follow arbitrary redirects.
- Secrets and personalized destinations are excluded from the public module catalogue and browser configuration.
- The AI agent has an additional allowlist of reviewed operations and applies its approval policy independently.

## Addon implementation

A compatible addon implements the manifest, registration, signing and transformation schemas used in `src/types/addons.ts`, `src/lib/validators/manifest-validator.ts` and `src/features/plugins/addon-payload.ts`. The [Paranod addon SDK](https://github.com/rstlgu/paranod-addon-sdk) implements this protocol and is maintained separately from this application.

Persist installation secrets securely. If an addon has multiple replicas, storage and replay protection must be shared and atomic. Validate signatures before processing requests, reject stale timestamps and duplicate nonces, and bind callbacks to the platform job identifier. Set bounded provider timeouts and report partial or failed results accurately.

Test synchronous and asynchronous results, duplicate callbacks, invalid signatures, stale timestamps, timeouts and malformed results. `scripts/verify-addon-integration.cjs` exercises a compatible SDK through real local HTTP while isolating persistence in memory; it takes the path to a separately built SDK distribution.

## Operator responsibilities

Use HTTPS for remote addons. Set the application URL to the address users actually open; it only needs to be reachable from the addon server when using callbacks. Keep local host allowances narrow. Back up the database and encryption keys together. External providers may require their own subscription or usage payment; those terms belong to the provider, not to Paranod.
