/**
 * The single sanctioned seam between Athena's generated Convex model and the
 * package-neutral contract surface.
 *
 * Nothing else in `@athena/contracts` — and nothing at all in
 * `@athena/storefront-webapp` — may reach into
 * `packages/athena-webapp/convex/**`. Consumers depend on this module (or on
 * the contracts re-exported from it) so that regenerating the Convex data model
 * never rewrites import paths outside the Athena webapp package.
 *
 * Every import here is type-only, so this module contributes no runtime code to
 * a browser bundle.
 */
import type { Infer } from "convex/values";

import type { addressSchema } from "../athena-webapp/convex/schemas/storeFront";

export type { Doc, Id } from "../athena-webapp/convex/_generated/dataModel";

/** Delivery/billing address as persisted by the storefront checkout. */
export type Address = Infer<typeof addressSchema>;
