---
title: Generated Artifact Repair Should Stage The Full Tracked Diff
date: 2026-05-02
category: harness
module: repo-harness
problem_type: generated_artifact_staging_gap
component: pre-commit-generated-artifacts
symptoms:
  - "pre-commit:generated-artifacts stages refreshed generated files but leaves source changes unstaged"
  - "ticket commits require a manual git add after generated-artifact repair"
root_cause: generated_artifact_repair_only_staged_allowlisted_outputs
resolution_type: staging_contract
severity: medium
tags:
  - harness
  - generated-artifacts
  - pre-commit
  - graphify
---

# Generated Artifact Repair Should Stage The Full Tracked Diff

## Problem

Generated-artifact repair refreshes harness docs and Graphify outputs as a consequence of tracked source changes. If the repair command stages only the generated outputs, the index is left half-ready: generated files are staged, while the source or test edits that caused them remain unstaged.

That mixed index adds a manual recovery step and makes it easier to commit generated outputs separately from the behavior they describe.

## Solution

Keep generated artifacts staged through explicit allowlists, then finish the repair command with tracked-only staging:

```sh
git add --update -- .
```

This stages modified and deleted tracked files, including the source/test changes that belong with refreshed generated artifacts. It does not stage untracked or ignored local files.

## Prevention

- Do not replace this with `git add .` or `git add -A`; those can pull unrelated untracked files into a ticket commit.
- Keep pre-push repair fail-closed when it repairs files during push validation. The full tracked-diff staging contract belongs to `pre-commit:generated-artifacts`, where the user is preparing a commit.
- Preserve tests that assert the final staging command is tracked-only.
