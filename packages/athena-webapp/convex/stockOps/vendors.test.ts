import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";

const mockedAuthServer = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: mockedAuthServer.getAuthUserId,
}));

import {
  createVendor,
  createVendorWithCtx,
  createVendorCommand,
  listVendors,
  mapCreateVendorError,
  normalizeVendorLookupKey,
} from "./vendors";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function getHandler(fn: unknown) {
  return (fn as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })
    ._handler;
}

function createVendorMutationCtx() {
  mockedAuthServer.getAuthUserId.mockResolvedValue(null);

  const insert = vi.fn();
  const ctx = {
    db: {
      get: vi.fn(),
      insert,
      query: vi.fn(),
    },
  } as unknown as MutationCtx;

  return { ctx, insert };
}

describe("stock ops vendors", () => {
  it("normalizes vendor names into a stable store-scoped lookup key", () => {
    expect(normalizeVendorLookupKey("  Crown  & Glory Wigs  ")).toBe(
      "crown-glory-wigs",
    );
  });

  it("guards duplicate vendors with the store lookup index", () => {
    const source = getSource("./vendors.ts");

    expect(source).toContain("export const createVendor = mutation({");
    expect(source).toContain(
      "handler: admitPublicMutation(\n    createVendorOperationDefinition,\n    createVendorWithCtx,\n  ),",
    );
    expect(source).toContain('.withIndex("by_storeId_lookupKey"');
    expect(source).toContain(
      'throw new Error("A vendor with this name already exists for this store.");',
    );
  });

  it("requires full-admin access before vendor creation writes", async () => {
    const { ctx, insert } = createVendorMutationCtx();

    await expect(
      createVendorWithCtx(ctx, {
        name: "Main Vendor",
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow("Authentication required.");
    expect(insert).not.toHaveBeenCalled();
  });

  // Admission rail: the retired handler-local demo gate is now expressed by
  // the definition (`procurement.manage`, store scope, `sharedDemo: "deny"`),
  // so the exported ingress denies an anonymous caller before the handler
  // body — and before any vendor row is inserted.
  it("denies unauthenticated vendor ingress before any write", async () => {
    const { ctx, insert } = createVendorMutationCtx();

    await expect(
      getHandler(createVendor)(ctx, {
        name: "Main Vendor",
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow("Sign in again to continue.");

    await expect(
      getHandler(createVendorCommand)(ctx, {
        name: "Main Vendor",
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow("Sign in again to continue.");

    await expect(
      getHandler(listVendors)(ctx, {
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow("Sign in again to continue.");

    expect(insert).not.toHaveBeenCalled();
  });

  it("maps expected vendor creation failures to command-result user errors", () => {
    expect(mapCreateVendorError(new Error("Store not found."))).toEqual({
      kind: "user_error",
      error: {
        code: "not_found",
        message: "Store not found.",
      },
    });

    expect(mapCreateVendorError(new Error("Vendor name is required."))).toEqual(
      {
        kind: "user_error",
        error: {
          code: "validation_failed",
          message: "Vendor name is required.",
        },
      },
    );

    expect(
      mapCreateVendorError(
        new Error("A vendor with this name already exists for this store."),
      ),
    ).toEqual({
      kind: "user_error",
      error: {
        code: "conflict",
        message: "A vendor with this name already exists for this store.",
      },
    });
  });

  it("exposes vendor creation through a command-result wrapper", () => {
    const source = getSource("./vendors.ts");

    expect(source).toContain("export const createVendor = mutation({");
    expect(source).toContain("export const createVendorCommand = mutation({");
    expect(source).toContain("returns: commandResultValidator(v.any()),");
    expect(source).toContain(
      "handler: admitPublicMutation(\n    createVendorCommandOperationDefinition,",
    );
    expect(source).toContain("createVendorCommandWithCtx(ctx, args)");
    expect(source).toContain(
      "return ok(await createVendorWithCtx(ctx, args));",
    );
    expect(source).toContain(
      "handler: admitPublicQuery(\n    listVendorsReadDefinition,",
    );
    // The handler-local shared-demo gate is retired: the definition's
    // `procurement.manage` capability + store scope + `sharedDemo: "deny"`
    // expresses the same rule at the admission boundary.
    expect(source).not.toContain(
      "requireReadySharedDemoStoreCapabilityIfApplicable",
    );
    assertConformsToExportedReturns(createVendorCommand, {
      kind: "user_error",
      error: {
        code: "conflict",
        message: "A vendor with this name already exists for this store.",
      },
    });
  });
});
