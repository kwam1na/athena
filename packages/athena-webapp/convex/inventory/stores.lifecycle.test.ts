import type { Id } from "../_generated/dataModel";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decommissionServicePrincipalAuthBinding: vi.fn(),
  getAuthenticatedActorWithCtx: vi.fn(),
  getSharedDemoActorWithCtx: vi.fn(),
  reconcileServicePrincipal: vi.fn(),
  recordOperationalEventWithCtx: vi.fn(),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireNonDemoFoundationMutation: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  requireSharedDemoCapabilityIfApplicable: vi.fn(),
  transitionServicePrincipal: vi.fn(),
}));

vi.mock("../lib/authenticatedActor", () => ({
  getAuthenticatedActorWithCtx: mocks.getAuthenticatedActorWithCtx,
}));
vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    mocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));
vi.mock("../sharedDemo/actor", () => ({
  getSharedDemoActorWithCtx: mocks.getSharedDemoActorWithCtx,
  requireSharedDemoCapabilityIfApplicable:
    mocks.requireSharedDemoCapabilityIfApplicable,
}));
vi.mock("../sharedDemo/foundation", () => ({
  requireNonDemoFoundationMutation: mocks.requireNonDemoFoundationMutation,
}));
vi.mock("../servicePrincipals/lifecycle", () => ({
  STORE_SERVICE_PRINCIPAL_STABLE_KEY: "store.service",
  decommissionServicePrincipalAuthBinding:
    mocks.decommissionServicePrincipalAuthBinding,
  reconcileServicePrincipal: mocks.reconcileServicePrincipal,
  transitionServicePrincipal: mocks.transitionServicePrincipal,
}));
vi.mock("../operations/operationalEvents", () => ({
  recordOperationalEventWithCtx: mocks.recordOperationalEventWithCtx,
}));

import {
  createStoreWithLifecycleWithCtx,
  removeStoreWithLifecycleWithCtx,
} from "./stores";
import { STORE_SERVICE_PRINCIPAL_STABLE_KEY } from "../servicePrincipals/lifecycle";

type Row = Record<string, unknown> & { _id: string };

