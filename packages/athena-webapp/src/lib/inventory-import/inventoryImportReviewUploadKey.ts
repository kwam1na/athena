type ReviewUploadRowDecision = {
  action?: "create_item" | "skip_row";
  nameSource?: "import" | "athena";
  priceSource?: "import" | "athena";
  productName: string;
  quantitySource?: "import" | "athena";
  rowKey: string;
  rowNumber: number;
};

async function hashFingerprint(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function buildInventoryImportReviewUploadKey(args: {
  fileName?: string;
  importKey: string;
  issueCount: number;
  notes?: string;
  rawContent: string;
  rawContentChunkCount: number;
  rowCount: number;
  rowDecisionChunkCount: number;
  rowDecisions: ReviewUploadRowDecision[];
  sourceFormat: "csv" | "json";
}) {
  const normalizeOptionalFingerprintValue = (value?: string) => {
    const normalized = value?.trim();
    return normalized || undefined;
  };
  const fingerprint = JSON.stringify({
    fileName: normalizeOptionalFingerprintValue(args.fileName),
    importKey: args.importKey,
    issueCount: args.issueCount,
    notes: normalizeOptionalFingerprintValue(args.notes),
    rawContent: args.rawContent.trim(),
    rawContentChunkCount: args.rawContentChunkCount,
    rowCount: args.rowCount,
    rowDecisionChunkCount: args.rowDecisionChunkCount,
    rowDecisions: args.rowDecisions.map((decision) => ({
      action: decision.action,
      nameSource: decision.nameSource,
      priceSource: decision.priceSource,
      productName: decision.productName.trim(),
      quantitySource: decision.quantitySource,
      rowKey: decision.rowKey.trim(),
      rowNumber: decision.rowNumber,
    })),
    sourceFormat: args.sourceFormat,
  });
  return `inventory-import-review-upload:${await hashFingerprint(fingerprint)}`;
}
