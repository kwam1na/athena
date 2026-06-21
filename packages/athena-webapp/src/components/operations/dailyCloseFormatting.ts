import { formatStoredCurrencyAmount } from "@/lib/pos/displayAmounts";

export function formatDailyCloseMoney(
  currency: string,
  amount?: number | null,
) {
  if (typeof amount !== "number") return "Pending";

  return formatStoredCurrencyAmount(currency, amount, {
    revealMinorUnits: true,
  });
}

export function formatDailyCloseOperatingDate(operatingDate: string) {
  const parsed = new Date(`${operatingDate}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return operatingDate;
  }

  return parsed.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    weekday: "long",
    year: "numeric",
  });
}

export function formatDailyCloseCompletedAt(completedAt?: number | null) {
  if (!completedAt) return "Completion time unavailable";

  return new Date(completedAt).toLocaleString([], {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}
