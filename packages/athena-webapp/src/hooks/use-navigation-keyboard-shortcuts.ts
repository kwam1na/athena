import { useEffect } from "react";
import { useSearch } from "@tanstack/react-router";
import { useNavigateBack } from "./use-navigate-back";

const INTERACTIVE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function useNavigationKeyboardShortcuts() {
  const { o } = useSearch({ strict: false });
  const navigateBack = useNavigateBack();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const el = document.activeElement;
      if (
        el &&
        (INTERACTIVE_TAGS.has(el.tagName) ||
          (el as HTMLElement).isContentEditable)
      ) {
        return;
      }

      if (e.key === "[" && o) {
        e.preventDefault();
        navigateBack();
      } else if (e.key === "]") {
        e.preventDefault();
        window.history.forward();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [o, navigateBack]);
}
