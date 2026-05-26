const QUICK_ADD_LOOKUP_CODE_BARCODE = /^\d[\d-]*$/;

export function isLikelyQuickAddBarcode(lookupCode: string): boolean {
  return QUICK_ADD_LOOKUP_CODE_BARCODE.test(lookupCode);
}

export function normalizeQuickAddLookupCode(lookupCode: string): string {
  const trimmedLookupCode = lookupCode.trim();
  if (!trimmedLookupCode) {
    return "";
  }

  const lookupCodeWithoutSpaces = trimmedLookupCode.replace(/\s+/g, "");
  if (isLikelyQuickAddBarcode(lookupCodeWithoutSpaces)) {
    return lookupCodeWithoutSpaces;
  }

  return trimmedLookupCode;
}

export function normalizeQuickAddInitialLookupCode(lookupCode: string): string {
  const extractedLookupCode = lookupCode.trim();
  if (!isLikelyQuickAddBarcode(extractedLookupCode)) {
    return "";
  }

  return normalizeQuickAddLookupCode(extractedLookupCode);
}
