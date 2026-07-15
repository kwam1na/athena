import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Id } from "~/convex/_generated/dataModel";
import {
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  ok,
  userError,
} from "~/shared/commandResult";
import { mapThrownError } from "~/src/lib/pos/application/results";

import { CashierAuthDialog } from "./CashierAuthDialog";

const mocks = vi.hoisted(() => ({
  createPosLocalStore: vi.fn(),
  hashPin: vi.fn(async (pin: string) => `hashed:${pin}`),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  useSharedDemoContext: vi.fn(),
  unwrapLocalStaffProofToken: vi.fn(
    async (): Promise<{ expiresAt: number; token: string } | null> => ({
      expiresAt: Date.now() + 10_000,
      token: "proof-token-1",
    }),
  ),
  useMutation: vi.fn(),
  verifyLocalPin: vi.fn(
    async (): Promise<
      | { ok: true }
      | {
          ok: false;
          reason: "invalid_pin" | "malformed_verifier" | "unsupported_verifier";
        }
    > => ({ ok: true }),
  ),
  wrapLocalStaffProofToken: vi.fn(async () => ({
    ciphertext: "wrapped-proof-token",
    expiresAt: Date.now() + 10_000,
    iv: "proof-iv",
  })),
}));

vi.mock("convex/react", () => ({
  useMutation: mocks.useMutation,
}));

vi.mock("@/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: mocks.useSharedDemoContext,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock("~/src/lib/security/pinHash", () => ({
  hashPin: mocks.hashPin,
}));

vi.mock("@/lib/security/localPinVerifier", () => ({
  unwrapLocalStaffProofToken: mocks.unwrapLocalStaffProofToken,
  verifyLocalPin: mocks.verifyLocalPin,
  wrapLocalStaffProofToken: mocks.wrapLocalStaffProofToken,
}));

vi.mock("@/lib/pos/infrastructure/local/posLocalStore", () => ({
  createIndexedDbPosLocalStorageAdapter: vi.fn(() => ({})),
  createPosLocalStore: mocks.createPosLocalStore,
}));

vi.mock("@/lib/pos/infrastructure/local/posLocalStorageRuntime", () => ({
  getDefaultPosLocalStore: mocks.createPosLocalStore,
}));

vi.mock("@/components/pos/PinInput", () => ({
  PinInput: ({
    disabled,
    onChange,
    onKeyDown,
    value,
  }: {
    disabled: boolean;
    onChange: (value: string) => void;
    onKeyDown?: (event: React.KeyboardEvent) => void;
    value: string;
  }) => (
    <input
      aria-label="PIN"
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
  ),
}));

