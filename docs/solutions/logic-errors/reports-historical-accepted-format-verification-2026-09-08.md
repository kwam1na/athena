---
title: Verify historical accepted Reports in their original format
date: 2026-09-08
category: logic-errors
module: Reports pipeline migration
problem_type: logic_error
component: background_job
symptoms:
  - "Accepted history failed migration parity despite a sealed supported correction."
  - "Historical reports lacked newer transaction metrics and retained three leaders rather than five."
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [reports, migration, immutable-history, parity]
delivery_diff_fingerprint: d81393128a0e5bec185ceb6ae012836d09024d01caf29a2a9fcf97a2d534d472
---

# Verify historical accepted Reports in their original format

## Problem

Wigclub's pipeline migration could not certify accepted history using assumptions from the current producer. The accepted records were immutable; replacing them with current-format output would erase the evidence being verified.

## Symptoms

- A supported sealed correction was rejected by the blanket correction guard.
- Metric-version-one rows omitted transaction counts that current replay supplies.
- Older accepted rows retained three leaders while current replay retains five.

## What Didn't Work

Increasing dispatch batches cleared backlogs but could not fix semantic parity failures. Comparing every old record with the newest output shape rejected legitimate history. Removing every symbol named legacy was also incorrect: summary-range workers still use the shared legacy evidence lane.

## Solution

Reconstruct the supported sealed Wigclub August 3–9 correction read-only at its recorded application time. Require the original accepted-row identity and exact correction payload. Preserve original replay, financial values, schedule cohort and fingerprint checks; reject unknown corrections or changed source evidence.

For supported historical metric versions, preserve absent transaction counts. For historical leader lists, use only supported widths and verify the original fingerprint. A modern row truncated to three leaders must still fail when its original fingerprint does not match.

Use the existing four-claim limit for close-evidence and rollup dispatch, retaining independent fenced worker transactions. After guarded activation, remove only the retired store sweep, dispatcher and cron entry. Retain shared evidence, maintenance, historical schemas and readers.

## Why This Works

Format compatibility changes how historical evidence is interpreted, not what financial truth is accepted. Tests assert unchanged accepted state after successful verification and refusals. Source reconstruction uses bounded accounting and refuses before subsequent fact/compact reads when exhausted; this is not an absolute cap on every database byte because charging follows reads and existing bounded notification reads are separate.

## Prevention

- Keep historical producer shapes and fingerprint semantics explicit.
- Test tampered corrections, foreign row identity, changed source, unsupported widths, financial mismatches and real under/over-budget pages.
- Verify activation, function registration and retained cron execution separately from deployment.
- Search callers before removing shared legacy-named helpers.

## Related Issues

- [V26-1921](https://linear.app/v26-labs/issue/V26-1921)
- [Reports read amplification](../performance-issues/reports-pipeline-read-amplification-2026-08-29.md)
- [Operational runbook](../../operations/reports-pipeline-read-efficiency.md)
