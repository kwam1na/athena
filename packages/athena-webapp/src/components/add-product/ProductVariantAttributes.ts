type VariantAttributeValue = number | string | undefined;

function isLegacyNullPlaceholder(value: unknown) {
  return typeof value === "string" && value.trim().toUpperCase() === "NULL";
}

export function normalizeSkuAttributeValue<T extends VariantAttributeValue>(
  value: T,
): T | undefined {
  if (isLegacyNullPlaceholder(value)) {
    return undefined;
  }

  return value;
}

export function parseVariantAttributeValue(attribute: string, value: string) {
  if (isLegacyNullPlaceholder(value)) {
    return undefined;
  }

  if (attribute !== "length") {
    return value;
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    return undefined;
  }

  const parsedValue = Number(trimmedValue);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}
