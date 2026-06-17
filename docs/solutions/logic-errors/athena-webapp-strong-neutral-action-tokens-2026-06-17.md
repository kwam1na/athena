---
title: Athena Strong Neutral Actions Need Dedicated Theme Tokens
date: 2026-06-17
category: logic-errors
module: athena-webapp
problem_type: dark_mode_strong_neutral_action_contrast
component: athena-webapp-theme
symptoms:
  - "A high-emphasis neutral button can render as a pale filled control in dark mode"
  - "Hard-coded text-white on foreground-filled buttons breaks once foreground becomes light"
  - "Receipt and internal evidence actions drift from the design system in dark mode"
root_cause: strong_neutral_actions_reused_foreground_as_a_fill_color_instead_of_theme_specific_action_tokens
resolution_type: semantic_strong_neutral_action_token_pair
severity: medium
tags:
  - athena-webapp
  - frontend
  - design-system
  - dark-mode
  - accessibility
---

# Athena Strong Neutral Actions Need Dedicated Theme Tokens

## Problem

Some high-emphasis neutral commands, such as receipt printing, were styled by
filling the button with `--foreground` and forcing `text-white`. That reads as a
dark, neutral command in light mode, but it fails in dark mode because
`--foreground` becomes light. The result is a light filled button with white text
or weak contrast.

Using `--foreground` as a background also hides intent. Foreground is a text
role, not an action-fill role, so components end up duplicating hover, border,
shadow, and foreground choices instead of using a reusable command treatment.

## Solution

Create an explicit strong-neutral action token family:

- `--action-neutral-strong`
- `--action-neutral-strong-foreground`
- `--action-neutral-strong-border`

Map those through Tailwind under `action.neutral-strong`, then expose them via a
shared button variant such as `utility-strong`. Components keep their local size
and radius while the theme owns the fill, text, border, shadow, and dark-mode
contrast.

This preserves the intended hierarchy in both themes: strong neutral commands
remain visibly actionable without pretending to be commit, workflow, success, or
danger actions.

## Regression Targets

- Button primitive tests should assert the strong-neutral variant uses
  `bg-action-neutral-strong` and `text-action-neutral-strong-foreground`.
- Foundation/design-system tests should assert the token family exists in
  `src/index.css`.
- Search for `bg-[hsl(var(--foreground))]` plus hard-coded white text when
  touching dark-mode action surfaces.

## Prevention

- Do not use text tokens as filled-button background tokens.
- Do not hard-code `text-white` for semantic app actions unless the theme token
  itself is white by design.
- Add a token-backed variant when a command treatment repeats across POS,
  expenses, or operations evidence surfaces.

## Related

- [Athena Dark Mode Should Resolve Through Tokens Before Legacy Utility Colors](./athena-webapp-dark-mode-token-compatibility-2026-06-13.md)
