import { v } from "convex/values";

/** The closed reporting tender set — mirrors REPORT_PAYMENT_METHODS. */
const reportPaymentMethod = v.union(
  v.literal("cash"),
  v.literal("card"),
  v.literal("mobile_money"),
);

/**
 * Canonical fact ledger for the rebuilt reports layer.
 *
 * Identity is STRUCTURAL: uniqueness is the composite
 * (storeId, sourceDomain, sourceId, lineId, factKind) enforced via the
 * by_identity index by the ingestion module — no concatenated string keys.
 *
 * Emitters write facts inside the domain transaction (Convex mutations are
 * transactional), so there is no ingress staging table. Replay with an equal
 * fingerprint is a no-op; a fingerprint mismatch parks `quarantine` on the
 * existing row and dirties the day — facts are never silently overwritten.
 */
export const reportFactSchema = v.object({
  storeId: v.id("store"),

  sourceDomain: v.union(
    v.literal("pos"),
    v.literal("storefront"),
    v.literal("service"),
    v.literal("payments"),
    v.literal("inventory"),
    v.literal("daily_close"),
  ),
  sourceId: v.string(),
  lineId: v.string(),
  factKind: v.union(
    v.literal("sale"),
    v.literal("refund"),
    v.literal("void"),
    v.literal("correction"),
    v.literal("return"),
    v.literal("payment"),
    v.literal("payment_refund"),
    v.literal("close_snapshot"),
    v.literal("inventory_issue"),
    v.literal("procurement_receipt"),
  ),

  fingerprint: v.string(),
  fingerprintVersion: v.number(),

  /** Business time — when the event happened. Drives operatingDate. */
  occurredAt: v.number(),
  /** Arrival metadata — when Athena learned of it. */
  recordedAt: v.number(),
  /**
   * Server-stamped knowledge time for immutable reporting cutoffs. Optional
   * during the compatibility migration; acceptance refuses legacy rows until
   * they have been stamped rather than guessing from business time.
   */
  observedAt: v.optional(v.number()),
  /** Store-local operating day label, resolved at ingest via time authority. */
  operatingDate: v.string(),

  currency: v.string(),
  grossAmountMinor: v.number(),
  netAmountMinor: v.number(),
  taxAmountMinor: v.number(),
  discountAmountMinor: v.number(),
  quantity: v.number(),
  productSkuId: v.optional(v.id("productSku")),
  unitCostMinor: v.optional(v.number()),
  // Absent legacy allocation lineage is an honest unknown, never zero.
  paymentAllocationMinor: v.optional(v.number()),
  paymentAllocationCoverage: v.optional(
    v.union(v.literal("known"), v.literal("unknown")),
  ),

  /**
   * Payment-mix dimensions, all optional and all absent together.
   *
   * Absent means this fact makes no gross method contribution — a legacy row,
   * a refund or reversal, or a receipt whose source method reporting cannot
   * classify. It never means zero: the value still counts toward Payments
   * totals, only the method breakdown is unavailable.
   *
   * `paymentParticipationId` is the Daily Close-aligned unit of tender use —
   * the POS transaction where there is one, the allocation otherwise — so
   * several same-method allocations on one transaction count once.
   * `paymentMethodFrom` appears only on an approved method-correction fact,
   * which moves one participation from the old method to the new.
   */
  paymentMethod: v.optional(reportPaymentMethod),
  paymentMethodFrom: v.optional(reportPaymentMethod),
  paymentParticipationId: v.optional(v.string()),
  paymentMixMinor: v.optional(v.number()),

  quarantine: v.optional(
    v.object({
      reason: v.string(),
      detectedAt: v.number(),
    }),
  ),
});
