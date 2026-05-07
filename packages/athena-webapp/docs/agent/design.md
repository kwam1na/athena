# Athena Webapp Design System

Use this guide before changing Athena UI. The source tokens live in
[src/index.css](../../src/index.css), Tailwind exposes them in
[tailwind.config.js](../../tailwind.config.js), and Storybook documents the living system
under `Guidance`, `Foundations`, `Primitives`, `Patterns`, and `Templates`.

## Design Thesis

Athena is a calm operational workspace for retail teams. Interfaces should feel precise,
warm, and durable: quiet surfaces, clear hierarchy, restrained motion, and enough density for
daily work without making screens feel cramped.

Favor operator confidence over visual novelty. Pages should be easy to scan under pressure,
with state, ownership, next action, and totals visible before decorative detail.

## Token Authority

Use CSS variables from `src/index.css` instead of hardcoded visual values. Use Tailwind
semantic classes backed by those variables whenever possible.

Core token map:

| Role                  | Token                                | Default                                |
| --------------------- | ------------------------------------ | -------------------------------------- |
| App canvas            | `--background` / `--foreground`      | light neutral canvas, dark ink         |
| Working surface       | `--surface`                          | card and panel plane                   |
| Raised surface        | `--surface-raised`                   | dialogs, inspectors, important panels  |
| Shell                 | `--shell` / `--shell-foreground`     | deep navigation and structural framing |
| Primary action signal | `--signal` / `--signal-foreground`   | one action accent                      |
| Success               | `--success` / `--success-foreground` | completed or healthy state             |
| Warning               | `--warning` / `--warning-foreground` | pending risk or degraded state         |
| Danger                | `--danger` / `--danger-foreground`   | destructive or blocked state           |
| Border and inputs     | `--border`, `--input`, `--ring`      | low-contrast operational chrome        |
| Radius                | `--radius`                           | `0.75rem` / 12px                       |
| Surface shadow        | `--shadow-surface`                   | soft panel elevation                   |
| Overlay shadow        | `--shadow-overlay`                   | stronger modal or shell elevation      |

Tailwind aliases are already wired for these roles: `bg-background`, `text-foreground`,
`bg-surface`, `bg-surface-raised`, `bg-shell`, `bg-signal`, `text-muted-foreground`,
`border-border`, `shadow-surface`, and `shadow-overlay`.

## Radius

The system radius is 12px: `--radius: 0.75rem`.

Use semantic radius utilities where possible:

- `rounded-lg` for the standard component radius.
- `rounded-md` and `rounded-sm` for tighter controls that derive from `--radius`.
- `rounded-[calc(var(--radius)*1.1)]` through `rounded-[calc(var(--radius)*1.4)]`
  for larger cards and Storybook specimens that need a softer panel feel.
- `rounded-full` only for pills, avatars, status dots, and circular icon affordances.

Do not hardcode arbitrary pixel radii in feature components. If a new radius scale is needed,
add it as a token or Tailwind alias first.

Storybook exposes a Radius toolbar knob for exploration. Treat that knob as preview-only
unless the chosen value is promoted to `--radius` in `src/index.css`.

## Color

Use semantic color roles, not raw hues. Athena should not become a one-note palette: the base
canvas is neutral, the shell is dark, and `--signal` is the primary warm accent.

Rules:

- Keep primary actions on `bg-signal text-signal-foreground`.
- Use `bg-surface` and `bg-surface-raised` for cards, panels, and inspectors.
- Use `text-muted-foreground` for helper copy and secondary metadata.
- Use success, warning, and danger tokens only for state, never decoration.
- Keep borders quiet with `border-border` or `border-border/70`.
- Preserve dark mode by using tokens instead of hardcoded light colors.

## Typography

The font tokens are:

- `--font-sans`: UI copy, controls, tables, helper text.
- `--font-display`: page titles, section landmarks, and authored workspace anchors.
- `--font-numeric`: cash totals, ledger values, metric amounts, and other tabular operator
  numerics.
- `--font-mono`: technical identifiers, trace IDs, codes, and compact diagnostics.

