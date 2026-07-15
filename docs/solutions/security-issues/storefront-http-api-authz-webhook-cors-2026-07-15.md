---
title: "Storefront HTTP routes must derive identity from cookies and check ownership; payment webhooks must verify signatures; CORS must be a first-party allowlist"
date: 2026-07-15
category: security-issues
module: storefront
problem_type: security_issue
component: authentication
symptoms:
  - "GET/PUT /users/:userId served and updated any customer's PII by document id with no auth (non-me branch)"
  - "orders/bags/savedBags /owner claim routes reassigned ownership using currentOwnerId/newOwnerId taken straight from the request body"
  - "bag/savedBag item add/update/delete and rewards /order-points acted on client-supplied ids with no ownership check"
  - "reviews PATCH/DELETE and the underlying reviews.update/deleteReview mutations had no actor, so any user could edit or delete any review"
  - "the Paystack webhook accepted unsigned JSON (signature verification commented out), so a crafted charge.success placed a paid order with no money collected"
  - "CORS reflected any Origin with credentials:true and SameSite=None cookies, so any third-party page could drive authenticated storefront requests"
root_cause: missing_permission
resolution_type: code_fix
severity: critical
tags: [storefront, authorization, idor, pii, convex, paystack, webhook, cors, multi-tenant]
delivery_diff_fingerprint: aa1a3021c5e6d37802d8a97254eab7bb278e0df58da817f39f4fbe03b7c93216
---

# Storefront HTTP API — ownership authorization, webhook signature, and CORS allowlist

## Problem

An audit of the customer storefront's HTTP surface (`packages/athena-webapp/convex/http`) found the storefront counterparts of the same class the POS Phase 0 work closed, still open. Identity was taken from client-controlled inputs (a path/body `userId`, `bagId`, or `ownerId`) and trusted directly, so PII, orders, carts, reviews, and loyalty points were readable and mutable by id. Because the API answered with `Access-Control-Allow-Credentials: true` while reflecting any `Origin` and issuing `SameSite=None` cookies, every one of those routes was also drivable cross-origin from any website as the logged-in customer. Separately, the Paystack webhook had its signature verification commented out, so a forged `charge.success` would place a "paid" order.

## Symptoms

- `GET/PUT /users/:userId` returned/updated any customer's email, phone, and addresses by id.
- `/owner` routes (`onlineOrder`, `bag`, `savedBag`) absorbed an arbitrary guest's orders/cart into the caller's account.
- Bag item mutations and `rewards /order-points` acted on any id with no ownership check.
- `reviews.update`/`deleteReview` edited or deleted any review site-wide.
- The webhook created "paid" orders from unsigned, unauthenticated JSON.
- Any third-party page could issue credentialed requests and read the responses.

## What Didn't Work

- Re-verifying the charged amount against `session.amount` in the webhook is wrong as-is: `checkoutSession.ts:413` sets `sessionAmount = pricedCheckout.subtotal` (subtotal only, excluding delivery fee/discount), so comparing it to the Paystack total false-positives on every order with a delivery fee and would block legitimate checkouts. Signature verification alone closes the forgery hole; correct amount reconciliation is a separate follow-up.
- `node:crypto` cannot be used for the HMAC: the Convex HTTP action runtime does not expose it (this is almost certainly why the original signature code was commented out). Web Crypto (`crypto.subtle`) is the runtime-safe replacement.
- A single-cookie check on the `/owner` claim (only `newOwnerId === user_id`) is insufficient — without also binding `currentOwnerId === guest_id`, an attacker can pull an arbitrary guest's orders into their own account.

## Solution

Derive the actor from the session cookie on every sensitive route and compare resource ownership with the existing `isAuthorizedResourceOwner(resourceOwnerId, actorId)` helper (exact match, null-safe), mirroring the POS `requirePosTransactionStoreAccess` pattern:

- `user.ts`: GET/PUT `403` unless the param is `"me"`, then key strictly off the `user_id` cookie. The arbitrary-id branches are removed.
- `onlineOrder.ts`, `bag.ts`, `savedBag.ts` `/owner`: require the target to equal the `user_id` cookie AND the source to equal the `guest_id` cookie, so a caller can only merge their own prior guest session.
- `bag.ts`/`savedBag.ts` item add/update/delete/clear: `assertBagOwnership` fetches the bag and compares `storeFrontUserId` to the cookie actor before mutating.
- `reviews.ts` PATCH/DELETE require a cookie actor; ownership is enforced inside the `reviews.update`/`deleteReview` mutations via a new `requestedByStoreFrontUserId` arg (defense-in-depth — every caller of the mutation is covered).
- `rewards.ts`: `/order-points` enforces order ownership; `/award-guest-orders` binds `userId`→`user_id` and `guestId`→`guest_id` cookies.

Payments: restore signature verification in `paystack.ts` before any DB mutation, using `computePaystackSignature` (Web Crypto HMAC-SHA512, hex) and a constant-time hex compare (`timingSafeEqualHex`). Missing secret → `500`, missing/invalid signature → `401`; all fail closed.

Cross-site: replace the reflect-any CORS `origin` callback with `resolveAllowedOrigin`, a unit-tested first-party allowlist (apex + `*.wigclub.store`, localhost only when `STAGE !== "prod"`, plus exact `ADDITIONAL_ALLOWED_ORIGINS`). The suffix check rejects look-alikes like `wigclub.store.evil.com`.

Frontend: `storefront-webapp/src/api/reviews.ts` `updateReview`/`deleteReview` now send `credentials: "include"` so the cookie reaches the newly-enforced check.

## Prevention

- New storefront route touching a user-owned resource: derive identity from the cookie (`getStorefrontUserFromRequest` / `getCookie`) and gate with `isAuthorizedResourceOwner`; never trust a path/body id.
- Cross-identity actions (claims/merges) need proof of BOTH identities from cookies.
- Push ownership into the Convex mutation, not just the route, so a second caller can't bypass a route-only check.
- Every provider webhook must verify its signature with Web Crypto in the Convex HTTP runtime and fail closed; set the provider secret (`PAYSTACK_SECRET_KEY`) and `STAGE=prod` in the prod environment before deploy.
- This diff deliberately leaves cookie integrity (signed cookies / opaque server-side session tokens + CSRF) to the separate ticket V26-952 / Phase 1: until then, a non-browser client can still forge a `Cookie: user_id=<victimId>` header. The ownership checks here remain necessary regardless of how identity is later proven.
