import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPosTransactionByReceiptToken,
  PosTransactionReceiptError,
} from "./posTransaction";

const fetchMock = vi.fn<typeof fetch>();

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });

describe("posTransaction api", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("fetches tokenized receipt shares from the public token endpoint", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        _id: "txn_123",
      }),
    );

    await getPosTransactionByReceiptToken("share token/123");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/pos-transactions/receipt-shares/share%20token%2F123",
      ),
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      }),
    );
  });

  it("preserves receipt lookup status codes for retry and not-found handling", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: "Receipt not found.",
        },
        404,
      ),
    );

    await expect(getPosTransactionByReceiptToken("missing")).rejects.toEqual(
      expect.objectContaining<Partial<PosTransactionReceiptError>>({
        message: "Receipt not found.",
        status: 404,
      }),
    );
  });
});
