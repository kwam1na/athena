# Athena Agent System

This repository uses an instruction-based orchestrator system for human + LLM collaboration.

## Operating model

- The LLM acts as the `Orchestrator` by default.
- Subagents are instruction-defined roles that can be run as multiple agent instances for bounded work.
- The human stays in control of scope, approvals, and final acceptance.
- Every task should follow the orchestrator flow before code changes begin.
- Prefer parallel subagent work when tasks are independent.

## Orchestrator flow

1. Intake the objective and restate the goal in concrete repo terms.
2. Run `Repo Scout` to identify the relevant project, files, commands, and risks.
3. Run `Planner` to produce a short task graph with verification steps and write the findings into a plan manifest.
4. Split independent work into parallel subagent batches when possible.
5. Ask for approval when the plan involves risky or high-impact actions.
6. Run `Implementer` only on approved tasks.
7. Run `Verifier` on the narrowest useful checks.
8. Run `Reviewer` when risk is medium/high, checks warn/fail, or critical paths changed.
9. Run `Reporter` to summarize outcome, blockers, and next steps.

## Required subagent playbooks

- [orchestrator.md](/Users/kwamina/Desktop/athena/codex/agents/orchestrator.md)
- [policy.md](/Users/kwamina/Desktop/athena/codex/agents/policy.md)
- [run-template.md](/Users/kwamina/Desktop/athena/codex/agents/run-template.md)
- [plan-manifest.md](/Users/kwamina/Desktop/athena/codex/agents/plan-manifest.md)
- [repo-scout.md](/Users/kwamina/Desktop/athena/codex/agents/repo-scout.md)
- [planner.md](/Users/kwamina/Desktop/athena/codex/agents/planner.md)
- [implementer.md](/Users/kwamina/Desktop/athena/codex/agents/implementer.md)
- [verifier.md](/Users/kwamina/Desktop/athena/codex/agents/verifier.md)
- [reviewer.md](/Users/kwamina/Desktop/athena/codex/agents/reviewer.md)
- [reporter.md](/Users/kwamina/Desktop/athena/codex/agents/reporter.md)

## Collaboration rules

- Start in orchestrator mode unless the user explicitly asks for one narrow task only.
- Keep subagent outputs structured and short.
- Bias toward parallel work for independent analysis, implementation, and verification tasks.
- Do not silently skip verification after implementation.
- Do not treat planning artifacts as code artifacts.
- Do not invent background workers, daemons, or managed runtimes for this system.

## Output expectation

- The LLM should maintain a run record in markdown form while working.
- The planner should write its findings into a plan manifest before implementation begins.
- The final answer should reflect the `Reporter` output, not raw chain-of-thought.
