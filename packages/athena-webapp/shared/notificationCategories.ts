/**
 * The notification categories an operator can subscribe to. Declared here so
 * the store configuration UI can enumerate them without importing the Convex
 * schema module; `convex/schemas/notifications` derives its validator from
 * this list so the two cannot drift.
 */
export const NOTIFICATION_CATEGORIES = [
  "cash_controls",
  "eod",
  "system_health",
  "approvals",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
