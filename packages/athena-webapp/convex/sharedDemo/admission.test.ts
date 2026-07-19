import { afterEach, describe, expect, it, vi } from "vitest";

import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import {
  consumeAdmissionBudgetWithCtx,
  consumeSharedDemoTicketWithCtx,
  issueSharedDemoTicket,
  storeSharedDemoTicket,
} from "./admission";
import { SHARED_DEMO_BASELINE_VERSION } from "./config";

afterEach(() => vi.unstubAllEnvs());

const invoke = (definition: unknown, ctx: unknown, args: unknown) =>
  (definition as { _handler: Function })._handler(ctx, args);

function admissionContext(restoreState: Record<string, unknown> | null) {
  const get = vi.fn(async (table: string) => {
    if (table === "athenaUser") return { _id: "demo-user" };
    if (table === "organization") return { _id: "demo-org" };
    if (table === "store") {
      return { _id: "demo-store", organizationId: "demo-org" };
    }
    return null;
  });
  const insert = vi.fn(async (table: string) => {
    if (table === "users") return "auth-user";
    if (table === "sharedDemoPrincipal") return "principal";
    return `${table}-row`;
  });
  const query = vi.fn((table: string) => ({
    withIndex: vi.fn((_name: string, apply: Function) => {
      apply({ eq: vi.fn().mockReturnThis() });
      return {
        unique: vi.fn().mockResolvedValue(
          table === "sharedDemoRestoreState"
            ? restoreState
            : table === "organizationMember"
              ? { role: "full_admin" }
              : null,
        ),
      };
    }),
  }));
  return {
    ctx: {
      db: {
        get,
        insert,
        patch: vi.fn(),
        query,
        replace: vi.fn(),
      },
    } as never,
    get,
    insert,
  };
}

function configureAdmissionEnvironment() {
  vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
  vi.stubEnv("STAGE", "prod");
  vi.stubEnv("ATHENA_SHARED_DEMO_ATHENA_USER_ID", "demo-user");
  vi.stubEnv("ATHENA_SHARED_DEMO_ORGANIZATION_ID", "demo-org");
  vi.stubEnv("ATHENA_SHARED_DEMO_STORE_ID", "demo-store");
}

describe("shared demo admission return contract", () => {
  it("accepts the short-lived opaque ticket result", () => {
    assertConformsToExportedReturns(issueSharedDemoTicket, {
      ticket: "opaque-ticket",
      expiresAt: 20_000,
    });
  });
});

describe("shared demo admission foundation", () => {
  it("rejects an otherwise valid configured tenant before reading tenant rows", async () => {
    configureAdmissionEnvironment();
    const { ctx, get, insert } = admissionContext(null);

    await expect(
      invoke(storeSharedDemoTicket, ctx, {
        athenaUserId: "demo-user",
        expiresAt: 20_000,
        organizationId: "demo-org",
        storeId: "demo-store",
        ticketHash: "hash",
      }),
    ).rejects.toThrow("not a current provisioned foundation");
    expect(get).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("issues admission only for the current ready provisioned foundation", async () => {
    configureAdmissionEnvironment();
    const { ctx, get, insert } = admissionContext({
      baselineVersion: SHARED_DEMO_BASELINE_VERSION,
      completedAt: 19_000,
      status: "ready",
    });

    await expect(
      invoke(storeSharedDemoTicket, ctx, {
        athenaUserId: "demo-user",
        expiresAt: 20_000,
        organizationId: "demo-org",
        storeId: "demo-store",
        ticketHash: "hash",
      }),
    ).resolves.toBeNull();
    expect(get).toHaveBeenCalledTimes(3);
    expect(insert).toHaveBeenCalledWith(
      "sharedDemoAdmissionTicket",
      expect.objectContaining({ ticketHash: "hash" }),
    );
  });
});

function contextWith(ticket: Record<string, unknown> | null) {
  const patch = vi.fn();
  const unique = vi.fn().mockResolvedValue(ticket);
  return {
    ctx: {
      db: {
        get: vi.fn(),
        insert: vi.fn(),
        patch,
        replace: vi.fn(),
        query: vi.fn((table) => ({
          withIndex: vi.fn((_name, apply) => {
            apply({ eq: vi.fn().mockReturnThis() });
            return { unique: table === "sharedDemoAdmissionRateBucket" ? vi.fn().mockResolvedValue(null) : unique };
          }),
        })),
      },
    } as never,
    patch,
  };
}

describe("shared demo ticket consumption", () => {
  it("atomically consumes an active ticket and activates the demo principal", async () => {
    const { ctx, patch } = contextWith({
      _id: "ticket-1",
      authUserId: "user-1",
      consumedAt: undefined,
      expiresAt: 20_000,
      principalId: "principal-1",
    });

    await expect(
      consumeSharedDemoTicketWithCtx(ctx, { now: 10_000, ticketHash: "hash" }),
    ).resolves.toEqual({ authUserId: "user-1" });
    expect(patch).toHaveBeenNthCalledWith(1, "sharedDemoAdmissionTicket", "ticket-1", {
      consumedAt: 10_000,
    });
    expect(patch).toHaveBeenNthCalledWith(2, "sharedDemoPrincipal", "principal-1", {
      admissionExpiresAt: 10_810_000,
      updatedAt: 10_000,
    });
  });

  it.each([
    ["missing", null],
    ["consumed", { consumedAt: 9_000, expiresAt: 20_000 }],
    ["expired", { consumedAt: undefined, expiresAt: 9_999 }],
  ])("rejects a %s ticket without changing state", async (_label, ticket) => {
    const { ctx, patch } = contextWith(ticket);
    await expect(
      consumeSharedDemoTicketWithCtx(ctx, { now: 10_000, ticketHash: "hash" }),
    ).rejects.toThrow("Demo sign-in link is no longer valid");
    expect(patch).not.toHaveBeenCalled();
  });
});

describe("shared demo admission budget", () => {
  it("rejects a request after the transactional window limit", async () => {
    const patch = vi.fn();
    const ctx = {
      db: {
        patch,
        query: vi.fn(() => ({ withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue({ _id: "bucket", count: 2, windowStartedAt: 9_000 }) })) })),
      },
    } as never;
    await expect(consumeAdmissionBudgetWithCtx(ctx, { kind: "mint", limit: 2, now: 10_000 })).rejects.toThrow("demo is busy");
    expect(patch).not.toHaveBeenCalled();
  });
});