vi.mock("../ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

const storeId = "store-1" as Id<"store">;
const terminalId = "terminal-1" as Id<"posTerminal">;
const staffProfileId = "staff-1" as Id<"staffProfile">;

function buildLocalAuthorityRecord(overrides = {}) {
  return {
    activeRoles: ["cashier"],
    credentialId: "credential-1",
    credentialVersion: 1,
    displayName: "Ama Mensah",
    expiresAt: Date.now() + 10_000,
    issuedAt: Date.now(),
    organizationId: "org-1",
    refreshedAt: Date.now(),
    staffProfileId,
    status: "active",
    storeId,
    terminalId,
    username: "frontdesk",
    verifier: {
      algorithm: "PBKDF2-SHA256",
      hash: "hash",
      iterations: 120000,
      salt: "salt",
      version: 1,
    },
    wrappedPosLocalStaffProof: {
      ciphertext: "wrapped-proof-token",
      expiresAt: Date.now() + 10_000,
      iv: "proof-iv",
    },
    ...overrides,
  };
}

function renderDialog({
  allowedRoles,
  authenticateMutation = vi.fn(),
  expireMutation = vi.fn(),
  refreshAuthorityMutation = vi.fn().mockResolvedValue(ok([])),
  presentation,
  restoredCashier,
  workflowMode,
}: {
  allowedRoles?: Array<"cashier" | "manager">;
  authenticateMutation?: ReturnType<typeof vi.fn>;
  expireMutation?: ReturnType<typeof vi.fn>;
  refreshAuthorityMutation?: ReturnType<typeof vi.fn>;
  presentation?: "dialog" | "inline";
  restoredCashier?: {
    displayName?: string | null;
    username: string;
  } | null;
  workflowMode?: "pos" | "expense";
} = {}) {
  mocks.useMutation.mockReset();
  let mutationCallCount = 0;
  mocks.useMutation.mockImplementation(() => {
    mutationCallCount += 1;

    if (mutationCallCount === 1) return authenticateMutation as never;
    if (mutationCallCount === 2) return refreshAuthorityMutation as never;
    return expireMutation as never;
  });

  const onAuthenticated = vi.fn();
  const onDismiss = vi.fn();

  render(
    <CashierAuthDialog
      allowedRoles={allowedRoles}
      open
      onAuthenticated={onAuthenticated}
      onDismiss={onDismiss}
      presentation={presentation}
      restoredCashier={restoredCashier}
      storeId={storeId}
      terminalId={terminalId}
      workflowMode={workflowMode}
    />,
  );

  return {
    authenticateMutation,
    expireMutation,
    onAuthenticated,
    onDismiss,
    user: userEvent.setup(),
  };
}

async function submitLockedCashierPin(
  user: ReturnType<typeof userEvent.setup>,
  pin = "1234",
) {
  await waitFor(() => expect(screen.getByLabelText(/pin/i)).toHaveFocus());
  await user.type(screen.getByLabelText(/pin/i), pin);
}

async function submitCredentials(
  user: ReturnType<typeof userEvent.setup>,
  {
    pin = "1234",
    username = "frontdesk",
  }: {
    pin?: string;
    username?: string;
  } = {},
) {
  await waitFor(() => expect(screen.getByLabelText(/username/i)).toHaveFocus());
  await user.type(screen.getByLabelText(/username/i), username);
  await user.type(screen.getByLabelText(/pin/i), pin);
}

describe("CashierAuthDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSharedDemoContext.mockReturnValue(null);
    mocks.createPosLocalStore.mockReturnValue({
      readStaffAuthorityForUsername: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      replaceStaffAuthoritySnapshot: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      upsertStaffAuthorityRecord: vi.fn(async ({ record }) => ({
        ok: true,
        value: record,
      })),
    });
    mocks.verifyLocalPin.mockResolvedValue({ ok: true });
    mocks.unwrapLocalStaffProofToken.mockResolvedValue({
      expiresAt: Date.now() + 10_000,
      token: "proof-token-1",
    });
    mocks.wrapLocalStaffProofToken.mockResolvedValue({
      ciphertext: "wrapped-proof-token",
      expiresAt: Date.now() + 10_000,
      iv: "proof-iv",
    });
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows demo manager and cashier credentials in the inline POS sign-in card", () => {
    mocks.useSharedDemoContext.mockReturnValue({ storeId });

    renderDialog({ presentation: "inline" });

    expect(screen.getByText("Demo staff sign-in")).toBeInTheDocument();
    expect(screen.getByText("kofi")).toBeInTheDocument();
    expect(screen.getByText("ama")).toBeInTheDocument();
    expect(screen.getByText("1111")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign out from other registers" }),
    ).not.toBeInTheDocument();
  });

  it("does not show demo manager credentials outside the demo store", () => {
    renderDialog({ presentation: "inline" });

    expect(screen.queryByText("Demo staff sign-in")).not.toBeInTheDocument();
  });

  it("restricts terminal authentication to the roles required by the action", async () => {
    const authenticateMutation = vi.fn().mockResolvedValue(
      ok({
        activeRoles: ["manager"],
        staffProfile: { fullName: "Kofi Mensah" },
        staffProfileId,
      }),
    );
    const { user } = renderDialog({
      allowedRoles: ["manager"],
      authenticateMutation,
    });

    await submitCredentials(user);

    await waitFor(() =>
      expect(authenticateMutation).toHaveBeenCalledWith({
        allowedRoles: ["manager"],
        allowActiveSessionsOnOtherTerminals: false,
        pinHash: "hashed:1234",
        storeId,
        terminalId,
        username: "frontdesk",
      }),
    );
  });

  it("shows safe authentication failure copy for invalid credentials", async () => {
    const authenticateMutation = vi.fn().mockResolvedValue(
      userError({
        code: "authentication_failed",
        message: "Invalid staff credentials.",
      }),
    );

    const { user, onAuthenticated } = renderDialog({ authenticateMutation });

    await submitCredentials(user);

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Sign-in details not recognized. Enter the username and PIN again.",
      ),
    );
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      expect.stringContaining("[CONVEX]"),
    );
  });

  it("shows safe precondition copy when another terminal is active", async () => {
    const authenticateMutation = vi.fn().mockResolvedValue(
      userError({
        code: "precondition_failed",
        message: "This staff member has an active session on another terminal.",
      }),
    );

    const { user, onAuthenticated } = renderDialog({ authenticateMutation });

    await submitCredentials(user);

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Sign-in already active on another terminal. Sign out there before starting here.",
      ),
    );
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("preserves local staff authority when an online refresh is refused", async () => {
    const replaceStaffAuthoritySnapshot = vi.fn(async () => ({
      ok: true,
      value: [],
    }));
    mocks.createPosLocalStore.mockReturnValue({
      readStaffAuthorityForUsername: vi.fn(async () => ({
        ok: true,
        value: buildLocalAuthorityRecord(),
      })),
      replaceStaffAuthoritySnapshot,
    });
    const refreshAuthorityMutation = vi.fn().mockResolvedValue(
      userError({
        code: "precondition_failed",
        message:
          "Staff sign-in list is too large to refresh safely. Contact support before using offline sign-in.",
      }),
    );

    renderDialog({ refreshAuthorityMutation });

    await waitFor(() =>
      expect(refreshAuthorityMutation).toHaveBeenCalledWith({
        storeId,
        terminalId,
      }),
    );
    expect(replaceStaffAuthoritySnapshot).not.toHaveBeenCalled();
  });

  it("does not show the session recovery action in expense mode", () => {
    const authenticateMutation = vi.fn();

    renderDialog({ authenticateMutation, workflowMode: "expense" });

    expect(
      screen.getByRole("heading", { name: "Sign in required" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign out from other sessions" }),
    ).not.toBeInTheDocument();
  });

  it("does not leave cashier sign-in pending when the browser is offline", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    const authenticateMutation = vi.fn();

    const { user, onAuthenticated } = renderDialog({ authenticateMutation });

    await submitCredentials(user);

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Staff list is not ready on this terminal. Reconnect once to refresh staff credentials.",
      ),
    );
    expect(authenticateMutation).not.toHaveBeenCalled();
    expect(onAuthenticated).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText(/pin/i)).toHaveValue(""));
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("stores the current cashier offline proof immediately after online sign-in", async () => {
    const upsertStaffAuthorityRecord = vi.fn(async ({ record }) => ({
      ok: true,
      value: record,
    }));
    mocks.createPosLocalStore.mockReturnValue({
      readStaffAuthorityForUsername: vi.fn(async () => ({
        ok: true,
        value: null,
      })),
      replaceStaffAuthoritySnapshot: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      upsertStaffAuthorityRecord,
    });
    const authenticateMutation = vi.fn(async () =>
      ok({
        activeRoles: ["cashier"],
        posLocalStaffAuthority: buildLocalAuthorityRecord({
          wrappedPosLocalStaffProof: undefined,
        }),
        posLocalStaffProof: {
          expiresAt: Date.now() + 10_000,
          token: "proof-token-1",
        },
        staffProfile: { fullName: "Ama Mensah" },
        staffProfileId,
      }),
    );

    const { user, onAuthenticated } = renderDialog({ authenticateMutation });

    await submitCredentials(user);

    await waitFor(() =>
      expect(upsertStaffAuthorityRecord).toHaveBeenCalledWith({
        record: expect.objectContaining({
          staffProfileId,
          wrappedPosLocalStaffProof: {
            ciphertext: "wrapped-proof-token",
            expiresAt: expect.any(Number),
            iv: "proof-iv",
          },
        }),
        storeId,
        terminalId,
      }),
    );
    expect(mocks.wrapLocalStaffProofToken).toHaveBeenCalledWith(
      expect.objectContaining({ algorithm: "PBKDF2-SHA256" }),
      "1234",
      expect.objectContaining({ token: "proof-token-1" }),
    );
    expect(onAuthenticated).toHaveBeenCalled();
  });

  it("authenticates a locally authorized cashier while offline", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    const readStaffAuthorityForUsername = vi.fn(async () => ({
      ok: true,
      value: buildLocalAuthorityRecord(),
    }));
    mocks.createPosLocalStore.mockReturnValue({
      readStaffAuthorityForUsername,
      replaceStaffAuthoritySnapshot: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      upsertStaffAuthorityRecord: vi.fn(async ({ record }) => ({
        ok: true,
        value: record,
      })),
    });
    const authenticateMutation = vi.fn();

    const { user, onAuthenticated } = renderDialog({ authenticateMutation });

    await submitCredentials(user);

    await waitFor(() =>
      expect(onAuthenticated).toHaveBeenCalledWith(
        expect.objectContaining({
          activeRoles: ["cashier"],
          posLocalStaffProof: {
            expiresAt: expect.any(Number),
            token: "proof-token-1",
          },
          staffProfileId,
        }),
      ),
    );
    expect(authenticateMutation).not.toHaveBeenCalled();
    expect(mocks.verifyLocalPin).toHaveBeenCalledWith(
      expect.objectContaining({ algorithm: "PBKDF2-SHA256" }),
      "1234",
    );
    expect(mocks.unwrapLocalStaffProofToken).toHaveBeenCalledWith(
      expect.objectContaining({ algorithm: "PBKDF2-SHA256" }),
      "1234",
      expect.objectContaining({ ciphertext: "wrapped-proof-token" }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Signed in as Ama Mensah");
  });

  it("does not use cached cashier authority for a manager-only offline action", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    mocks.createPosLocalStore.mockReturnValue({
      readStaffAuthorityForUsername: vi.fn(async () => ({
        ok: true,
        value: buildLocalAuthorityRecord({ activeRoles: ["cashier"] }),
      })),
      replaceStaffAuthoritySnapshot: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
    });
    const authenticateMutation = vi.fn();
    const { user, onAuthenticated } = renderDialog({
      allowedRoles: ["manager"],
      authenticateMutation,
    });

    await submitCredentials(user);

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Manager access is required for this action.",
      ),
    );
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(authenticateMutation).not.toHaveBeenCalled();
  });

  it("authenticates a locally authorized cashier offline before a proof has been wrapped", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    const readStaffAuthorityForUsername = vi.fn(async () => ({
      ok: true,
      value: buildLocalAuthorityRecord({
        wrappedPosLocalStaffProof: undefined,
      }),
    }));
    mocks.createPosLocalStore.mockReturnValue({
      readStaffAuthorityForUsername,
      replaceStaffAuthoritySnapshot: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      upsertStaffAuthorityRecord: vi.fn(async ({ record }) => ({
        ok: true,
        value: record,
      })),
    });
    const authenticateMutation = vi.fn();

    const { user, onAuthenticated } = renderDialog({ authenticateMutation });

    await submitCredentials(user);

    await waitFor(() =>
      expect(onAuthenticated).toHaveBeenCalledWith(
        expect.objectContaining({
          activeRoles: ["cashier"],
          localStaffAuthority: expect.objectContaining({
            staffProfileId,
            username: "frontdesk",
          }),
          staffProfileId,
        }),
      ),
    );
    expect(onAuthenticated.mock.calls[0][0]).not.toHaveProperty(
      "posLocalStaffProof",
    );
    expect(authenticateMutation).not.toHaveBeenCalled();
    expect(mocks.verifyLocalPin).toHaveBeenCalledWith(
      expect.objectContaining({ algorithm: "PBKDF2-SHA256" }),
      "1234",
    );
    expect(mocks.unwrapLocalStaffProofToken).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Signed in as Ama Mensah");
  });

  it("unlocks a restored cashier session with PIN only", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    const readStaffAuthorityForUsername = vi.fn(async () => ({
      ok: true,
      value: buildLocalAuthorityRecord(),
    }));
    mocks.createPosLocalStore.mockReturnValue({
      readStaffAuthorityForUsername,
      replaceStaffAuthoritySnapshot: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      upsertStaffAuthorityRecord: vi.fn(async ({ record }) => ({
        ok: true,
        value: record,
      })),
    });
    const { user, onAuthenticated } = renderDialog({
      restoredCashier: {
        displayName: "Ama Mensah",
        username: "frontdesk",
      },
    });

    await submitLockedCashierPin(user);

    await waitFor(() =>
      expect(onAuthenticated).toHaveBeenCalledWith(
        expect.objectContaining({
          staffProfileId,
        }),
      ),
    );
    expect(readStaffAuthorityForUsername).toHaveBeenCalledWith({
      storeId,
      terminalId,
      username: "frontdesk",
    });
  });

  it("lets a restored cashier session switch to a different cashier sign-in", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    const readStaffAuthorityForUsername = vi.fn(async () => ({
      ok: true,
      value: buildLocalAuthorityRecord(),
    }));
    mocks.createPosLocalStore.mockReturnValue({
      readStaffAuthorityForUsername,
      replaceStaffAuthoritySnapshot: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      upsertStaffAuthorityRecord: vi.fn(async ({ record }) => ({
        ok: true,
        value: record,
      })),
    });
    const { user, onAuthenticated } = renderDialog({
      restoredCashier: {
        displayName: "Ama Mensah",
        username: "frontdesk",
      },
    });

    expect(
      screen.getByRole("heading", { name: "Unlock cashier session" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ama Mensah")).toBeInTheDocument();
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign out from other registers" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Sign in as a different cashier" }),
    );

    expect(
      screen.getByRole("heading", { name: "Sign in required" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign out from other registers" }),
    ).not.toBeInTheDocument();

    const usernameInput = screen.getByLabelText(/username/i);
    await user.type(usernameInput, "frontdesk");
    await waitFor(() => expect(usernameInput).toHaveValue("frontdesk"));
    fireEvent.change(screen.getByLabelText(/pin/i), {
      target: { value: "1234" },
    });

    await waitFor(() =>
      expect(onAuthenticated).toHaveBeenCalledWith(
        expect.objectContaining({
          staffProfileId,
        }),
      ),
    );
    expect(readStaffAuthorityForUsername).toHaveBeenCalledWith({
      storeId,
      terminalId,
      username: "frontdesk",
    });
  });

  it("clears the PIN when local offline authority cannot be read", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    mocks.createPosLocalStore.mockReturnValue({
      readStaffAuthorityForUsername: vi.fn(async () => ({
        error: { code: "write_failed", message: "No local store" },
        ok: false,
      })),
      replaceStaffAuthoritySnapshot: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      upsertStaffAuthorityRecord: vi.fn(async ({ record }) => ({
        ok: true,
        value: record,
      })),
    });
    const authenticateMutation = vi.fn();

    const { user, onAuthenticated } = renderDialog({ authenticateMutation });

    await submitCredentials(user);

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Offline staff sign-in is unavailable. Reconnect, then try again.",
      ),
    );
    expect(authenticateMutation).not.toHaveBeenCalled();
    expect(onAuthenticated).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText(/pin/i)).toHaveValue(""));
  });

  it("clears the PIN when offline local PIN verification fails", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    mocks.verifyLocalPin.mockResolvedValue({
      ok: false,
      reason: "invalid_pin",
    });
    mocks.createPosLocalStore.mockReturnValue({
      readStaffAuthorityForUsername: vi.fn(async () => ({
        ok: true,
        value: buildLocalAuthorityRecord(),
      })),
      replaceStaffAuthoritySnapshot: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      upsertStaffAuthorityRecord: vi.fn(async ({ record }) => ({
        ok: true,
        value: record,
      })),
    });
    const authenticateMutation = vi.fn();

    const { user, onAuthenticated } = renderDialog({ authenticateMutation });

    await submitCredentials(user);

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Sign-in details not recognized. Enter the username and PIN again.",
      ),
    );
    expect(authenticateMutation).not.toHaveBeenCalled();
    expect(onAuthenticated).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText(/pin/i)).toHaveValue(""));
  });

  it("continues offline when a cached staff proof cannot be unwrapped", async () => {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });
    mocks.unwrapLocalStaffProofToken.mockResolvedValue(null);
    mocks.createPosLocalStore.mockReturnValue({
      readStaffAuthorityForUsername: vi.fn(async () => ({
        ok: true,
        value: buildLocalAuthorityRecord(),
      })),
      replaceStaffAuthoritySnapshot: vi.fn(async () => ({
        ok: true,
        value: [],
      })),
      upsertStaffAuthorityRecord: vi.fn(async ({ record }) => ({
        ok: true,
        value: record,
      })),
    });
    const authenticateMutation = vi.fn();

    const { user, onAuthenticated } = renderDialog({ authenticateMutation });

    await submitCredentials(user);

    await waitFor(() =>
      expect(onAuthenticated).toHaveBeenCalledWith(
        expect.objectContaining({
          activeRoles: ["cashier"],
          localStaffAuthority: expect.objectContaining({
            staffProfileId,
            username: "frontdesk",
          }),
          staffProfileId,
        }),
      ),
    );
    expect(authenticateMutation).not.toHaveBeenCalled();
    expect(onAuthenticated.mock.calls[0][0]).not.toHaveProperty(
      "posLocalStaffProof",
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Signed in as Ama Mensah");
  });

  it("collapses thrown faults to generic fallback copy and clears the PIN", async () => {
    const authenticateMutation = vi
      .fn()
      .mockRejectedValue(
        new Error("[CONVEX] raw backend details that should never be toasted"),
      );

    const { user, onAuthenticated } = renderDialog({ authenticateMutation });

    await submitCredentials(user);

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        GENERIC_UNEXPECTED_ERROR_MESSAGE,
      ),
    );
    await waitFor(() => expect(screen.getByLabelText(/pin/i)).toHaveValue(""));
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      expect.stringContaining("raw backend details"),
    );
  });

  it("still completes a successful cashier sign-in", async () => {
    const authenticateMutation = vi.fn().mockResolvedValue(
      ok({
        activeRoles: ["cashier"],
        credentialId: "credential-1",
        staffProfile: {
          firstName: "Ama",
          fullName: "Ama Mensah",
          lastName: "Mensah",
        },
        staffProfileId,
      }),
    );

    const { user, onAuthenticated } = renderDialog({ authenticateMutation });

    await submitCredentials(user);

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Signed in as Ama Mensah",
      ),
    );
    expect(onAuthenticated).toHaveBeenCalledWith(
      expect.objectContaining({ staffProfileId }),
    );
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

});

describe("mapThrownError", () => {
  it("uses the shared generic fallback copy for thrown faults", () => {
    expect(mapThrownError(new Error("database exploded"))).toEqual({
      ok: false,
      code: "unknown",
      message: GENERIC_UNEXPECTED_ERROR_MESSAGE,
    });
  });

  it("preserves known drawer conflict messages from wrapped Convex faults", () => {
    expect(
      mapThrownError(
        new Error(
          "Uncaught Error: A register session is already open for this register number",
        ),
      ),
    ).toEqual({
      ok: false,
      code: "conflict",
      message: "A register session is already open for this register number",
    });
  });
});
