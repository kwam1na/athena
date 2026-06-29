---
title: "Athena historic EOD automation needs indexed source evidence"
date: 2026-06-29
category: architecture
module: athena-webapp
problem_type: historic_eod_automation_boundary
component: daily-operations
resolution_type: indexed_completeness_aware_automation
severity: high
tags:
  - automation
  - daily-operations
  - daily-close
  - register-sessions
  - cash-controls
  - audit
---

## Problem

Athena sometimes needs to close historic store days after the fact. The
dangerous version of that work is a support script that scans old register
sessions by broad status, assumes capped reads are complete, and writes a
closed Daily Close as if it were the live current close.

That creates three risks:

- historic days can be completed from partial source reads;
- old completions can demote the actual current Daily Close for the store; and
- register sessions without date-indexed ownership force automation to infer
  operating dates from stale or unbounded scans.

## Solution

Historic EOD automation needs its own evidence path:

- register sessions carry opened and closeout operating-date evidence;
- register-session indexes support store, status, opened date, and closeout
  date queries;
- Daily Close snapshots persist `sourceCompleteness` alongside source counts;
- automation completion accepts `currentnessMode: "historical_record"` so
  historic records stay non-current and do not demote live current closes;
- support-owned historic runs process bounded oldest-first ranges with stable
  idempotency keys; and
- incomplete source evidence records a quarantine run instead of applying a
  close.

The runner should reuse the same Daily Close completion boundary rather than
creating a second closeout writer. The difference is the caller mode and the
eligibility evidence: historic apply requires complete source reads and writes a
historical record; normal same-day automation can still mark the close current.

## Safety Boundary

Do not let historic automation repair missing source indexes by widening the
mutation-time scan. If a register session cannot provide sufficient operating
date evidence, classify the run as skipped or quarantined and leave a durable
automation run explaining the missing source boundary.

Historic apply mode must be support-owned, bounded by an explicit date range,
and idempotent by store, date, mode, and automation action. Dry runs should use
the same eligibility path as apply, without mutating Daily Close state.

## Prevention

- Add date-index fields before adding automation that depends on historic
  session ownership.
- Persist source completeness with the Daily Close snapshot, not only in logs.
- Use `historical_record` for retroactive completion so live currentness is not
  rewritten.
- Quarantine incomplete reads instead of guessing.
- Test dry-run/apply parity, currentness preservation, duplicate/idempotent
  runs, incomplete source reads, closeout-derived session dates, and index
  presence together.
