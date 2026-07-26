import { useRouterState } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ShellOverlay =
  | "desktop-menu"
  | "desktop-bag"
  | "mobile-menu"
  | "mobile-bag"
  | "mobile-filter";
export type ShellRouteState = {
  location: "homepage" | "shop" | "checkout" | "receipt";
  layout: "overlay" | "fixed";
  navigationVisible: boolean;
};
type ContextValue = {
  activeMenu: string | null;
  activeOverlay: ShellOverlay | null;
  appLocation: "homepage" | "shop" | "checkout" | null;
  navBarLayout: "sticky" | "fixed";
  routeState: ShellRouteState;
  openOverlay: (
    overlay: ShellOverlay,
    trigger?: HTMLElement | null,
    menu?: string | null,
  ) => void;
  closeOverlay: (options?: { restoreFocus?: boolean }) => void;
};
const Context = createContext<ContextValue | undefined>(undefined);
const locksScroll = (overlay: ShellOverlay | null) =>
  overlay === "mobile-menu" ||
  overlay === "mobile-bag" ||
  overlay === "mobile-filter";

export function deriveShellRouteState(pathname: string): ShellRouteState {
  if (pathname.startsWith("/shop/receipt/")) {
    return { location: "receipt", layout: "fixed", navigationVisible: false };
  }
  if (pathname.startsWith("/shop/checkout")) {
    return { location: "checkout", layout: "fixed", navigationVisible: true };
  }
  if (pathname === "/") {
    return { location: "homepage", layout: "overlay", navigationVisible: true };
  }
  return { location: "shop", layout: "fixed", navigationVisible: true };
}

export function NavigationBarStateProvider({
  children,
  pathname,
}: {
  children: ReactNode;
  pathname: string;
}) {
  const routeState = useMemo(() => deriveShellRouteState(pathname), [pathname]);
  const [activeOverlay, setActiveOverlay] = useState<ShellOverlay | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const closeOverlay = useCallback(
    ({ restoreFocus = true }: { restoreFocus?: boolean } = {}) => {
      const opener = trigger.current;
      setActiveOverlay(null);
      setActiveMenu(null);
      trigger.current = null;
      if (restoreFocus && opener?.isConnected) queueMicrotask(() => opener.focus());
    },
    [],
  );
  const openOverlay = useCallback(
    (
      overlay: ShellOverlay,
      opener?: HTMLElement | null,
      menu: string | null = null,
    ) => {
      trigger.current = opener ?? null;
      setActiveMenu(menu);
      setActiveOverlay(overlay);
    },
    [],
  );

  useEffect(() => closeOverlay({ restoreFocus: false }), [pathname, closeOverlay]);
  useEffect(() => {
    if (!locksScroll(activeOverlay)) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [activeOverlay]);

  const value = useMemo<ContextValue>(
    () => ({
      activeMenu,
      activeOverlay,
      appLocation:
        routeState.location === "receipt" ? null : routeState.location,
      navBarLayout: routeState.layout === "overlay" ? "sticky" : "fixed",
      routeState,
      openOverlay,
      closeOverlay,
    }),
    [activeMenu, activeOverlay, routeState, openOverlay, closeOverlay],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function NavigationBarProvider({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <NavigationBarStateProvider pathname={pathname}>
      {children}
    </NavigationBarStateProvider>
  );
}

export function useNavigationBarContext() {
  const context = useContext(Context);
  if (!context) {
    throw new Error(
      "useNavigationBarContext must be used within a NavigationBarProvider",
    );
  }
  return context;
}
