/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";

const sharedDemoMocks = vi.hoisted(() => ({
  getSharedDemoActorWithCtx: vi.fn(),
}));

vi.mock("../sharedDemo/actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sharedDemo/actor")>()),
  getSharedDemoActorWithCtx: sharedDemoMocks.getSharedDemoActorWithCtx,
}));

const athenaUserMocks = vi.hoisted(() => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
}));

vi.mock("../lib/athenaUserAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/athenaUserAuth")>()),
  requireAuthenticatedAthenaUserWithCtx:
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx,
}));

import { AthenaUnauthenticatedError } from "../lib/athenaUnauthenticated";
import { admitOperationWithCtx } from "../platform/operationAdmission";
import * as intelligenceActions from "../intelligence/capabilities/actions";
import * as llmStoreInsights from "./storeInsights";
import * as llmUserInsights from "./userInsights";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./llm/"),
    loader,
  ]),
);

/**
 * Every generation entry point, public shim included. A denial has to land in
 * this admission hop, before the prompt is built and before the provider is
 * called at all.
 */
const GENERATION_OPERATIONS = [
  "intelligence/capabilities/actions.generateStoreInsights",
  "intelligence/capabilities/actions.generateUserInsights",
  "llm/storeInsights.getStoreInsightsFromLlm",
  "llm/userInsights.getUserInsightsFromLlm",
  "llm/userInsights.getStoreInsightsFromLlm",
] as const;

type Fixture = {
  athenaUserId: Id<"athenaUser">;
  organizationId: Id<"organization">;
  otherStoreId: Id<"store">;
  storeId: Id<"store">;
};

async function seedFixture(ctx: MutationCtx): Promise<Fixture> {
  const athenaUserId = await ctx.db.insert("athenaUser", {
    email: "operator@example.com",
    normalizedEmail: "operator@example.com",
  });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: athenaUserId,
    name: "Org",
    slug: "org",
  });
  const storeId = await ctx.db.insert("store", {
    createdByUserId: athenaUserId,
    currency: "ghs",
    name: "Store",
    organizationId,
    slug: "store",
  });
  const otherStoreId = await ctx.db.insert("store", {
    createdByUserId: athenaUserId,
    currency: "ghs",
    name: "Other Store",
    organizationId,
    slug: "other-store",
  });
  return { athenaUserId, organizationId, otherStoreId, storeId };
}

function admit(
  t: ReturnType<typeof convexTest>,
  operationId: string,
  operationArgs: Record<string, unknown>,
) {
  return t.run((ctx) =>
    admitOperationWithCtx(ctx, { operationArgs, operationId }),
  );
}

describe("insight generation admission", () => {
  beforeEach(() => {
    sharedDemoMocks.getSharedDemoActorWithCtx.mockReset();
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockReset();
  });

  it("admits an authenticated operator and clamps to the named store", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: fixture.athenaUserId,
    });

    for (const operationId of GENERATION_OPERATIONS) {
      const admission = await admit(t, operationId, {
        storeId: fixture.storeId,
      });
      expect(admission.actor.kind, operationId).toBe("normal_user");
      expect(admission.constraints.storeId, operationId).toBe(fixture.storeId);
      expect(admission.constraints.storeId, operationId).not.toBe(
        fixture.otherStoreId,
      );
    }
  });

  it("denies an anonymous caller before any provider call", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    athenaUserMocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new AthenaUnauthenticatedError("Sign in again to continue."),
    );

    for (const operationId of GENERATION_OPERATIONS) {
      await expect(
        admit(t, operationId, { storeId: fixture.storeId }),
        operationId,
      ).rejects.toThrow();
    }
  });

  it("denies a demo principal before any provider call", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: fixture.athenaUserId,
      authUserId: "users_demo_1",
      kind: "shared_demo",
      organizationId: fixture.organizationId,
      storeId: fixture.storeId,
    });

    for (const operationId of GENERATION_OPERATIONS) {
      await expect(
        admit(t, operationId, { storeId: fixture.storeId }),
        operationId,
      ).rejects.toThrow();
    }
  });
});

describe("insight generation internal siblings", () => {
  it("exposes an internal sibling for every backend caller of a generation action", () => {
    // The shims used to re-enter through `api.*`, which runs a SECOND
    // admission with the backend's own context. Both siblings must exist for
    // those call sites to be expressible as `internal.*`.
    expect(intelligenceActions).toHaveProperty("internalGenerateStoreInsights");
    expect(intelligenceActions).toHaveProperty("internalGenerateUserInsights");
    expect(intelligenceActions).toHaveProperty("generateStoreInsights");
    expect(intelligenceActions).toHaveProperty("generateUserInsights");
  });

  it("keeps the public shim exports the webapp still calls", () => {
    expect(llmStoreInsights).toHaveProperty("getStoreInsightsFromLlm");
    expect(llmUserInsights).toHaveProperty("getUserInsightsFromLlm");
    expect(llmUserInsights).toHaveProperty("getStoreInsightsFromLlm");
  });
});
