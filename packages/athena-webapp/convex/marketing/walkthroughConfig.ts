import { env } from "../_generated/server";

const LOCAL_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
] as const;

export function parseBoundedPositiveInteger(
  configured: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
) {
  if (configured === undefined) return fallback;
  if (!/^\d+$/.test(configured)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} is outside its approved range`);
  }
  return parsed;
}

export function resolveWalkthroughAllowedOrigins(
  configured: string | undefined,
  allowLocal: boolean,
) {
  const origins = (configured ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowLocal) origins.push(...LOCAL_ORIGINS);
  return [...new Set(origins)];
}

export function walkthroughAllowedOrigins() {
  return resolveWalkthroughAllowedOrigins(
    env.WALKTHROUGH_ALLOWED_ORIGINS,
    env.WALKTHROUGH_ALLOW_LOCAL_ORIGINS === "true",
  );
}

export function walkthroughMaxBodyBytes(defaultValue = 8_192) {
  return parseBoundedPositiveInteger(
    env.WALKTHROUGH_MAX_BODY_BYTES,
    defaultValue,
    "WALKTHROUGH_MAX_BODY_BYTES",
    1_024,
    64 * 1_024,
  );
}

export function walkthroughDailyPerEmailLimit(defaultValue = 4) {
  return parseBoundedPositiveInteger(
    env.WALKTHROUGH_DAILY_PER_EMAIL_LIMIT,
    defaultValue,
    "WALKTHROUGH_DAILY_PER_EMAIL_LIMIT",
    1,
    1_000,
  );
}

export function walkthroughHourlyGlobalLimit(defaultValue = 120) {
  return parseBoundedPositiveInteger(
    env.WALKTHROUGH_HOURLY_GLOBAL_LIMIT,
    defaultValue,
    "WALKTHROUGH_HOURLY_GLOBAL_LIMIT",
    1,
    100_000,
  );
}

export function walkthroughHourlyNotificationLimit(defaultValue = 60) {
  return parseBoundedPositiveInteger(
    env.WALKTHROUGH_HOURLY_NOTIFICATION_LIMIT,
    defaultValue,
    "WALKTHROUGH_HOURLY_NOTIFICATION_LIMIT",
    1,
    100_000,
  );
}

export function landingFunnelHourlyLimit(defaultValue = 2_000) {
  return parseBoundedPositiveInteger(
    env.LANDING_FUNNEL_HOURLY_LIMIT,
    defaultValue,
    "LANDING_FUNNEL_HOURLY_LIMIT",
    1,
    1_000_000,
  );
}

export function walkthroughPrivacyContact() {
  const contact = (process.env.WALKTHROUGH_PRIVACY_CONTACT ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
    throw new Error("WALKTHROUGH_PRIVACY_CONTACT must be a valid email");
  }
  return contact;
}
