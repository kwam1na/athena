# Storefront Design System

Use this guide before changing storefront presentation. The storefront borrows Athena's
governance model—documented foundations, curated primitives, reusable patterns, and automated
checks—but owns its customer-facing values and components. The token source is
[`src/index.css`](../../src/index.css), and [`tailwind.config.js`](../../tailwind.config.js)
is its utility-class projection.

## Design thesis

The storefront is warm, image-led, and refined. Quiet neutral surfaces let merchandise lead;
one recognizable brand accent signals identity and offers; dark neutral actions make the next
step unmistakable. Composition should feel comfortable on touch screens, restrained on large
screens, and useful before it feels decorative.

Content hierarchy is product or journey context first, price and status second, the next
customer action third, and promotional detail only when it changes a decision. This is a
light-first system. Its semantic roles can support a future validated theme, but `.dark`,
system-theme switching, and unverified dark values are not part of the current contract.

## Foundations

### Color and surfaces

Use semantic roles, never raw palette names, for normalized work:

- `canvas` is the page backdrop.
- `surface`, `surface-subtle`, and `surface-raised` establish containment and elevation.
- `brand` carries identity; `action` carries the primary customer action.
- `selection` marks selected or highlighted content without implying status.
- `offer` is reserved for discounts or decision-relevant merchandising.
- `success`, `warning`, `danger`, and `info` communicate system state.
- `inventory-available`, `inventory-low`, and `inventory-unavailable` communicate stock state.
- `border`, `input`, `focus`, and `overlay` define interaction boundaries.

State color is never the only cue. Pair it with text, an icon, or both. Normal body text and
interactive states must meet WCAG 2.2 AA contrast. Large decorative display type does not
justify weakening customer-critical text.

### Typography and numerics

Use `font-sans` for interface and content text, `font-display` only for restrained brand
moments, and `font-numeric` with `tabular-nums` for prices, totals, quantities, and order
numbers. Maintain a clear heading sequence and avoid using size alone to imply semantics.
Inputs, textareas, and selects stay at 16 CSS pixels on mobile so focusing a field does not
trigger browser zoom.

### Spacing, layout, and density

Use `layout-2xs` through `layout-3xl` for component and section rhythm. Use `max-w-content`
for the shared 64rem content measure and `px-gutter` for its responsive page gutter. Safe-area
utilities (`safe-top`, `safe-right`, `safe-bottom`, `safe-left`) are available for fixed mobile
actions.

Use `control-compact`, `control-standard`, and `control-comfortable` for control geometry.
Standalone controls and mobile actions must expose at least a 44×44 CSS-pixel target. Inline
text links may use their natural text target when spacing and surrounding alternatives satisfy
WCAG 2.5.8.

Use `rounded-sm`, `rounded-md`, `rounded-lg`, and `rounded-pill` instead of arbitrary radii.
Use `shadow-surface` for contained merchandise/content and `shadow-overlay` for dialogs,
drawers, and menus.

### Motion

Use `duration-fast`, `duration-standard`, or `duration-slow` with `ease-standard` or
`ease-emphasized`. Motion provides feedback or explains state; it must not delay essential
content or navigation. [`getRevealMotion`](../../src/lib/motion.ts) is the default reveal
contract. Call it with the result of Framer Motion's `useReducedMotion`.

When reduced motion is requested, content is immediately visible, translation is zero, and
delay and duration collapse to zero. The global stylesheet also suppresses nonessential CSS
animation and smooth scrolling.

### Imagery and responsive composition

Product imagery is content: provide useful alternative text, stable aspect-ratio space, and
an explicit fallback. Preserve crop intent across breakpoints. Responsive composition should
reflow rather than shrink a desktop canvas; zoom to 200% and narrow viewport checks must not
introduce two-dimensional scrolling except for intrinsically two-dimensional content.

## Interaction and accessibility contract

- Keyboard focus is always visible through the `focus` role. Never use `outline-none` without
  an equivalent `focus-visible` replacement.
- Browser zoom remains enabled and `index.html` is the only viewport authority.
- Controls need accessible names; icon-only buttons require an explicit label.
- Busy actions remain named, expose busy/disabled state, and reject repeat activation.
- Errors identify the affected field, explain recovery in customer-safe language, and retain
  entered values when possible.
- Status updates use an appropriate live region without announcing routine visual changes.
- Authentication must not rely on memory tests or prevent password-manager workflows.
- Overlays use accessible primitives that trap and restore focus and support Escape.

The contract maps to WCAG 2.2 AA as follows:

| Assertion | WCAG 2.2 success criteria |
|---|---|
| Text and UI contrast | 1.4.3 Contrast (Minimum), 1.4.11 Non-text Contrast |
| Reflow and restored zoom | 1.4.10 Reflow, 1.4.4 Resize Text |
| Visible keyboard focus | 2.4.7 Focus Visible, 2.4.11 Focus Not Obscured (Minimum) |
| Accessible names and labels | 1.3.1 Info and Relationships, 2.5.3 Label in Name, 4.1.2 Name, Role, Value |
| Status and busy feedback | 4.1.3 Status Messages |
| Error identification and recovery | 3.3.1 Error Identification, 3.3.3 Error Suggestion |
| Reduced motion | 2.3.3 Animation from Interactions |
| Authentication compatibility | 3.3.8 Accessible Authentication (Minimum) |
| Project 44×44 target | Stricter project rule; WCAG 2.5.8 Target Size (Minimum) remains the AA floor |

## Copy

Customer copy is calm, direct, and specific. Explain what happened, whether customer input is
safe, and the next available action. Normalize backend errors before display. Do not imply an
order, payment, reward, or inventory transition succeeded until the corresponding business
contract confirms it.

## Layering and ownership

Foundations and primitives must not import route, product, checkout, analytics, or API state.
Commerce patterns may compose primitives; templates may compose patterns; routes connect
templates to product state. Keep the system package-local until repeated real usage proves a
contract is genuinely neutral across Athena and storefront.

## Legacy migration aliases

`accent2`, `accent3`, `accent4`, and `accent5` are a temporary, non-canonical bridge for
existing route code. They remain resolvable during migration but must not appear in new or
normalized code, Storybook guidance, or component APIs. Replace them with `brand`, `action`,
`selection`, `offer`, or a status role, then remove the aliases once repository usage is zero.

## Change checklist

- Select an existing semantic token before adding a value.
- Preserve the relevant route contract in
  [`design-system-migration-baseline.md`](./design-system-migration-baseline.md).
- Follow [`design-system-artifact-policy.md`](./design-system-artifact-policy.md) for fixtures,
  screenshots, videos, traces, and Storybook.
- Check keyboard, zoom/reflow, reduced motion, loading, empty, error, and success states.
- Run the package's focused tests, typecheck, and build.
