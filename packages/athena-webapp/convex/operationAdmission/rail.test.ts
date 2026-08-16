import { describe, expect, it, vi } from "vitest";

import { createAdmissionRail } from "./rail";
import { defineOperation } from "./domains/_shapes";
import type {
  OperationAdapter,
  OperationDefinition,
  OperationResourceGuards,
} from "./types";

const storeWrite = defineOperation({
  kind: "mutation" as const,
  operationId: "test.rail.storeWrite",
  capability: "daily_operations.write",
  scope: { kind: "store", storeIdArg: "storeId" },
  readiness: { kind: "store_write" },
  effects: { mode: "none" },
  actors: { normalUser: "admit", sharedDemo: "deny", public: "deny" },
});

function admittingAdapter(
  kind: OperationAdapter["kind"] = "normal_user",
): OperationAdapter {
  return {
    kind,
    resolve: vi.fn(async () => ({
      actor: { kind: "normal_user" as const, athenaUserId: "user-1" as never },
      constraints: { storeId: "store-1" as never },
      decision: { adapter: kind, outcome: "admitted" as const },
      provenance: { kind },
    })),
  };
}

function rail(config: Partial<Parameters<typeof createAdmissionRail>[0]> = {}) {
  return createAdmissionRail({
    adapters: [admittingAdapter()],
    readAdapters: [],
    ...config,
  });
}

describe("admission chain fail-closed behaviour", () => {
  it("never re-admits a demo principal denied on a sharedDemo:deny definition", async () => {
    const normalAdapter = admittingAdapter();
    const demoAdapter: OperationAdapter = {
      kind: "shared_demo",
      resolve: vi.fn(async () => ({
        error: new Error("This action isn't allowed in the demo."),
        kind: "denied" as const,
        reason: "actor_denied" as const,
        recognized: true,
      })),
    };
    const wrapped = rail({
      adapters: [demoAdapter, normalAdapter],
    }).admitPublicMutation(storeWrite, vi.fn());

    await expect(
      wrapped({ db: {} } as never, { storeId: "store-1" }),
    ).rejects.toThrow("This action isn't allowed in the demo.");
    expect(normalAdapter.resolve).not.toHaveBeenCalled();
  });

  it("propagates an unexpected adapter throw instead of admitting public", async () => {
    const publicAdapter = admittingAdapter("public");
    const explodingAdapter: OperationAdapter = {
      kind: "normal_user",
      resolve: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    };
    const wrapped = rail({
      adapters: [explodingAdapter, publicAdapter],
    }).admitPublicMutation(storeWrite, vi.fn());

    await expect(
      wrapped({ db: {} } as never, { storeId: "store-1" }),
    ).rejects.toThrow("database unavailable");
    expect(publicAdapter.resolve).not.toHaveBeenCalled();
  });

  it("propagates a scope-resolver throw rather than falling through", async () => {
    const scopeFailing = defineOperation({
      ...storeWrite,
      operationId: "test.rail.scopeThrows",
      scope: {
        kind: "store",
        resolve: () => {
          throw new Error("scope lookup failed");
        },
      },
    }) as OperationDefinition;
    const publicAdapter = admittingAdapter("public");
    const scopeAdapter: OperationAdapter = {
      kind: "normal_user",
      resolve: (_ctx, args, definition) =>
        Promise.resolve(
          (definition.scope as unknown as { resolve: () => never }).resolve(),
        ) as never,
    };

    const wrapped = rail({
      adapters: [scopeAdapter, publicAdapter],
    }).admitPublicMutation(scopeFailing, vi.fn());

    await expect(
      wrapped({ db: {} } as never, { storeId: "store-1" }),
    ).rejects.toThrow("scope lookup failed");
    expect(publicAdapter.resolve).not.toHaveBeenCalled();
  });

  it("denies when every adapter falls through", async () => {
    const wrapped = rail({
      adapters: [
        { kind: "normal_user", resolve: async () => ({ kind: "unauthenticated" }) },
        { kind: "public", resolve: async () => ({ kind: "not_applicable" }) },
      ],
    }).admitPublicMutation(storeWrite, vi.fn());

    await expect(
      wrapped({ db: {} } as never, { storeId: "store-1" }),
    ).rejects.toThrow("Sign in again to continue.");
  });
});

