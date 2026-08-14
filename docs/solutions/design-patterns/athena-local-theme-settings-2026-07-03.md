---
title: Athena Local Theme Settings Should Share One Runtime Contract
date: 2026-07-03
last_updated: 2026-08-13
category: design-patterns
module: athena-webapp
problem_type: design_pattern
component: frontend_stimulus
resolution_type: code_fix
severity: medium
applies_when:
  - "Adding local browser preferences that affect the whole Athena shell"
  - "Adding theme variants without deleting older palettes that may be restored later"
  - "Exposing a header shortcut and a settings page for the same preference"
  - "Adding an adaptive appearance mode driven by local device context"
tags:
  - athena-webapp
  - theme-runtime
  - app-settings
  - dark-mode
  - design-system
  - sun-cycle
  - geolocation
  - lifecycle-scheduling
delivery_diff_fingerprint: 9dbc928fa5f15f0877945a390f71cf1aa089db78f530048135ed97f2a17d5d21
---

# Athena Local Theme Settings Should Share One Runtime Contract

## Problem

Athena needed a second dark palette, a browser-local settings page, and a
header toggle that could move between system, light, and dark. Keeping those
as separate UI states would let the header, settings page, and root CSS drift.

## Solution

Keep theme state in `src/lib/theme.ts` and make every surface use that runtime:

- Persist the selected mode under one storage key with `system`, `light`,
  `dark`, and `sun-cycle` as the supported modes.
- Persist dark-palette variants separately so a palette can change without
  changing whether the app follows system, light, or dark.
- Apply `data-theme`, `data-theme-mode`, and dark-only `data-theme-variant`
  attributes to the document root before React renders.
- Let the App settings page call the same setter functions as the header
  shortcut instead of maintaining local theme state.
- Keep adaptive modes in that same runtime. Request device location only when
  the operator selects the mode, retain only coarse coordinates locally, and
  resolve the active appearance before React renders.
- Schedule the next adaptive transition directly, then recalculate when the
  browser regains focus or returns from the background so sleep cannot leave
  the interface in a stale appearance.
- Keep the old dark palette in CSS under a named variant, even when the new
  palette becomes the default.

The header shortcut intentionally stays a quick three-mode control while App
settings exposes the permission-bearing Sun cycle choice. It should be device-aware
when the current mode is `system`: use a monitor icon on desktop and a phone
icon on mobile, while explicit `light` and `dark` modes keep their sun and moon
icons.

## Why This Matters

Theme controls are global app behavior. If each entry point owns its own state
shape, the active appearance label, root attributes, stored value, and rendered
palette can disagree. A single runtime contract keeps page UI, header UI, CSS
tokens, and tests aligned.

## Prevention

- Add runtime tests for invalid stored values, explicit mode changes, system
  preference changes, solar boundaries, denied location access, and
  dark-palette persistence.
- Add route/sidebar tests when introducing app-level settings pages so access
  control and navigation stay explicit.
- Only show palette selection controls when the chosen mode is explicit dark;
  system mode should report the resolved appearance but avoid exposing dark
  palette controls while the device may currently be light.
- Keep palette cards simple: label plus swatches is enough when the section
  already names the purpose.

## Examples

Use one hook contract across surfaces:

```tsx
const {
  mode,
  resolvedTheme,
  darkThemeVariant,
  setThemeMode,
  setDarkThemeVariant,
} = useAthenaTheme();
```

Represent variants with root attributes instead of conditional component
classes:

```css
:root.dark[data-theme-variant="classic"] {
  --background: 222 47% 7%;
}
```

## Related

- `packages/athena-webapp/src/lib/theme.ts`
- `packages/athena-webapp/src/index.css`
- `packages/athena-webapp/src/components/app-settings/AppSettingsView.tsx`
- `packages/athena-webapp/src/routes/-authed-layout.tsx`
- `docs/solutions/logic-errors/athena-webapp-dark-mode-token-compatibility-2026-06-13.md`
