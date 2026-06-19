import type { UpdateApplyOptions } from "./updateCoordinator";

type BeforeUnloadListener = Parameters<Window["addEventListener"]>[1];

type InstalledBypass = {
  listeners: Map<BeforeUnloadListener, Set<boolean>>;
  originalAddEventListener: Window["addEventListener"];
  originalRemoveEventListener: Window["removeEventListener"];
};

const installedByWindow = new WeakMap<Window, InstalledBypass>();

export function installAppUpdateUnloadPromptBypass(
  win: Window = window,
): void {
  if (installedByWindow.has(win)) {
    return;
  }

  const installed: InstalledBypass = {
    listeners: new Map(),
    originalAddEventListener: win.addEventListener,
    originalRemoveEventListener: win.removeEventListener,
  };
  installedByWindow.set(win, installed);

  Object.defineProperty(win, "addEventListener", {
    configurable: true,
    value(
      type: string,
      listener: BeforeUnloadListener,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "beforeunload" && listener) {
        const captures = installed.listeners.get(listener) ?? new Set<boolean>();
        captures.add(getCapture(options));
        installed.listeners.set(listener, captures);
      }
      return installed.originalAddEventListener.call(
        this,
        type,
        listener,
        options,
      );
    },
  });

  Object.defineProperty(win, "removeEventListener", {
    configurable: true,
    value(
      type: string,
      listener: BeforeUnloadListener,
      options?: boolean | EventListenerOptions,
    ) {
      if (type === "beforeunload" && listener) {
        const captures = installed.listeners.get(listener);
        if (captures) {
          captures.delete(getCapture(options));
          if (captures.size === 0) {
            installed.listeners.delete(listener);
          }
        }
      }
      return installed.originalRemoveEventListener.call(
        this,
        type,
        listener,
        options,
      );
    },
  });
}

export function reloadBrowserForAppUpdate(
  options: UpdateApplyOptions | undefined,
  win: Window = window,
): void {
  if (options?.bypassUnloadPrompt) {
    clearTrackedBeforeUnloadHandlers(win);
  }

  win.location.reload();
}

function clearTrackedBeforeUnloadHandlers(win: Window) {
  const installed = installedByWindow.get(win);
  if (installed) {
    for (const [listener, captures] of installed.listeners.entries()) {
      for (const capture of captures) {
        installed.originalRemoveEventListener.call(
          win,
          "beforeunload",
          listener,
          capture,
        );
      }
    }
    installed.listeners.clear();
  }
}

function getCapture(options?: boolean | EventListenerOptions): boolean {
  return typeof options === "boolean" ? options : Boolean(options?.capture);
}
