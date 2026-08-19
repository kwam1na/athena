import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    MAILERSEND_API_KEY: v.optional(v.string()),
    R2_PUBLIC_URL: v.optional(v.string()),
    WALKTHROUGH_ALLOWED_ORIGINS: v.optional(v.string()),
    WALKTHROUGH_ALLOW_LOCAL_ORIGINS: v.optional(v.string()),
    WALKTHROUGH_NOTIFICATION_RECIPIENT: v.optional(v.string()),
    WALKTHROUGH_PRIVACY_CONTACT: v.optional(v.string()),
    WALKTHROUGH_MAX_BODY_BYTES: v.optional(v.string()),
    WALKTHROUGH_DAILY_PER_EMAIL_LIMIT: v.optional(v.string()),
    WALKTHROUGH_HOURLY_GLOBAL_LIMIT: v.optional(v.string()),
    WALKTHROUGH_HOURLY_NOTIFICATION_LIMIT: v.optional(v.string()),
    WALKTHROUGH_INGRESS_DISABLED: v.optional(v.string()),
    WALKTHROUGH_NOTIFICATIONS_DISABLED: v.optional(v.string()),
    WALKTHROUGH_HMAC_ACTIVE_VERSION: v.optional(v.string()),
    WALKTHROUGH_HMAC_ACTIVE_SECRET: v.optional(v.string()),
    WALKTHROUGH_HMAC_PRIOR_KEYRING: v.optional(v.string()),
    LANDING_FUNNEL_HOURLY_LIMIT: v.optional(v.string()),
    LANDING_FUNNEL_INGRESS_DISABLED: v.optional(v.string()),
    // Signs the storefront `guest_id` cookie. Optional so an unconfigured
    // environment still deploys and still serves anonymous browse; every
    // guest-identified path fails closed without it.
    ATHENA_STOREFRONT_COOKIE_SECRET: v.optional(v.string()),
    ATHENA_WAIVER_REVIEWER_EMAIL: v.optional(v.string()),
    ATHENA_WAIVER_BROKER_SECRET: v.optional(v.string()),
    ATHENA_WAIVER_ENROLLMENT_TOKEN_HASH: v.optional(v.string()),
    ATHENA_WAIVER_RP_ID: v.optional(v.string()),
    ATHENA_WAIVER_ORIGIN: v.optional(v.string()),
  },
});
