/** Use a complete historical week: individual days can be closed or have no sales for a SKU. */
export function demoJourneyDate(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  const isoWeekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - isoWeekday - 6);
  return date.toISOString().slice(0, 10);
}
