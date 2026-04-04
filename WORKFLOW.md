---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: 22769268c360
  handoff_state: Human Review
polling:
  interval_ms: 30000
workspace:
  root: $ATHENA_REPO_ROOT/worktrees
hooks:
  after_create: bash /Users/kwamina/athena/scripts/symphony/after-create.sh
  before_run: bash /Users/kwamina/athena/scripts/symphony/before-run.sh
  before_remove: bash /Users/kwamina/athena/scripts/symphony/before-remove.sh
  timeout_ms: 120000
agent:
  max_concurrent_agents: 2
  max_turns: 12
  max_input_tokens_per_attempt: 150000
  max_issue_input_tokens: 300000
  max_continuation_runs_per_issue: 2
  continuation_retry_delay_ms: 30000
  max_retry_backoff_ms: 300000
codex:
  command: /Applications/Codex.app/Contents/Resources/codex app-server
  read_timeout_ms: 5000
  turn_timeout_ms: 3600000
  stall_timeout_ms: 300000
---

You are working on issue {{ issue.identifier }}: {{ issue.title }}.

State: {{ issue.state }}
{% if attempt %}Attempt: {{ attempt }}{% endif %}

Repository root: /Users/kwamina/athena

Package routing contract:

- Use issue labels to determine scope.
- Label mapping:
  - pkg:athena-webapp -> packages/athena-webapp
  - pkg:storefront-webapp -> packages/storefront-webapp
  - pkg:symphony-service -> packages/symphony-service
  - pkg:valkey-proxy-server -> packages/valkey-proxy-server
- If multiple pkg:\* labels are present, treat the issue as multi-package scope and validate all mapped packages.
- If no recognized pkg:\* label is present, infer scope from issue text and touched files.
- Always include either explicit label-based scope or inferred scope in the PR summary.

Validation policy:

- Run the narrowest package-scoped checks first.
- Escalate only when changes cross package boundaries or failures indicate broader impact.
- Required validation matrix:
  - pkg:athena-webapp:
    - bun run --filter '@athena/webapp' test
    - bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json
  - pkg:storefront-webapp:
    - bun run --filter '@athena/storefront-webapp' test
    - bunx tsc --noEmit -p packages/storefront-webapp/tsconfig.json
  - pkg:symphony-service:
    - bun run --filter '@athena/symphony-service' test
    - bunx tsc --noEmit -p packages/symphony-service/tsconfig.json
  - pkg:valkey-proxy-server:
    - npm --prefix packages/valkey-proxy-server run test:connection when env prerequisites are available
    - if prerequisites are unavailable, report skip reason and run: node --check packages/valkey-proxy-server/index.js

Execution requirements:

- Make focused, production-safe changes in this repository.
- Follow red-green where practical.
- Use branch names with codex/ prefix.
- PR body must include sections: Summary, Why, Validation.
- When implementation is complete, move the issue to the handoff state (`Human Review`) or `Done` if handoff is unavailable.
- Add a completion update that includes: PR link, package scope, validation commands/results, and any unresolved risks.
