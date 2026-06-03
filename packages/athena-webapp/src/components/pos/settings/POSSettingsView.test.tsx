import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  generateBrowserFingerprint: vi.fn(),
  registerTerminalMutation: vi.fn(),
  rotateRecoveryCode: vi.fn(),
  revokeRecoveryCode: vi.fn(),
  unlockRecoveryCode: vi.fn(),
  useMutation: vi.fn(),
  usePermissions: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({ activeStore: { _id: "store-1" } }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: mocks.usePermissions,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
    ...props
  }: {
    children?: ReactNode;
    params?: { orgUrlSlug: string; storeUrlSlug: string };
    to?: string;
  }) => (
    <a
      href={
        to
          ?.replace("$orgUrlSlug", params?.orgUrlSlug ?? "")
          .replace("$storeUrlSlug", params?.storeUrlSlug ?? "") ?? "#"
      }
      {...props}
    >
      {children}
    </a>
  ),
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    inventory: { posTerminal: {} },
    pos: {
      public: {
        posRecoveryCodes: {
          getRecoveryCodeStatus: "getRecoveryCodeStatus",
          rotateRecoveryCode: "rotateRecoveryCode",
          revokeRecoveryCode: "revokeRecoveryCode",
          unlockRecoveryCode: "unlockRecoveryCode",
        },
      },
    },
  },
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: (props: LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props} />
  ),
}));

vi.mock("@/components/ui/loading-button", () => ({
  LoadingButton: ({
    children,
    isLoading,
    variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    isLoading?: boolean;
    variant?: string;
  }) => {
    void isLoading;
    void variant;

    return <button {...props}>{children}</button>;
  },
}));

vi.mock("@/lib/browserFingerprint", () => ({
  generateBrowserFingerprint: mocks.generateBrowserFingerprint,
}));

