import { describe, expect, it } from "vitest";

import type { PosLocalEventRecord } from "@/lib/pos/infrastructure/local/posLocalStore";
import type { PosLocalRegisterReadModel } from "@/lib/pos/infrastructure/local/registerReadModel";

import {
  buildOpenDrawerFailureMessage,
  getCloseoutCloudRegisterSessionId,
  getCloseoutLocalRegisterSessionId,
  getLatestLocalRegisterLifecycleEvent,
  isKnownCloudRegisterSessionBlockingLocalProjection,
  readLocalSyncStatus,
} from "./registerDrawerPresentation";

function localEvent(
  overrides: Partial<PosLocalEventRecord>,
): PosLocalEventRecord {
  return {
    createdAt: 1,
    localEventId: "event-1",
    localRegisterSessionId: "local-register-1",
    payload: {},
    schemaVersion: 8,
    sequence: 1,
    storeId: "store-1",
    sync: { status: "pending" },
    terminalId: "terminal-1",
    type: "register.closeout_started",
    ...overrides,
  } as PosLocalEventRecord;
}

function readModel(
  overrides: Partial<PosLocalRegisterReadModel>,
): PosLocalRegisterReadModel {
  return {
    activeRegisterSession: {
      expectedCash: 10,
      localRegisterSessionId: "local-register-1",
      openedAt: 1,
      openingFloat: 10,
      status: "open",
    },
    activeSale: null,
    canSell: true,
    clearedSaleIds: [],
    closeoutState: null,
    completedSales: [],
    errors: [],
    registerState: {} as PosLocalRegisterReadModel["registerState"],
    sourceEvents: [],
    syncStatus: {} as PosLocalRegisterReadModel["syncStatus"],
    ...overrides,
  };
}

describe("registerDrawerPresentation", () => {
  it("resolves local closeout ids from cloud-mapped local register sessions", () => {
    expect(
      getCloseoutLocalRegisterSessionId(
        { _id: "cloud-register-1" },
        readModel({
          activeRegisterSession: {
            cloudRegisterSessionId: "cloud-register-1",
            expectedCash: 10,
            localRegisterSessionId: "local-register-1",
            openedAt: 1,
            openingFloat: 10,
            status: "open",
          },
        }),
      ),
    ).toBe("local-register-1");

    expect(getCloseoutCloudRegisterSessionId({ _id: "cloud-register-1" })).toBe(
      "cloud-register-1",
    );
    expect(
      getCloseoutCloudRegisterSessionId({
        _id: "cloud-register-1",
        localRegisterSessionId: "local-register-1",
      }),
    ).toBeUndefined();
  });

  it("treats non-usable cloud sessions as local projection blockers", () => {
    expect(
      isKnownCloudRegisterSessionBlockingLocalProjection(
        { _id: "cloud-register-1", status: "closed" },
        { cloudRegisterSessionId: "cloud-register-1" },
      ),
    ).toBe(true);
    expect(
      isKnownCloudRegisterSessionBlockingLocalProjection(
        { _id: "cloud-register-1", status: "open" },
        { cloudRegisterSessionId: "cloud-register-1" },
      ),
    ).toBe(false);
  });

  it("reads sync status from multiple presentation shapes", () => {
    expect(readLocalSyncStatus({ syncStatus: "pending_sync" })).toEqual({
      status: "pending_sync",
    });
    expect(
      readLocalSyncStatus({
        localSyncStatus: { pendingEventCount: 2, status: "needs_review" },
      }),
    ).toEqual({ pendingEventCount: 2, status: "needs_review" });
  });

  it("returns the latest closeout lifecycle event for the active register", () => {
    const latest = getLatestLocalRegisterLifecycleEvent(
      readModel({
        sourceEvents: [
          localEvent({ sequence: 1, type: "register.closeout_started" }),
          localEvent({ sequence: 2, type: "register.reopened" }),
          localEvent({
            localEventId: "event-3",
            localRegisterSessionId: "other-register",
            sequence: 3,
            type: "register.closeout_started",
          }),
        ],
      }),
    );

    expect(latest?.type).toBe("register.reopened");
  });

  it("preserves command user errors when the drawer cannot be opened", () => {
    expect(
      buildOpenDrawerFailureMessage({
        kind: "user_error",
        error: {
          message:
            "A local drawer is already open for another register on this terminal.",
        },
      }),
    ).toBe(
      "A local drawer is already open for another register on this terminal.",
    );

    expect(buildOpenDrawerFailureMessage({ kind: "ok" })).toBe(
      "Unable to open the drawer. Try again.",
    );
    expect(
      buildOpenDrawerFailureMessage({
        kind: "user_error",
        error: {
          message: "POS local store could not write the local event.",
        },
      }),
    ).toBe("Unable to open the drawer. Try again.");
  });
});
