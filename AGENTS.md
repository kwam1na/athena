## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:

- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `bun run graphify:rebuild` to keep the graph current

## tracking

- project_tracker: linear
- linear_team: yaegars
- linear_team_key: V26
- linear_team_id: 1c947ba4-dd56-4973-b205-3424bfdede61
- linear_project: athena
- linear_project_id: 0a9f3894-fdbb-45dc-b3ff-000af5ba49cc
- linear_project_url: https://linear.app/v26-labs/project/athena-22769268c360

## solutions

Reusable implementation learnings live under docs/solutions/.
Before changing a known bug pattern, search docs/solutions/ for related guidance.

## testing

Athena webapp tests use Vitest. Do not run test files directly with `bun test`; it does not provide Vitest globals such as `vi.hoisted` and can produce false harness failures. For focused webapp tests, run from `packages/athena-webapp` with:

```bash
bun run test -- path/to/file.test.ts -t "test name"
```

Use package-relative paths with that command, for example `convex/cashControls/deposits.test.ts`.

## skills

Athena vendors its agent skill system under `.agents/`.

Rules:

- Agents working in this repo must use repo-local skills from `.agents/skills/`.
- Do not use global `~/.codex`, plugin-cache, marketplace, or Superpowers skills for Athena workflow behavior when a repo-local skill exists.
- Use repo-local `track` and `execute` for Linear planning and ticket execution workflows.
- External connectors and platform tools may be used as runtime capabilities, but they are not skill sources for Athena workflow policy.

## product copy

For in-product copy work, follow [docs/product-copy-tone.md](docs/product-copy-tone.md).
Keep operator-facing language calm, clear, restrained, and operational, and normalize raw backend wording before it reaches the UI.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read the repo-root file
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