describe("target resource guards", () => {
  const guards = (): OperationResourceGuards => ({
    protectDemoFoundation: vi.fn((target) => {
      if (
        target.storeId === "demo-store" ||
        target.organizationId === "demo-org" ||
        target.athenaUserId === "demo-user"
      ) {
        throw new Error("This action isn't allowed in the demo.");
      }
    }),
    protectDemoFoundationExternalRefs: vi.fn((refs) => {
      if (refs.some((ref: string) => ref.includes("/stores/demo-store/"))) {
        throw new Error("This action isn't allowed in the demo.");
      }
    }),
  });

  function admitFullAdmin(definition: OperationDefinition) {
    return rail({
      adapters: [
        {
          kind: "normal_user",
          resolve: async (_ctx, args) => ({
            actor: {
              kind: "normal_user" as const,
              athenaUserId: "full-admin" as never,
            },
            constraints: { storeId: args.storeId as never },
            decision: {
              adapter: "normal_user" as const,
              outcome: "admitted" as const,
            },
            provenance: {},
          }),
        },
      ],
      resourceGuards: guards(),
    }).admitPublicMutation(definition, vi.fn(async () => "ok"));
  }

  it("denies a scope-bound foundation row for a normal full admin", async () => {
    const wrapped = admitFullAdmin(
      defineOperation({
        ...storeWrite,
        operationId: "test.rail.target.scope",
        target: { protectDemoFoundation: true },
      }) as OperationDefinition,
    );

    await expect(
      wrapped({ db: {} } as never, { storeId: "demo-store" }),
    ).rejects.toThrow("This action isn't allowed in the demo.");
    await expect(
      wrapped({ db: {} } as never, { storeId: "store-1" }),
    ).resolves.toBe("ok");
  });

  it("denies an arg-bound foundation row for a normal full admin", async () => {
    const wrapped = admitFullAdmin(
      defineOperation({
        ...storeWrite,
        operationId: "test.rail.target.arg",
        target: { protectDemoFoundation: { organizationIdArg: "ownerOrgId" } },
      }) as OperationDefinition,
    );

    await expect(
      wrapped({ db: {} } as never, {
        storeId: "store-1",
        ownerOrgId: "demo-org",
      }),
    ).rejects.toThrow("This action isn't allowed in the demo.");
  });

  it("denies a resolver-bound foundation row for a normal full admin", async () => {
    const wrapped = admitFullAdmin(
      defineOperation({
        ...storeWrite,
        operationId: "test.rail.target.resolve",
        target: {
          protectDemoFoundation: {
            resolve: async () => ({ athenaUserId: "demo-user" as never }),
          },
        },
      }) as OperationDefinition,
    );

    await expect(
      wrapped({ db: {} } as never, { storeId: "store-1" }),
    ).rejects.toThrow("This action isn't allowed in the demo.");
  });

  it("denies external refs that point at demo fixture media", async () => {
    const wrapped = admitFullAdmin(
      defineOperation({
        ...storeWrite,
        operationId: "test.rail.target.refs",
        target: { protectDemoFoundationExternalRefs: { arg: "imageUrls" } },
      }) as OperationDefinition,
    );

    await expect(
      wrapped({ db: {} } as never, {
        storeId: "store-1",
        imageUrls: ["https://cdn/stores/demo-store/a.png"],
      }),
    ).rejects.toThrow("This action isn't allowed in the demo.");
  });
});

describe("action admission", () => {
  const emailAction = defineOperation({
    kind: "action" as const,
    operationId: "test.rail.action",
    capability: "customer.messaging.send",
    scope: { kind: "store", storeIdArg: "storeId" },
    readiness: { kind: "store_ready" },
    effects: { mode: "protected", gateways: ["order_notification.send"] },
    actors: { normalUser: "admit", sharedDemo: "admit", public: "deny" },
  });

  it("confines the body to the admitted store rather than the requested one", async () => {
    const runMutation = vi.fn(async () => ({
      actor: { kind: "shared_demo" as const },
      constraints: { storeId: "store-a" },
      decision: { adapter: "shared_demo", outcome: "admitted" },
      operationId: emailAction.operationId,
      provenance: {},
    }));
    const handler = vi.fn(async (ctx) => ctx.operationAdmission.constraints);

    const wrapped = rail({
      entrypoints: {
        admitOperation: "admitOperation" as never,
        admitReadOperation: "admitReadOperation" as never,
      },
    }).admitPublicAction(emailAction as never, handler);

    await expect(
      wrapped({ runMutation } as never, { storeId: "store-b" }),
    ).resolves.toEqual({ storeId: "store-a" });
  });

  it("refuses to admit an action when no entry point is registered", async () => {
    const wrapped = rail().admitPublicAction(emailAction as never, vi.fn());

    await expect(
      wrapped({ runMutation: vi.fn() } as never, { storeId: "store-a" }),
    ).rejects.toThrow("Operation admission entry points are not registered");
  });
});

