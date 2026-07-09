# Subagent Prompt Templates

Use these templates as starting points. Keep subagents read-only and ask for concise, source-grounded output.

## Session Context Subagent

```text
In <repo-root>, gather session and delivery context for <PR/merge SHA/Linear issue>.

Do not edit files. Search relevant session history, Linear context, PR closeout, and repo docs. Return:
- prior decisions or attempts that shaped the landed work
- reviewer/subagent loops and findings that mattered
- finish-line changes such as deploy/no-deploy or root alignment
- Linear parent/child issue state and closeout evidence
- durable lessons or solution notes related to the work
- sources used

Keep the result concise and source-grounded.
```

Preferred role: `ce-session-historian` when available. If unavailable, use `explorer` or a default read-only subagent and provide local artifacts/paths.

## Delivered Diff Subagent

```text
In <repo-root>, analyze the delivered code and doc changes for <PR/merge SHA>.

Do not edit files. Use git/PR truth and local files. Return:
- changed-file map grouped by behavior layer
- before/after architecture or data flow
- behavior changes and intentionally unchanged behavior
- failure boundaries and risks
- validation and generated artifact implications
- files that should be highlighted in a reader-facing report
- sources used

Keep the result concise and actionable for an HTML explainer.
```

Preferred role: `explorer`, `ce-repo-research-analyst`, or another read-only codebase researcher.

## Quiz And Report Reviewer Subagent

Use after a draft report exists.

```text
In <repo-root>, review <report-path> for reader comprehension.

Do not edit files. Check whether the report explains the landed change clearly and whether the quiz tests real understanding. Return:
- unclear or missing context
- unsupported or overstated claims
- weak quiz questions or answer explanations
- missing failure-boundary or validation concepts
- concrete suggested fixes

Approve only if the report is useful for someone trying to understand the landed work.
```

Preferred role: `ce-coherence-reviewer`, `ce-testing-reviewer`, or default.
