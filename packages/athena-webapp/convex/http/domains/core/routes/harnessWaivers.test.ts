import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generatedServer = vi.hoisted(() => ({
  env: {
    ATHENA_WAIVER_ORIGIN: "https://athena.example",
    ATHENA_WAIVER_REVIEWER_EMAIL: "reviewer@example.com",
    ATHENA_WAIVER_BROKER_SECRET: "broker-secret",
    ATHENA_WAIVER_RP_ID: "athena.example",
  } as Record<string, string | undefined>,
}));

// Only `env` is overridden: the route now imports the admission composition
// root, which pulls in the real Convex function builders, so replacing the
// whole generated module would break at import time.
vi.mock("../../../../_generated/server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  get env() {
    return generatedServer.env;
  },
}));

import {
  harnessWaiverRoutes,
  isWaiverApprovalUnavailable,
  isWaiverConfigurationError,
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
  // The declared ingress verifier reads the same secret from the environment
  // the Convex runtime exposes it through.
  process.env.ATHENA_WAIVER_BROKER_SECRET = "broker-secret";
});

afterEach(() => {
  delete process.env.ATHENA_WAIVER_BROKER_SECRET;
});

/**
 * Admission runs its own internal mutation/query before each handler, so the
 * "exactly one backend call" property is now about the harness calls: the
 * admission entry points are the only other traffic on these bindings.
 */
const brokerCalls = (bindings: ReturnType<typeof brokerEnv>) =>
  [
    ...bindings.runAction.mock.calls,
    ...bindings.runQuery.mock.calls,
    ...bindings.runMutation.mock.calls,
  ].filter((call) => {
    const args = call[1] as { operationId?: string } | undefined;
    return !args || args.operationId === undefined;
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
    expect(brokerCalls(bindings)).toHaveLength(1);
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

/**
 * The rule these tests hold: a status the broker's contract documents is
 * reserved for the domain condition that earns it, and a fault stays a fault.
 *
 * A route that answers every failure with an expected status tells the caller
 * to stop retrying and tells monitoring nothing broke. Hono renders an escaped
 * error as 500, so "propagates" is observable as a 5xx here — which is exactly
 * the signal that used to be missing.
 */
describe("harness waiver error classification", () => {
  it("recognizes only the configuration misses an operator can fix", () => {
    expect(
      isWaiverConfigurationError(
        new Error("ATHENA_WAIVER_BROKER_SECRET is not configured."),
      ),
    ).toBe(true);
    expect(
      isWaiverConfigurationError(
        new Error("The waiver reviewer passkey is not enrolled."),
      ),
    ).toBe(true);
    expect(isWaiverConfigurationError(new TypeError("boom"))).toBe(false);
    // Exact match, never a substring: a drifting message must fail loudly.
    expect(
      isWaiverConfigurationError(
        new Error("ATHENA_WAIVER_RP_ID is not configured. (wrapped)"),
      ),
    ).toBe(false);
  });

  it("recognizes only genuine conflicts over the presented approval", () => {
    for (const message of [
      "Passkey approval is unavailable.",
      "Approval request is expired.",
      "Approval request is consumed.",
      "Approval request is not approved.",
      "Passkey approval candidate does not match the expected candidate.",
    ]) {
      expect(isWaiverApprovalUnavailable(new Error(message))).toBe(true);
    }
    expect(isWaiverApprovalUnavailable(new TypeError("boom"))).toBe(false);
    expect(isWaiverApprovalUnavailable("Approval request is expired.")).toBe(false);
  });
});

/** The waiver call is the one that carries no `operationId`; admission does. */
function isWaiverCall(args: unknown) {
  return (args as { operationId?: string } | undefined)?.operationId === undefined;
}

async function postRequests(bindings: ReturnType<typeof brokerEnv>) {
  return harnessWaiverRoutes.request(
    "http://localhost/requests",
    {
      method: "POST",
      headers: {
        authorization: "Bearer broker-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify(candidate),
    },
    bindings,
  );
}

async function postConsume(bindings: ReturnType<typeof brokerEnv>) {
  return harnessWaiverRoutes.request(
    "http://localhost/requests/approval-1/consume",
    {
      method: "POST",
      headers: {
        authorization: "Bearer broker-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify(candidate),
    },
    bindings,
  );
}

describe("harness waiver request creation", () => {
  it("keeps 503 for an unenrolled reviewer passkey", async () => {
    const bindings = brokerEnv();
    bindings.runAction.mockRejectedValue(
      new Error("The waiver reviewer passkey is not enrolled."),
    );

    const response = await postRequests(bindings);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "temporarily_unavailable" },
    });
  });

  it("propagates an unexpected action fault instead of reporting 503", async () => {
    const bindings = brokerEnv();
    bindings.runAction.mockRejectedValue(new TypeError("boom"));

    const response = await postRequests(bindings);

    // A fault must not wear the "retry later, we are fine" status.
    expect(response.status).toBe(500);
  });
});

describe("harness waiver consumption", () => {
  it("keeps 409 for an approval that cannot be consumed", async () => {
    const bindings = brokerEnv();
    bindings.runMutation.mockImplementation((_reference, args) =>
      isWaiverCall(args)
        ? Promise.reject(new Error("Approval request is expired."))
        : Promise.resolve({ approvalId: "approval-1" }),
    );

    const response = await postConsume(bindings);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "approval_unavailable" },
    });
  });

  it("propagates an unexpected mutation fault instead of reporting 409", async () => {
    const bindings = brokerEnv();
    bindings.runMutation.mockImplementation((_reference, args) =>
      isWaiverCall(args)
        ? Promise.reject(new TypeError("boom"))
        : Promise.resolve({ approvalId: "approval-1" }),
    );

    const response = await postConsume(bindings);

    expect(response.status).toBe(500);
  });
});
