import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  generateBrowserFingerprint: vi.fn(),
  registerTerminalMutation: vi.fn(),
  rotateRecoveryCode: vi.fn(),
  revokeRecoveryCode: vi.fn(),
  updateEodAutoCompletePolicy: vi.fn(),
  updateOpeningAutoStartPolicy: vi.fn(),
  unlockRecoveryCode: vi.fn(),
  useAuth: vi.fn(),
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

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mocks.useAuth(),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: mocks.usePermissions,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to,
    ...props
  }: {
    children?: ReactNode;
    params?: { orgUrlSlug: string; storeUrlSlug: string; terminalId?: string };
    search?: Record<string, string>;
    to?: string;
  }) => {
    const path =
      to
        ?.replace("$orgUrlSlug", params?.orgUrlSlug ?? "")
        .replace("$storeUrlSlug", params?.storeUrlSlug ?? "")
        .replace("$terminalId", params?.terminalId ?? "") ?? "#";
    const query = search
      ? `?${new URLSearchParams(search).toString()}`
      : "";

    return (
      <a href={`${path}${query}`} {...props}>
        {children}
      </a>
    );
  },
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    inventory: {
      posTerminal: {
        getTerminalByFingerprint: "getTerminalByFingerprint",
        registerTerminal: "registerTerminal",
      },
    },
    operations: {
      dailyOperationsAutomation: {
        getEodAutoCompletePolicy: "getEodAutoCompletePolicy",
        getOpeningAutoStartPolicy: "getOpeningAutoStartPolicy",
        updateEodAutoCompletePolicy: "updateEodAutoCompletePolicy",
        updateOpeningAutoStartPolicy: "updateOpeningAutoStartPolicy",
      },
    },
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

async function waitForFingerprintEffect() {
  await waitFor(() =>
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      "athena.pos.fingerprint",
      expect.any(String),
    ),
  );
}

