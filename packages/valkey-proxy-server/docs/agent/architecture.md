# Valkey Proxy Server Architecture

Start from `index.js`, which creates the Redis cluster client, attaches runtime logging, builds the Express app from `app.js`, and starts the server.

## Main Boundaries

- `app.js` owns the HTTP handlers, Redis helper utilities, connection probe helper, and the app factory used by both runtime and tests.
- `index.js` is the production bootstrap layer and should stay thin.
- `test-connection.js` is an environment-dependent live probe. Keep it separate from the default local validation path.

## Change Guidance

- Prefer editing `app.js` when you are changing request validation, serialization, health checks, or invalidation semantics.
- Touch `index.js` only when bootstrap or server startup behavior changes.
- Treat `test-connection.js` as an operator probe; use it to verify live cluster assumptions, not as the default regression harness.
