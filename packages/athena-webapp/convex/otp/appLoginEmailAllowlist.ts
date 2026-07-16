import { v } from "convex/values";

import { query } from "../_generated/server";

export const ATHENA_APP_LOGIN_EMAIL_ALLOWLIST = [
  "kwamina.0x00@gmail.com",
  "kwami.nuh@gmail.com",
  "pos@wigclub.store",
  "essuahmensahmaud@gmail.com",
  "knownothing955@gmail.com",
] as const;

const approvedAppLoginEmails = new Set<string>(
  ATHENA_APP_LOGIN_EMAIL_ALLOWLIST,
);

export function normalizeAthenaAppLoginEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isAthenaAppLoginEmailApproved(email: string) {
  return approvedAppLoginEmails.has(normalizeAthenaAppLoginEmail(email));
}

export const checkAppLoginEmailApproval = query({
  args: {
    email: v.string(),
  },
  returns: v.object({
    approved: v.boolean(),
  }),
  handler: async (_ctx, args) => ({
    approved: isAthenaAppLoginEmailApproved(args.email),
  }),
});
