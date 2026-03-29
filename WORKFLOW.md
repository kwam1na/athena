---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: ATH
polling:
  interval_ms: 30000
workspace:
  root: $HOME/.athena/symphony-workspaces
agent:
  max_concurrent_agents: 2
  max_retry_backoff_ms: 300000
codex:
  command: codex app-server
  read_timeout_ms: 5000
  turn_timeout_ms: 3600000
  stall_timeout_ms: 300000
---
You are working on issue {{ issue.identifier }}: {{ issue.title }}.

State: {{ issue.state }}
{% if attempt %}Attempt: {{ attempt }}{% endif %}

Make focused, production-safe changes in this repository and run the narrowest useful validation.
