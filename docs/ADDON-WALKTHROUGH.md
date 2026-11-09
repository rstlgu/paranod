# A complete asynchronous addon walkthrough

This example connects a Paranod 2.2 installation to an SDK 0.5 addon that stores signed asynchronous results for outbound polling. The addon can be on a different server. The Paranod installation can remain at an HTTP localhost or LAN address: it makes outbound requests and does not receive callbacks.

The [runnable SDK example](https://github.com/rstlgu/paranod-addon-sdk/tree/v0.5.1/examples/polling-addon) is deliberately synthetic. Given `example.org`, it returns `api.example.org` with a `demo: true` marker. It performs no DNS lookup or OSINT search and must not be treated as discovered evidence. Replace its handler with a real provider integration when developing an actual addon.

## Start the addon

Use Node.js 22 and check out the SDK tag:

```sh
git clone --branch v0.5.1 --depth 1 https://github.com/rstlgu/paranod-addon-sdk.git
cd paranod-addon-sdk
npm ci
export ADDON_INSTALL_TOKEN=$(openssl rand -hex 32)
export ADDON_STORAGE_ENCRYPTION_KEY=$(openssl rand -hex 32)
export PUBLIC_URL=https://addon.example.org
export PORT=4100
node examples/polling-addon/index.cjs
```

Use your own reachable addon origin in `PUBLIC_URL`. Put the process behind an HTTPS reverse proxy forwarding to port 4100. Persist the two environment secrets in your deployment's secret configuration; the temporary shell values above must survive future restarts. Persist the `data` directory and back it up with its encryption key. The supplied file stores support a single addon process. For multiple replicas, provide shared installation, polling and replay stores as described in the SDK.

The default listener is `127.0.0.1`. Set `HOST=0.0.0.0` when a container or remote proxy must reach it, and publish only the intended interface. Never expose an unprotected development listener accidentally. `GET /health` should return 200. The process does not print the installation token or personalized URL.

## Install the manifest

Construct this personalized URL privately, substituting the configured installation token:

```text
https://addon.example.org/manifest.json?token=YOUR_INSTALLATION_TOKEN
```

In Paranod, open **Plugins & Addons → Addons → Install addon**, paste the URL, review the manifest and complete installation. The manifest token authorizes registration; protect it like a credential. Registration creates separate signing credentials for the workspace. Neither an addon store nor a central Paranod account is required.

Add a domain node with the value `example.org` to a graph. Select the node and run **Demo polling addon → Create demo subdomain**. The action should progress from running to completed and add the synthetic domain and its relationship. The platform retrieves status and results through signed requests to the addon's polling endpoint. Closing the browser does not stop background polling.

The same enabled action is discoverable by the graph agent. Its invocation is subject to the selected approval mode. This walkthrough can be completed manually and does not require an AI provider; a real-model investigation is a separate validation step.

## Local addon development

Remote HTTPS addons work with the default configuration. For a trusted addon on your LAN, use an address reachable **from the Paranod app container** and add that exact hostname or IP to `PARANOD_ADDON_ALLOWED_HOSTS` in `.env.docker`. Recreate the app and worker after changing this setting. The allowlist permits the explicitly selected local addon host; do not use wildcards or broadly disable address validation.

For example, an addon hosted at `http://192.168.1.50:4100` needs `PUBLIC_URL` set to that origin and `PARANOD_ADDON_ALLOWED_HOSTS=192.168.1.50` on the Paranod installation. Choose your own host address. `localhost` inside the Paranod container identifies that container, not the addon server or your laptop. `host.docker.internal` is available with Docker Desktop; plain Linux hosts may require an explicit host-gateway mapping or a routable LAN address. Do not use a public-looking domain that resolves unexpectedly to a private network.

Keep public addon endpoints on HTTPS. Older callback-only addons require a reachable HTTPS platform origin; adding a local-host allowlist does not convert them to polling.

## Troubleshooting

- Manifest rejected: verify its personalized token, public URL, TLS certificate and app-container reachability; for a local addon, check the exact host allowlist.
- Signature rejected after restart: verify that installation storage and its encryption key were preserved. Reinstalling creates new signing credentials and is not a substitute for keeping persistent storage.
- Pending job after addon restart: completed results survive with persistent storage; interrupted handlers are not automatically re-executed. Wait for the platform timeout and review the provider operation before retrying.
- Manual execution works but agent cannot discover the action: check that the addon is enabled, the selected graph entity has the advertised input type, the worker is healthy and a model provider is configured.

See [protocol and security](https://github.com/rstlgu/paranod/blob/v2.3.0/docs/ADDON-SECURITY-AND-PUBLISHING.md) for validation rules, limits and legacy compatibility.
