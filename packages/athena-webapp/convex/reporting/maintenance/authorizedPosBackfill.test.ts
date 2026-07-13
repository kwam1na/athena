import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertAuthorizedPosBackfillLineage,
  storeTimezoneAuthorizationContentHash,
  normalizeBackfillRequestNonce,
  type AuthorizedPosBackfillLineage,
} from "./authorizedPosBackfill";

const lineage: AuthorizedPosBackfillLineage = {
  grantId: "grant-1",
  grant: {
    _id: "grant-1",
    athenaUserId: "user-1",
    contractVersion: 2,
    envelopeHash: "reporting-backfill-authorization-v1:abc",
    identitySubject: "issuer|subject",
    membershipId: "membership-1",
    migrationPurpose: "reports_financial_truth_reset_backfill",
    organizationId: "org-1",
    requestNonce: "migration-2026-07-12",
    roleSnapshot: "full_admin",
    runId: "run-1",
    sourceScope: "pos",
    status: "authorized",
    storeId: "store-1",
    timezoneContentHash: "timezone-hash-1",
  },
  run: {
    _id: "run-1",
    actorKind: "human",
    actorUserId: "user-1",
    backfillAuthorizationGrantId: "grant-1",
    censusToken:
      "reporting-pos-census-v1:reporting-backfill-authorization-v1:abc",
    domain: "reporting",
    factContractVersion: 2,
    financialDateContractVersion: 2,
    operation: "financial_truth_reset_backfill",
    organizationId: "org-1",
    projectionContractVersion: 2,
    requestKey: "reporting-backfill-authorization-v1:abc",
    runType: "backfill",
    sourceScope: "pos",
    status: "pending",
    storeId: "store-1",
  },
};

describe("authorized POS reporting backfill", () => {
  it("normalizes a bounded idempotency nonce", () => {
    expect(normalizeBackfillRequestNonce("  migration-1  ")).toBe(
      "migration-1",
    );
    expect(() => normalizeBackfillRequestNonce(" ")).toThrow(
      "request nonce is required",
    );
    expect(() => normalizeBackfillRequestNonce("x".repeat(129))).toThrow(
      "request nonce is too long",
    );
  });

  it("hashes immutable timezone evidence with its store scope", () => {
    const input = {
      effectiveFrom: 0,
      evidenceHash: "schedule-evidence-1",
      organizationId: "org-1",
      storeId: "store-1",
      timezone: "Africa/Accra",
    };
    expect(storeTimezoneAuthorizationContentHash(input)).toBe(
      storeTimezoneAuthorizationContentHash({ ...input }),
    );
    expect(storeTimezoneAuthorizationContentHash(input)).not.toBe(
      storeTimezoneAuthorizationContentHash({ ...input, storeId: "store-2" }),
    );
  });

  it("accepts one human full-admin grant bound to exactly one POS-only run", () => {
    expect(() =>
      assertAuthorizedPosBackfillLineage({
        ...lineage,
        grantId: "grant-1",
      }),
    ).not.toThrow();
  });

  it("fails closed when immutable grant or run scope drifts", () => {
    expect(() =>
      assertAuthorizedPosBackfillLineage({
        ...lineage,
        grantId: "grant-1",
        run: { ...lineage.run, sourceScope: "inventory" },
      }),
    ).toThrow("sourceScope");
    expect(() =>
      assertAuthorizedPosBackfillLineage({
        ...lineage,
        grant: { ...lineage.grant, runId: "run-2" },
        grantId: "grant-1",
      }),
    ).toThrow("runId");
    expect(() =>
      assertAuthorizedPosBackfillLineage({
        ...lineage,
        grant: { ...lineage.grant, identitySubject: "other-identity" },
        grantId: "grant-1",
        expectedIdentitySubject: "issuer|subject",
      }),
    ).toThrow("identitySubject");
  });

  it("derives authority server-side and schedules a private phase", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "convex",
        "reporting",
        "maintenance",
        "authorizedPosBackfill.ts",
      ),
      "utf8",
    );
    expect(source).toContain(
      "export const authorizePosReportingBackfill = mutation",
    );
    expect(source).toContain("requireReportingStoreAccess(ctx, args.storeId)");
    expect(source).toContain("ctx.auth.getUserIdentity()");
    expect(source).toContain("identity.tokenIdentifier");
    expect(source).toContain("assertStoreTimezoneVersionCanBeInserted");
    expect(source).toContain('ctx.db.insert("storeTimezoneVersion"');
    expect(source).toContain("athenaUserId: access.athenaUser._id");
    expect(source).toContain("authorizedByUserId: args.athenaUserId");
    expect(source).toContain('roleSnapshot: "full_admin"');
    expect(source).toContain('sourceScope: "pos"');
    expect(source).toContain("ctx.scheduler.runAfter");
    expect(source).toContain(
      "export const beginAuthorizedPosReportingBackfill = internalMutation",
    );
    expect(source).toContain(
      "assertExternallyPurgedDevelopmentReportingStateWithCtx",
    );
    expect(source).toContain(
      '.filter((q) => q.neq(q.field("runId"), allowedRunId))',
    );
    expect(source).toContain('cursor: "purge:verified"');
    expect(source).toContain("posCensusBackfill");
    expect(source).toContain('query("reportingSkuAttributionCursor")');
    expect(source).toContain(
      'query("reportingSkuAttributionAppliedSequence")',
    );
    expect(source).not.toContain("resetStoreReporting");
    expect(source).not.toMatch(/actorUserId:\s*args\./);
    expect(source).not.toMatch(/identitySubject:\s*args\./);
    expect(source).not.toContain("secondAdmin");
  });

  it("ships a development-only external purge command that cannot target prod", () => {
    const script = readFileSync(
      join(process.cwd(), "scripts", "purge-reporting-dev.sh"),
      "utf8",
    );
    expect(script).toContain("dev|local");
    expect(script).toContain("Refusing reporting purge");
    expect(script).toContain("convex import");
    expect(script).toContain("--replace");
    expect(script).toContain("reportingSkuAttributionCursor");
    expect(script).toContain("reportingSkuAttributionAppliedSequence");
    expect(script).not.toContain("--prod");
    expect(script).not.toContain("--replace-all");
  });
});
