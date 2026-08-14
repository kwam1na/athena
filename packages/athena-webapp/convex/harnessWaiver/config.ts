import { env } from "../_generated/server";

function required(name: string, value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is not configured.`);
  return normalized;
}

export function waiverPasskeyConfig() {
  const origin = required("ATHENA_WAIVER_ORIGIN", env.ATHENA_WAIVER_ORIGIN);
  return {
    reviewerEmail: required(
      "ATHENA_WAIVER_REVIEWER_EMAIL",
      env.ATHENA_WAIVER_REVIEWER_EMAIL,
    ),
    brokerSecret: required(
      "ATHENA_WAIVER_BROKER_SECRET",
      env.ATHENA_WAIVER_BROKER_SECRET,
    ),
    enrollmentTokenHash: env.ATHENA_WAIVER_ENROLLMENT_TOKEN_HASH?.trim() ?? "",
    rpId: required("ATHENA_WAIVER_RP_ID", env.ATHENA_WAIVER_RP_ID),
    origin,
    approvalUrl: `${origin}/waiver/approve`,
  };
}
