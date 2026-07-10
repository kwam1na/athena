const SAFE_MATERIAL_FIELDS = new Set([
  "amountMinor",
  "currencyCode",
  "currencyMinorUnitScale",
  "eventType",
  "occurrenceAt",
  "quantity",
  "sourceDomain",
  "storeId",
]);

export function sanitizeConflictEvidence(args: {
  expectedFingerprint: string;
  receivedFingerprint: string;
  materialFields: string[];
}) {
  return {
    expectedFingerprint: args.expectedFingerprint,
    receivedFingerprint: args.receivedFingerprint,
    materialFields: [...new Set(args.materialFields)]
      .filter((field) => SAFE_MATERIAL_FIELDS.has(field))
      .sort(),
  };
}
