import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthRuntimeHandoffCoordinator } from "../../../lib/auth/authRuntimeHandoff";
import {
  activatePosRecoveryFlow,
  startPosRecoveryFlow,
  type PosRecoveryFrontendAdapter,
} from "./posRecoveryFlow";

describe("POS recovery flow", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  it("issues, activates, verifies, and promotes in order", async () => {
    const calls: string[] = [];
    const adapter = createAdapter(calls);
    const coordinator = createCoordinator();

    const result = await startPosRecoveryFlow({
      adapter,
      code: "code-1",
      coordinator,
      onPhase: (phase) => calls.push(phase),
      redirectTo: "/wigclub/store/main/pos",
      terminalId: "terminal-1",
      terminalProof: "proof-1",
    });

    expect(calls).toEqual([
      "prepared",
      "issue",
      "auth_issued",
      "activating",
      "activate",
      "promoting",
      "assert",
      "completed",
    ]);
    expect(coordinator.getSnapshot()).toMatchObject({
      activeNamespace: result.session.handle.pendingNamespace,
      handoffPhase: "idle",
    });
  });

  it("retries activation without issuing another Auth session", async () => {
    const calls: string[] = [];
    const adapter = createAdapter(calls);
    adapter.activate = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(activation);
    const coordinator = createCoordinator();
    let retrySession!: Parameters<typeof activatePosRecoveryFlow>[0]["session"];

    try {
      await startPosRecoveryFlow({
        adapter,
        code: "code-1",
        coordinator,
        onSession: (session) => {
          retrySession = session;
        },
        redirectTo: "/pos",
        terminalId: "terminal-1",
        terminalProof: "proof-1",
      });
    } catch {
      // The prepared exact session remains available for activation retry.
    }

    await activatePosRecoveryFlow({
      adapter,
      coordinator,
      session: retrySession,
    });

    expect(adapter.issue).toHaveBeenCalledTimes(1);
    expect(adapter.activate).toHaveBeenCalledTimes(2);
  });

  it("reclaims its own expired handoff lease before retrying activation", async () => {
    const calls: string[] = [];
    const adapter = createAdapter(calls);
    adapter.activate = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(activation);
    let now = 1_000;
    const coordinator = createCoordinatorWithNow(() => now);
    let retrySession!: Parameters<typeof activatePosRecoveryFlow>[0]["session"];

    try {
      await startPosRecoveryFlow({
        adapter,
        code: "code-1",
        coordinator,
        onSession: (session) => {
          retrySession = session;
        },
        redirectTo: "/pos",
        terminalId: "terminal-1",
        terminalProof: "proof-1",
      });
    } catch {
      // The lease now expires while the operator waits before retrying.
    }
    now = 120_000;

    await activatePosRecoveryFlow({
      adapter,
      coordinator,
      session: retrySession,
    });

    expect(adapter.issue).toHaveBeenCalledTimes(1);
    expect(adapter.activate).toHaveBeenCalledTimes(2);
    expect(coordinator.getSnapshot()).toMatchObject({
      activeNamespace: retrySession.handle.pendingNamespace,
      handoffPhase: "idle",
    });
  });

  it("discards a stale abandoned pre-activation handoff so a fresh sign-in can start", async () => {
    const storage = createMemoryStorage();
    let now = 1_000;
    let abandonedSequence = 0;
    const abandonedCoordinator = createAuthRuntimeHandoffCoordinator({
      now: () => now,
      ownerToken: "owner-crashed",
      randomId: () => `abandoned-${++abandonedSequence}-12345678`,
      storage,
    });
    abandonedCoordinator.prepareHandoff();
    now = 120_000;
    let sequence = 0;
    const coordinator = createAuthRuntimeHandoffCoordinator({
      now: () => now,
      ownerToken: "owner-current",
      randomId: () => `fresh-${++sequence}-12345678`,
      storage,
    });
    const calls: string[] = [];
    const adapter = createAdapter(calls);

    const result = await startPosRecoveryFlow({
      adapter,
      code: "code-1",
      coordinator,
      redirectTo: "/pos",
      terminalId: "terminal-1",
      terminalProof: "proof-1",
    });

    expect(adapter.issue).toHaveBeenCalledTimes(1);
    expect(coordinator.getSnapshot()).toMatchObject({
      activeNamespace: result.session.handle.pendingNamespace,
      handoffPhase: "idle",
    });
  });

  it("clears an expired exact-session handoff when the code is required again", async () => {
    const calls: string[] = [];
    const adapter = createAdapter(calls);
    (adapter.activate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: "code_required",
    });
    const coordinator = createCoordinator();

    await expect(
      startPosRecoveryFlow({
        adapter,
        code: "code-1",
        coordinator,
        redirectTo: "/pos",
        terminalId: "terminal-1",
        terminalProof: "proof-1",
      }),
    ).rejects.toThrow("pos_recovery_code_required");

    expect(coordinator.getSnapshot()).toMatchObject({
      activeNamespace: null,
      handoffPhase: "idle",
      pendingNamespace: null,
    });
  });
});

const activation = {
  authorityExpiresAt: 10_000,
  offlineAuthorityReceipt: "receipt-1",
  posApplicationSessionBindingId: "binding-1",
  servicePrincipalSessionId: "session-1",
  storeId: "store-1",
  terminalId: "terminal-1",
};

function createAdapter(calls: string[]): PosRecoveryFrontendAdapter {
  return {
    requestDisposition: vi.fn(async () => ({
      disposition: "recovery_code_required" as const,
    })),
    issue: vi.fn(async () => {
      calls.push("issue");
    }),
    resume: vi.fn(async () => {
      calls.push("resume");
    }),
    activate: vi.fn(async () => {
      calls.push("activate");
      return activation;
    }),
    assertActivatedSession: vi.fn(async () => {
      calls.push("assert");
    }),
    abort: vi.fn(async () => undefined),
  };
}

function createCoordinator() {
  return createCoordinatorWithNow(() => 1_000);
}

function createCoordinatorWithNow(now: () => number) {
  let sequence = 0;
  return createAuthRuntimeHandoffCoordinator({
    now,
    ownerToken: "owner-current",
    randomId: () => `generated-${++sequence}-12345678`,
    storage: createMemoryStorage(),
  });
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
