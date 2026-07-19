# Graphify Knowledge Graph

Graphify builds a knowledge graph of the repo under `graphify-out/`. It gives
agents and maintainers a way to orient around packages, communities, and code
relationships before reading raw files.

The graph is treated as a reviewable source artifact, not decorative output.
Tracked graphify files are committed, and a freshness gate blocks pushes when
they drift from the code they describe.

## Start Here

- [Graphify wiki index](../graphify-out/wiki/index.md) — repo-wide navigation,
  package landing pages, and graph hotspots.
- [Graph report](../graphify-out/GRAPH_REPORT.md) — the generated summary of
  communities and structure.
- [Packages agent router](../packages/AGENTS.md) — per-package `AGENTS.md` and
  `docs/agent/*`, which stay the operational source of truth for making edits
  and choosing validation commands.

Use graphify to find your way to the right package or module. Use the package
agent docs to decide what to change and how to validate it.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run graphify:check` | Freshness gate for tracked graphify artifacts. |
| `bun run graphify:rebuild` | Regenerate the graph when the check reports drift. |

`graphify:check` rebuilds into a temporary workspace and compares the result
against the tracked files, so it detects drift without mutating your tree.

## Artifacts

Tracked and freshness-gated, from `TRACKED_GRAPHIFY_ARTIFACTS` in
`scripts/graphify-check.ts`:

- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/graph.json`
- `graphify-out/wiki/index.md`
- `graphify-out/wiki/packages/<app>.md` — one page per package registered in
  `scripts/harness-app-registry.ts` (`athena-webapp`, `storefront-webapp`,
  `valkey-proxy-server` today)

`graphify-out/graph.html` is also committed, but it is deliberately outside
`TRACKED_GRAPHIFY_ARTIFACTS`. It is a browsable convenience view, so it is not
part of the freshness comparison and can lag the gated artifacts.

`graphify-out/cache/` is git-ignored. It is a large local acceleration cache,
not a reviewable artifact.

## Python Runtime

Graphify itself is a Python package. The repo pins it in
`.graphify-requirements.txt` (`graphifyy==0.4.12` today).

Install or repair the local runtime with:

```bash
python3 -m pip install -r .graphify-requirements.txt
```

`graphify:rebuild` picks its interpreter through `resolveGraphifyPython` in
`scripts/graphify-rebuild.ts`:

1. If `.graphify_python` is missing or empty, use `python3`.
2. If its contents contain no path separator, treat the value as a command name
   and use it as-is.
3. If it looks like a path and that path exists, use it.
4. If it looks like a path and the path does not exist, warn and fall back to
   `python3`.

`.graphify_python` is tracked, and its committed value is currently the
macOS Homebrew path `/opt/homebrew/bin/python3.10`. That is a convenience for
the primary development machine, not a portable default. On Linux, in CI, or on
a Mac without that exact interpreter, step 4 applies: the rebuild prints a
fallback warning and uses `python3`. If you see that warning, it is expected
behavior rather than a broken setup — but the resulting `python3` must still
have `graphifyy` installed, or the rebuild will fail.

## How It Fits The Harness

Graphify is one of the harness freshness sensors. See
[Repo harness and sensors](./harness.md) for the full picture. The parts
specific to graphify:

- `pre-commit:generated-artifacts` runs `graphify:rebuild` alongside
  `harness:generate` and stages the refreshed tracked outputs, so a commit
  carries its own updated graph.
- `pre-push:review` runs `graphify:check` first. If tracked artifacts are
  stale, it rebuilds once, rechecks, then **blocks** so you review and commit
  the repaired artifacts rather than pushing a stale ref.
- `pr:athena` ends its review half with `graphify:check`.
- `harness:janitor --repair` includes `graphify:rebuild` among its safe repairs.

The consistent rule is fail-closed repair: the harness will refresh the graph
for you, but it will not silently push the refreshed files past review.

## When To Rebuild

Rebuild when the code or documentation structure changes in a way the graph
should reflect — new modules, moved boundaries, renamed packages, or
substantially reorganized docs. In practice the pre-commit hook handles this,
and you mostly interact with graphify when `graphify:check` blocks a push.

If a check failure surprises you, run `bun run graphify:rebuild` and read the
diff before committing. A large unexplained diff usually means the local
interpreter or `graphifyy` version differs from the pinned one.
