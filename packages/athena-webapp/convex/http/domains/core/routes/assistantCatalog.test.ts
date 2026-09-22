/// <reference types="vite/client" />

/**
 * The assistant catalogue endpoint, end to end through the exported Hono
 * router and the REAL admission entry points.
 *
 * Three things are being held in place here:
 *
 * 1. Who gets in. The store comes from the token row, a `?storeId=` naming
 *    another store is refused, a withdrawn credential answers the wire
 *    protocol's rejection body byte for byte, and no other caller is admitted.
 * 2. What the question may do. Every bound is applied in the route, the text
 *    never reaches `operationArgs`, a URL or a log line, and a question that
 *    cannot be read is answered, not reported.
 * 3. What the credential records. `lastUsedAt` is stamped at most once a
 *    quarter hour, with the token id and nothing else, and a failed stamp
 *    never costs the shopper an answer.
 */

import { getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { internal } from "../../../../_generated/api";
import {
  admitOperationWithCtx,
  admitReadOperationWithCtx,
} from "../../../../platform/operationAdmission";
import { hashCatalogAccessTokenValue } from "../../../../inventory/catalogAccess";
import { CATALOG_READER_REJECTION_BODY } from "../../../../operationAdmission/types";
import { assistantCatalogSearchRouteReadDefinition } from "../../../../operationAdmission/domains/httpCore_readDefinitions";
import {
  assistantCatalogRoutes,
  resolveAssistantQueryHeader,
  resolveAssistantSearchLimit,
  shouldStampCatalogAccessToken,
} from "./assistantCatalog";

const ADMIT_WRITE = getFunctionName(
  internal.platform.admissionEntrypoints.admitOperation,
);
const ADMIT_READ = getFunctionName(
  internal.platform.admissionEntrypoints.admitReadOperation,
);
const SEARCH = getFunctionName(internal.storeFront.assistantCatalog.search);
const TOUCH = getFunctionName(internal.inventory.catalogAccess.touch);

const STORE_A = "store-A";
const STORE_B = "store-B";
const ACTIVE_TOKEN = `athcat_${"A".repeat(43)}`;
const REVOKED_TOKEN = `athcat_${"B".repeat(43)}`;
const UNKNOWN_TOKEN = `athcat_${"C".repeat(43)}`;

const BODY = {
  contractVersion: "assistant_catalog.v1",
  exhaustive: true,
  fetchedAt: "2026-09-22T10:00:00.000Z",
  hasMore: false,
  matches: [],
  source: { currency: "GHS", name: "Wig Club" },
};

type TokenRow = {
  _id: string;
  lastUsedAt?: number;
  status: "active" | "revoked";
  storeId: string;
  tokenHash: string;
};

async function tokenRows(): Promise<TokenRow[]> {
  return [
    {
      _id: "token-active",
      status: "active",
      storeId: STORE_A,
      tokenHash: await hashCatalogAccessTokenValue(ACTIVE_TOKEN),
    },
    {
      _id: "token-revoked",
      status: "revoked",
      storeId: STORE_A,
      tokenHash: await hashCatalogAccessTokenValue(REVOKED_TOKEN),
    },
  ];
}

/**
 * The smallest database the adapter chain actually touches: one index read on
 * `catalogAccessToken.by_tokenHash`, plus document reads for the other actors'
 * adapters.
 */
function fakeDb(rows: TokenRow[]) {
  return {
    get: async () => null,
    normalizeId: (_table: string, id: string) => id,
    query: (table: string) => ({
      withIndex: (_index: string, build: (q: unknown) => unknown) => {
        const filters: Record<string, unknown> = {};
        const q = {
          eq: (field: string, value: unknown) => {
            filters[field] = value;
            return q;
          },
        };
        build(q);
        const matching =
          table === "catalogAccessToken"
            ? rows.filter((row) =>
                Object.entries(filters).every(
                  ([field, value]) =>
                    (row as unknown as Record<string, unknown>)[field] ===
                    value,
                ),
              )
            : [];
        return {
          collect: async () => matching,
          take: async (count: number) => matching.slice(0, count),
          unique: async () => matching[0] ?? null,
        };
      },
    }),
  };
}

type HarnessOptions = {
  searchResult?: unknown;
  touch?: () => Promise<unknown>;
};

function harness(rows: TokenRow[], options: HarnessOptions = {}) {
  const ctx = {
    auth: { getUserIdentity: async () => null },
    db: fakeDb(rows),
  } as never;

  const calls: { args: unknown; name: string }[] = [];
  let admissionWrites = 0;

  const dispatch = async (ref: never, args: never) => {
    const name = getFunctionName(ref);
    if (name === ADMIT_WRITE) {
      admissionWrites += 1;
      return await admitOperationWithCtx(ctx, args);
    }
    if (name === ADMIT_READ) {
      return await admitReadOperationWithCtx(ctx, args);
    }
    calls.push({ args, name });
    if (name === SEARCH) return options.searchResult ?? BODY;
    if (name === TOUCH) return options.touch ? await options.touch() : null;
    return null;
  };

  return {
    admissionWrites: () => admissionWrites,
    calls,
    called: (name: string) => calls.find((call) => call.name === name),
    env: { runAction: dispatch, runMutation: dispatch, runQuery: dispatch },
  };
}

function request(
  path: string,
  options: { cookie?: string; headers?: Record<string, string> } = {},
) {
  const headers = new Headers(options.headers ?? {});
  if (options.cookie) headers.set("Cookie", options.cookie);
  return new Request(`https://api.test${path}`, { headers, method: "GET" });
}

const call = async (
  path: string,
  options: {
    cookie?: string;
    headers?: Record<string, string>;
    harnessOptions?: HarnessOptions;
  } = {},
) => {
  const test = harness(await tokenRows(), options.harnessOptions ?? {});
  const response = await assistantCatalogRoutes.fetch(
    request(path, { cookie: options.cookie, headers: options.headers }),
    test.env as never,
  );
  return { response, test };
};

const withToken = (token: string, extra: Record<string, string> = {}) => ({
  "X-Assistant-Token": token,
  ...extra,
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------ 1. authorization */

describe("assistant catalogue authorization", () => {
  it("declares the one definition that admits a catalogue reader and denies everyone else", () => {
    expect(assistantCatalogSearchRouteReadDefinition.actors).toEqual({
      normalUser: "deny",
      sharedDemo: "deny",
      storefrontCustomer: "deny",
      catalogReader: "admit",
      public: "deny",
    });
    expect(assistantCatalogSearchRouteReadDefinition.operationId).toBe(
      "http.core.assistantCatalog.search",
    );
    expect(assistantCatalogSearchRouteReadDefinition.access).toEqual({
      kind: "read",
      intent: "storefront.catalog.view",
    });
    expect(assistantCatalogSearchRouteReadDefinition.scope).toEqual({
      kind: "store",
      storeIdArg: "storeId",
    });
  });

  it("answers a live token with the response, the pinned cache header and the token's store", async () => {
    const { response, test } = await call("/search", {
      headers: withToken(ACTIVE_TOKEN, { "X-Assistant-Query": "bob%20wig" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
    await expect(response.json()).resolves.toEqual(BODY);
    expect(test.called(SEARCH)?.args).toEqual({
      limit: 5,
      q: "bob wig",
      storeId: STORE_A,
    });
    // A read admits through the query entry point; nothing was recorded.
    expect(test.admissionWrites()).toBe(0);
  });

  it("admits the token, not the cookies, when a browser session travels with it", async () => {
    const { response, test } = await call("/search", {
      cookie: "user_id=user-1; store_id=store-B; guest_id=guest-1",
      headers: withToken(ACTIVE_TOKEN),
    });

    expect(response.status).toBe(200);
    // The store is the TOKEN's store, not the `store_id` cookie's.
    expect(test.called(SEARCH)?.args).toMatchObject({ storeId: STORE_A });
  });

  it("answers a storeId argument naming the token's own store", async () => {
    const { response } = await call(`/search?storeId=${STORE_A}`, {
      headers: withToken(ACTIVE_TOKEN),
    });

    expect(response.status).toBe(200);
  });

  it("refuses a storeId argument naming another store", async () => {
    const { response, test } = await call(`/search?storeId=${STORE_B}`, {
      headers: withToken(ACTIVE_TOKEN),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual(
      CATALOG_READER_REJECTION_BODY,
    );
    expect(test.called(SEARCH)).toBeUndefined();
  });

  it("answers a revoked and an unknown token with the same rejection body, byte for byte", async () => {
    for (const token of [REVOKED_TOKEN, UNKNOWN_TOKEN]) {
      const { response, test } = await call("/search", {
        headers: withToken(token),
      });

      expect(response.status).toBe(403);
      await expect(response.text()).resolves.toBe(
        '{"code":"reference_token_rejected"}',
      );
      expect(test.called(SEARCH)).toBeUndefined();
      expect(test.admissionWrites()).toBe(0);
    }
  });

  it("answers 401 to a caller presenting no credential of this kind", async () => {
    const cases: Record<string, string>[] = [
      {},
      { "X-Assistant-Token": "not-a-catalogue-token" },
      { "X-Assistant-Query": "bob wig" },
    ];
    for (const headers of cases) {
      const { response, test } = await call("/search", { headers });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "Authentication required.",
      });
      expect(test.called(SEARCH)).toBeUndefined();
    }
  });

  it("answers 401 to a signed-in shopper and to an anonymous browser", async () => {
    const { response } = await call("/search", {
      cookie: "user_id=user-1; store_id=store-A; guest_id=guest-1",
    });

    expect(response.status).toBe(401);
  });
});

/* ------------------------------------------------------------ 2. bounds */

describe("assistant query bounds", () => {
  it("treats an absent and an empty header as the same empty probe", () => {
    expect(resolveAssistantQueryHeader(undefined)).toEqual({
      kind: "query",
      q: "",
    });
    expect(resolveAssistantQueryHeader("")).toEqual({ kind: "query", q: "" });
  });

  it("decodes percent-encoded UTF-8", () => {
    expect(resolveAssistantQueryHeader("bob%20wig%20%C3%A9")).toEqual({
      kind: "query",
      q: "bob wig é",
    });
  });

  it("reads nothing out of a malformed or oversize header", () => {
    expect(resolveAssistantQueryHeader("%E0%A4%A")).toEqual({
      kind: "unreadable",
    });
    expect(resolveAssistantQueryHeader("%")).toEqual({ kind: "unreadable" });
    expect(resolveAssistantQueryHeader("a".repeat(2_401))).toEqual({
      kind: "unreadable",
    });
    expect(resolveAssistantQueryHeader("a".repeat(2_400))).toEqual({
      kind: "query",
      q: "a".repeat(200),
    });
  });

  it("collapses control characters and truncates by codepoint", () => {
    expect(resolveAssistantQueryHeader("bob%00%09wig%1b")).toEqual({
      kind: "query",
      q: "bob  wig",
    });
    const truncated = resolveAssistantQueryHeader(
      encodeURIComponent("\u00e9".repeat(300)),
    );
    expect(truncated).toEqual({ kind: "query", q: "\u00e9".repeat(200) });
    // Codepoints, not UTF-16 units: 200 emoji are 400 units and still fit.
    const astral = resolveAssistantQueryHeader(
      encodeURIComponent("\u{1F600}".repeat(200)),
    );
    expect(astral).toEqual({ kind: "query", q: "\u{1F600}".repeat(200) });
    expect(astral.kind === "query" && astral.q.length).toBe(400);
  });

  it("drops a lone surrogate rather than passing half a character on", () => {
    // Percent-encoded, a lone surrogate is not valid UTF-8 and the decoder
    // refuses it outright.
    expect(resolveAssistantQueryHeader("wig%ED%A0%80")).toEqual({
      kind: "unreadable",
    });
    // Sent raw it decodes to itself, and the slice must not pass half a
    // character on to a text index.
    const outcome = resolveAssistantQueryHeader("wig\ud800");
    expect(outcome.kind).toBe("query");
    expect(outcome.kind === "query" && /[\uD800-\uDFFF]/.test(outcome.q)).toBe(
      false,
    );
  });

  it("defaults and clamps the limit", () => {
    expect(resolveAssistantSearchLimit(undefined)).toBe(5);
    expect(resolveAssistantSearchLimit("")).toBe(5);
    expect(resolveAssistantSearchLimit("abc")).toBe(5);
    expect(resolveAssistantSearchLimit("0")).toBe(1);
    expect(resolveAssistantSearchLimit("-4")).toBe(1);
    expect(resolveAssistantSearchLimit("3")).toBe(3);
    expect(resolveAssistantSearchLimit("999")).toBe(10);
    expect(resolveAssistantSearchLimit("3.7")).toBe(3);
  });

  it("answers an unreadable header with an empty search, not an error", async () => {
    const { response, test } = await call("/search?limit=abc", {
      headers: withToken(ACTIVE_TOKEN, { "X-Assistant-Query": "%E0%A4%A" }),
    });

    expect(response.status).toBe(200);
    expect(test.called(SEARCH)?.args).toEqual({
      limit: 5,
      q: "",
      storeId: STORE_A,
    });
  });
});

/* ------------------------------------------------ 3. the text stays put */

describe("the question never leaves the header", () => {
  const SECRET_QUESTION = "do you have a burgundy bob wig in stock";

  it("keeps the text out of operationArgs, out of the URL and out of the logs", async () => {
    const logged: string[] = [];
    for (const level of ["debug", "error", "info", "log", "warn"] as const) {
      vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => {
        logged.push(parts.map((part) => String(part)).join(" "));
      });
    }

    const test = harness(await tokenRows());
    const url = `https://api.test/search?limit=5`;
    const response = await assistantCatalogRoutes.fetch(
      new Request(url, {
        headers: new Headers(
          withToken(ACTIVE_TOKEN, {
            "X-Assistant-Query": encodeURIComponent(SECRET_QUESTION),
          }),
        ),
        method: "GET",
      }),
      test.env as never,
    );

    expect(response.status).toBe(200);
    expect(url).not.toContain("burgundy");

    const admissionArgs = test.calls
      .filter((entry) => entry.name !== SEARCH)
      .map((entry) => JSON.stringify(entry.args));
    for (const serialized of admissionArgs) {
      expect(serialized).not.toContain("burgundy");
    }
    for (const line of logged) {
      expect(line).not.toContain("burgundy");
    }

    // The one place it does travel is the internal query's `q`.
    expect(test.called(SEARCH)?.args).toMatchObject({ q: SECRET_QUESTION });
  });

  it("never puts the query text in the arguments the admission rail records", async () => {
    const recorded: unknown[] = [];
    const rows = await tokenRows();
    const ctx = {
      auth: { getUserIdentity: async () => null },
      db: fakeDb(rows),
    } as never;

    const dispatch = async (ref: never, args: never) => {
      const name = getFunctionName(ref);
      if (name === ADMIT_READ) {
        recorded.push((args as { operationArgs: unknown }).operationArgs);
        return await admitReadOperationWithCtx(ctx, args);
      }
      return BODY;
    };

    await assistantCatalogRoutes.fetch(
      request("/search?limit=5", {
        headers: withToken(ACTIVE_TOKEN, {
          "X-Assistant-Query": encodeURIComponent(SECRET_QUESTION),
        }),
      }),
      { runAction: dispatch, runMutation: dispatch, runQuery: dispatch } as never,
    );

    expect(recorded).toHaveLength(1);
    expect(JSON.stringify(recorded[0])).not.toContain("burgundy");
    // Only `limit` is ever in the query string the rail spreads.
    expect(Object.keys(recorded[0] as Record<string, unknown>).sort()).toEqual([
      "__operationIngressClaim",
      "limit",
    ]);
  });
});

/* -------------------------------------------------------- 4. lastUsedAt */

describe("credential freshness", () => {
  it("stamps at most once a quarter hour", () => {
    const now = 10_000_000_000;
    expect(shouldStampCatalogAccessToken(undefined, now)).toBe(true);
    expect(shouldStampCatalogAccessToken(now - 15 * 60 * 1000, now)).toBe(true);
    expect(shouldStampCatalogAccessToken(now - 14 * 60 * 1000, now)).toBe(
      false,
    );
    expect(shouldStampCatalogAccessToken(now, now)).toBe(false);
  });

  it("stamps a never-used token with the token id and nothing else", async () => {
    const { response, test } = await call("/search", {
      headers: withToken(ACTIVE_TOKEN, { "X-Assistant-Query": "bob%20wig" }),
    });

    expect(response.status).toBe(200);
    expect(test.called(TOUCH)?.args).toEqual({ tokenId: "token-active" });
  });

  it("does not stamp a token used inside the interval", async () => {
    const rows = await tokenRows();
    rows[0].lastUsedAt = Date.now() - 60_000;
    const test = harness(rows);

    const response = await assistantCatalogRoutes.fetch(
      request("/search", { headers: withToken(ACTIVE_TOKEN) }),
      test.env as never,
    );

    expect(response.status).toBe(200);
    expect(test.called(TOUCH)).toBeUndefined();
  });

  it("answers the shopper even when the stamp fails, logging a reason code only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { response } = await call("/search", {
      headers: withToken(ACTIVE_TOKEN, { "X-Assistant-Query": "bob%20wig" }),
      harnessOptions: {
        touch: async () => {
          throw new Error("write conflict on catalogAccessToken");
        },
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(BODY);
    expect(warn).toHaveBeenCalledWith("assistant_catalog_token_stamp_failed");
    for (const parts of warn.mock.calls) {
      expect(parts.map(String).join(" ")).not.toContain("conflict");
    }
  });
});
