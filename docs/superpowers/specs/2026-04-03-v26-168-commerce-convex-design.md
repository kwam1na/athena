# V26-168 Commerce Convex Query Design

## Goal
Refactor Athena's highest-risk storefront commerce queries to use indexed or otherwise bounded Convex access patterns without changing the public shapes returned to current callers.

## Scope
- `packages/athena-webapp/convex/storeFront/bag.ts`
- `packages/athena-webapp/convex/storeFront/savedBag.ts`
- `packages/athena-webapp/convex/storeFront/checkoutSession.ts`
- `packages/athena-webapp/convex/storeFront/onlineOrder.ts`
- `packages/athena-webapp/convex/schema.ts`

## Design
The refactor will be end-to-end. It will add the missing additive schema indexes needed for the current storefront bag, saved-bag, checkout-session, and online-order access patterns, then switch those modules from broad `.filter(...)` and `.collect()` scans to `withIndex(...)` or bounded follow-up work after a narrow indexed lookup.

Bag and saved-bag flows will move owner lookup and item lookup onto direct indexes so route handlers such as the active-bag endpoints do not need full-table scans. Checkout session and online order flows will use direct indexes for session-item, order-item, storefront-user, checkout-session, and store access patterns, while preserving the current authorization and ownership checks.

## Index Additions
- `bag.by_storeFrontUserId`
- `savedBag.by_storeFrontUserId`
- `savedBagItem.by_savedBagId`
- `checkoutSession.by_storeFrontUserId`
- `checkoutSession.by_storeId`
- `onlineOrder.by_checkoutSessionId`
- `onlineOrder.by_storeFrontUserId`
- `onlineOrder.by_storeId`
- `onlineOrder.by_externalReference`
- `onlineOrderItem.by_orderId`
- `promoCodeItem.by_productSkuId`
- `redeemedPromoCode.by_promoCodeId_storeFrontUserId`

## Guardrails
- Keep current request and response shapes stable.
- Do not broaden this into public/internal boundary work.
- Do not pull helper extraction beyond small local indexed loaders that reduce repeated query logic in the touched modules.
- Preserve ownership behavior for guest-to-user bag and saved-bag transfer flows.

## Validation
- Add failing tests first for the new schema indexes and the primary indexed commerce lookup paths.
- Run `bun run lint:convex:changed`, `bun run build`, and `bun run test` in `packages/athena-webapp`.
