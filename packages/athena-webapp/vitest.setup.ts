import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";
import { vi, beforeEach } from "vitest";

// Under the heavy parallel CI coverage run, the async effects behind
// `waitFor` / `findBy*` assertions can take longer than Testing Library's
// 1000ms default to settle, producing intermittent timeouts even though the
// assertion itself would pass (e.g. the POS local-sync runtime seeding a
// drawer through a chain of awaited store reads). Give async utilities more
// headroom in CI only; local runs keep the short default for fast feedback.
// `waitFor` still resolves as soon as its callback passes, so this does not
// slow the happy path — it only raises the ceiling before a timeout is
// declared.
if (process.env.CI) {
  configure({ asyncUtilTimeout: 5000 });
}

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
