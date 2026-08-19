import { v } from "convex/values";

/**
 * `storeId` is what makes a guest admissible.
 *
 * The storefront-customer adapter derives the admitted store from THIS row (the
 * `store_id` cookie is only cross-checked), so a guest without `storeId` cannot
 * be clamped and is a terminal denial at every customer route. The write path
 * is therefore strict: `storeFront/guest:create` requires `storeId`, and no
 * caller may create a storeless guest.
 *
 * The stored field stays optional on purpose. `storeFront/guestStoreIdBackfill`
 * fills every legacy row for which an authoritative related row exists
 * (`bag` / `checkoutSession` / `onlineOrder`) and deliberately LEAVES the rest
 * unset rather than defaulting them to a store — a wrong store would place a
 * stranger inside a merchant's customer set, which is worse than the denial.
 * Convex validates every existing document against the schema on push, so
 * declaring the column required would make those intentionally-unresolved rows
 * un-pushable; the invariant is enforced where rows are created and at
 * admission, which is where it actually protects anything.
 *
 * Operational prerequisite: run the backfill before the next storefront deploy.
 */
export const guestSchema = v.object({
  marker: v.optional(v.string()),
  creationOrigin: v.optional(v.string()),
  email: v.optional(v.string()),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  phoneNumber: v.optional(v.string()),
  storeId: v.optional(v.id("store")),
  organizationId: v.optional(v.id("organization")),
});
