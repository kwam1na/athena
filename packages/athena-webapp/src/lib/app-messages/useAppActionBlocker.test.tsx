import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  AppMessagesProvider,
  useAppActionBlocker,
  useAppActionBlockers,
  useAppMessage,
  useAppMessages,
} from ".";

function wrapper({ children }: { children: ReactNode }) {
  return <AppMessagesProvider>{children}</AppMessagesProvider>;
}

describe("useAppActionBlocker", () => {
  it("scopes blockers by app action id", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => {
        useAppActionBlocker({
          actionId: "app-update.apply",
          active,
          blockerId: "pos-register",
          priority: "critical-workflow",
          label: "Register sale",
          guidance: "Finish this sale before refreshing.",
        });
        useAppActionBlocker({
          actionId: "inventory-close.confirm",
          active,
          blockerId: "pos-register",
          priority: "active-command",
          label: "Register command",
          guidance: "Finish the command first.",
        });

        return {
          updateBlockers: useAppActionBlockers("app-update.apply"),
          closeBlockers: useAppActionBlockers("inventory-close.confirm"),
        };
      },
      {
        initialProps: { active: true },
        wrapper,
      },
    );

    expect(result.current.updateBlockers).toEqual([
      expect.objectContaining({
        actionId: "app-update.apply",
        blockerId: "pos-register",
        label: "Register sale",
      }),
    ]);
    expect(result.current.closeBlockers).toEqual([
      expect.objectContaining({
        actionId: "inventory-close.confirm",
        blockerId: "pos-register",
        label: "Register command",
      }),
    ]);

    rerender({ active: false });

    expect(result.current.updateBlockers).toEqual([]);
    expect(result.current.closeBlockers).toEqual([]);
  });

  it("sorts blockers by action priority without leaking to other actions", () => {
    const { result } = renderHook(
      () => {
        useAppActionBlocker({
          actionId: "app-update.apply",
          active: true,
          blockerId: "inventory-import",
          priority: "resume-required",
          label: "Inventory import",
          guidance: "Save the import before refreshing.",
        });
        useAppActionBlocker({
          actionId: "app-update.apply",
          active: true,
          blockerId: "pos-register",
          priority: "critical-workflow",
          label: "Register sale",
          guidance: "Finish the sale before refreshing.",
        });

        return {
          updateBlockers: useAppActionBlockers("app-update.apply"),
          otherBlockers: useAppActionBlockers("inventory-close.confirm"),
        };
      },
      { wrapper },
    );

    expect(result.current.updateBlockers.map((blocker) => blocker.blockerId))
      .toEqual(["pos-register", "inventory-import"]);
    expect(result.current.otherBlockers).toEqual([]);
  });

  it("does not require a provider for read-only consumers", () => {
    const { result } = renderHook(() =>
      useAppActionBlockers("app-update.apply"),
    );

    expect(result.current).toEqual([]);
  });

  it("registers prioritized app messages independent of the app-update adapter", () => {
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => {
        useAppMessage({
          id: "inventory-close.pending",
          active,
          label: "Inventory close",
          message: "Inventory close needs review.",
          priority: 10,
        });
        useAppMessage({
          id: "daily-close.pending",
          active,
          label: "Daily close",
          message: "Daily close is waiting.",
          priority: 20,
        });

        return useAppMessages();
      },
      {
        initialProps: { active: true },
        wrapper,
      },
    );

    expect(result.current.map((message) => message.id)).toEqual([
      "daily-close.pending",
      "inventory-close.pending",
    ]);

    rerender({ active: false });

    expect(result.current).toEqual([]);
  });
});
