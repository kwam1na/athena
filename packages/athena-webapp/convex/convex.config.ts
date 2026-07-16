import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    MAILERSEND_API_KEY: v.optional(v.string()),
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
    POS_OFFLINE_AUTHORITY_KEYS_JSON: v.optional(v.string()),
  },
});
