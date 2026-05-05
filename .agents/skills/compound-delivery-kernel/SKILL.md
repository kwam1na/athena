---
name: compound-delivery-kernel
description: Use when agent work needs a reusable delivery posture across planning, implementation, review, Linear execution, or skill updates.
---

# Compound Delivery Kernel

## Overview

Compound delivery means every unit of work should make the next unit easier. The repo supplies sensors: tests, validation maps, runtime checks, docs drift checks, CI, logs, and review artifacts. The skill system owns the workflow: how agents plan, work, review, learn, and hand off.

Use this as a shared contract for delivery skills. Do not encode this loop into project repos unless a repo-local sensor is missing and should be built.

## Core Loop

Plan -> Work -> Review -> Compound -> Repeat.

### Plan

- Understand the outcome, constraints, and non-goals.
- Research local patterns and available repo sensors before choosing an approach.
- Capture test scenarios before implementation.
- Name the execution posture for each behavior-bearing unit:
  - `test-first` for new behavior or bug fixes with a clear expected outcome.
  - `characterization-first` for legacy, unclear, or fragile behavior that must be captured before changing.
  - `sensor-only` only for pure docs, generated artifacts, configuration, or mechanical changes with no behavior.
- Identify the smallest repo sensor set likely to prove the change: targeted tests first, then broader suite, typecheck/build/lint, harness/review/CI-equivalent commands, runtime scenarios, or other project-specific checks.
- Note possible compounding signals: recurring bug class, missing guardrail, undocumented pattern, weak test affordance, or agent workflow friction.

### Work

- Isolate the work in a branch or worktree when the change is more than trivial.
- For `test-first`, write the failing test, run it, and confirm the failure proves the intended behavior before implementation.
- For `characterization-first`, write a test or fixture that captures current behavior before changing it.
- Implement the smallest behavior slice that can turn the selected test green.
- Run the relevant sensor after each meaningful slice, not only at the end.
- Regenerate tracked generated client APIs before commit when source changes can affect them; for Athena Convex work this includes `convex/_generated/` via the repo's generated-artifacts hook, not just staging whatever happened to be dirty.
- If a repo sensor fails, classify it:
  - deterministic repairable drift: run the documented repair once, inspect the result, and rerun the sensor
  - semantic blocker: investigate normally and fix the root cause
  - unrelated environmental blocker: document exactly what blocked validation

### Review

- Review against the plan, acceptance criteria, and repo sensors.
- Use specialized reviewers when risk warrants it: correctness, tests, security, performance, data, architecture, frontend behavior, agent-native access, or project standards.
- Treat important review findings as work, not commentary.
- After fixes, rerun the specific sensor that should catch the issue and then the merge-level sensor set.
- When GitHub required checks are the only remaining gate and the repo supports auto-merge, arm auto-merge after local merge-level sensors and review gates pass. Pending remote checks should be delegated to auto-merge instead of spending agent time polling green checks just to run a manual merge; failing checks still require investigation.

### Post-Merge Local CD

- When a delivery workflow carries work all the way into `main`, treat production deploy as part of the post-merge finish, not as a VPS-side build job.
- Confirm the PR actually merged and `origin/main` contains the merge before deploying. Then fast-forward the root checkout to that exact `origin/main` state and verify it is clean.
- In Athena, choose the narrowest local production deploy commands from the merged diff instead of defaulting every merge to a full deploy. After fast-forwarding local `main`, inspect the merged file set:
  ```bash
  git diff --name-only HEAD^ HEAD
  ```
  If GitHub did not use a squash merge, use the PR file list from `gh pr view <pr> --json files` or the merge-base range that covers only the merged PR.
- Map touched files to deploy commands:
  - `scripts/deploy-vps.sh convex-prod` when the diff changes Convex runtime code, schema, generated Convex API, or Convex-affecting package config under `packages/athena-webapp/convex/**`, `packages/athena-webapp/shared/**`, `packages/athena-webapp/package.json`, or `bun.lockb`.
  - `scripts/deploy-vps.sh athena-local` when the diff changes Athena admin runtime assets or build inputs under `packages/athena-webapp/**`, excluding docs, tests, stories, and Convex-only changes that do not affect browser code.
  - `scripts/deploy-vps.sh storefront-local` when the diff changes storefront runtime assets or build inputs under `packages/storefront-webapp/**`, excluding docs, tests, and stories.
  - `scripts/deploy-vps.sh valkey-proxy` when the diff changes `packages/valkey-proxy-server/**` or deploy/nginx/proxy configuration consumed by that service.
  - `scripts/deploy-vps.sh full-prod-local` only when the change spans Convex, both static apps, and the proxy, or when the deploy impact is genuinely ambiguous and under-deploying would be riskier than rebuilding all local artifacts.
