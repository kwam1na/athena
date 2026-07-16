import { Email } from "@convex-dev/auth/providers/Email";
import type { Value } from "convex/values";
import { alphabet, generateRandomString } from "oslo/crypto";

import type { DataModel, Doc } from "../_generated/dataModel";
import { sendVerificationCode } from "../mailersend";
import {
  ATHENA_EMAIL_OTP_PROVIDER_ID,
  ATHENA_LOGIN_EMAIL_NOT_APPROVED_ERROR_CODE,
} from "../../shared/auth";
import {
  isAthenaAppLoginEmailApproved,
  normalizeAthenaAppLoginEmail,
} from "./appLoginEmailAllowlist";

const EMAIL_OTP_MAX_AGE_SECONDS = 60 * 20;

function assertAppLoginEmailApproved(email: string) {
  if (!isAthenaAppLoginEmailApproved(email)) {
    throw new Error(ATHENA_LOGIN_EMAIL_NOT_APPROVED_ERROR_CODE);
  }
}

async function authorizeEmailOtp(
  params: Record<string, Value | undefined>,
  account: Doc<"authAccounts">,
) {
  if (typeof params.email !== "string") {
    throw new Error(
      "Token verification requires an `email` in params of `signIn`.",
    );
  }

  const normalizedEmail = normalizeAthenaAppLoginEmail(params.email);
  assertAppLoginEmailApproved(normalizedEmail);

  if (account.providerAccountId !== normalizedEmail) {
    throw new Error(
      "Short verification code requires a matching `email` in params of `signIn`.",
    );
  }
}

function formatValidTime(expires: Date) {
  const remainingMs = expires.getTime() - Date.now();
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / (60 * 1000)));

  return `${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}`;
}

const emailOtpProvider = Email<DataModel>({
  id: ATHENA_EMAIL_OTP_PROVIDER_ID,
  maxAge: EMAIL_OTP_MAX_AGE_SECONDS,
  normalizeIdentifier: normalizeAthenaAppLoginEmail,
  authorize: authorizeEmailOtp,
  async generateVerificationToken() {
    return generateRandomString(6, alphabet("0-9"));
  },
  async sendVerificationRequest({ identifier: email, token, expires }) {
    if (!isAthenaAppLoginEmailApproved(email)) {
      return;
    }

    const response = await sendVerificationCode({
      customerEmail: email,
      verificationCode: token,
      storeName: "Athena",
      validTime: formatValidTime(expires),
    });

    if (response.ok) {
      return;
    }

    const responseBody = await response.text().catch(() => "");
    throw new Error(
      responseBody || `MailerSend failed with status ${response.status}`,
    );
  },
});

export const EmailOTP = {
  ...emailOtpProvider,
  authorize: authorizeEmailOtp,
};
