---
date: 2026-04-25
topic: storefront-mobile-product-cta
---

# Storefront Mobile Product CTA

## Problem Frame

On mobile product detail pages, shoppers currently encounter product attributes before they have made a clear purchase or save intent. This makes the product page feel heavier than it needs to be, especially for hair products where color and length options can dominate the first product-information section. The mobile experience should keep the primary actions sticky at the bottom of the screen and collect required variant details only after the shopper expresses intent to add or save.

---

## Actors

- A1. Mobile shopper: Browses a product, then decides whether to add it to the bag or save it.
- A2. Storefront: Presents the product and collects the minimum details needed to complete the shopper's intended action.

---

## Key Flows

- F1. Add product from collapsed CTA bar
  - **Trigger:** A mobile shopper taps `Add to Bag` from the sticky bottom action bar.
  - **Actors:** A1, A2
  - **Steps:** The bar expands upward in place, shows the required product attributes for the selected product, lets the shopper adjust color and length, then provides a clear confirmation action to add the selected variant to the bag.
  - **Outcome:** The selected variant is added to the bag only after the shopper confirms from the expanded CTA bar.
  - **Covered by:** R1, R2, R3, R4, R6, R7

- F2. Save product from collapsed CTA bar
  - **Trigger:** A mobile shopper taps the save action from the sticky bottom action bar.
  - **Actors:** A1, A2
  - **Steps:** The bar expands upward in place, shows the same required attribute controls, lets the shopper adjust color and length, then provides a clear confirmation action to save the selected variant.
  - **Outcome:** The selected variant is saved only after the shopper confirms from the expanded CTA bar.
  - **Covered by:** R1, R2, R3, R5, R6, R7

- F3. Review product information without purchase intent
  - **Trigger:** A mobile shopper scrolls the product page without tapping add or save.
  - **Actors:** A1, A2
  - **Steps:** The product page keeps product details, trust signals, pickup, delivery, and review content readable while the sticky action bar remains available at the bottom.
  - **Outcome:** Variant controls do not occupy the product information flow until the shopper asks to act.
  - **Covered by:** R1, R8, R9

---

## Requirements

**Mobile CTA behavior**
- R1. On mobile product pages, the primary add and save actions must live in a sticky bottom CTA bar.
- R2. The initial mobile CTA bar state must be compact and must not show full product attribute controls.
- R3. Tapping `Add to Bag` from the compact bar must expand the CTA bar in place instead of immediately adding the current default variant.
- R4. When the expanded bar was opened by `Add to Bag`, the final confirmation action must add the currently selected variant to the bag.
- R5. When the expanded bar was opened by save, the final confirmation action must save the currently selected variant.

**Variant collection**
- R6. The expanded CTA bar must show the product attributes required to choose the variant, including color and length for hair products when those attributes are available.
- R7. Attribute changes made inside the expanded CTA bar must update the selected variant before the final add or save action runs.
- R8. The product page body on mobile must no longer show the full color and length selector block before intent.

**Experience quality**
- R9. The sticky CTA bar must not cover important page content in its compact or expanded states.
- R10. The expanded bar must provide an obvious way to return to the compact state without completing the action.
- R11. Sold-out and failed-action states must remain visible and actionable from the CTA bar.
- R12. Desktop product-page behavior should remain unchanged in this refinement.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4, R6, R7.** Given a mobile shopper is viewing a hair product with color and length options, when they tap `Add to Bag`, the bottom CTA bar expands to show color and length choices and the product is not added until they confirm.
- AE2. **Covers R1, R2, R5, R6, R7.** Given a mobile shopper taps the save action, when they choose a different length in the expanded bar and confirm, the saved item reflects the newly selected variant.
- AE3. **Covers R8, R9.** Given a mobile shopper scrolls through product details without tapping add or save, when they pass the title and price area, the product attributes do not appear inline and the sticky CTA bar does not obscure the page's readable content.
- AE4. **Covers R10, R11.** Given the CTA bar is expanded, when the shopper dismisses it or an action fails, the shopper can recover without losing page context.

---

## Success Criteria

- Mobile shoppers can browse product information with less visual burden before purchase intent.
- Shoppers still make an explicit color and length selection before add or save actions complete.
- The add/save flow feels anchored to the bottom CTA area rather than split between page content and actions.
- Planning can proceed without inventing the mobile interaction model, completion behavior, or desktop scope.

---

## Scope Boundaries

- This work is limited to the mobile product detail add/save experience.
- Desktop product detail behavior is intentionally unchanged.
- This work does not redesign the full product media gallery, pickup section, review section, bag page, or saved-items page.
- This work does not introduce a new checkout flow or change bag and saved-item ownership behavior.
- This work does not require changing product data, variant data, or pricing semantics.

---

## Key Decisions

- Interaction model: Use an expandable sticky bottom CTA bar.
- Intent gate: First tap on add or save opens variant collection; confirmation inside the expanded bar performs the mutation.
- Attribute placement: Hide full mobile product attribute controls from the main page body until intent.
- Variant scope: Color and length are the required first-class controls for the current hair-product use case.
- Platform scope: Keep this refinement mobile-only for v1.

---

## Dependencies / Assumptions

- Product variants already provide the color and length data needed to render the required controls.
- The current selected variant can remain initialized internally, but mobile shoppers should still confirm from the expanded CTA bar before add or save completes.
- Existing add-to-bag and save-item success, error, and sold-out behavior should be preserved inside the new mobile CTA flow.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R9][Technical] Determine the exact collapsed and expanded bar heights needed to avoid covering content across common mobile viewport sizes.
- [Affects R11][Technical] Confirm how the existing success sheet and error state should be visually coordinated with the expanded CTA bar.

---

## Next Steps

- -> `/ce-plan` for structured implementation planning
