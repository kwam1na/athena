---
title: Athena Dark Mode Should Resolve Through Tokens Before Legacy Utility Colors
date: 2026-06-13
category: logic-errors
module: athena-webapp
problem_type: dark_mode_contrast_drift
component: athena-webapp-theme
symptoms:
  - "The app had dark tokens but no runtime that applied them from system preference or operator override"
  - "Legacy light utility classes such as bg-red-50 and text-gray-900 could render inside dark mode with weak contrast"
  - "Some dark-mode foreground tokens were light on bright state backgrounds"
root_cause: dark_mode_tokens_existed_without_a_theme_runtime_or_legacy_color_compatibility_layer
resolution_type: semantic_theme_runtime_and_contrast_compatibility
severity: medium
tags:
  - athena-webapp
  - frontend
  - design-system
  - dark-mode
  - accessibility
---

# Athena Dark Mode Should Resolve Through Tokens Before Legacy Utility Colors

## Problem

Athena's design system already had light and dark CSS variables, but the app did
not consistently apply a theme class from the browser's system setting, nor did
it expose an operator override. That meant the dark token set could exist
without reliably controlling the rendered app.

Older feature surfaces also still used direct Tailwind palette utilities such
as `bg-red-50`, `text-green-700`, `bg-gray-50`, and `text-gray-900`. Those
classes were acceptable on the light canvas, but they became a contrast risk
once the root switched to a dark canvas.

## Solution

Keep the canonical theme values in `src/index.css` and apply them through a
small runtime that resolves `system`, `light`, or `dark` before React mounts.
Persist only explicit overrides; absence of a stored value means "follow the
system setting".

For broad dark-mode safety, add a dark-only compatibility utility layer that
remaps common legacy light palette classes to Athena semantic tokens. This
lets old screens remain readable while new or touched UI continues to use
semantic classes such as `bg-surface`, `text-foreground`, `text-danger`, and
`border-border`.

For filled status tokens, check the foreground pair directly. Tokens such as
`--comparison-primary`, `--comparison-secondary`, `--success`, and `--danger`
need enough contrast with their `*-foreground` pair, not just enough contrast
against the app canvas.

## Prevention

- Add theme runtime tests for system default, explicit override persistence,
  and returning to system mode.
- Verify contrast for token foreground pairs whenever dark token values change.
- Prefer semantic Tailwind aliases in new UI; use the compatibility layer only
  to keep older direct palette utilities readable.
- Visually inspect at least one real app route in both light and dark mode
  after changing theme tokens.
