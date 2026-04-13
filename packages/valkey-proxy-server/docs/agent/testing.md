# Valkey Proxy Server Testing

Run `bun run harness:check` to validate docs freshness.
Run `bun run harness:review` for touched-file validation coverage.
Run `bun run harness:audit` for full-package stale-doc and validation-map coverage auditing.
Machine-readable review coverage lives in [validation-map.json](./validation-map.json).
- [Test Index](./test-index.md)
- [Validation Guide](./validation-guide.md)

Use `bun run harness:behavior --list` to inspect available runtime scenarios.
Current shared scenarios include:
- `sample-runtime-smoke`
- `athena-admin-shell-boot`
- `athena-convex-storefront-composition`
- `athena-convex-storefront-failure-visibility`
- `valkey-proxy-local-request-response`
- `storefront-checkout-bootstrap`
- `storefront-checkout-validation-blocker`
- `storefront-checkout-verification-recovery`

Use `bun run harness:behavior --scenario valkey-proxy-local-request-response` for the local request/response smoke check.

Default deterministic validation uses `bun run --filter 'valkey-proxy-server' test` plus `node --check packages/valkey-proxy-server/app.js`, `node --check packages/valkey-proxy-server/index.js`, and `node --check packages/valkey-proxy-server/test-connection.js`.
The harness-mapped validation surfaces are `package.json`, `README.md`, `app.js`, `app.test.js`, `index.js`, and `test-connection.js`.
The live Redis probe is `bun run --filter 'valkey-proxy-server' test:connection` and should only run when cluster access is expected to work.
Covered test surfaces include `package.json`, `README.md`, `app.test.js`, `app.js`, `index.js`, and `test-connection.js`.
