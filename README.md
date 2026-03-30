# athena

let's go again

ci-check-smoke: storefront workflow validation.

## Running Symphony Against Athena Packages

Symphony can orchestrate real package work in this monorepo using issue-scoped git worktrees.

### Prerequisites

- `LINEAR_API_KEY` exported in your environment.
- `ATHENA_REPO_ROOT` exported and pointing to this repository root.
- Linear issues labeled with one or more package labels:
  - `pkg:athena-webapp`
  - `pkg:storefront-webapp`
  - `pkg:symphony-service`
  - `pkg:valkey-proxy-server`

### Start Symphony

```bash
export ATHENA_REPO_ROOT="$(pwd)"
bun run symphony
```

Watch mode:

```bash
export ATHENA_REPO_ROOT="$(pwd)"
bun run symphony:watch
```

See the detailed runbook in [docs/symphony-athena-packages.md](./docs/symphony-athena-packages.md).

Symphony runtime status includes running/retrying plus delivery-complete issue signals via the status dashboard/API.
