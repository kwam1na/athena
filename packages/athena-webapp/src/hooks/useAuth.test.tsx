import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOGGED_IN_USER_ID_KEY,
  PENDING_ATHENA_AUTH_SYNC_KEY,
} from "../lib/constants";
import { useAuth } from "./useAuth";
import { POS_SERVICE_AUTH_PRESENTATION_KEY } from "../components/auth/Login/posRecoveryFlow";

const mocked = vi.hoisted(() => ({
  useAuthToken: vi.fn(),
  useConvexAuth: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthToken: mocked.useAuthToken,
}));

vi.mock("convex/react", () => ({
  useConvexAuth: mocked.useConvexAuth,
  useQuery: mocked.useQuery,
}));

describe("useAuth", () => {
  beforeEach(() => {
    mocked.useAuthToken.mockReset();
    mocked.useConvexAuth.mockReset();
    mocked.useQuery.mockReset();
    mocked.useAuthToken.mockReturnValue(null);
    window.localStorage.clear();
    vi.mocked(window.localStorage.getItem).mockReset();
    vi.mocked(window.localStorage.setItem).mockReset();
    vi.mocked(window.localStorage.removeItem).mockReset();
    window.sessionStorage.clear();
    vi.mocked(window.sessionStorage.getItem).mockReset();
    vi.mocked(window.sessionStorage.removeItem).mockReset();
  });

  it("stays loading until the authenticated Convex user settles", () => {
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mocked.useQuery
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);

    const { result } = renderHook(() => useAuth());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.user).toBeUndefined();
  });

  it("advances the auth session epoch when the token changes for the same user", async () => {
    let token = "jwt-1";
    mocked.useAuthToken.mockImplementation(() => token);
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mocked.useQuery.mockImplementation((_ref, args) =>
      args === undefined ? { _id: "convex-user-1" } : { _id: "user-1" },
    );

    const { result, rerender } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.user?._id).toBe("user-1"));
    const initialEpoch = result.current.authSessionEpoch;

    token = "jwt-2";
    rerender();

    expect(result.current.authSessionEpoch).toBe(initialEpoch + 1);
    expect(result.current.user?._id).toBe("user-1");
  });

  it("clears stale local auth state when the Convex session is missing", async () => {
    vi.mocked(window.localStorage.getItem).mockReturnValue("user-1");
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mocked.useQuery.mockImplementation((_ref, args) => {
      if (args && typeof args === "object" && "id" in args) {
        return null;
      }

      return null;
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.user).toBeNull());

    expect(result.current.user).toBeNull();
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(
      LOGGED_IN_USER_ID_KEY,
    );
    expect(mocked.useQuery.mock.calls.at(-1)?.[1]).toBe("skip");
  });

  it("keeps loading while Convex re-establishes the backend session for a stored token", () => {
    vi.mocked(window.localStorage.getItem).mockReturnValue("user-1");
    mocked.useAuthToken.mockReturnValue("jwt-123");
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    mocked.useQuery.mockReturnValueOnce(undefined).mockReturnValueOnce(null);

    const { result } = renderHook(() => useAuth());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.user).toBeUndefined();
    expect(window.localStorage.removeItem).not.toHaveBeenCalled();
  });

  it("does not promote a stored token to an authenticated user before Convex confirms the session", async () => {
    vi.mocked(window.localStorage.getItem).mockReturnValue("user-1");
    mocked.useAuthToken.mockReturnValue("jwt-123");
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    mocked.useQuery.mockReturnValue(null);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).toBeNull();
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(
      LOGGED_IN_USER_ID_KEY,
    );
  });

  it("loads the Athena user when the Convex user query confirms a Safari-rehydrating token", async () => {
    vi.mocked(window.localStorage.getItem).mockReturnValue("user-1");
    mocked.useAuthToken.mockReturnValue("jwt-123");
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    mocked.useQuery.mockImplementation((_ref, args) => {
      if (args === undefined) {
        return {
          _id: "convex-user-1",
          email: "manager@example.com",
        };
      }

      if (args && typeof args === "object" && Object.keys(args).length === 0) {
        return {
          _id: "user-1",
          email: "manager@example.com",
        };
      }

      return null;
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).toMatchObject({
      _id: "user-1",
      email: "manager@example.com",
    });
    expect(window.localStorage.removeItem).not.toHaveBeenCalled();
  });

  it("loads the Athena user from the authenticated Convex session when local storage is missing", async () => {
    vi.mocked(window.localStorage.getItem).mockReturnValue(null);
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mocked.useQuery.mockImplementation((_ref, args) => {
      if (args && typeof args === "object" && "id" in args) {
        return null;
      }

      if (args && typeof args === "object" && Object.keys(args).length === 0) {
        return {
          _id: "user-1",
          email: "manager@example.com",
        };
      }

      return {
        _id: "convex-user-1",
        email: "manager@example.com",
      };
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).toMatchObject({
      _id: "user-1",
      email: "manager@example.com",
    });
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      LOGGED_IN_USER_ID_KEY,
      "user-1",
    );
  });

  it("loads the Athena user once the Convex session is ready", async () => {
    vi.mocked(window.localStorage.getItem).mockReturnValue("user-1");
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mocked.useQuery.mockImplementation((_ref, args) => {
      if (args && typeof args === "object" && Object.keys(args).length === 0) {
        return {
          _id: "user-1",
          email: "manager@example.com",
        };
      }

      return {
        _id: "convex-user-1",
        email: "manager@example.com",
      };
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user).toMatchObject({
      _id: "user-1",
      email: "manager@example.com",
    });
    expect(mocked.useQuery.mock.calls.at(-1)?.[1]).toEqual({});
  });

  it("presents an activated service session without querying or storing a human user", async () => {
    vi.mocked(window.localStorage.getItem).mockReturnValue("stale-human-user");
    vi.mocked(window.sessionStorage.getItem).mockImplementation((key) =>
      key === POS_SERVICE_AUTH_PRESENTATION_KEY
        ? JSON.stringify({
            kind: "active",
            redirectTo: "/wigclub/store/wigclub/pos/register",
            startedAt: Date.now(),
          })
        : null,
    );
    mocked.useAuthToken.mockReturnValue("service-jwt");
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mocked.useQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.actorKind).toBe("service_principal");
    expect(result.current.user).toBeNull();
    expect(mocked.useQuery.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocked.useQuery.mock.calls.every((call) => call[1] === "skip")).toBe(
      true,
    );
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(
      LOGGED_IN_USER_ID_KEY,
    );
  });

  it("clears an active service presentation after Auth definitively expires", async () => {
    let presentation: string | null = JSON.stringify({
        kind: "active",
        redirectTo: "/wigclub/store/wigclub/pos/register",
        startedAt: Date.now(),
      });
    vi.mocked(window.sessionStorage.getItem).mockImplementation((key) =>
      key === POS_SERVICE_AUTH_PRESENTATION_KEY ? presentation : null,
    );
    vi.mocked(window.sessionStorage.removeItem).mockImplementation((key) => {
      if (key === POS_SERVICE_AUTH_PRESENTATION_KEY) presentation = null;
    });
    const authState = {
      isAuthenticated: false,
      isLoading: true,
    };
    mocked.useAuthToken.mockReturnValue(null);
    mocked.useConvexAuth.mockImplementation(() => authState);
    mocked.useQuery.mockReturnValue(null);

    const { result, rerender } = renderHook(() => useAuth());

    expect(window.sessionStorage.removeItem).not.toHaveBeenCalledWith(
      POS_SERVICE_AUTH_PRESENTATION_KEY,
    );
    authState.isLoading = false;
    rerender();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.actorKind).toBeNull();
    expect(result.current.user).toBeNull();
    expect(window.sessionStorage.removeItem).toHaveBeenCalledWith(
      POS_SERVICE_AUTH_PRESENTATION_KEY,
    );
  });

  it("preserves pending service handoff metadata while the root provider is unauthenticated", () => {
    vi.mocked(window.sessionStorage.getItem).mockImplementation((key) =>
      key === POS_SERVICE_AUTH_PRESENTATION_KEY
        ? JSON.stringify({
            kind: "pending",
            redirectTo: "/wigclub/store/wigclub/pos/register",
            startedAt: Date.now(),
          })
        : null,
    );
    mocked.useAuthToken.mockReturnValue(null);
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    mocked.useQuery.mockReturnValue(null);

    const { result } = renderHook(() => useAuth());

    expect(result.current.isLoading).toBe(true);
    expect(window.sessionStorage.removeItem).not.toHaveBeenCalledWith(
      POS_SERVICE_AUTH_PRESENTATION_KEY,
    );
  });

  it("treats fresh pending auth sync as loading while the Convex session is settling", () => {
    vi.mocked(window.sessionStorage.getItem).mockImplementation((key) =>
      key === PENDING_ATHENA_AUTH_SYNC_KEY
        ? JSON.stringify({ startedAt: Date.now(), redirectTo: "/" })
        : null,
    );
    mocked.useAuthToken.mockReturnValue(null);
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    mocked.useQuery.mockReturnValue(null);

    const { result } = renderHook(() => useAuth());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.user).toBeUndefined();
    expect(window.sessionStorage.removeItem).not.toHaveBeenCalled();
  });

  it("fails closed for stale pending auth sync metadata", async () => {
    vi.mocked(window.sessionStorage.getItem).mockImplementation((key) =>
      key === PENDING_ATHENA_AUTH_SYNC_KEY
        ? JSON.stringify({ startedAt: 1, redirectTo: "/" })
        : null,
    );
    mocked.useAuthToken.mockReturnValue(null);
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    mocked.useQuery.mockReturnValue(null);

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(window.sessionStorage.removeItem).toHaveBeenCalledWith(
      PENDING_ATHENA_AUTH_SYNC_KEY,
    );
  });
});
