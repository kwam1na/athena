---
title: Consolidate action colors into the primary token family
date: 2026-07-17
category: design-patterns
module: Athena webapp design system
problem_type: design_pattern
component: frontend_stimulus
resolution_type: code_fix
severity: medium
applies_when:
  - "A semantic accent has become the de facto primary color across the application"
  - "Multiple action token families represent the same interaction hierarchy"
tags: [design-tokens, primary-color, semantic-color, tailwind, ui-primitives]
delivery_diff_fingerprint: 0c7c7e059e2d34429e5aab14b11f75f00aef58679a90e9f28cdae6c2bc419727
---

# Consolidate action colors into the primary token family

## Problem

Athena's workflow blue was used broadly enough to function as the product's primary accent, while the formal `primary`, `signal`, `action-commit`, and `action-workflow` families described overlapping roles. Components had to choose among names that no longer represented meaningful visual or behavioral differences.

## Solution

Promote the established workflow palette directly into one canonical family:

```css
--primary: 232 42% 45%;
--primary-foreground: 232 100% 98%;
--primary-soft: 232 58% 96%;
--primary-border: 232 38% 82%;
```

Use `primary` for emphasized actions, interactive accents, focus, and selection controls. Use `primary-soft` with `primary-border` and primary-colored text for selected or contextual surfaces. Migrate every consumer to those names and remove the superseded variables, Tailwind aliases, and component variants instead of preserving compatibility aliases.

Keep unrelated state semantics separate. For example, `transaction-signal` remains a transaction-specific status color, and success, warning, danger, comparison, and neutral-action tokens retain their existing roles. Chart ordering can follow the new product hierarchy without making the retired pink action color disappear from data visualization: chart 1 becomes blue and chart 2 retains pink.

Selection primitives should render the same family themselves. The shared radio keeps a native input for form and keyboard semantics, but resets browser appearance and draws its selected state from `primary` so individual screens do not inherit platform-specific visuals.

Repeated configuration sections can deliberately use the quieter `primary-soft` button treatment for their main save actions so the page does not become a stack of competing solid accents. Links that leave the current settings task should remain neutral outline buttons and use an `ArrowUpRight` icon to communicate the transition.

## Why This Matters

One authoritative family makes component defaults and local surface choices predictable. A default button and an explicitly emphasized workflow action now resolve to the same semantic contract, while the soft treatment remains available without implying a second kind of primary action. Removing the old names ensures future code cannot silently extend a deprecated color model.

## Prevention

- Add token-level assertions that require `primary`, `primary-soft`, and `primary-border` and reject retired action or signal variables.
- Keep component variant tests focused on semantic roles rather than historical feature names.
- When consolidating a semantic family, search CSS variables, Tailwind aliases, arbitrary-value classes, component variant types, stories, tests, and agent design guidance before declaring the migration complete.

## Examples

```tsx
<Button>Save changes</Button>
<Button variant="primary-soft">Selected correction</Button>
<Button asChild size="sm" variant="outline">
  <Link to="/configuration">
    Open Store Hours
    <ArrowUpRight aria-hidden="true" />
  </Link>
</Button>
```

Avoid feature-specific variants such as `workflow`, `workflow-soft`, or `commit-soft` when they resolve to the same primary hierarchy.

## Related

- `packages/athena-webapp/docs/agent/design.md`
- `packages/athena-webapp/src/stories/Foundations/ActionColorReview.stories.tsx`
