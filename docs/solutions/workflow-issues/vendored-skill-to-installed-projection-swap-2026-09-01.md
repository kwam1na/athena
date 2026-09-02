---
title: Swapping a vendored workflow skill for an installed projection keeps the repo-specific half in AGENTS.md
date: 2026-09-01
category: workflow-issues
module: .agents
problem_type: workflow_issue
component: development_workflow
resolution_type: workflow_improvement
severity: medium
applies_when:
  - A vendored `.agents/skills/*` directory is replaced by an agent-skills profile member
  - Repository sensors assert strings inside a skill file that is about to be deleted
  - An installation that carries an `adoption` block is moved to a different profile
tags: [agent-skills, agents-md, vendored-skills, profile-switch, guidance-contract]
delivery_diff_fingerprint: aed3c6d48e9e12bd5ec8d6a0d2c23d54628901492648402c65eab6ab2d5c8c5d
---

# Swapping a vendored workflow skill for an installed projection keeps the repo-specific half in AGENTS.md

## Problem

Athena vendored `track` and `execute` under `.agents/skills/`. Both mixed two
different kinds of instruction: a tracker workflow that the `agent-skills`
product now ships, and Athena's own delivery rules — the
`pr:athena:prepare` → `harness:review-context` → `harness:review-evidence`
chain, `bun run github:pr-merge`, `bun run landed-report:check`, and the
`scripts/deploy-vps.sh athena-local` deploy classification. Four repository
sensors read the vendored `execute/SKILL.md` directly and asserted those
Athena strings, so deleting the file would have deleted the repository's own
policy along with the superseded product copy.

## Solution

Split the file by ownership before deleting it:

- The tracker workflow is discarded; the installed `execute-linear-ticket` and
  `create-linear-ticket` skills carry it.
- Every Athena-specific instruction moves verbatim into root `AGENTS.md`, which
  the product skill's repository-authority step already tells the host to read.
  Keep the original heading sequence: the sensors assert `### 8.`, `### 9.`, and
  `### 10.` and the substrings between them, so the ordering is part of the
  contract, not incidental formatting.
- Repoint every reader at `AGENTS.md`: the three guidance tests, and the entry
  in `scripts/pre-push-validation-proof.ts`'s fingerprint path list. That list
  hashes `missing` rather than failing for an absent path, so a forgotten entry
  silently weakens the pre-push proof instead of going red.
- Repoint the fingerprint's own regression test as well. It writes the listed
  path into a fixture root to prove the proof invalidates; left on the deleted
  path it would keep passing while proving nothing.

## Why This Matters

A skill directory is a plausible home for repository policy until the skill is
replaced. When the product and the repository share one file, the swap that
retires the product half also silently retires the repository half. Keeping the
repository half in `AGENTS.md` puts it on a surface no product release can take
away, and makes the overlay explicit rather than implied.

## Prevention

- Before deleting a vendored skill, `git grep` the file path: sensors that read
  it are the inventory of what the repository — not the product — owned in it.
- Treat asserted heading numbers and substrings as the move's contract; verify
  each one against the new home before running the suite.
- An installation carrying an `adoption` block exposes only the adopted skill.
  `update` to a wider profile installs the new generation but adds no new
  exposures, so confirm each expected skill with `readlink` after the update
  instead of trusting the lifecycle summary's `current` exposure state.
- Never run the lifecycle CLI with the installed generation on `PYTHONPATH`.
  The `__pycache__` directories it writes land inside the generation tree and
  trip `local-divergence` on the next command.

## Examples

Before — the repository's merge-helper rule lived in a product-owned file:

    .agents/skills/execute/SKILL.md
      "In Athena, merge or arm auto-merge with `bun run github:pr-merge -- ...`"
    scripts/github-pr-merge.test.ts
      readFile(path.join(rootDir, ".agents/skills/execute/SKILL.md"), "utf8")

After — the rule and its sensor both sit on repository-owned ground:

    AGENTS.md  ## ticket delivery
      "In Athena, merge or arm auto-merge with `bun run github:pr-merge -- ...`"
    scripts/github-pr-merge.test.ts
      readFile(path.join(rootDir, "AGENTS.md"), "utf8")

## Related

- `AGENTS.md` — `## skills` and `## ticket delivery`
- `.agents/tracker-properties.json` — the adapter-declared tracker context
- `docs/solutions/harness/worktree-safe-pr-merge-2026-05-02.md`