function createCtx(seed: {
  bindings?: Row[];
  principals?: Row[];
  stores?: Row[];
}) {
  const tables = {
    servicePrincipal: new Map(
      (seed.principals ?? []).map((row) => [row._id, row]),
    ),
    servicePrincipalAuthBinding: new Map(
      (seed.bindings ?? []).map((row) => [row._id, row]),
    ),
    store: new Map((seed.stores ?? []).map((row) => [row._id, row])),
  };

  const db = {
    delete: vi.fn(async (table: keyof typeof tables, id: string) => {
      tables[table].delete(id);
    }),
    get: vi.fn(async (table: keyof typeof tables, id: string) => {
      return tables[table].get(id) ?? null;
    }),
    insert: vi.fn(
      async (table: keyof typeof tables, value: Record<string, unknown>) => {
        const id = `${table}-${tables[table].size + 1}`;
        tables[table].set(id, { _id: id, _creationTime: 1, ...value });
        return id;
      },
    ),
    query(table: keyof typeof tables) {
      const filters: Array<[string, unknown]> = [];
      const chain = {
        take: async (limit: number) =>
          Array.from(tables[table].values())
            .filter((row) =>
              filters.every(([field, value]) => row[field] === value),
            )
            .slice(0, limit),
        withIndex(
          _index: string,
          apply: (query: {
            eq: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) {
          const query = {
            eq(field: string, value: unknown) {
              filters.push([field, value]);
              return query;
            },
          };
          apply(query);
          return chain;
        },
      };
      return chain;
    },
  };

  return { ctx: { auth: {}, db }, db, tables };
}

const organizationId = "organization-1" as Id<"organization">;
const athenaUserId = "athena-user-1" as Id<"athenaUser">;

describe("store service-principal lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedActorWithCtx.mockResolvedValue({
      kind: "human",
      athenaUserId,
      authUserId: "auth-user-1",
    });
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue({
      role: "full_admin",
    });
    mocks.reconcileServicePrincipal.mockResolvedValue({
      created: true,
      lifecycleRevision: 1,
      servicePrincipalId: "principal-1",
      status: "active",
    });
    mocks.decommissionServicePrincipalAuthBinding.mockResolvedValue({});
    mocks.transitionServicePrincipal.mockResolvedValue({});
    mocks.recordOperationalEventWithCtx.mockResolvedValue({});
  });

  it("authorizes create before atomically reconciling and auditing the generic principal", async () => {
    const { ctx, db } = createCtx({});

    await expect(
      createStoreWithLifecycleWithCtx(
        ctx as never,
        {
          createdByUserId: athenaUserId,
          currency: "GHS",
          name: "Accra",
          organizationId,
          slug: "accra",
        },
        { now: 100 },
      ),
    ).resolves.toMatchObject({ name: "Accra" });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      {
        allowedRoles: ["full_admin"],
        failureMessage: "A full administrator is required for this store.",
        organizationId,
        userId: athenaUserId,
      },
    );
    expect(mocks.reconcileServicePrincipal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId,
        stableKey: STORE_SERVICE_PRINCIPAL_STABLE_KEY,
      }),
    );
    expect(mocks.recordOperationalEventWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        actorType: "human",
        actorUserId: athenaUserId,
        eventType: "service_principal.reconciled",
        servicePrincipalId: "principal-1",
      }),
    );
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("denies service and shared-demo identities before store creation", async () => {
    const { ctx, db } = createCtx({});
    mocks.getAuthenticatedActorWithCtx.mockResolvedValue({
      kind: "service_principal",
    });

    await expect(
      createStoreWithLifecycleWithCtx(ctx as never, {
        createdByUserId: athenaUserId,
        currency: "GHS",
        name: "Accra",
        organizationId,
        slug: "accra",
      }),
    ).rejects.toThrow("full administrator");
    expect(db.insert).not.toHaveBeenCalled();
    expect(mocks.reconcileServicePrincipal).not.toHaveBeenCalled();
  });

  it("decommissions the stable binding and principal before hard deletion", async () => {
    const storeId = "store-1" as Id<"store">;
    const { ctx, db, tables } = createCtx({
      stores: [
        {
          _id: storeId,
          _creationTime: 1,
          createdByUserId: athenaUserId,
          currency: "GHS",
          name: "Accra",
          organizationId,
          slug: "accra",
        },
      ],
      principals: [
        {
          _id: "principal-1",
          lifecycleRevision: 4,
          organizationId,
          stableKey: STORE_SERVICE_PRINCIPAL_STABLE_KEY,
          status: "active",
          storeId,
        },
      ],
      bindings: [
        {
          _id: "binding-1",
          revision: 2,
          servicePrincipalId: "principal-1",
          status: "active",
        },
      ],
    });

    await expect(
      removeStoreWithLifecycleWithCtx(ctx as never, { id: storeId }, { now: 200 }),
    ).resolves.toEqual({ message: "OK" });

    expect(mocks.decommissionServicePrincipalAuthBinding).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        expectedRevision: 2,
        servicePrincipalAuthBindingId: "binding-1",
      }),
    );
    expect(mocks.transitionServicePrincipal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        expectedRevision: 4,
        nextStatus: "decommissioned",
        servicePrincipalId: "principal-1",
      }),
    );
    expect(mocks.recordOperationalEventWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        eventType: "service_principal.decommissioned",
        servicePrincipalId: "principal-1",
      }),
    );
    expect(tables.store.has(storeId)).toBe(false);
    expect(
      mocks.decommissionServicePrincipalAuthBinding.mock.invocationCallOrder[0],
    ).toBeLessThan(db.delete.mock.invocationCallOrder[0]);
    expect(
      mocks.transitionServicePrincipal.mock.invocationCallOrder[0],
    ).toBeLessThan(db.delete.mock.invocationCallOrder[0]);
  });

  it("keeps the store when decommissioning fails", async () => {
    const storeId = "store-1" as Id<"store">;
    const { ctx, db, tables } = createCtx({
      stores: [
        {
          _id: storeId,
          _creationTime: 1,
          organizationId,
        },
      ],
      principals: [
        {
          _id: "principal-1",
          lifecycleRevision: 1,
          organizationId,
          stableKey: STORE_SERVICE_PRINCIPAL_STABLE_KEY,
          storeId,
        },
      ],
    });
    mocks.transitionServicePrincipal.mockRejectedValue(
      new Error("stale_revision"),
    );

    await expect(
      removeStoreWithLifecycleWithCtx(ctx as never, { id: storeId }),
    ).rejects.toThrow("stale_revision");
    expect(db.delete).not.toHaveBeenCalled();
    expect(tables.store.has(storeId)).toBe(true);
  });
});
