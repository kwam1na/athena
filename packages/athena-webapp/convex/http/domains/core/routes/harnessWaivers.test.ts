import { beforeEach, describe, expect, it, vi } from "vitest";

const generatedServer = vi.hoisted(() => ({
  env: {
    ATHENA_WAIVER_ORIGIN: "https://athena.example",
    ATHENA_WAIVER_REVIEWER_EMAIL: "reviewer@example.com",
    ATHENA_WAIVER_BROKER_SECRET: "broker-secret",
    ATHENA_WAIVER_RP_ID: "athena.example",
  } as Record<string, string | undefined>,
}));

vi.mock("../../../../_generated/server", () => generatedServer);

import {
  harnessWaiverRoutes,
  parseWaiverCandidate,
  secureSecretMatches,
} from "./harnessWaivers";

const candidate = {
  repository: "kwam1na/athena",
  prNumber: 123,
  headSha: "head",
  baseRef: "origin/main",
  baseSha: "base",
  diffBaseSha: "merge-base",
  deliverableTreeSha: "tree",
  identityVersion: "deliverable-tree/v1",
  waivedFindingCodes: ["compound-solution"],
  reason: "Accepted for this candidate.",
};

function brokerEnv() {
  return {
    runAction: vi.fn().mockResolvedValue({ approvalId: "approval-1" }),
    runQuery: vi.fn().mockResolvedValue({
      _id: "approval-1",
      status: "pending",
      expiresAt: 1,
    }),
    runMutation: vi.fn().mockResolvedValue({ approvalId: "approval-1" }),
  };
}

beforeEach(() => {
  generatedServer.env.ATHENA_WAIVER_BROKER_SECRET = "broker-secret";
});

describe("parseWaiverCandidate", () => {
  it("accepts the exact supported documentation findings", () => {
    expect(parseWaiverCandidate(candidate)).toMatchObject({
      prNumber: 123,
      waivedFindingCodes: ["compound-solution"],
    });
  });

  it("rejects unsupported findings and incomplete candidate identity", () => {
    expect(parseWaiverCandidate({
      repository: "kwam1na/athena",
      prNumber: 123,
      waivedFindingCodes: ["review.green"],
      reason: "Accepted.",
    })).toBeUndefined();
  });
});

describe("secureSecretMatches", () => {
  it("matches only the exact broker secret", async () => {
    await expect(secureSecretMatches("secret", "secret")).resolves.toBe(true);
    await expect(secureSecretMatches("secret", "different")).resolves.toBe(false);
  });
});

describe("harness waiver broker authorization", () => {
  const operations = [
    ["POST", "/requests", candidate],
    ["GET", "/requests/approval-1", undefined],
    ["POST", "/requests/approval-1/consume", candidate],
  ] as const;

  it.each(operations)(
    "rejects missing, malformed, and incorrect credentials for %s %s",
    async (method, path, body) => {
      for (const authorization of [undefined, "Basic broker-secret", "Bearer wrong"]) {
        const bindings = brokerEnv();
        const response = await harnessWaiverRoutes.request(
          `http://localhost${path}`,
          {
            method,
            headers: authorization
              ? { authorization, "content-type": "application/json" }
              : { "content-type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
          },
          bindings,
        );

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: { code: "unauthorized" } });
        expect(bindings.runAction).not.toHaveBeenCalled();
        expect(bindings.runQuery).not.toHaveBeenCalled();
        expect(bindings.runMutation).not.toHaveBeenCalled();
      }
    },
  );

  it.each(operations)("accepts the exact bearer secret for %s %s", async (method, path, body) => {
    const bindings = brokerEnv();
    const response = await harnessWaiverRoutes.request(
      `http://localhost${path}`,
      {
        method,
        headers: {
          authorization: "Bearer broker-secret",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      bindings,
    );

    expect(response.status).toBe(method === "POST" && path === "/requests" ? 201 : 200);
    expect(
      bindings.runAction.mock.calls.length +
        bindings.runQuery.mock.calls.length +
        bindings.runMutation.mock.calls.length,
    ).toBe(1);
  });

  it("fails closed when the broker secret is not configured", async () => {
    generatedServer.env.ATHENA_WAIVER_BROKER_SECRET = undefined;
    const bindings = brokerEnv();
    const response = await harnessWaiverRoutes.request(
      "http://localhost/requests/approval-1",
      { headers: { authorization: "Bearer broker-secret" } },
      bindings,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "temporarily_unavailable" },
    });
    expect(bindings.runQuery).not.toHaveBeenCalled();
  });
});
