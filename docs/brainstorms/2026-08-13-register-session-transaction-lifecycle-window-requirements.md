---
date: 2026-08-13
topic: register-session-transaction-lifecycle-window
---

# Register Session Transaction Lifecycle Window

## Summary

Completed Transactions will preserve the register session as its primary scope while making the segmented time controls truthful. The default “From [opening date]” view will cover the session lifecycle across operating days, and “All Time” will remain an audit view for every transaction carrying the session identity.

## Problem Frame

A register session can remain open across multiple operating dates. The current handoff supplies both the session identity and its opening operating date, but Completed Transactions treats that date as a single-day window. Operators therefore see fewer transactions than the register summary even though both surfaces describe the same session.

## Requirements

- R1. A register-session handoff must initially select “From [opening date].”
- R2. Every segmented time view must retain the register-session constraint.
- R3. For an open, active, or closing session, “From [opening date]” must include linked transactions from the opening operating-date boundary onward.
- R4. For a closed session, “From [opening date]” must include linked transactions from the opening operating-date boundary through the session’s recorded closure time.
- R5. “All Time” must remain available and show every transaction carrying the register-session identity, including anomalous records after closure.
- R6. “Today” must remain available and intersect today’s window with the register-session constraint.
- R7. An operator’s explicit segment selection must override the default lifecycle view.
- R8. Counts and pagination must reflect the complete result set for the selected segment.

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a session opened on Aug 12 and still active on Aug 13, when an operator follows its transaction-history link, “From Aug 12, 2026” is selected and linked transactions from both dates appear.
- AE2. **Covers R2, R4.** Given a session opened on Aug 12 and closed on Aug 13, when “From Aug 12, 2026” is selected, linked transactions through the closure time appear and later records do not.
- AE3. **Covers R2, R5.** Given a transaction carrying the session identity was recorded after closure, when the operator selects “All Time,” that transaction appears.
- AE4. **Covers R2, R6, R7.** Given a multi-day session, when the operator selects “Today,” only today’s linked transactions appear.

## Success Criteria

- Operators following a register-session link see the same legitimate lifecycle sales represented by the register summary.
- The selected segment accurately communicates the time boundary applied to the session-scoped query.
- Focused tests distinguish active lifecycle, closed lifecycle, Today, and All Time behavior.

## Scope Boundaries

- Do not repair, delete, or otherwise mutate anomalous post-closure transactions.
- Do not change register closeout policy.
- Do not change standalone Completed Transactions behavior when no register session is supplied.
- Do not change the Cash Controls linked-sales summary.

## Key Decisions

- Session-first scoping: Register identity remains authoritative across every segment.
- Lifecycle-bounded default: The opening date is a lower bound, not a single operating day; closure is the upper bound only after the session is closed.
- Explicit audit escape hatch: All Time intentionally ignores lifecycle time bounds while retaining session identity.

## Dependencies / Assumptions

- The register-session snapshot supplies authoritative status and closure time.
- The existing handoff continues to supply the session’s opening operating date.