- Run each selected deploy command from the clean root checkout and report skipped deploy surfaces explicitly. The VPS should receive locally built static artifacts; it should not build the Athena or storefront apps as an automatic consequence of every merge.
- Do not run local production deploy from a feature branch, dirty checkout, or temporary worktree. If the deploy script fails, keep the deploy failure as the active blocker, report the exact command and relevant output, and do not claim production is current.
- If the user explicitly scopes delivery to PR-only or asks to skip deploy, honor that scope and state that production CD was intentionally not run.

### Compound

Before handoff, decide whether this delivery taught the system something reusable.

Create or update durable knowledge when at least one is true:
- A bug revealed a missing pattern, test, sensor, or reviewer.
- A review found an issue future agents are likely to repeat.
- The repo had a non-obvious command, repair path, architecture boundary, or validation trick.
- The ticket required a reusable workflow decision, not just one-off code.
- A repo sensor was missing or misleading.

Prefer the smallest durable improvement:
- Add or refresh a `docs/solutions/` learning when the repo uses solution docs.
- Update a skill when the lesson changes how agents should work across repos.
- Create a follow-up issue when a missing repo sensor or tool must be implemented.
- Do nothing when the learning is local, obvious, or unlikely to recur.

## Proactive Tickets

Agents may proactively create follow-up tickets when the work is concrete, scoped, evidence-backed, and better handled separately than folded into the current task.

Good reasons:
- A repo sensor, validation map, local parity check, reviewer, or runtime scenario is missing or misleading.
- Review or CI exposed a real gap that is not required to complete the current ticket.
- A commit, push, pre-push, or repo harness gate blocked delivery and the agent had to do extra investigative or corrective work beyond running the documented repair once. Use `$track` so the repo can later decide whether the failure class should be auto-repaired by the harness or reported with a more targeted diagnostic.
- Implementation uncovered adjacent work that has a clear outcome but would expand current scope.
- The compound decision identified a durable system improvement that needs implementation.

Required ticket evidence:
- Link or quote the source signal: failing check, CI log, review finding, code path, user-reported issue, compounding note, or exact missing sensor.
- For harness-block tickets, include the blocking command, the failing harness output or diagnosis, the extra work the agent performed, why it was not safe or obvious for the current run to automate silently, and the future question: "Can the harness safely repair this, or should it emit a better diagnostic?"
- State why it is separate from the current task.
- Include acceptance criteria, test scenarios, expected sensors, and execution posture.
- Link it from the current ticket, PR, or handoff.

Do not create proactive tickets for:
- speculative ideas without observed evidence
- broad cleanup or "make better" work with no sharp outcome
- work that is required to satisfy the current acceptance criteria
- duplicate backlog items that already cover the same outcome

If a tracker is unavailable, record the same follow-up in the handoff with enough detail to create later.

## Ticket Shape

Tickets prepared for compound delivery should include:

- outcome and scope boundary
- acceptance criteria
- test scenarios
- execution posture (`test-first`, `characterization-first`, or `sensor-only`)
- expected repo sensors
- compounding opportunity, or `None expected`
- dependencies and generated-artifact coordination notes

## Handoff Shape

Every delivery handoff should include:

- what changed
- validation evidence from repo sensors
- for web app or app-surface changes, include a browser preview URL only when a preview was already started for inspection or explicitly requested; preview startup is optional and is not a handoff requirement
- post-merge production deploy command and result when local CD applies, or the explicit reason it did not run
- review status and remaining risk
- compounding decision: documented, skill updated, follow-up filed, or no durable learning
- links to ticket, PR, and learning/follow-up artifacts when present

## Red Flags

- Treating a passing final suite as proof that TDD happened.
- Encoding a project workflow in repo docs when a reusable skill should own it.
- Adding a learning doc for every tiny change.
- Skipping the compound decision because the PR is merged.
- Creating speculative tickets because an idea sounds useful.
- Manually compensating for an untrusted step instead of improving a sensor, reviewer, or skill.
