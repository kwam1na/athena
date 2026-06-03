// Keep the provider id stable so existing Convex auth-account records continue
// to work while Athena uses the shared MailerSend delivery path for OTPs.
export const ATHENA_EMAIL_OTP_PROVIDER_ID = "resend-otp";
export const ATHENA_POS_RECOVERY_CODE_PROVIDER_ID =
  "athena-pos-recovery-code";
