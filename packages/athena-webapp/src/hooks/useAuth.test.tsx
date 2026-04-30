import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LOGGED_IN_USER_ID_KEY } from "../lib/constants";
import { useAuth } from "./useAuth";

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
      LOGGED_IN_USER_ID_KEY
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
    mocked.useQuery
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(null);

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
      LOGGED_IN_USER_ID_KEY
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

      if (
        args &&
        typeof args === "object" &&
        Object.keys(args).length === 0
      ) {
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

      if (
        args &&
        typeof args === "object" &&
        Object.keys(args).length === 0
      ) {
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
      "user-1"
    );
  });

  it("loads the Athena user once the Convex session is ready", async () => {
    vi.mocked(window.localStorage.getItem).mockReturnValue("user-1");
    mocked.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mocked.useQuery.mockImplementation((_ref, args) => {
      if (
        args &&
        typeof args === "object" &&
        Object.keys(args).length === 0
      ) {
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
});