The active Athena story preset uses the same sans family for UI, display, and numeric
typography. Cash totals and ledger values use the numeric token with tabular number styling,
not a different font family. The previous app setup is preserved as the `athena-classic`
preset in `src/index.css` for comparison or rollback.

Use display type sparingly. It should create hierarchy, not ornament every card. Avoid
negative letter spacing beyond existing local patterns, and do not scale font size directly
with viewport width except for existing Storybook hero specimens.

## Page-Level Headers

Use the page-level header pattern for top-level workspace orientation, documentation pages,
template overviews, and operational pages that need to quickly tell an operator where they
are and what the page is doing. This is separate from the compact `PageHeader` used inside
`View` headers.

Canonical structure:

- Uppercase eyebrow for the page family, store context, workflow, or system area.
- Large `font-display` title as the primary orientation anchor.
- One restrained description that explains the operational outcome, not the implementation.
- Quiet bottom divider below the header before the first content section.
- No enclosing card, panel, hero art, or decorative background.

Use `PageLevelHeader` from `src/components/common/PageLevelHeader.tsx` when a page needs this
orientation pattern. Keep actions outside the header unless the page has a true top-level
primary action that belongs with the title.

## Page Rhythm

Use the page workspace rhythm primitives from `src/components/common/PageLevelHeader.tsx`
for top-level operational workspaces:

- `PageWorkspace` for the outer page stack. It separates the page header from the working
  surface with `space-y-layout-2xl`.
- `PageWorkspaceGrid` for the common work area plus side rail layout. It uses
  `gap-layout-2xl` so the rail does not crowd the primary task.
- `PageWorkspaceMain` for the primary task stack. It uses `space-y-layout-3xl` to give
  filters, scope selectors, tables, and review queues distinct scan zones.
- `PageWorkspaceRail` for inspector and summary rails. It uses a vertical flex stack with
  `gap-layout-lg`, which keeps supporting panels connected without compressing them.

Prefer these primitives over ad hoc page-level `space-y-*`, `gap-*`, and two-column grid
classes when building or refreshing a workspace. Local component internals can still choose
compact spacing when the surface is a dense table, queue item, or form control group.

## Spacing And Density

Use the layout spacing tokens:

- `--space-2xs`: micro gaps.
- `--space-xs`: tight labels, pills, compact rows.
- `--space-sm`: small component internals.
- `--space-md`: default card and control grouping.
- `--space-lg`: dense section spacing.
- `--space-xl`: normal page module spacing.
- `--space-2xl` and `--space-3xl`: large Storybook/template scene spacing.

Use Tailwind aliases such as `gap-layout-sm`, `p-layout-md`, and `py-layout-xl`.

Density rules:

- Use standard density for dashboards, forms, empty states, and orientation pages.
- Use compact density for tables, filters, review lanes, and comparison-heavy surfaces.
- If compact mode makes the page hard to parse, the layout is carrying too many jobs.

Control heights are tokenized:

- `--control-height-standard`: `2.75rem`.
- `--control-height-compact`: `2.25rem`.

## Cards And Surfaces

Cards should frame information that belongs together. They are not the default page layout.

Use cards for:

- A bounded decision.
- A coherent data block.
- A status or summary that operators must revisit.
- Repeated items in lists, queues, and review lanes.

Avoid:

- Cards inside cards unless the inner card is a real sub-decision.
- Floating cards as page sections.
- Decorative card grids where a simple section or table would scan better.
- Heavy shadows, high-contrast borders, or ornamental backgrounds.

Card language:

- Quiet border: `border border-border` or `border-border/80`.
- Surface: `bg-surface` or `bg-surface-raised`.
- Soft elevation: `shadow-surface`.
- Header/content split: a light rule when the top area carries state, progress, or a primary summary.

## Flow Detail Pattern

Use the flow detail pattern for operational views that need stable context plus an active work
area. It applies to transactions, orders, service cases, cash controls, procurement, returns,
staff actions, and trace review.

Structure:

- Narrow context rail for stable flow context, current state, ownership, key dates, totals,
  and next actions.
- Large working canvas for editable records, review queues, audit trails, traces, line items,
  or supporting detail.
