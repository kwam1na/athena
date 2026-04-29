import { renderHook, waitFor } from "@testing-library/react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import { useExpenseStore } from "@/stores/expenseStore";
import { useExpenseRegisterViewModel } from "./useExpenseRegisterViewModel";

const mockCreateExpenseSession = vi.fn();
const mockNavigateBack = vi.fn();
const loadedSessionIds: string[] = [];
let mockActiveSessionQuery: {
  _id: Id<"expenseSession">;
  status: "active";
  expiresAt: number;
  sessionNumber: string;
  updatedAt: number;
  notes?: string;
  cartItems: Array<{
    _id: Id<"expenseSessionItem">;
    quantity: number;
    updatedAt: number;
  }>;
} | null;

vi.mock("convex/react", () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: {
      _id: "store-1" as Id<"store">,
      currency: "GHS",
    },
  }),
}));

vi.mock("@/hooks/useGetTerminal", () => ({
  useGetTerminal: () => ({
    _id: "terminal-1" as Id<"posTerminal">,
    displayName: "Front Counter",
    registerNumber: "1",
  }),
}));

vi.mock("@/hooks/use-navigate-back", () => ({
  useNavigateBack: () => mockNavigateBack,
}));

vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: (value: string) => value,
}));

vi.mock("@/hooks/usePOSProducts", () => ({
  usePOSBarcodeSearch: () => null,
  usePOSProductSearch: () => [],
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("useExpenseRegisterViewModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadedSessionIds.length = 0;
    useExpenseStore.getState().resetAll();
    useExpenseStore.getState().setCashier("staff-1" as Id<"staffProfile">);
    mockActiveSessionQuery = null;

    mockCreateExpenseSession.mockImplementation(async () => {
      const callCount = mockCreateExpenseSession.mock.calls.length;
      if (callCount >= 2) {
        mockActiveSessionQuery = {
          _id: "expense-session-1" as Id<"expenseSession">,
          status: "active",
          expiresAt: Date.now() + 60_000,
          sessionNumber: "EXP-0001",
          updatedAt: 100,
          cartItems: [],
        };
      }

      return {
        kind: "ok",
        data: {
          sessionId: "expense-session-1" as Id<"expenseSession">,
          expiresAt: Date.now() + 60_000,
        },
      };
    });
    vi.mocked(useMutation).mockReturnValue(mockCreateExpenseSession as never);
    vi.mocked(useQuery).mockImplementation(() => mockActiveSessionQuery);
  });

  it("does not auto-create duplicate sessions while the active-session query is still empty", async () => {
    const { rerender } = renderHook(() => useExpenseRegisterViewModel());

    await waitFor(() => {
      expect(mockCreateExpenseSession).toHaveBeenCalledTimes(1);
    });

    rerender();

    await waitFor(() => {
      expect(mockCreateExpenseSession).toHaveBeenCalledTimes(1);
    });
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("New expense session created");
  });

  it("loads an unchanged active session only once", async () => {
    useExpenseStore.setState((state) => ({
      ...state,
      loadSessionData: (session: { _id: Id<"expenseSession"> }) => {
        loadedSessionIds.push(session._id);
        useExpenseStore.setState((currentState) => ({
          ...currentState,
          session: {
            ...currentState.session,
            currentSessionId: session._id,
          },
        }));
      },
    }));
    mockActiveSessionQuery = {
      _id: "expense-session-1" as Id<"expenseSession">,
      status: "active",
      expiresAt: Date.now() + 60_000,
      sessionNumber: "EXP-0001",
      updatedAt: 100,
      cartItems: [],
    };

    const { rerender } = renderHook(() => useExpenseRegisterViewModel());

    await waitFor(() => {
      expect(loadedSessionIds).toEqual(["expense-session-1"]);
    });

    rerender();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadedSessionIds).toEqual(["expense-session-1"]);
  });

  it("identifies the cashier auth dialog as an expense session sign-in", () => {
    useExpenseStore.getState().clearCashier();

    const { result } = renderHook(() => useExpenseRegisterViewModel());

    expect(result.current.authDialog?.workflowMode).toBe("expense");
  });
});
