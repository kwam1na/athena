import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";
import { vi, beforeEach } from "vitest";

// Under a heavy parallel coverage run, the async effects behind `waitFor` /
// `findBy*` assertions can take longer than Testing Library's 1000ms default
// to settle, producing intermittent timeouts even though the assertion itself
// would pass (e.g. the POS local-sync runtime seeding a drawer through a chain
// of awaited store reads).
//
// This headroom is deliberately not gated on `process.env.CI`. The load that
// causes the timeout comes from running the full suite in parallel, which the
// local `pr:athena` gate does too — gating on CI left the local gate running
// the same 661-file coverage sweep on the unextended 1000ms default, so it
// flaked (observed: 1023ms, a hair over the ceiling) on runs that were green
// in CI. Tying the fix to the environment variable rather than to the actual
// cause made the gate less reliable than the CI it was meant to mirror.
//
// `waitFor` resolves as soon as its callback passes, so this does not slow the
// happy path; it only raises the ceiling before a timeout is declared. The
// cost is that a genuinely failing async assertion takes up to 5s to report
// instead of 1s.
configure({ asyncUtilTimeout: 5000 });

// Mock toast notifications
vi.mock("react-hot-toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
  },
}));

// Mock Convex hooks
vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  useAction: vi.fn(),
}));

// framer-motion: render `motion.*` as plain, prop-forwarding elements. Entrance
// animations never advance under jsdom, so a real `initial={{ opacity: 0 }}`
// would leave content at opacity 0 and fail `toBeVisible()` assertions. Only
// `motion` is overridden — AnimatePresence, hooks, and every other export stay
// real — and framer-only props are stripped so no animation styling leaks onto
// the DOM node.
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  const React = await import("react");
  const FRAMER_ONLY_PROPS = new Set([
    "initial", "animate", "exit", "transition", "variants", "custom",
    "whileHover", "whileTap", "whileFocus", "whileInView", "whileDrag",
    "drag", "dragConstraints", "dragElastic", "dragMomentum", "dragSnapToOrigin",
    "layout", "layoutId", "layoutScroll", "layoutDependency", "layoutRoot",
    "onAnimationStart", "onAnimationComplete", "onUpdate", "viewport",
    "onHoverStart", "onHoverEnd", "onTap", "onTapStart", "onTapCancel",
    "onDragStart", "onDragEnd", "onDrag", "onDirectionLock",
  ]);
  const build = (tag: unknown) =>
    React.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<unknown>) => {
        const clean: Record<string, unknown> = {};
        for (const key of Object.keys(props)) {
          if (!FRAMER_ONLY_PROPS.has(key)) clean[key] = props[key];
        }
        return React.createElement(tag as never, { ...clean, ref });
      },
    );
  // Cache one component per tag/component. JSX reads `motion.div` on every
  // render, so returning a fresh component each time would give React a new
  // type and remount the whole subtree — wiping input focus and value.
  const cache = new Map<unknown, React.ElementType>();
  const forward = (tag: unknown) => {
    let component = cache.get(tag);
    if (!component) {
      component = build(tag);
      cache.set(tag, component);
    }
    return component;
  };
  const motion = new Proxy(function () {}, {
    // motion.div / motion.button / …
    get: (_target, tag) => forward(String(tag)),
    // motion(SomeComponent)
    apply: (_target, _thisArg, args: unknown[]) => forward(args[0]),
  }) as unknown as typeof actual.motion;
  return { ...actual, motion };
});

// Only run browser-specific mocks when a window object exists (e.g. jsdom).
if (typeof window !== "undefined") {
  // jsdom has no layout engine, so ResizeObserver is absent and
  // getBoundingClientRect reports 0×0. Recharts' ResponsiveContainer measures
  // its box that way and, finding 0×0, renders the chart at zero size and logs
  // "The width(0) and height(0) of chart should be greater than 0". Provide a
  // ResizeObserver that reports a fixed non-zero box on observe() so the
  // container adopts a real size and the chart renders (and stays silent).
  const RESIZE_BOX = { width: 800, height: 600 } as const;
  class ResizeObserverStub implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const contentRect = {
        ...RESIZE_BOX,
        top: 0,
        left: 0,
        right: RESIZE_BOX.width,
        bottom: RESIZE_BOX.height,
        x: 0,
        y: 0,
        toJSON() {},
      } as DOMRectReadOnly;
      this.callback(
        [{ target, contentRect } as ResizeObserverEntry],
        this,
      );
    }
    unobserve() {}
    disconnect() {}
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = ResizeObserverStub;
  }

  const pointerCaptureStub = () => false;
  const pointerReleaseStub = () => undefined;

  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = pointerCaptureStub;
  }

  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = pointerReleaseStub;
  }

  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = pointerReleaseStub;
  }

  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = pointerReleaseStub;
  }

  // Mock window.print for receipt printing tests
  Object.defineProperty(window, "print", {
    value: vi.fn(),
    writable: true,
  });

  // Mock window.open for print window tests
  Object.defineProperty(window, "open", {
    value: vi.fn(() => ({
      document: {
        write: vi.fn(),
        close: vi.fn(),
      },
      print: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      closed: false,
    })),
    writable: true,
  });

  // Mock localStorage
  const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  };
  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
  });

  // Mock sessionStorage
  const sessionStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  };
  Object.defineProperty(window, "sessionStorage", {
    value: sessionStorageMock,
  });
}

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});
