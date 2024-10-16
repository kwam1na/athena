import { Email } from "@convex-dev/auth/providers/Email";
import { alphabet, generateRandomString } from "oslo/crypto";
import { Resend as ResendAPI } from "resend";
import { VerificationCodeEmail } from "./VerificationCodeEmail";
import { AUTH_EMAIL, AUTH_RESEND_KEY } from "../env";

export const ResendOTP = Email({
  id: "resend-otp",
  apiKey: AUTH_RESEND_KEY,
  maxAge: 60 * 20,
  async generateVerificationToken() {
    return generateRandomString(8, alphabet("0-9"));
  },
  async sendVerificationRequest({
    identifier: email,
    provider,
    token,
    expires,
  }) {
    console.log(provider.apiKey);
    const resend = new ResendAPI("re_ExacZJiD_BpHB6Yyc8vcnZvk7LVJYWRBr");
    const { error } = await resend.emails.send({
      // TODO: Update with your app name and email address
      from: AUTH_EMAIL ?? "athena <onboarding@resend.dev>",
      to: [email],
      // TODO: Update with your app name
      subject: `Sign in to Convex SaaS`,
      react: VerificationCodeEmail({ code: token, expires }),
    });

    if (error) {
      throw new Error(JSON.stringify(error));
    }
  },
});
