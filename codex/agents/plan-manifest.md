# Plan Manifest Template

Use this template as the planner's final output artifact. The planner should fill this in before implementation begins.

```md
# Plan Manifest

## Objective

<plain-language objective>

## Scoped Targets

- Packages:
- Key files:
- Constraints:

## Findings

- Existing behavior:
- Relevant commands:
- Risks and unknowns:

## Task Graph

1. <task one>
2. <task two>
3. <task three>

## Parallel Batches

- Batch A:
  Tasks:
  Paths:
- Batch B:
  Tasks:
  Paths:

## Serialization Rules

- <what must not run in parallel and why>

## Verification Plan

- <check one>
- <check two>

## Approval Gates

- <none> or <approval required + why>

## Handoff To Implementer

- First batch to execute:
- Expected files to change:
- Blocking assumptions:
```
