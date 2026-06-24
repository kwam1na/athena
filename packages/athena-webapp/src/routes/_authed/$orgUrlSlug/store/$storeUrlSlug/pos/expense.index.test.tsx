import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  routeOptions: null as Record<string, unknown> | null,
  useAppMessageCommunicationPreference: vi.fn(),
  useAppShellFullscreenMode: vi.fn(),
  useExpenseRegisterViewModel: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => {
    mocked.routeOptions = options;
    return {
      ...options,
      useParams: () => ({ orgUrlSlug: "wigclub", storeUrlSlug: "wigclub" }),
    };
  },
}));

vi.mock("@/contexts/AppShellFullscreenContext", () => ({
  useAppShellFullscreenMode: mocked.useAppShellFullscreenMode,
}));

vi.mock("@/lib/app-messages", () => ({
  useAppMessageCommunicationPreference:
    mocked.useAppMessageCommunicationPreference,
}));

vi.mock(
  "@/lib/pos/presentation/expense/useExpenseRegisterViewModel",
  () => ({
    useExpenseRegisterViewModel: mocked.useExpenseRegisterViewModel,
  }),
);

vi.mock("~/src/components/pos/POSRegisterView", () => ({
  POSRegisterView: ({
    workflowMode,
    viewModel,
  }: {
    workflowMode: string;
    viewModel: unknown;
  }) => (
    <div data-view-model={String(Boolean(viewModel))}>
      register workflow: {workflowMode}
    </div>
  ),
}));

vi.mock("~/src/components/states/not-found/NotFoundView", () => ({
  NotFoundView: () => <div />,
}));

describe("POS expense route", () => {
  beforeEach(() => {
    vi.resetModules();
    mocked.routeOptions = null;
    mocked.useAppMessageCommunicationPreference.mockReset();
    mocked.useAppShellFullscreenMode.mockReset();
    mocked.useExpenseRegisterViewModel.mockReset();
    mocked.useExpenseRegisterViewModel.mockReturnValue({ mode: "expense" });
  });

  it("renders the expense register in the fullscreen POS shell", async () => {
    await import("./expense.index");

    const Component = mocked.routeOptions?.component as
      | ComponentType
      | undefined;
    if (!Component) {
      throw new Error("Expense route component was not registered");
    }

    render(<Component />);

    expect(mocked.useAppShellFullscreenMode).toHaveBeenCalled();
    expect(mocked.useAppMessageCommunicationPreference).toHaveBeenCalledWith({
      surfaceId: "pos-expense-register",
      variant: "toast",
    });
    expect(screen.getByText("register workflow: expense")).toBeInTheDocument();
  });
});