describe("http ingress", () => {
  const customerWrite = defineOperation({
    kind: "http" as const,
    operationId: "test.rail.http.customerWrite",
    route: { method: "POST", path: "/bags/:bagId/items" },
    capability: "orders.create",
    scope: { kind: "store", storeIdArg: "storeId" },
    readiness: { kind: "none" },
    effects: { mode: "none" },
    ingressVerification: { kind: "origin_allowlist" },
    actors: {
      normalUser: "deny",
      sharedDemo: "deny",
      storefrontCustomer: "admit",
      public: "deny",
    },
  });

  function honoContext(options: {
    body?: string;
    origin?: string | null;
    runMutation?: ReturnType<typeof vi.fn>;
  }) {
    const headers = new Headers();
    if (typeof options.origin === "string") {
      headers.set("Origin", options.origin);
    }
    const request = new Request("https://api.test/bags/bag-1/items", {
      method: "POST",
      headers,
      body: options.body ?? "{}",
    });
    const text = vi.fn(async () => options.body ?? "{}");
    return {
      env: { runMutation: options.runMutation ?? vi.fn(), runQuery: vi.fn() },
      json: vi.fn((payload: unknown, status?: number) => ({
        payload,
        status: status ?? 200,
      })),
      req: {
        param: () => ({ bagId: "bag-1" }),
        query: () => ({}),
        raw: request,
        text,
      },
    };
  }

  const railWithEntrypoints = () =>
    rail({
      entrypoints: {
        admitOperation: "admitOperation" as never,
        admitReadOperation: "admitReadOperation" as never,
      },
      extractIngressClaim: () => ({ storeFrontUserId: "user-1" as never }),
    });

  it("denies an unlisted origin with zero admission rows", async () => {
    vi.stubEnv("ATHENA_STOREFRONT_ALLOWED_ORIGINS", "https://shop.test");
    const runMutation = vi.fn();
    const c = honoContext({ origin: "https://evil.test", runMutation });
    const handler = vi.fn();

    const response = await railWithEntrypoints().admitHttpRoute(
      customerWrite as never,
      handler,
    )(c as never);

    expect(response).toMatchObject({ status: 403 });
    expect(runMutation).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("denies an absent and a null origin", async () => {
    vi.stubEnv("ATHENA_STOREFRONT_ALLOWED_ORIGINS", "https://shop.test");
    const route = railWithEntrypoints().admitHttpRoute(
      customerWrite as never,
      vi.fn(),
    );

    await expect(route(honoContext({}) as never)).resolves.toMatchObject({
      status: 403,
    });
    await expect(
      route(honoContext({ origin: "null" }) as never),
    ).resolves.toMatchObject({ status: 403 });
    vi.unstubAllEnvs();
  });

  it("fails closed when no allowlist is configured", async () => {
    vi.stubEnv("ATHENA_STOREFRONT_ALLOWED_ORIGINS", "");
    await expect(
      railWithEntrypoints().admitHttpRoute(customerWrite as never, vi.fn())(
        honoContext({ origin: "https://shop.test" }) as never,
      ),
    ).resolves.toMatchObject({ status: 403 });
    vi.unstubAllEnvs();
  });

  it("bounds the body, reads it once, and hands the same string to the handler", async () => {
    vi.stubEnv("ATHENA_STOREFRONT_ALLOWED_ORIGINS", "https://shop.test");
    const runMutation = vi.fn(async () => ({
      actor: { kind: "storefront_customer", assurance: "bearer_id" },
      constraints: { storeId: "store-1" },
      decision: { adapter: "storefront_customer", outcome: "admitted" },
      operationId: customerWrite.operationId,
      provenance: {},
    }));
    const c = honoContext({
      body: '{"quantity":2}',
      origin: "https://shop.test",
      runMutation,
    });
    const handler = vi.fn(async (_c, admitted) => admitted.ingress.rawBody);
    const originalRequest = c.req.raw;

    const result = await railWithEntrypoints().admitHttpRoute(
      customerWrite as never,
      handler,
    )(c as never);

    expect(result).toBe('{"quantity":2}');
    // The rail streams the raw body under a size bound rather than calling
    // `c.req.text()`, so the assertion is that the ORIGINAL stream is spent
    // exactly once and the handler still sees the identical bytes a verifier
    // would have signed over.
    expect(originalRequest.bodyUsed).toBe(true);
    expect(c.req.raw).not.toBe(originalRequest);
    expect(await c.req.raw.text()).toBe('{"quantity":2}');
    expect(runMutation).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  /**
   * A refusal must not be reported as a server fault. Before this, a denial
   * thrown inside the admission mutation escaped the Hono handler and Convex
   * rendered it as 500 — so clients retried, monitoring paged, and the body
   * carried the internal error text.
   */
  describe("admission denial status", () => {
    const denialContext = (data: unknown) => {
      const error = Object.assign(new Error("denied"), { data });
      return honoContext({
        origin: "https://shop.test",
        runMutation: vi.fn(async () => {
          throw error;
        }),
      });
    };

    it("maps an unauthenticated admission to 401", async () => {
      vi.stubEnv("ATHENA_STOREFRONT_ALLOWED_ORIGINS", "https://shop.test");
      const handler = vi.fn();
      const c = denialContext({
        kind: "operation_admission_denied",
        message: "Sign in again to continue.",
        outcome: "unauthenticated",
      });

      const result = await railWithEntrypoints().admitHttpRoute(
        customerWrite as never,
        handler,
      )(c as never);

      expect(result).toMatchObject({ status: 401 });
      expect(handler).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it("maps a refused admission to 403 with a body that reveals nothing", async () => {
      vi.stubEnv("ATHENA_STOREFRONT_ALLOWED_ORIGINS", "https://shop.test");
      const handler = vi.fn();
      const c = denialContext({
        kind: "operation_admission_denied",
        message: "wrong store: store-9",
        outcome: "denied",
        reason: "scope_denied",
      });

      const result = await railWithEntrypoints().admitHttpRoute(
        customerWrite as never,
        handler,
      )(c as never);

      expect(result).toMatchObject({
        status: 403,
        payload: { error: "Request rejected." },
      });
      // The denial reason never reaches the caller: probing the difference
      // between "wrong store" and "no such row" is what the fixed body prevents.
      expect(JSON.stringify(result)).not.toContain("store-9");
      vi.unstubAllEnvs();
    });

    it("lets a genuine fault propagate instead of disguising it as a denial", async () => {
      vi.stubEnv("ATHENA_STOREFRONT_ALLOWED_ORIGINS", "https://shop.test");
      const handler = vi.fn();
      const c = honoContext({
        origin: "https://shop.test",
        runMutation: vi.fn(async () => {
          throw new TypeError("index missing");
        }),
      });

      await expect(
        railWithEntrypoints().admitHttpRoute(
          customerWrite as never,
          handler,
        )(c as never),
      ).rejects.toThrow("index missing");
      expect(handler).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    });
  });

  it("rejects an oversize body with 413 before any admission row", async () => {
    vi.stubEnv("ATHENA_STOREFRONT_ALLOWED_ORIGINS", "https://shop.test");
    const runMutation = vi.fn();
    const c = honoContext({
      body: "x".repeat(2_048),
      origin: "https://shop.test",
      runMutation,
    });
    const handler = vi.fn();

    const result = await rail({
      entrypoints: {
        admitOperation: "admitOperation" as never,
        admitReadOperation: "admitReadOperation" as never,
      },
      extractIngressClaim: () => ({ storeFrontUserId: "user-1" as never }),
      maxIngressBodyBytes: 1_024,
    }).admitHttpRoute(customerWrite as never, handler)(c as never);

    expect(result).toMatchObject({ status: 413 });
    // Bounded BEFORE admission: an oversize request leaves no admission row
    // and never reaches the handler.
    expect(runMutation).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("denies a bad-signature webhook with zero admission rows", async () => {
    const webhook = defineOperation({
      kind: "http" as const,
      operationId: "test.rail.http.webhook",
      capability: "billing.manage",
      scope: { kind: "none" },
      readiness: { kind: "none" },
      effects: { mode: "none" },
      ingressVerification: { kind: "signature", verifier: "paystack" },
      actors: {
        normalUser: "deny",
        sharedDemo: "deny",
        storefrontCustomer: "deny",
        public: "admit",
      },
    });
    const runMutation = vi.fn();
    const c = honoContext({ body: "{}", runMutation });

    const response = await rail({
      entrypoints: {
        admitOperation: "admitOperation" as never,
        admitReadOperation: "admitReadOperation" as never,
      },
      ingressVerifiers: { paystack: () => false },
    }).admitHttpRoute(webhook as never, vi.fn())(c as never);

    expect(response).toMatchObject({ status: 403 });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("denies a webhook whose declared verifier is not registered", async () => {
    const webhook = defineOperation({
      kind: "http" as const,
      operationId: "test.rail.http.unknownVerifier",
      capability: "billing.manage",
      scope: { kind: "none" },
      readiness: { kind: "none" },
      effects: { mode: "none" },
      ingressVerification: { kind: "signature", verifier: "not-registered" },
      actors: {
        normalUser: "deny",
        sharedDemo: "deny",
        storefrontCustomer: "deny",
        public: "admit",
      },
    });

    await expect(
      rail({
        entrypoints: {
          admitOperation: "admitOperation" as never,
          admitReadOperation: "admitReadOperation" as never,
        },
      }).admitHttpRoute(webhook as never, vi.fn())(honoContext({}) as never),
    ).resolves.toMatchObject({ status: 403 });
  });
});
