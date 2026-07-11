import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createPosLocalStorageRuntime } from "./posLocalStorageRuntime";
import {
  PosLocalStorageRuntimeProvider,
  usePosLocalStorageRuntime,
} from "./posLocalStorageRuntimeContext";

describe("PosLocalStorageRuntimeProvider", () => {
  it("renders children while initialization is pending and exposes readiness", async () => {
    let resolveOpen!: (store: { name: string }) => void;
    const runtime = createPosLocalStorageRuntime({
      engine: {
        durability: "durable",
        id: "fixture",
        open: () =>
          new Promise((resolve) => {
            resolveOpen = resolve;
          }),
      },
    });

    render(
      <PosLocalStorageRuntimeProvider runtime={runtime}>
        <RuntimeStatus />
      </PosLocalStorageRuntimeProvider>,
    );

    expect(screen.getByText("initializing:1")).toBeTruthy();
    await act(async () => resolveOpen({ name: "fixture" }));
    expect(screen.getByText("ready:1")).toBeTruthy();
  });

  it("keeps children mounted when initialization fails and can retry", async () => {
    const runtime = createPosLocalStorageRuntime({
      engine: {
        durability: "durable",
        id: "fixture",
        open: vi
          .fn()
          .mockRejectedValueOnce(new Error("unavailable"))
          .mockResolvedValueOnce({ name: "fixture" }),
      },
    });

    render(
      <PosLocalStorageRuntimeProvider runtime={runtime}>
        <RuntimeStatus />
      </PosLocalStorageRuntimeProvider>,
    );

    expect(await screen.findByText("failed:1")).toBeTruthy();
    await act(async () => {
      await runtime.retry();
    });
    expect(screen.getByText("ready:2")).toBeTruthy();
  });
});

function RuntimeStatus() {
  const { snapshot } = usePosLocalStorageRuntime();
  return <div>{`${snapshot.status}:${snapshot.generation}`}</div>;
}
