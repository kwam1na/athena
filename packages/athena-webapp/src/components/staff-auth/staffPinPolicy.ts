export const STAFF_PIN_LENGTH = 4;

export function normalizeStaffPin(value: string) {
  return value.normalize("NFKC").replace(/\D/g, "").slice(0, STAFF_PIN_LENGTH);
}
