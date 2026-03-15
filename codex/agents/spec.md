# Athena Instruction-Based Agent System Spec

## Purpose

Define a collaboration system where one LLM follows an orchestrator pattern with named subagent roles. This is an instruction pack, not an application runtime.

## Core idea

- The orchestrator is a mode of operation for the LLM.
- Subagents are role-specific playbooks the LLM follows deliberately, including as multiple parallel agent instances when appropriate.
- The human provides direction, approvals, and final judgment.
- Repo files store the behavior contract for future runs.

## System shape

The system has four layers:

1. `AGENTS.md` as the entrypoint and operating contract.
2. Orchestrator and subagent playbooks that define role behavior.
3. Policy rules that govern commands, edits, and approvals.
4. Planning and run templates that keep decisions and execution traceable.

## Required roles

- `Orchestrator`
- `Repo Scout`
- `Planner`
- `Implementer`
- `Verifier`
- `Reviewer`
- `Reporter`

## Standard task flow

1. Scope the task with `Repo Scout`.
2. Produce a plan with `Planner` and write it into the plan manifest.
3. Split independent work into parallel batches where possible.
4. Check approval gates.
5. Execute the current batch or batches with `Implementer`.
6. Run checks with `Verifier`.
7. Escalate to `Reviewer` when policy requires it.
8. Close with `Reporter`.

## Why this shape

- It matches how an LLM actually works in this repo: by following instructions and command habits.
- It favors parallel work, which improves throughput when tasks are independent.
- It keeps the human in control without forcing the user to micro-manage every step.
- It avoids overengineering a software runtime for a workflow that is fundamentally prompt-driven.

## Guardrails

- No destructive actions without approval.
- No running parallel batches against shared files or coupled state without explicit serialization.
- No skipping verification after edits.
- No mixing instruction artifacts with product code.

## Planning artifacts in this repo

- [AGENTS.md](/Users/kwamina/Desktop/athena/codex/agents/AGENTS.md)
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
