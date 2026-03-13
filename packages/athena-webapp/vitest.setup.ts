import "@testing-library/jest-dom";
import { vi, beforeEach } from "vitest";

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

if (typeof window !== "undefined") {
  Object.defineProperty(window, "print", {
    value: vi.fn(),
    writable: true,
  });

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

  const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  };
  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
  });

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
