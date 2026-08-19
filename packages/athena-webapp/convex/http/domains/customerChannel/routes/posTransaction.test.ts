import { describe, expect, it, vi } from "vitest";

import { posTransactionRoutes } from "./posTransaction";

/**
 * The receipt-share route answers a stranger holding a link, so its 404 is the
 * whole public contract: it must mean "this receipt is not available", and
 * nothing else. The route used to reach that same 404 from a `catch`, which
 * made a broken lookup indistinguishable from a bad token — the customer with
 * a valid link was told it was wrong, and monitoring saw a clean 4xx while the
 * path was down.
 *
 * Admission runs its own query before the handler; it is the call carrying an
 * `operationId`, so the receipt lookup is the one without.
 */
const isReceiptLookup = (args: unknown) =>
  (args as { operationId?: string } | undefined)?.operationId === undefined;

function bindings(receipt: () => Promise<unknown>) {
  return {
    runQuery: vi
      .fn()
      .mockImplementation((_reference, args) =>
        isReceiptLookup(args) ? receipt() : Promise.resolve({}),
      ),
  } as never;
}

const request = (env: never) =>
  posTransactionRoutes.request(
    "http://localhost/receipt-shares/share-token",
    {},
    env,
  );

describe("receipt share route", () => {
  it("returns the receipt the share token resolves to", async () => {
    const response = await request(
      bindings(() => Promise.resolve({ _id: "transaction-1", total: 1_200 })),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      _id: "transaction-1",
    });
  });

  it("keeps 404 for a token the query resolves to nothing", async () => {
    // A missing, expired, or foreign token is answered as `null` by the query
    // — that IS the not-found domain outcome, and it is the only one mapped.
    const response = await request(bindings(() => Promise.resolve(null)));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Receipt not found",
    });
  });

  it("propagates an unexpected query fault instead of reporting 404", async () => {
    const response = await request(
      bindings(() => Promise.reject(new TypeError("boom"))),
    );

    // A fault surfaces as a fault: the caller can retry and monitoring sees it.
    expect(response.status).toBe(500);
  });
});
