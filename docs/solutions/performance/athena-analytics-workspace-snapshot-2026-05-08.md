---
title: Athena Analytics Workspaces Should Query A Server-Shaped Snapshot
date: 2026-05-08
category: performance
module: athena-webapp
problem_type: analytics_query_fanout
component: analytics-workspace
symptoms:
  - "The analytics workspace fetched raw event rows and recomputed dashboard metrics in React"
  - "Customer and product tables triggered additional child queries derived from client-side aggregation"
  - "The active checkout metric fetched full checkout sessions just to display a count"
root_cause: raw_events_used_as_workspace_view_model
resolution_type: server_shaped_snapshot_query
severity: medium
tags:
  - athena-webapp
  - analytics
  - convex
  - storefront
  - performance
---

# Athena Analytics Workspaces Should Query A Server-Shaped Snapshot

## Problem

Analytics pages are easy to over-fetch because the raw event stream feels like
the most flexible source of truth. In Athena, the storefront analytics workspace
loaded recent analytics events, then used React to calculate summary cards,
recent activity, shopper rows, and product rows. Those derived rows then caused
extra subscriptions for shopper documents and product hydration.

That shape makes the page more expensive as analytics volume grows. It also
couples the UI to raw tracking payloads, so small table changes can silently add
new query fan-out.

## Solution

Build a bounded Convex query that returns the workspace view model directly.
The query should still read from the canonical tables, but it should return only
the data the page renders:

- Summary counts for known shoppers, product views, visitors today, and active
  checkout sessions.
- A small recent-activity list with id, action, and creation time.
- Pre-aggregated shopper rows with display fields.
- Pre-aggregated product rows with lightweight product and SKU display data.

Keep separate reports separate when they have different semantics. Storefront
observability includes synthetic monitor traffic by design, while the business
analytics snapshot excludes synthetic monitor traffic by default. Folding both
into one raw event list would blur that boundary.

## Prevention

- Do not use a raw analytics event list as the top-level view model for a
  workspace.
- Treat dashboard cards and top-N tables as server-shaped projections, not
  client-side derivations followed by child subscriptions.
- Add an efficiency regression test when converting a workspace: assert that the
  page calls the snapshot query and that presentational child tables no longer
  call `useQuery`.
- When a metric only displays a count, return a count or bounded summary instead
  of a list of full documents.
- Prefer indexed reads for operational metrics, even when the current result set
  is small.
