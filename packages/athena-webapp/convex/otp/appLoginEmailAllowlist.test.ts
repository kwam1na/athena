/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "../_generated/api";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import schema from "../schema";
import {
  ATHENA_APP_LOGIN_EMAIL_ALLOWLIST,
  checkAppLoginEmailApproval,
  isAthenaAppLoginEmailApproved,
  normalizeAthenaAppLoginEmail,
} from "./appLoginEmailAllowlist";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./otp/"),
    loader,
  ]),
);

describe("appLoginEmailAllowlist", () => {
  it("contains only the approved app-login addresses", () => {
    expect(ATHENA_APP_LOGIN_EMAIL_ALLOWLIST).toEqual([
      "kwamina.0x00@gmail.com",
      "kwami.nuh@gmail.com",
      "pos@wigclub.store",
      "essuahmensahmaud@gmail.com",
      "knownothing955@gmail.com",
    ]);
  });

  it("normalizes approved addresses and rejects all other spellings", () => {
    expect(normalizeAthenaAppLoginEmail(" KWAMI.NUH@GMAIL.COM ")).toBe(
      "kwami.nuh@gmail.com",
    );
    expect(isAthenaAppLoginEmailApproved(" KWAMI.NUH@GMAIL.COM ")).toBe(true);
    expect(isAthenaAppLoginEmailApproved("eessuahmensahmaud@gmail.com")).toBe(
      false,
    );
    expect(isAthenaAppLoginEmailApproved("unapproved@example.com")).toBe(false);
  });

  it("returns a structured server-side approval decision", async () => {
    const t = convexTest(schema, modules);
    assertConformsToExportedReturns(checkAppLoginEmailApproval, {
      approved: true,
    });
    assertConformsToExportedReturns(checkAppLoginEmailApproval, {
      approved: false,
    });

    await expect(
      t.query(api.otp.appLoginEmailAllowlist.checkAppLoginEmailApproval, {
        email: " KWAMI.NUH@GMAIL.COM ",
      }),
    ).resolves.toEqual({ approved: true });
    await expect(
      t.query(api.otp.appLoginEmailAllowlist.checkAppLoginEmailApproval, {
        email: "unapproved@example.com",
      }),
    ).resolves.toEqual({ approved: false });
  });
});
