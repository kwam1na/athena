import { describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";

import {
  SHARED_DEMO_ACTION_DENIED_CODE,
  SHARED_DEMO_ACTION_DENIED_MESSAGE,
} from "~/shared/sharedDemoActionError";
import { runCommand } from "./runCommand";
import { setSharedDemoDenialObserver } from "./sharedDemoDenialObserver";

function demoDenial() {
  return new ConvexError({
    code: SHARED_DEMO_ACTION_DENIED_CODE,
    message: SHARED_DEMO_ACTION_DENIED_MESSAGE,
  });
}

describe("shared demo denial observer", () => {
  it("notifies when the demo refuses a command", async () => {
    const observer = vi.fn();
    const stop = setSharedDemoDenialObserver(observer);

    const result = await runCommand(() => {
      throw demoDenial();
    });

    expect(observer).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ kind: "user_error" });
    stop();
  });

  it("stays quiet for ordinary command failures", async () => {
    const observer = vi.fn();
    const stop = setSharedDemoDenialObserver(observer);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runCommand(() => {
      throw new Error("the network went away");
    });

    expect(observer).not.toHaveBeenCalled();
    stop();
    vi.restoreAllMocks();
  });

  it("keeps presenting the denial when the observer itself throws", async () => {
    const stop = setSharedDemoDenialObserver(() => {
      throw new Error("telemetry is down");
    });

    await expect(
      runCommand(() => {
        throw demoDenial();
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: { message: SHARED_DEMO_ACTION_DENIED_MESSAGE },
    });
    stop();
  });

  it("stops notifying once the observer is detached", async () => {
    const observer = vi.fn();
    setSharedDemoDenialObserver(observer)();

    await runCommand(() => {
      throw demoDenial();
    });

    expect(observer).not.toHaveBeenCalled();
  });
});
