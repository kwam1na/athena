import { act, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import { ok, userError } from "~/shared/commandResult";
import {
  ManagerElevationProvider,
  useManagerElevation,
} from "./ManagerElevationContext";

const mocks = vi.hoisted(() => ({
  endManagerElevation: vi.fn(),
  startManagerElevation: vi.fn(),
  dialogProps: null as null | {
    onAuthenticate: (args: {
      mode: "authenticate" | "recover";
      pinHash: string;
      username: string;
    }) => Promise<unknown>;
    onAuthenticated: (result: {
      activeRoles?: string[];
      staffProfile: {
        firstName?: string | null;
        fullName?: string | null;
        lastName?: string | null;
      };
      staffProfileId: Id<"staffProfile">;
    }) => void;
    onDismiss: () => void;
    open: boolean;
  },
  useGetActiveStore: vi.fn(),
  useGetTerminal: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: mocks.useGetActiveStore,
}));

vi.mock("@/hooks/useGetTerminal", () => ({
  useGetTerminal: mocks.useGetTerminal,
}));

vi.mock("@/components/staff-auth/StaffAuthenticationDialog", () => ({
  StaffAuthenticationDialog: (props: NonNullable<typeof mocks.dialogProps>) => {
    mocks.dialogProps = props;
    return props.open ? <div data-testid="manager-elevation-dialog" /> : null;
  },
}));

const storeId = "store-1" as Id<"store">;
const terminalId = "terminal-1" as Id<"posTerminal">;
const elevationId = "elevation-1" as Id<"managerElevation">;
const managerId = "staff-manager-1" as Id<"staffProfile">;

function wrapper({ children }: { children: ReactNode }) {
  return <ManagerElevationProvider>{children}</ManagerElevationProvider>;
}

describe("ManagerElevationProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dialogProps = null;
    let mutationCallCount = 0;
    mocks.useMutation.mockImplementation(() => {
      mutationCallCount += 1;
      return mutationCallCount % 2 === 1
        ? mocks.startManagerElevation
        : mocks.endManagerElevation;
    });
    mocks.useQuery.mockReturnValue(null);
    mocks.useGetActiveStore.mockReturnValue({
      activeStore: { _id: storeId },
      isLoadingStores: false,
    });
    mocks.useGetTerminal.mockReturnValue({ _id: terminalId });
  });

  it("starts manager elevation with existing staff authentication and exposes the active manager", async () => {
    mocks.startManagerElevation.mockResolvedValue(
      ok({
        activeRoles: ["manager"],
        credentialId: "credential-1",
        elevationId,
        expiresAt: 456,
        staffProfile: {
          firstName: "Adjoa",
          fullName: "Adjoa Mensah",
          lastName: "Mensah",
        },
        staffProfileId: managerId,
      }),
    );

    const { result } = renderHook(() => useManagerElevation(), { wrapper });

    expect(result.current.activeElevation).toBeNull();

    act(() => result.current.startManagerElevation());

    expect(screen.getByTestId("manager-elevation-dialog")).toBeInTheDocument();

    const authResult = await mocks.dialogProps?.onAuthenticate({
      mode: "authenticate",
      pinHash: "pin-hash",
      username: "manager",
    });

    expect(mocks.startManagerElevation).toHaveBeenCalledWith({
      pinHash: "pin-hash",
      reason: "Manager elevation",
      storeId,
      terminalId,
      username: "manager",
    });
    expect(authResult).toEqual(
      ok({
        activeRoles: ["manager"],
        expiresAt: 456,
        staffProfile: {
          firstName: "Adjoa",
          fullName: "Adjoa Mensah",
          lastName: "Mensah",
        },
        staffProfileId: managerId,
      }),
    );

    act(() => {
      mocks.dialogProps?.onAuthenticated({
        activeRoles: ["manager"],
        staffProfile: {
          firstName: "Adjoa",
          fullName: "Adjoa Mensah",
          lastName: "Mensah",
        },
        staffProfileId: managerId,
      });
    });

    expect(result.current.activeElevation).toMatchObject({
      displayName: "Adjoa Mensah",
      elevationId,
      expiresAt: 456,
      staffProfileId: managerId,
    });
    expect(result.current.isManagerElevated).toBe(true);

    await act(async () => result.current.endManagerElevation());

    expect(result.current.activeElevation).toBeNull();
    expect(result.current.isManagerElevated).toBe(false);
    expect(mocks.endManagerElevation).toHaveBeenCalledWith({
      elevationId,
      storeId,
      terminalId,
    });
  });

  it("returns a command error instead of elevating when store or terminal context is missing", async () => {
    mocks.useGetActiveStore.mockReturnValue({
      activeStore: null,
      isLoadingStores: false,
    });

    const { result } = renderHook(() => useManagerElevation(), { wrapper });

    act(() => result.current.startManagerElevation());

    const authResult = await mocks.dialogProps?.onAuthenticate({
      mode: "authenticate",
      pinHash: "pin-hash",
      username: "manager",
    });

    expect(authResult).toEqual(
      userError({
        code: "precondition_failed",
        message:
          "Select a store and register this terminal before starting manager elevation.",
      }),
    );
    expect(mocks.startManagerElevation).not.toHaveBeenCalled();
  });

  it("requires the provider around consumers", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      expect(() => renderHook(() => useManagerElevation())).toThrow(
        "useManagerElevation must be used within a ManagerElevationProvider",
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
