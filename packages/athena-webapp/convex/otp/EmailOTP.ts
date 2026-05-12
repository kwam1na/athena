import { Email } from "@convex-dev/auth/providers/Email";
import { alphabet, generateRandomString } from "oslo/crypto";

import { sendVerificationCode } from "../mailersend";
import { ATHENA_EMAIL_OTP_PROVIDER_ID } from "../../shared/auth";

const EMAIL_OTP_MAX_AGE_SECONDS = 60 * 20;

function formatValidTime(expires: Date) {
  const remainingMs = expires.getTime() - Date.now();
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / (60 * 1000)));

  return `${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}`;
}

export const EmailOTP = Email({
  id: ATHENA_EMAIL_OTP_PROVIDER_ID,
  maxAge: EMAIL_OTP_MAX_AGE_SECONDS,
  async generateVerificationToken() {
    return generateRandomString(6, alphabet("0-9"));
  },
  async sendVerificationRequest({ identifier: email, token, expires }) {
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
