import {
  createContext,
  type Dispatch,
  type SetStateAction,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

type AppShellFullscreenContextValue = {
  setFullscreenOverride: Dispatch<SetStateAction<boolean | null>>;
};

export const AppShellFullscreenContext =
  createContext<AppShellFullscreenContextValue | null>(null);

function isEditableKeyboardTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function useAppShellFullscreenMode() {
  const context = useContext(AppShellFullscreenContext);
  const setFullscreenOverrideRef = useRef(context?.setFullscreenOverride);
  const useBrowserLayoutEffect =
    typeof window === "undefined" ? useEffect : useLayoutEffect;

  useEffect(() => {
    setFullscreenOverrideRef.current = context?.setFullscreenOverride;
  }, [context?.setFullscreenOverride]);

  useBrowserLayoutEffect(() => {
    setFullscreenOverrideRef.current?.(null);

    const handleToggleFullscreen = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "f" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        isEditableKeyboardTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      setFullscreenOverrideRef.current?.((current) =>
        current === null ? false : !current,
      );
    };

    document.addEventListener("keydown", handleToggleFullscreen);

    return () => {
      document.removeEventListener("keydown", handleToggleFullscreen);
      setFullscreenOverrideRef.current?.(null);
    };
  }, []);
}
