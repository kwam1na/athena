# Convex I/O containment checkpoint: `<window-id>`

## Decision

- Status: `Pass | Hold | Rollback`
- Window: `<24-hour | 72-hour | diagnostic>`
- Production deployment: `<deployment>`
- UTC range: `<start>` to `<end>`
- Release commit: `<sha>`
- Athena build/version: `<build>`
- Recorded by: `<operator>`
- Recorded at: `<UTC timestamp>`
- Maintenance classification: `<clean | contaminated | unknown>`

## Boundary evidence

- Database I/O start/end/delta: `<values or unavailable>`
- Database I/O dashboard artifact: `<reference and checksum>`
- Function Calls dashboard artifact: `<reference and checksum>`
- Bounded Insights JSON: `<reference and checksum>`
- Missing evidence and consequence: `<none, or why status is Hold>`

## Function-family results

| Unit / family | Database I/O | Calls | Average bytes/call | Exposure and build adoption | Correctness | Decision |
|---|---:|---:|---:|---|---|---|
| U1 shell catalog summary |  |  |  |  |  |  |
| U2 Daily Operations |  |  |  |  |  |  |
| U3 Daily Close gate |  |  |  |  |  |  |
| U4 terminal recovery verification |  |  |  |  |  |  |
| U5 runtime publisher |  |  |  |  |  |  |
| U6 public homepage |  |  |  |  |  |  |
| U7 POS catalog refresh |  |  |  |  |  |  |

## Production-terminal interpretation

- M Supplies target `appVersion` / `buildSha`: `<value>`
- Target build confirmed before interpreting U3-U5: `<yes | no>`
- Accepted heartbeat cycles: `<count>`
- Freshness/readiness/recovery observations: `<summary>`
- Multi-context concurrency evidence: `<Dev/test references; never inferred from single-terminal Prod>`

## Budget and correctness decision

- Comparable baseline: `<report or unavailable>`
- Recurring rate change: `<percentage or unavailable>`
- Current billed usage and remaining-period ceiling: `<calculation>`
- Correctness exceptions: `<none or details>`
- Release decision and rationale: `<Pass | Hold | Rollback plus concise reason>`
- Rollback owner/action if applicable: `<owner and whole-surface action>`

## Sign-off

`<operator name / role>` — `<UTC timestamp>` — `<decision>`