vi.mock("../../common/FadeIn", () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../common/PageLevelHeader", () => ({
  PageLevelHeader: () => null,
  PageWorkspace: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../../View", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { registerAndProvisionPosTerminal } from "@/lib/pos/application/registerAndProvisionPosTerminal";
import { POSSettingsView } from "./POSSettingsView";

describe("registerAndProvisionPosTerminal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    mocks.rotateRecoveryCode.mockResolvedValue({
      code: "abc123-def456",
      credential: { status: "active" },
    });
    mocks.revokeRecoveryCode.mockResolvedValue({ status: "revoked" });
    mocks.unlockRecoveryCode.mockResolvedValue({ status: "active" });
    mocks.useMutation.mockImplementation((ref) => {
      if (ref === "rotateRecoveryCode") return mocks.rotateRecoveryCode;
      if (ref === "revokeRecoveryCode") return mocks.revokeRecoveryCode;
      if (ref === "unlockRecoveryCode") return mocks.unlockRecoveryCode;
      return mocks.registerTerminalMutation;
    });
    mocks.usePermissions.mockReturnValue({
      hasFullAdminAccess: true,
      isLoading: false,
    });
    mocks.useQuery.mockImplementation((ref) =>
      ref === "getRecoveryCodeStatus"
        ? {
            failedAttemptCount: 0,
            lastUsedAt: undefined,
            lockedUntil: undefined,
            rotatedAt: 1,
            status: "active",
          }
        : null,
    );
    mocks.generateBrowserFingerprint.mockResolvedValue({
      browserInfo: { userAgent: "test" },
      fingerprintHash: "fingerprint-1",
    });
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        getRandomValues: (bytes: Uint8Array) => {
          bytes.fill(7);
          return bytes;
        },
        subtle: {
          digest: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
        },
      },
    });
  });

  it("registers a typed terminal setup from the browser form", async () => {
    const user = userEvent.setup();
    const writeProvisionedTerminalSeed = vi.fn(async () => ({
      ok: true,
      value: null,
    }));
    mocks.registerTerminalMutation.mockImplementation(async (args) => ({
      kind: "ok" as const,
      data: {
        _id: "terminal-1",
        _creationTime: 1,
        browserInfo: args.browserInfo,
        displayName: args.displayName,
        fingerprintHash: args.fingerprintHash,
        registeredAt: 1,
        registeredByUserId: "user-1",
        registerNumber: args.registerNumber,
        status: "active",
        storeId: args.storeId,
        syncSecretHash: args.syncSecretHash,
      },
    }));

    render(
      <POSSettingsView
        storeFactory={() =>
          ({
            writeProvisionedTerminalSeed,
          }) as never
        }
      />,
    );

    await screen.findByLabelText("Terminal name");
    await user.type(screen.getByLabelText("Terminal name"), "  Front counter  ");
    await user.type(screen.getByLabelText("Register number"), "  7  ");
    await user.click(
      await screen.findByRole("button", { name: "Register terminal" }),
    );

    await waitFor(() =>
      expect(mocks.registerTerminalMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "Front counter",
          fingerprintHash: "fingerprint-1",
          registerNumber: "7",
          storeId: "store-1",
        }),
      ),
    );
    expect(writeProvisionedTerminalSeed).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudTerminalId: "terminal-1",
        registerNumber: "7",
        syncSecretHash: "01020304",
        terminalId: "fingerprint-1",
      }),
    );
  });

  it("saves existing terminal settings through the locked register setup", async () => {
    const user = userEvent.setup();
    const writeProvisionedTerminalSeed = vi.fn(async () => ({
      ok: true,
      value: null,
    }));
    mocks.useQuery.mockReturnValue({
      _id: "terminal-existing",
      _creationTime: 1,
      browserInfo: { userAgent: "test" },
      displayName: "Front counter",
      fingerprintHash: "fingerprint-1",
      registeredAt: 1,
      registeredByUserId: "user-1",
      registerNumber: "3",
      status: "active",
      storeId: "store-1",
    });
    mocks.registerTerminalMutation.mockImplementation(async (args) => ({
      kind: "ok" as const,
      data: {
        _id: "terminal-existing",
        _creationTime: 1,
        browserInfo: args.browserInfo,
        displayName: args.displayName,
        fingerprintHash: args.fingerprintHash,
        registeredAt: 1,
        registeredByUserId: "user-1",
        registerNumber: args.registerNumber,
        status: "active",
        storeId: args.storeId,
        syncSecretHash: args.syncSecretHash,
      },
    }));

    render(
      <POSSettingsView
        storeFactory={() =>
          ({
            writeProvisionedTerminalSeed,
          }) as never
        }
      />,
    );

    await screen.findByDisplayValue("Front counter");
    await user.clear(screen.getByLabelText("Terminal name"));
    await user.type(screen.getByLabelText("Terminal name"), "  Front desk  ");
    await user.click(
      await screen.findByRole("button", { name: "Save terminal settings" }),
    );

    await waitFor(() =>
      expect(mocks.registerTerminalMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "Front desk",
          fingerprintHash: "fingerprint-1",
          registerNumber: "3",
          storeId: "store-1",
        }),
      ),
    );
    expect(writeProvisionedTerminalSeed).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudTerminalId: "terminal-existing",
        registerNumber: "3",
        syncSecretHash: "01020304",
        terminalId: "fingerprint-1",
      }),
    );
  });

  it("lets full admins rotate the POS recovery code and shows plaintext once", async () => {
    const user = userEvent.setup();

    render(<POSSettingsView />);

    await user.click(
      await screen.findByRole("button", { name: /rotate recovery code/i }),
    );

    await waitFor(() =>
      expect(mocks.rotateRecoveryCode).toHaveBeenCalledWith({
        storeId: "store-1",
      }),
    );
    expect(screen.getByText("abc123-def456")).toBeInTheDocument();
  });

  it("lets full admins unlock a locked POS recovery code", async () => {
    const user = userEvent.setup();
    mocks.useQuery.mockImplementation((ref) =>
      ref === "getRecoveryCodeStatus"
        ? {
            failedAttemptCount: 5,
            lastUsedAt: undefined,
            lockedUntil: Date.now() + 60_000,
            rotatedAt: 1,
            status: "locked",
          }
        : null,
    );

    render(<POSSettingsView />);

    await user.click(await screen.findByRole("button", { name: /unlock/i }));

    await waitFor(() =>
      expect(mocks.unlockRecoveryCode).toHaveBeenCalledWith({
        storeId: "store-1",
      }),
    );
  });

  it("lets full admins revoke an active POS recovery code", async () => {
    const user = userEvent.setup();

    render(<POSSettingsView />);

    await user.click(await screen.findByRole("button", { name: /revoke/i }));

    await waitFor(() =>
      expect(mocks.revokeRecoveryCode).toHaveBeenCalledWith({
        storeId: "store-1",
      }),
    );
  });

  it("disables revoke for revoked POS recovery codes", async () => {
    mocks.useQuery.mockImplementation((ref) =>
      ref === "getRecoveryCodeStatus"
        ? {
            failedAttemptCount: 0,
            lastUsedAt: undefined,
            lockedUntil: undefined,
            rotatedAt: 1,
            status: "revoked",
          }
        : null,
    );

    render(<POSSettingsView />);

    expect(await screen.findByRole("button", { name: /revoke/i })).toBeDisabled();
  });

  it("hides recovery-code management from non-full-admin accounts", async () => {
    mocks.usePermissions.mockReturnValue({
      hasFullAdminAccess: false,
      isLoading: false,
    });

    render(<POSSettingsView />);

    expect(screen.queryByText("POS recovery code")).not.toBeInTheDocument();
    expect(mocks.useQuery).toHaveBeenCalledWith(
      "getRecoveryCodeStatus",
      "skip",
    );
  });

  it("hands off roster and support work to terminal health", async () => {
    render(<POSSettingsView />);

    expect(await screen.findByText("Terminal health")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This settings page only changes the current checkout station.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open terminal health" }),
    ).toHaveAttribute("href", "/acme/store/downtown/pos/terminals");
  });

  it("sends an independent sync secret and writes it into the local terminal seed", async () => {
    const registerTerminalMutation = vi.fn(async (args) => ({
      kind: "ok" as const,
      data: {
        _id: "terminal-1" as never,
        _creationTime: 1,
        browserInfo: args.browserInfo,
        displayName: args.displayName,
        fingerprintHash: args.fingerprintHash,
        registeredAt: 1,
        registeredByUserId: "user-1" as never,
        registerNumber: args.registerNumber,
        status: "active" as const,
        storeId: args.storeId as never,
        syncSecretHash: args.syncSecretHash,
      },
    }));
    const writeProvisionedTerminalSeed = vi.fn(async () => ({
      ok: true,
      value: null,
    }));

    await registerAndProvisionPosTerminal({
      activeStoreId: "store-1" as never,
      browserInfo: { userAgent: "test" },
      displayName: "Front register",
      fingerprintHash: "fingerprint-1",
      now: () => 123,
      registerNumber: "1",
      registerTerminalMutation,
      storeFactory: () =>
        ({
          writeProvisionedTerminalSeed,
        }) as never,
    });

    expect(registerTerminalMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprintHash: "fingerprint-1",
        syncSecretHash: "01020304",
      }),
    );
    expect(writeProvisionedTerminalSeed).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudTerminalId: "terminal-1",
        provisionedAt: 123,
        syncSecretHash: "01020304",
        terminalId: "fingerprint-1",
      }),
    );
  });

  it("uses the generated sync secret when registration omits the optional secret", async () => {
    const registerTerminalMutation = vi.fn(async (args) => ({
      kind: "ok" as const,
      data: {
        _id: "terminal-1" as never,
        _creationTime: 1,
        browserInfo: args.browserInfo,
        displayName: args.displayName,
        fingerprintHash: args.fingerprintHash,
        registeredAt: 1,
        registeredByUserId: "user-1" as never,
        registerNumber: args.registerNumber,
        status: "active" as const,
        storeId: args.storeId as never,
      },
    }));
    const writeProvisionedTerminalSeed = vi.fn(async () => ({
      ok: true,
      value: null,
    }));

    await registerAndProvisionPosTerminal({
      activeStoreId: "store-1" as never,
      browserInfo: { userAgent: "test" },
      displayName: "Front register",
      fingerprintHash: "fingerprint-1",
      now: () => 123,
      registerNumber: "1",
      registerTerminalMutation,
      storeFactory: () =>
        ({
          writeProvisionedTerminalSeed,
        }) as never,
    });

    expect(registerTerminalMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        syncSecretHash: "01020304",
      }),
    );
    expect(writeProvisionedTerminalSeed).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudTerminalId: "terminal-1",
        syncSecretHash: "01020304",
      }),
    );
  });

  it("uses the atomic terminal seed repair path when the local store supports it", async () => {
    const registerTerminalMutation = vi.fn(async (args) => ({
      kind: "ok" as const,
      data: {
        _id: "terminal-1" as never,
        _creationTime: 1,
        browserInfo: args.browserInfo,
        displayName: args.displayName,
        fingerprintHash: args.fingerprintHash,
        registeredAt: 1,
        registeredByUserId: "user-1" as never,
        registerNumber: args.registerNumber,
        status: "active" as const,
        storeId: args.storeId as never,
        syncSecretHash: args.syncSecretHash,
      },
    }));
    const writeProvisionedTerminalSeed = vi.fn(async () => ({
      ok: true,
      value: null,
    }));
    const writeProvisionedTerminalSeedAndClearTerminalIntegrity = vi.fn(
      async () => ({
        ok: true,
        value: null,
      }),
    );

    await registerAndProvisionPosTerminal({
      activeStoreId: "store-1" as never,
      browserInfo: { userAgent: "test" },
      displayName: "Front register",
      fingerprintHash: "fingerprint-1",
      now: () => 123,
      registerNumber: "1",
      registerTerminalMutation,
      storeFactory: () =>
        ({
          writeProvisionedTerminalSeed,
          writeProvisionedTerminalSeedAndClearTerminalIntegrity,
        }) as never,
    });

    expect(writeProvisionedTerminalSeedAndClearTerminalIntegrity).toHaveBeenCalledWith({
      seed: expect.objectContaining({
        cloudTerminalId: "terminal-1",
        syncSecretHash: "01020304",
        terminalId: "fingerprint-1",
      }),
      terminalIntegrity: {
        storeId: "store-1",
        terminalId: "fingerprint-1",
      },
    });
    expect(writeProvisionedTerminalSeed).not.toHaveBeenCalled();
  });

  it("clears terminal integrity after fallback terminal seed repair", async () => {
    const registerTerminalMutation = vi.fn(async (args) => ({
      kind: "ok" as const,
      data: {
        _id: "terminal-1" as never,
        _creationTime: 1,
        browserInfo: args.browserInfo,
        displayName: args.displayName,
        fingerprintHash: args.fingerprintHash,
        registeredAt: 1,
        registeredByUserId: "user-1" as never,
        registerNumber: args.registerNumber,
        status: "active" as const,
        storeId: args.storeId as never,
        syncSecretHash: args.syncSecretHash,
      },
    }));
    const writeProvisionedTerminalSeed = vi.fn(async () => ({
      ok: true,
      value: null,
    }));
    const clearTerminalIntegrityState = vi.fn(async () => ({
      ok: true,
      value: null,
    }));

    await registerAndProvisionPosTerminal({
      activeStoreId: "store-1" as never,
      browserInfo: { userAgent: "test" },
      displayName: "Front register",
      fingerprintHash: "fingerprint-1",
      now: () => 123,
      registerNumber: "1",
      registerTerminalMutation,
      storeFactory: () =>
        ({
          clearTerminalIntegrityState,
          writeProvisionedTerminalSeed,
        }) as never,
    });

    expect(writeProvisionedTerminalSeed).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudTerminalId: "terminal-1",
        syncSecretHash: "01020304",
        terminalId: "fingerprint-1",
      }),
    );
    expect(clearTerminalIntegrityState).toHaveBeenCalledWith({
      storeId: "store-1",
      terminalId: "fingerprint-1",
    });
  });

  it("fails provisioning when the local terminal seed cannot be written", async () => {
    const registerTerminalMutation = vi.fn(async (args) => ({
      kind: "ok" as const,
      data: {
        _id: "terminal-1" as never,
        _creationTime: 1,
        browserInfo: args.browserInfo,
        displayName: args.displayName,
        fingerprintHash: args.fingerprintHash,
        registeredAt: 1,
        registeredByUserId: "user-1" as never,
        registerNumber: args.registerNumber,
        status: "active" as const,
        storeId: args.storeId as never,
        syncSecretHash: args.syncSecretHash,
      },
    }));
    const writeProvisionedTerminalSeed = vi.fn(async () => ({
      ok: false as const,
      error: { code: "write_failed" as const, message: "seed write failed" },
    }));

    await expect(
      registerAndProvisionPosTerminal({
        activeStoreId: "store-1" as never,
        browserInfo: { userAgent: "test" },
        displayName: "Front register",
        fingerprintHash: "fingerprint-1",
        now: () => 123,
        registerNumber: "1",
        registerTerminalMutation,
        storeFactory: () =>
          ({
            writeProvisionedTerminalSeed,
          }) as never,
      }),
    ).rejects.toThrow("seed write failed");
  });

  it("does not write a local terminal seed when registration is rejected", async () => {
    const registerTerminalMutation = vi.fn(async () => ({
      kind: "user_error" as const,
      error: { message: "registration rejected" },
    }));
    const writeProvisionedTerminalSeed = vi.fn(async () => ({
      ok: true,
      value: null,
    }));

    const result = await registerAndProvisionPosTerminal({
      activeStoreId: "store-1" as never,
      browserInfo: { userAgent: "test" },
      displayName: "Front register",
      fingerprintHash: "fingerprint-1",
      now: () => 123,
      registerNumber: "1",
      registerTerminalMutation,
      storeFactory: () =>
        ({
          writeProvisionedTerminalSeed,
        }) as never,
    });

    expect(result).toEqual({
      kind: "user_error",
      error: { message: "registration rejected" },
    });
    expect(writeProvisionedTerminalSeed).not.toHaveBeenCalled();
  });
});
