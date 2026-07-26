# Catalog and Product Design-System Fit Review

## Scope

This review covers the U6 home, category, subcategory, filter, product-card,
product-detail, gallery, variant, review-display, and responsive action
surfaces. Pricing, inventory, route/search parameters, and analytics contracts
remain feature-owned and unchanged.

## Fit counts

| Fit dimension | Count | Finding |
| --- | ---: | --- |
| Compatibility variants | 1 | `ProductActions.layout` retains a mobile width recipe while sharing action behavior and state. |
| Policy exceptions | 0 | U6 adds no exception to the design-system artifact, accessibility, or semantic-token policies. |
| Route-local overrides | 1 | The homepage hero intentionally owns a full-viewport presentation; its colors, media, and controls use shared roles and primitives. |
| Duplicated compositions | 1 | Product detail retains separate mobile and desktop presentation order, but both consume the same SKU state, attributes, pricing, inventory, and action components. No commerce behavior diverges at 767/768px. |

## Responsive matrix

| Surface | 320/375px | 768px | 1024/1440px |
| --- | --- | --- | --- |
| Catalog grid | Two explicit columns with shared gutters | Three explicit columns | Three or four explicit columns within `max-w-content` |
| Filters | Named sheet trigger and focus-managed sheet | Desktop filter column begins | Sticky semantic filter header and bounded content |
| Product gallery | Full-width stable aspect ratio and named thumbnails | Two-column product layout | Same bounded two-column recipe |
| Product actions | Sticky mobile placement, shared busy/disabled behavior | Inline desktop placement | Inline desktop placement |
| Homepage merchandise | Two-column cards without fixed card widths | Three columns | Four bounded columns |

## Merchandise-state matrix

The retained `Templates/Catalog and Product` Storybook fixture uses synthetic
data and documents loading, empty catalog, failed media, sold out, low
inventory, offer, disabled action, and recoverable error states. Product media
uses the one-hop fallback contract; inventory and offer language use semantic
status treatments; loading and errors use `PageState`.

## Deviations and ownership

- `ProductActions.layout` is owned by U6 and may be removed in U9 if a
  container-query recipe can express the mobile icon-action width without
  weakening the shared behavior contract.
- The duplicated product-detail presentation order is owned by U6. U9 may
  collapse it after browser proof confirms no intentional mobile ordering is
  lost.
- The full-viewport homepage hero is an intentional specialist composition,
  not a token exception. U9 owns any later extraction into a named hero
  template.
- U9 moved `WelcomeBackModal` beside its live shopping-bag promotion consumer.
  Shared animation/type compatibility files remain until the review journey
  can move its concurrent consumers.
- U9 removed the unreferenced `UpsellModal` family after repository search
  confirmed that it had no runtime, route, or Storybook consumer.

## Decision

**Recommendation: proceed to U7, pending implementing-lead sign-off.** No
unresolved P0/P1 accessibility issue, undocumented policy exception, unowned
compatibility variant, or breakpoint-specific commerce behavior was found.
The implementing lead must record the final proceed-or-revise decision before
U7 starts.
