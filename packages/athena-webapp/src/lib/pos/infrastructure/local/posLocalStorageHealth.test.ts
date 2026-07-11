import { describe, expect, it, vi } from "vitest";

import {
  classifyPosLocalLedgerPressure,
  observePosLocalStorageHealth,
  toSafePosLocalStorageHealthDiagnostic,
} from "./posLocalStorageHealth";

describe("observePosLocalStorageHealth", () => {
  it("classifies ledger pressure from count and oldest-record age only", () => {
    const day = 24 * 60 * 60_000;
    expect(
      classifyPosLocalLedgerPressure({ eventCount: 100, now: 100 * day }),
    ).toBe("normal");
    expect(
      classifyPosLocalLedgerPressure({ eventCount: 10_000, now: 100 * day }),
    ).toBe("warning");
    expect(
      classifyPosLocalLedgerPressure({
        eventCount: 100,
        now: 100 * day,
        oldestEventAt: 9 * day,
      }),
    ).toBe("critical");
    expect(classifyPosLocalLedgerPressure({ eventCount: Number.NaN })).toBe(
      "unknown",
    );
  });
  it("reports granted persistence and a bounded pressure band", async () => {
    const result = await observePosLocalStorageHealth({
      clock: () => 1_000,
      storage: {
        estimate: vi.fn().mockResolvedValue({ quota: 100, usage: 81 }),
        persisted: vi.fn().mockResolvedValue(true),
      },
    });

    expect(result).toEqual({
      engineReadiness: "unknown",
      ledgerPressure: "unknown",
      maintenance: "unknown",
      migration: "unknown",
      observedAt: 1_000,
      persistence: "granted",
      pressure: "warning",
      quotaBytes: 100,
      usageBytes: 81,
    });
  });

  it("keeps unsupported and malformed estimates unknown", async () => {
    await expect(
      observePosLocalStorageHealth({
        clock: () => 1_000,
        storage: undefined,
      }),
    ).resolves.toEqual({
      engineReadiness: "unknown",
      ledgerPressure: "unknown",
      maintenance: "unknown",
      migration: "unknown",
      observedAt: 1_000,
      persistence: "unsupported",
      pressure: "unknown",
    });
    await expect(
      observePosLocalStorageHealth({
        storage: {
          estimate: vi.fn().mockResolvedValue({ quota: 0, usage: 12 }),
          persisted: vi.fn().mockRejectedValue(new Error("secret detail")),
        },
        clock: () => 1_000,
      }),
    ).resolves.toEqual({
      engineReadiness: "unknown",
      ledgerPressure: "unknown",
      maintenance: "unknown",
      migration: "unknown",
      observedAt: 1_000,
      persistence: "unknown",
      pressure: "unknown",
    });
  });

  it("emits only allowlisted, fresh diagnostics", () => {
    const diagnostic = toSafePosLocalStorageHealthDiagnostic(
      {
        engineReadiness: "ready",
        ledgerPressure: "normal",
        maintenance: "idle",
        migration: "idle",
        observedAt: 1_000,
        persistence: "granted",
        pressure: "normal",
        lastSuccessfulDurableCommitAt: 900,
        quotaBytes: Number.NaN,
        usageBytes: 5,
        privateEngineDetail: "must not escape",
      } as never,
      2_000,
    );

    expect(diagnostic).toEqual({
      engineReadiness: "ready",
      freshness: "fresh",
      lastSuccessfulDurableCommitAt: 900,
      ledgerPressure: "normal",
      maintenance: "idle",
      migration: "idle",
      observedAt: 1_000,
      persistence: "granted",
      pressure: "normal",
      usageBytes: 5,
    });
    expect(diagnostic).not.toHaveProperty("privateEngineDetail");
  });

  it("marks old or invalid evidence stale or unknown", () => {
    const base = {
      engineReadiness: "ready" as const,
      ledgerPressure: "normal" as const,
      maintenance: "idle" as const,
      migration: "idle" as const,
      persistence: "granted" as const,
      pressure: "normal" as const,
    };
    expect(
      toSafePosLocalStorageHealthDiagnostic(
        {
          ...base,
          observedAt: 1_000,
        },
        200_000,
      ).freshness,
    ).toBe("stale");
    expect(
      toSafePosLocalStorageHealthDiagnostic(
        {
          ...base,
          observedAt: Number.NaN,
        },
        2_000,
      ).freshness,
    ).toBe("unknown");
  });
});
