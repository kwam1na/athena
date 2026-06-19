import { describe, expect, it, vi } from "vitest";

import {
  installAppUpdateUnloadPromptBypass,
  reloadBrowserForAppUpdate,
} from "./appUpdateReload";

describe("appUpdateReload", () => {
  it("keeps unload prompts intact for normal app update reloads", () => {
    const win = createFakeWindow();
    const beforeUnload = vi.fn();

    installAppUpdateUnloadPromptBypass(win);
    win.addEventListener("beforeunload", beforeUnload);

    reloadBrowserForAppUpdate(undefined, win);
    win.dispatchEvent(new Event("beforeunload"));

    expect(win.location.reload).toHaveBeenCalledTimes(1);
    expect(beforeUnload).toHaveBeenCalledTimes(1);
  });

  it("removes tracked listener prompts before forced remote app update reloads", () => {
    const win = createFakeWindow();
    const beforeUnload = vi.fn();
    const assignedBeforeUnload = vi.fn();

    installAppUpdateUnloadPromptBypass(win);
    win.addEventListener("beforeunload", beforeUnload);
    win.onbeforeunload = assignedBeforeUnload;

    reloadBrowserForAppUpdate({ bypassUnloadPrompt: true }, win);
    win.dispatchEvent(new Event("beforeunload"));

    expect(win.location.reload).toHaveBeenCalledTimes(1);
    expect(beforeUnload).not.toHaveBeenCalled();
    expect(win.onbeforeunload).toBe(assignedBeforeUnload);
  });
});

function createFakeWindow() {
  const target = new EventTarget();
  return {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    location: {
      reload: vi.fn(),
    },
    onbeforeunload: null,
  } as unknown as Window & { location: Location & { reload: ReturnType<typeof vi.fn> } };
}
