---
title: Athena QA Live Smoke Should Not Depend On Network Idle
date: 2026-06-01
category: harness
module: runtime-behavior
problem_type: ci_flake
component: athena-qa-live-smoke
resolution_type: navigation_readiness_boundary
severity: medium
tags:
  - ci
  - github-actions
  - playwright
  - qa
  - smoke-test
---

# Athena QA Live Smoke Should Not Depend On Network Idle

## Problem

The scheduled Athena QA smoke workflow can fail while the QA page is healthy
because the live app is a Vite dev server connected to browser runtime services.
Waiting for Playwright `networkidle` makes the smoke depend on there being no
active or recently active network traffic for a quiet window. That is a brittle
condition for a live app with dev-server and backend connections.

The useful smoke signal is not "all network traffic stopped." It is whether the
document loads, the Athena app mounts, the login form appears, page errors are
absent, and same-origin document/script/style/fetch/xhr responses do not show
server failures.

## Solution

Keep `networkidle` as the default for local behavior scenarios where it remains a
reasonable readiness proxy. Let individual scenarios choose a lighter navigation
readiness mode when their assertion steps own the meaningful app readiness check.

For `athena-qa-live-smoke`, navigate with `domcontentloaded` and then assert the
real QA conditions from the scenario:

- wait for the document body
- wait briefly for the Athena login email field
- capture same-origin response, request failure, and page error observations
- fail with diagnostics when Athena content or the login field does not render

This keeps the scheduled workflow sensitive to blank pages and server-side asset
failures without failing solely because the live app did not become network idle.

## Prevention

- Do not use `networkidle` as the only readiness condition for live smoke checks
  against dev-server or long-lived backend pages.
- Prefer scenario-specific DOM and response assertions that describe the user
  outcome being monitored.
- When adding a live browser smoke, include a regression test for the navigation
  readiness mode as well as the final diagnostics.