describe("registerAndProvisionPosTerminal", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(
      null,
      "",
      "/acme/store/downtown/pos/settings?o=%2Facme%2Fstore%2Fdowntown%2Fpos",
    );
    window.localStorage.clear();
    mocks.rotateRecoveryCode.mockResolvedValue({
      code: "abc123-def456",
      credential: { status: "active" },
    });
    mocks.revokeRecoveryCode.mockResolvedValue({ status: "revoked" });
    mocks.unlockRecoveryCode.mockResolvedValue({ status: "active" });
    mocks.updateOpeningAutoStartPolicy.mockResolvedValue({
      mode: "enabled",
      openingBlockerHandling: "start_with_manager_review",
    });
    mocks.updateEodAutoCompletePolicy.mockResolvedValue({
      cleanDayAutoCompleteEnabled: true,
      localCompletionWindowMinutes: 1110,
      maxAbsoluteCashVariance: 500,
      maxVoidedSaleCount: 1,
      maxVoidedSaleTotal: 2500,
      mode: "enabled",
    });
    mocks.useMutation.mockImplementation((ref) => {
      if (ref === "updateOpeningAutoStartPolicy") {
        return mocks.updateOpeningAutoStartPolicy;
      }
      if (ref === "updateEodAutoCompletePolicy") {
        return mocks.updateEodAutoCompletePolicy;
      }
      if (ref === "rotateRecoveryCode") return mocks.rotateRecoveryCode;
      if (ref === "revokeRecoveryCode") return mocks.revokeRecoveryCode;
      if (ref === "unlockRecoveryCode") return mocks.unlockRecoveryCode;
      return mocks.registerTerminalMutation;
    });
    mocks.usePermissions.mockReturnValue({
      hasFullAdminAccess: true,
      isLoading: false,
    });
    mocks.useAuth.mockReturnValue({
      isLoading: false,
      user: { _id: "athena-user-1", email: "pos@wigclub.store" },
    });
    mocks.useQuery.mockImplementation((ref) =>
      ref === "getRecoveryCodeStatus"
        ? {
            failedAttemptCount: 0,
            lastUsedAt: undefined,
            lockedUntil: undefined,
            plaintextCode: "mintlamp42",
            rotatedAt: 1,
            status: "active",
          }
        : ref === "getOpeningAutoStartPolicy"
          ? {
              localStartMinutes: 510,
              mode: "enabled",
              openingBlockerHandling: "start_with_manager_review",
              operatingTimezoneOffsetMinutes: -120,
            }
        : ref === "getEodAutoCompletePolicy"
          ? {
              cleanDayAutoCompleteEnabled: true,
              localCompletionWindowMinutes: 1110,
              maxAbsoluteCashVariance: 500,
              maxVoidedSaleCount: 1,
              maxVoidedSaleTotal: 2500,
              mode: "dry_run",
              operatingTimezoneOffsetMinutes: -120,
            }
        : null,
    );
    mocks.generateBrowserFingerprint.mockResolvedValue({
      browserInfo: { userAgent: "test" },
      fingerprintHash: "fingerprint-1",
    });
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: undefined,
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
    await user.click(screen.getByText("Services only"));
    await user.click(screen.getByText("POS only"));
    await user.click(
      await screen.findByRole("button", { name: "Register terminal" }),
    );

    await waitFor(() =>
      expect(mocks.registerTerminalMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "Front counter",
          fingerprintHash: "fingerprint-1",
          loginMode: "pos_only",
          registerNumber: "7",
          storeId: "store-1",
          transactionCapability: "services_only",
        }),
      ),
    );
    expect(writeProvisionedTerminalSeed).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudTerminalId: "terminal-1",
        registerNumber: "7",
        syncSecretHash: "01020304",
        terminalId: "fingerprint-1",
        loginMode: "pos_only",
        transactionCapability: "services_only",
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
      loginMode: "pos_only",
      transactionCapability: "products_only",
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
    expect(screen.getByLabelText("Product SKUs only")).toBeChecked();
    expect(screen.getByLabelText("POS only")).toBeChecked();
    await user.clear(screen.getByLabelText("Terminal name"));
    await user.type(screen.getByLabelText("Terminal name"), "  Front desk  ");
    await user.click(screen.getByText("Services only"));
    await user.click(screen.getByText("Standard login"));
    await user.click(
      await screen.findByRole("button", { name: "Save terminal settings" }),
    );

    await waitFor(() =>
      expect(mocks.registerTerminalMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: "Front desk",
          fingerprintHash: "fingerprint-1",
          loginMode: "standard",
          registerNumber: "3",
          storeId: "store-1",
          transactionCapability: "services_only",
        }),
      ),
    );
    expect(writeProvisionedTerminalSeed).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudTerminalId: "terminal-existing",
        registerNumber: "3",
        syncSecretHash: "01020304",
        terminalId: "fingerprint-1",
        loginMode: "standard",
        transactionCapability: "services_only",
      }),
    );
  });

  it("shows the current POS recovery code from status", async () => {
    render(<POSSettingsView />);

    expect(await screen.findByText("mintlamp42")).toBeInTheDocument();
    expect(
      screen.getByText("Current recovery code"),
    ).toBeInTheDocument();
  });

  it("lets full admins rotate the POS recovery code and keeps plaintext visible", async () => {
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

  it("shows full admins the store-day automation policy", async () => {
    render(<POSSettingsView />);

    expect(await screen.findByText("Store day automation")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Athena can start the store day on schedule and keep opening review items for manager follow-up.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Enable store-day auto-start")).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Store day start hour" }))
      .toHaveTextContent("08");
    expect(screen.getByRole("combobox", { name: "Store day start minute" }))
      .toHaveTextContent("30");
    expect(screen.getByRole("combobox", { name: "Store day start period" }))
      .toHaveTextContent("AM");
    expect(screen.queryByLabelText("Store UTC offset")).not.toBeInTheDocument();
    expect(
      screen.getByText("Blockers stay available for manager review."),
    ).toBeInTheDocument();
    expect(mocks.useQuery).toHaveBeenCalledWith("getOpeningAutoStartPolicy", {
      storeId: "store-1",
    });
  });

  it("shows full admins a distinct EOD completion automation policy", async () => {
    render(<POSSettingsView />);

    expect(
      await screen.findByText("EOD completion automation"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Athena can complete clean or low-risk EOD Reviews under store policy.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Dry run EOD completion")).toBeChecked();
    expect(screen.getByLabelText("Enable blocker-free completion")).toBeChecked();
    expect(screen.getByRole("combobox", { name: "EOD completion hour" }))
      .toHaveTextContent("06");
    expect(screen.getByRole("combobox", { name: "EOD completion minute" }))
      .toHaveTextContent("30");
    expect(screen.getByRole("combobox", { name: "EOD completion period" }))
      .toHaveTextContent("PM");
    expect(screen.getByLabelText("Cash variance threshold")).toHaveValue(500);
    expect(screen.getByLabelText("Voided sale count threshold")).toHaveValue(1);
    expect(screen.getByLabelText("Voided sale total threshold")).toHaveValue(2500);
    expect(mocks.useQuery).toHaveBeenCalledWith("getEodAutoCompletePolicy", {
      storeId: "store-1",
    });
  });

  it("saves the EOD completion automation policy with thresholds", async () => {
    const user = userEvent.setup();

    render(<POSSettingsView />);

    await screen.findByText("EOD completion automation");
    await waitFor(() =>
      expect(screen.getByLabelText("Dry run EOD completion")).toBeChecked(),
    );
    fireEvent.click(screen.getByLabelText("Enable EOD completion"));
    fireEvent.click(screen.getByLabelText("Enable blocker-free completion"));
    fireEvent.change(screen.getByLabelText("Cash variance threshold"), {
      target: { value: "750" },
    });
    fireEvent.change(screen.getByLabelText("Voided sale count threshold"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Voided sale total threshold"), {
      target: { value: "9000" },
    });
    expect(screen.getByLabelText("Enable EOD completion")).toBeChecked();
    expect(screen.getByLabelText("Enable blocker-free completion")).not.toBeChecked();
    expect(screen.getByLabelText("Cash variance threshold")).toHaveValue(750);
    expect(screen.getByLabelText("Voided sale count threshold")).toHaveValue(2);
    expect(screen.getByLabelText("Voided sale total threshold")).toHaveValue(9000);
    await user.click(
      screen.getByRole("button", { name: "Save EOD completion automation" }),
    );

    await waitFor(() =>
      expect(mocks.updateEodAutoCompletePolicy).toHaveBeenCalledWith({
        cleanDayAutoCompleteEnabled: false,
        localCompletionWindowMinutes: 1110,
        maxAbsoluteCashVariance: 750,
        maxVoidedSaleCount: 2,
        maxVoidedSaleTotal: 9000,
        mode: "enabled",
        operatingTimezoneOffsetMinutes: 0,
        storeId: "store-1",
      }),
    );
  });

  it("saves the store-day automation policy with local time and review handling", async () => {
    const user = userEvent.setup();

    render(<POSSettingsView />);

    await user.click(await screen.findByLabelText("Enable store-day auto-start"));
    await user.click(
      screen.getByRole("combobox", { name: "Store day start hour" }),
    );
    await user.click(await screen.findByRole("option", { name: "07" }));
    await user.click(
      screen.getByRole("combobox", { name: "Store day start minute" }),
    );
    await user.click(await screen.findByRole("option", { name: "45" }));
    await user.click(
      screen.getByRole("button", { name: "Save store-day automation" }),
    );

    await waitFor(() =>
      expect(mocks.updateOpeningAutoStartPolicy).toHaveBeenCalledWith({
        localStartMinutes: 465,
        mode: "disabled",
        openingBlockerHandling: "start_with_manager_review",
        operatingTimezoneOffsetMinutes: 0,
        storeId: "store-1",
      }),
    );
  });

  it("saves enabled store-day automation from a disabled policy", async () => {
    const user = userEvent.setup();
    mocks.useQuery.mockImplementation((ref) =>
      ref === "getRecoveryCodeStatus"
        ? {
            failedAttemptCount: 0,
            lastUsedAt: undefined,
            lockedUntil: undefined,
            plaintextCode: "mintlamp42",
            rotatedAt: 1,
            status: "active",
          }
        : ref === "getOpeningAutoStartPolicy"
          ? {
              localStartMinutes: 480,
              mode: "disabled",
              openingBlockerHandling: "start_with_manager_review",
              operatingTimezoneOffsetMinutes: 0,
            }
          : null,
    );

    render(<POSSettingsView />);

    await user.click(await screen.findByLabelText("Enable store-day auto-start"));
    await user.click(
      screen.getByRole("combobox", { name: "Store day start minute" }),
    );
    await user.click(await screen.findByRole("option", { name: "15" }));
    await user.click(
      screen.getByRole("button", { name: "Save store-day automation" }),
    );

    await waitFor(() =>
      expect(mocks.updateOpeningAutoStartPolicy).toHaveBeenCalledWith({
        localStartMinutes: 495,
        mode: "enabled",
        openingBlockerHandling: "start_with_manager_review",
        operatingTimezoneOffsetMinutes: 0,
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

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /revoke/i })).toBeDisabled(),
    );
  });

  it("hides recovery-code management from non-full-admin accounts", async () => {
    mocks.usePermissions.mockReturnValue({
      hasFullAdminAccess: false,
      isLoading: false,
    });

    render(<POSSettingsView />);
    await waitForFingerprintEffect();

    expect(screen.queryByText("POS recovery code")).not.toBeInTheDocument();
    expect(screen.queryByText("Store day automation")).not.toBeInTheDocument();
    expect(screen.queryByText("EOD completion automation")).not.toBeInTheDocument();
    expect(mocks.useQuery).toHaveBeenCalledWith(
      "getRecoveryCodeStatus",
      "skip",
    );
    expect(mocks.useQuery).toHaveBeenCalledWith(
      "getOpeningAutoStartPolicy",
      "skip",
    );
    expect(mocks.useQuery).toHaveBeenCalledWith(
      "getEodAutoCompletePolicy",
      "skip",
    );
  });

  it("shows a normalized error when store-day automation cannot save", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.updateOpeningAutoStartPolicy.mockRejectedValue(
      new Error("internal duplicate_policy stack"),
    );

    render(<POSSettingsView />);

    await user.click(
      screen.getByRole("button", {
        name: "Save store-day automation",
      }),
    );

    await waitFor(() =>
      expect(mocks.updateOpeningAutoStartPolicy).toHaveBeenCalled(),
    );
    expect(
      await screen.findByText("Store-day automation settings were not saved."),
    ).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "internal duplicate_policy stack",
      }),
    );
    expect(screen.queryByText(/duplicate_policy/)).not.toBeInTheDocument();
  });

  it("shows a normalized error when EOD completion automation cannot save", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.updateEodAutoCompletePolicy.mockRejectedValue(
      new Error("internal threshold_policy stack"),
    );

    render(<POSSettingsView />);

    await user.click(
      screen.getByRole("button", {
        name: "Save EOD completion automation",
      }),
    );

    await waitFor(() =>
      expect(mocks.updateEodAutoCompletePolicy).toHaveBeenCalled(),
    );
    expect(
      await screen.findByText("EOD completion automation settings were not saved."),
    ).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "internal threshold_policy stack",
      }),
    );
    expect(screen.queryByText(/threshold_policy/)).not.toBeInTheDocument();
  });

  it("hands off roster and support work to terminal health", async () => {
    render(<POSSettingsView />);

    expect(screen.getByText("Terminal health")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByText("Offline diagnostics need attention"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText((_content, element) =>
        Boolean(element?.textContent?.trim() === "1 of 7 reporting"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("App-session continuity is verified for POS."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "App shell recovery needs attention before offline route access is reliable.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This settings page only changes the current checkout station.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open terminal health" }),
    ).toHaveAttribute(
      "href",
      "/acme/store/downtown/pos/terminals?o=%252Facme%252Fstore%252Fdowntown%252Fpos%252Fsettings%253Fo%253D%25252Facme%25252Fstore%25252Fdowntown%25252Fpos",
    );
  });

  it("links terminal health to the current terminal and keeps settings as the origin", async () => {
    mocks.useQuery.mockImplementation((ref) =>
      ref === "getRecoveryCodeStatus"
        ? {
            failedAttemptCount: 0,
            lastUsedAt: undefined,
            lockedUntil: undefined,
            plaintextCode: "mintlamp42",
            rotatedAt: 1,
            status: "active",
          }
        : ref === "getOpeningAutoStartPolicy"
          ? {
              localStartMinutes: 510,
              mode: "enabled",
              openingBlockerHandling: "start_with_manager_review",
              operatingTimezoneOffsetMinutes: 0,
            }
          : ref === "getTerminalByFingerprint"
            ? {
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
              }
            : null,
    );

    render(<POSSettingsView />);

    expect(screen.getByText("Terminal health")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open terminal health" }),
    ).toHaveAttribute(
      "href",
      "/acme/store/downtown/pos/terminals/terminal-existing?o=%252Facme%252Fstore%252Fdowntown%252Fpos%252Fsettings%253Fo%253D%25252Facme%25252Fstore%25252Fdowntown%25252Fpos",
    );
  });

  it("shows when the current register is ready for offline checkout", async () => {
    const existingTerminal = {
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
    };
    mocks.useQuery.mockImplementation((ref) => {
      if (ref === "getRecoveryCodeStatus") {
        return {
          failedAttemptCount: 0,
          lastUsedAt: undefined,
          lockedUntil: undefined,
          plaintextCode: "mintlamp42",
          rotatedAt: 1,
          status: "active",
        };
      }
      if (ref === "getTerminalByFingerprint") {
        return existingTerminal;
      }
      return null;
    });
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: {
        keys: vi.fn(async () => ["athena-pos-app-shell-v6"]),
        open: vi.fn(async () => ({
          match: vi.fn(async () => ({ ok: true })),
        })),
      },
    });

    render(
      <POSSettingsView
        storeFactory={() =>
          ({
            getStaffAuthorityReadiness: vi.fn(async () => ({
              ok: true,
              value: "ready",
            })),
            readProvisionedTerminalSeed: vi.fn(async () => ({
              ok: true,
              value: {
                cloudTerminalId: "terminal-existing",
                storeId: "store-1",
                terminalId: "fingerprint-1",
              },
            })),
            readRegisterAvailabilitySnapshot: vi.fn(async () => ({
              ok: true,
              value: { refreshedAt: Date.now() },
            })),
            readRegisterCatalogSnapshot: vi.fn(async () => ({
              ok: true,
              value: { refreshedAt: Date.now() },
            })),
            readRegisterServiceCatalogSnapshot: vi.fn(async () => ({
              ok: true,
              value: { refreshedAt: Date.now() },
            })),
          }) as never
        }
      />,
    );

    expect(
      await screen.findByText("This register is ready for checkout"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Register ready for offline checkout"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("App-session continuity is verified for POS."),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_content, element) =>
        Boolean(element?.textContent?.trim() === "7 of 7 reporting"),
      ),
    ).toBeInTheDocument();
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
        loginMode: "standard",
        syncSecretHash: "01020304",
        transactionCapability: "products_and_services",
      }),
    );
    expect(writeProvisionedTerminalSeed).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudTerminalId: "terminal-1",
        loginMode: "standard",
        provisionedAt: 123,
        syncSecretHash: "01020304",
        terminalId: "fingerprint-1",
        transactionCapability: "products_and_services",
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
