# Plugins and addons

## Execution models

| Type | Execution | Configuration |
| --- | --- | --- |
| Builtin plugin | Application server | Administrator-supplied provider keys |
| External addon | Separate HTTP service | Personalized manifest URL and registration |
| Container tool | Local Docker runner | Allowlisted image and resource limits |

An addon does not load JavaScript into the browser or the Paranod server process. It exposes a manifest, registration endpoint and one or more transformation endpoints. The addon author remains responsible for its own server and any external services it uses.

## Installation and execution

1. An administrator enters the personalized manifest URL. Treat this URL as a credential; do not publish it in screenshots, logs or source code.
2. Paranod validates the manifest and resolves the declared destinations with request size bounds, timeouts, redirect controls, DNS pinning and SSRF protection.
3. The review step describes the provider, destinations and execution model before registration.
4. Registration establishes a per-workspace signing secret. Paranod encrypts the stored manifest, URL and secret.
5. Execution requests carry a workspace identifier, timestamp, nonce and HMAC signature. Async callbacks bind the result to the platform job and carry a unique event identifier.
6. Conditional job updates and event deduplication prevent a late or repeated callback from overwriting a terminal state. Maintenance handles abandoned jobs and timeouts.

Disabling a module prevents execution. Reinstallation and removal are rejected while its jobs are active, so credentials are not rotated underneath in-flight callbacks.

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

A compatible addon implements the manifest, registration, signing and transformation schemas used in `src/types/addons.ts`, `src/lib/validators/manifest-validator.ts` and `src/features/plugins/addon-payload.ts`. An SDK can implement the same protocol; it is maintained separately from this application.

Persist installation secrets securely. If an addon has multiple replicas, storage and replay protection must be shared and atomic. Validate signatures before processing requests, reject stale timestamps and duplicate nonces, and bind callbacks to the platform job identifier. Set bounded provider timeouts and report partial or failed results accurately.

Test synchronous and asynchronous results, duplicate callbacks, invalid signatures, stale timestamps, timeouts and malformed results. `scripts/verify-addon-integration.cjs` exercises a compatible SDK through real local HTTP while isolating persistence in memory; it takes the path to a separately built SDK distribution.

## Operator responsibilities

Use HTTPS for remote addons and configure the application's public URL correctly. Keep local host allowances narrow. Back up the database and encryption keys together. External providers may require their own subscription or usage payment; those terms belong to the provider, not to Paranod.
