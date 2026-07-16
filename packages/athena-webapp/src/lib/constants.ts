export const OG_ORGANIZATION_ID = "kn7fw2ezvfrvp06ctjkb689tpd786c4j";
export const OG_STORE_ID = "m1773nc3djfy0qg7m0wp4v1bn9786n2y";

export const LOGGED_IN_USER_ID_KEY = "logged_in_user_id";
// Compatibility-only marker retained until the per-store migration retirement
// gate closes. It is never service-principal or offline authority.
export const LEGACY_POS_APP_ACCOUNT_ID_KEY = "athena.pos.app_account_id";
/** @deprecated Use only while removing legacy local account markers. */
export const POS_APP_ACCOUNT_ID_KEY = LEGACY_POS_APP_ACCOUNT_ID_KEY;
export const POS_SERVICE_PRINCIPAL_RECOVERY_EVIDENCE_VERSION = 1;
export const PENDING_ATHENA_AUTH_SYNC_KEY = "pending_athena_auth_sync";
export const ATHENA_PENDING_AUTH_SYNC_EVENT = "athena:pending-auth-sync";
export const ATHENA_AUTH_SYNC_FAILED_EVENT = "athena:auth-sync-failed";

export const FINGERPRINT_STORAGE_KEY = "athena.pos.fingerprint";

export const currencies = [
  {
    label: "US Dollar",
    value: "usd",
  },
  {
    label: "Ghanaian Cedi",
    value: "ghs",
  },
];

export const PAYSTACK_PROCESSING_FEE = 1.95;
