# Valkey Proxy Server

A small HTTP proxy for Athena's Valkey (Redis-compatible) cache cluster.

## Overview

This package exposes a minimal Express service for cache reads, writes, health checks, and pattern-based invalidation. The runtime entrypoint lives in `index.js`, while the route handlers and Redis helpers live in `app.js` so we can keep the default validation path deterministic.

## Validation Modes

### Default local validation

Use these checks when you change handler logic, request validation, serialization, or documentation:

```bash
npm test
node --check app.js
node --check index.js
node --check test-connection.js
```

These commands do not require a live Redis cluster.

### Local runtime behavior scenario

Use `bun run harness:behavior --scenario valkey-proxy-local-request-response` to boot the local in-memory proxy and exercise the request/response round trip without live Valkey credentials.

### Live Redis connectivity probe

Use this when you change TLS, cluster wiring, or AWS network assumptions and have the required environment/network access:

```bash
npm run test:connection
```

This probe reaches the configured Valkey cluster and should be treated as environment-dependent.

## API Endpoints

- `GET /` - check that the service is running
- `GET /health` - ping Valkey and report service health
- `POST /get` - fetch a value by key
- `POST /set` - store a string or JSON value by key
- `POST /invalidate` - delete keys matching a pattern with per-key deletes
- `POST /invalidate-pipeline` - delete keys matching a pattern with pipelined deletes

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Troubleshooting

1. Run `npm test` first to verify the local handler layer still behaves correctly.
2. Run `npm run test:connection` only when you expect live Redis access to work.
3. Check the Valkey client logs for cluster redirection, TLS, or node-level errors.