- Status-first context, then metadata, then actions.
- Large canvas should breathe; do not squeeze primary review content into the rail.

Copy and labels:

- Use uppercase micro-labels only for section identity or totals.
- Keep field labels sentence case.
- Right-align values where comparison matters.
- Keep operator language calm and factual; follow
  [product copy tone](../../../../docs/product-copy-tone.md).

## Operator Input Pages

Use this pattern for pages whose main job is to collect setup, configuration, or profile
information from an operator. Examples include POS settings, store setup, staff provisioning
when it is a full page, route configuration, and other settings flows where the operator is
entering a bounded set of fields.

Page structure:

- Render the page on the normal `bg-background` canvas; do not wrap the entire page in an
  enclosing `View`, floating card, or panel.
- Put the outlet back affordance above the page title with `NavigateBackButton` when the page
  was reached from another workflow.
- Use a guidance-style page header: uppercase eyebrow, large light display title, and one
  restrained sentence explaining the operational outcome.
- Add a quiet divider below the header before the first input section.
- Lay out each input section as a row: left rail for the section title and short explanation,
  right rail for status chips, fields, validation/error copy, and the action.
- Separate repeated sections with full-width border rules instead of stacking cards.

Section rhythm:

- Left rail: `text-2xl font-medium` section heading and muted helper copy. Keep this copy about
  the operator outcome, not the implementation.
- Right rail: use compact status chips at the top when they help orientation, then a responsive
  field grid, then helper/error copy, then the primary action after a top border.
- Keep primary actions in the right rail, close to the fields they submit. Avoid page-level
  action bars for a single section.
- Use cards only inside the right rail when a contained sub-decision truly needs framing. The
  input section itself should remain an unframed row.

Copy rules:

- Prefer operator language such as "register", "checkout station", "drawer", "team", "route",
  "store", and "profile" over implementation language such as "browser", "fingerprint",
  "terminal identity", "binding", or "session" unless the operator must act on that concept.
- Status chips should answer scan questions: "Ready", "Setup needed", "Needs attention",
  object name, or missing required detail.
- Helper text should explain what to enter or why it matters. Do not describe how the system
  stores or detects the value unless that is part of the operator's decision.

## Shell Composition

The shell anchors the workspace and then steps aside for page content.

Rules:

- Keep shell, page header, and workspace sections visually distinct.
- Prefer left-rail navigation or a strong top-level header for orientation.
- Preserve scan paths: title, state, primary action, then supporting content.
- Do not add landing-page hero composition to operational tools.
- Page sections should be full-width bands or unframed layouts; use cards for repeated items,
  modals, or genuinely framed tools.

## Motion

Motion should guide attention, not perform.

Tokens:

- `--motion-fast`: `160ms`.
- `--motion-standard`: `240ms`.
- `--motion-slow`: `360ms`.
- `--ease-standard`: default transitions.
- `--ease-emphasized`: important reveals.

Use motion for focus, overlays, status changes, drawers, and short feedback. Avoid decorative
easing that makes the workspace feel lively instead of useful. If motion obscures hierarchy,
it is too strong for Athena.

## Storybook Workflow

Use Storybook as the design workbench:

- `Guidance/Introduction`: written implementation rules.
- `Foundations/Overview`: tokens, color roles, type, spacing, density, motion, and detail-view specimens.
- `Primitives/*`: reusable controls and surface behavior.
- `Patterns/*`: shell and workspace composition examples.
- `Templates/*`: complete reference pages.

When exploring design changes, use Storybook toolbar globals such as Theme and Radius. When a
choice becomes canonical, promote it into `src/index.css` and update any tests that assert the
token value.

## Implementation Checklist

Before changing UI:

- Read this file, the relevant Storybook story, and nearby feature components.
- Use existing primitives and Tailwind token classes before inventing new styles.
- Check both light and dark mode when the surface uses semantic colors.
- Keep copy calm, clear, restrained, and operational.
- Verify text does not overlap or overflow at mobile and desktop widths.
- For Storybook/design-system edits, run the validation guide's Storybook and frontend tooling checks.

Do not introduce a new visual language inside a feature. If the current system cannot express
the design, extend the token system first.
