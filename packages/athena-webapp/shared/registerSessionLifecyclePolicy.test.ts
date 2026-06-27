import { describe, expect, it } from "vitest";

import {
  canOpenReplacementDrawerForLocalBlock,
  canReuseCloudRegisterSessionForLocalOpen,
  canSupersedeReviewedRegisterSessionForLocalOpen,
  getRegisterSessionVoidApplicationStatus,
  getSaleBlockingDrawerAuthority,
  isNonBlockingRegisterLifecycleReviewEvent,
  isRegisterCloseoutReviewConflict,
  isRegisterSessionReplacementBlocking,
  isRegisterSessionSaleUsable,
  REGISTER_CLOSEOUT_VARIANCE_SYNC_REVIEW_SUMMARY,
} from "./registerSessionLifecyclePolicy";

describe("registerSessionLifecyclePolicy", () => {
  it("keeps only open and active register sessions sale usable", () => {
    expect(isRegisterSessionSaleUsable({ status: "open" })).toBe(true);
    expect(isRegisterSessionSaleUsable({ status: "active" })).toBe(true);
    expect(isRegisterSessionSaleUsable({ status: "closing" })).toBe(false);
    expect(isRegisterSessionSaleUsable({ status: "closeout_rejected" })).toBe(
      false,
    );
    expect(isRegisterSessionSaleUsable({ status: "closed" })).toBe(false);
    expect(isRegisterSessionSaleUsable({ status: "needs_review" })).toBe(false);
  });

  it("allows void application for open, active, and closing register sessions", () => {
    for (const status of ["open", "active", "closing"] as const) {
      expect(
        getRegisterSessionVoidApplicationStatus({
          registerSession: {
            status,
            storeId: "store-1",
            terminalId: "terminal-1",
          },
          storeId: "store-1",
          terminalId: "terminal-1",
        }),
      ).toEqual({ allowed: true });
    }
  });

  it("blocks void application for closed and rejected closeout sessions", () => {
    for (const status of ["closeout_rejected", "closed"] as const) {
      expect(
        getRegisterSessionVoidApplicationStatus({
          registerSession: {
            status,
            storeId: "store-1",
            terminalId: "terminal-1",
          },
          storeId: "store-1",
          terminalId: "terminal-1",
        }),
      ).toEqual({ allowed: false, reason: "blocked_status" });
    }
  });

  it("distinguishes void application scope failures", () => {
    expect(
      getRegisterSessionVoidApplicationStatus({
        registerSession: null,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toEqual({ allowed: false, reason: "missing_session" });
    expect(
      getRegisterSessionVoidApplicationStatus({
        registerSession: {
          status: "closing",
          storeId: "store-2",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toEqual({ allowed: false, reason: "wrong_store" });
    expect(
      getRegisterSessionVoidApplicationStatus({
        registerSession: {
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-2",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toEqual({ allowed: false, reason: "wrong_terminal" });
  });

  it("allows replacement for submitted closeouts without making them sale usable", () => {
    expect(
      isRegisterSessionReplacementBlocking({
        hasSubmittedCloseout: false,
        session: { status: "closing" },
      }),
    ).toBe(true);
    expect(
      isRegisterSessionReplacementBlocking({
        hasSubmittedCloseout: true,
        session: { status: "closing" },
      }),
    ).toBe(false);
    expect(
      isRegisterSessionReplacementBlocking({
        hasSubmittedCloseout: true,
        session: { status: "closeout_rejected" },
      }),
    ).toBe(false);
    expect(
      isRegisterSessionReplacementBlocking({
        hasSubmittedCloseout: true,
        session: { status: "active" },
      }),
    ).toBe(true);
  });

  it("treats same-drawer lifecycle rejection as recoverable for local sale blocking", () => {
    expect(
      getSaleBlockingDrawerAuthority({
        activeRegisterSession: { localRegisterSessionId: "local-drawer-1" },
        drawerAuthority: {
          localRegisterSessionId: "local-drawer-1",
          status: "healthy",
        },
      }),
    ).toBeNull();

    expect(
      getSaleBlockingDrawerAuthority({
        activeRegisterSession: { localRegisterSessionId: "local-drawer-1" },
        drawerAuthority: {
          localRegisterSessionId: "local-drawer-1",
          reason: "lifecycle_rejected",
          status: "blocked",
        },
      }),
    ).toBeNull();

    expect(
      getSaleBlockingDrawerAuthority({
        activeRegisterSession: { localRegisterSessionId: "local-drawer-1" },
        drawerAuthority: {
          localRegisterSessionId: "local-drawer-1",
          reason: "cloud_closed",
          status: "blocked",
        },
      })?.reason,
    ).toBe("cloud_closed");
  });

  it("ignores drawer authority that belongs to a superseded drawer identity", () => {
    expect(
      getSaleBlockingDrawerAuthority({
        activeRegisterSession: {
          cloudRegisterSessionId: "cloud-drawer-2",
          localRegisterSessionId: "local-drawer-2",
        },
        drawerAuthority: {
          cloudRegisterSessionId: "cloud-drawer-1",
          localRegisterSessionId: "local-drawer-1",
          reason: "cloud_closed",
          status: "blocked",
        },
      }),
    ).toBeNull();
  });

  it("allows local replacement drawers only for cloud-closed, settled closeout, or submitted closeout blocks", () => {
    expect(
      canOpenReplacementDrawerForLocalBlock({
        drawerAuthorityReason: "cloud_closed",
        hasSettledCloseout: false,
        saleBlockReason: "drawer_authority",
      }),
    ).toBe(true);
    expect(
      canOpenReplacementDrawerForLocalBlock({
        activeRegisterSession: { status: "closing" },
        hasSettledCloseout: false,
        saleBlockReason: "drawer_closed",
      }),
    ).toBe(true);
    expect(
      canOpenReplacementDrawerForLocalBlock({
        hasSettledCloseout: true,
        saleBlockReason: "drawer_closed",
      }),
    ).toBe(true);
    expect(
      canOpenReplacementDrawerForLocalBlock({
        hasSettledCloseout: false,
        saleBlockReason: "terminal_integrity",
      }),
    ).toBe(false);
  });

  it("reuses cloud register sessions only for the same scoped sale-usable drawer identity", () => {
    expect(
      canReuseCloudRegisterSessionForLocalOpen({
        hasOpenRegisterCloseoutReview: false,
        localRegisterSessionId: "local-drawer-1",
        registerSession: {
          localRegisterSessionId: "local-drawer-1",
          status: "active",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(true);
    expect(
      canReuseCloudRegisterSessionForLocalOpen({
        hasOpenRegisterCloseoutReview: true,
        localRegisterSessionId: "local-drawer-1",
        registerSession: {
          localRegisterSessionId: "local-drawer-1",
          status: "active",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
    expect(
      canReuseCloudRegisterSessionForLocalOpen({
        hasOpenRegisterCloseoutReview: false,
        localRegisterSessionId: "local-drawer-1",
        registerSession: {
          localRegisterSessionId: "local-drawer-1",
          status: "active",
          storeId: "store-1",
          terminalId: "terminal-2",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
    expect(
      canReuseCloudRegisterSessionForLocalOpen({
        hasOpenRegisterCloseoutReview: false,
        localRegisterSessionId: "local-drawer-2",
        registerSession: {
          localRegisterSessionId: "local-drawer-1",
          status: "active",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
    expect(
      canReuseCloudRegisterSessionForLocalOpen({
        hasOpenRegisterCloseoutReview: false,
        localRegisterSessionId: "cloud-drawer-1",
        registerSession: {
          cloudRegisterSessionId: "cloud-drawer-1",
          status: "active",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(true);
  });

  it("allows superseding reviewed sale-usable or closing sessions only in scope", () => {
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        closeoutReviewBoundaryAt: 20,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        replacementOpenedAt: 30,
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(true);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        closeoutReviewBoundaryAt: 50,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        replacementOpenedAt: 10,
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        closeoutReviewBoundaryAt: 20,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        replacementOpenedAt: 30,
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(true);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        closeoutReviewBoundaryAt: null,
        hasOpenRegisterCloseoutReview: false,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        replacementOpenedAt: 20,
        registerSession: {
          localRegisterSessionId: "submitted-closeout-drawer",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        allowUnknownCloseoutReviewBoundary: true,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closeout_rejected",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(true);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        allowUnknownCloseoutReviewBoundary: true,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closed",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        allowUnknownCloseoutReviewBoundary: true,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "reviewed-local-drawer",
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        allowUnknownCloseoutReviewBoundary: true,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(true);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        allowUnknownCloseoutReviewBoundary: true,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closing",
          storeId: "store-2",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        allowUnknownCloseoutReviewBoundary: true,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-2",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
  });

  it("classifies closeout review conflicts from the shared summary or money details", () => {
    expect(
      isRegisterCloseoutReviewConflict({
        summary: REGISTER_CLOSEOUT_VARIANCE_SYNC_REVIEW_SUMMARY,
      }),
    ).toBe(true);
    expect(
      isRegisterCloseoutReviewConflict({
        details: { countedCash: 100, expectedCash: 90, variance: 10 },
      }),
    ).toBe(true);
    expect(
      isRegisterCloseoutReviewConflict({
        summary: "Inventory needs manager review for a synced offline sale.",
      }),
    ).toBe(false);
  });

  it("keeps uploaded register lifecycle review events out of blocking sync status", () => {
    expect(
      isNonBlockingRegisterLifecycleReviewEvent({
        sync: { status: "needs_review" },
        type: "register.opened",
      }),
    ).toBe(true);
    expect(
      isNonBlockingRegisterLifecycleReviewEvent({
        sync: { status: "needs_review" },
        type: "cart.item_added",
      }),
    ).toBe(false);
  });
});
