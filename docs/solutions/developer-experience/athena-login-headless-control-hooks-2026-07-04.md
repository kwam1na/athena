---
title: Athena Login Headless Control Uses Stable Form Hooks
date: 2026-07-04
category: developer-experience
module: athena-webapp
problem_type: developer_experience
component: authentication
resolution_type: code_fix
severity: medium
applies_when:
  - "Automating Athena login from Playwright or agent-controlled browsers"
  - "Adding custom form widgets that wrap hidden or visually transformed inputs"
tags:
  - auth
  - login
  - playwright
  - headless-control
  - otp
---

# Athena Login Headless Control Uses Stable Form Hooks

## Problem

Athena OTP login was usable by operators, but brittle for headless agents. The
`input-otp` widget renders a real input behind visual slots, and in headless
browser control that input was easiest to find as `input[name="pin"]` rather
than through the visible label.

## Solution

Treat login controls as an automation surface. Give each step stable selectors
and direct accessible names while preserving the existing operator-facing UI:

- Email step: `athena-login-email-input`,
  `athena-login-email-submit`, and `athena-login-pos-sign-in`.
- OTP step: `athena-login-otp-input`, `athena-login-otp-submit`,
  `athena-login-change-email`, and `athena-login-request-code`.
- The real OTP input should carry `aria-label="One-time code"`,
  `autoComplete="one-time-code"`, `inputMode="numeric"`, and `name="pin"`.

Add at least one regression test that renders the real OTP component, not only a
mock. The important assertion is that a headless fill against
`athena-login-otp-input` submits the normalized six-digit code.

## Why This Matters

Agent-controlled browsers should not need to depend on library-generated ids,
implicit label wiring, or visually hidden implementation details. Stable hooks
make login repeatable enough for screenshots, smoke tests, and feature demos,
and the direct accessible names keep the controls better exposed to assistive
technology as well.

## Prevention

- Put stable `data-testid` hooks on authentication controls that agents need to
  drive across sessions.
- For custom widgets that wrap hidden inputs, test the production widget once so
  the real DOM contract is covered.
- Prefer role, label, and test-id selectors over generated ids or incidental
  input names in Playwright scripts.
- Keep OTP values out of durable storage and docs; selectors are reusable,
  codes are not.

## Examples

```ts
await page.getByTestId("athena-login-email-input").fill(email);
await page.getByTestId("athena-login-email-submit").click();
await page.getByTestId("athena-login-otp-input").fill(code);
await page.getByTestId("athena-login-otp-submit").click();
```

## Related

- [Athena Login OTP Auth Sync Handoff Waits For App User Sync](../logic-errors/athena-login-otp-auth-sync-handoff-2026-07-03.md)
- [Athena QA Live Smoke Should Not Depend On Network Idle](../harness/athena-qa-smoke-live-navigation-readiness-2026-06-01.md)
