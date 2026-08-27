import { render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  fixtureName: undefined as string | undefined,
  fixtureState: { fixture: undefined, isResolving: false } as {
    fixture?: Record<string, unknown>;
    isResolving: boolean;
  },
  routeOptions: null as Record<string, unknown> | null,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: vi.fn((path: string) => {
    const route = {
      path,
      useSearch: () => ({ fixture: mocks.fixtureName }),
    };
    return (options: Record<string, unknown>) => {
      mocks.routeOptions = options;
      return Object.assign(route, options);
    };
  }),
  Outlet: () => <div data-testid="pos-child-outlet" />,
}));

vi.mock("@/components/auth/DefaultCatchBoundary", () => ({
  DefaultCatchBoundary: ({ error }: { error: Error }) => (
    <div>recovery: {error.message}</div>
  ),
}));

vi.mock("@/components/pos/PosClientTelemetryHost", () => ({
  PosClientTelemetryHost: () => <div data-testid="pos-telemetry-host" />,
}));

vi.mock("@/lib/pos/infrastructure/telemetry/telemetryBuffer", () => ({
  enqueuePosClientEvent: mocks.enqueue,
}));

vi.mock("@/stories/operations/devFixtureActivation", () => ({
  usePosHubFixture: () => mocks.fixtureState,
}));

function listRouteModules(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? listRouteModules(path) : [path];
    })
    .filter((path) => path.endsWith(".tsx") && !path.endsWith(".test.tsx"));
}

async function loadParentRoute() {
  await import("./pos");
  if (!mocks.routeOptions) throw new Error("POS parent route was not registered");
  return mocks.routeOptions;
}

describe("POS parent route", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.enqueue.mockReset();
    mocks.fixtureName = undefined;
    mocks.fixtureState = { fixture: undefined, isResolving: false };
    mocks.routeOptions = null;
    window.history.replaceState({}, "", "/acme/store/osu/pos");
  });

  it("owns the complete current POS child-route inventory structurally", async () => {
    const currentDirectory = dirname(fileURLToPath(import.meta.url));
    const childDirectory = join(currentDirectory, "pos");
    const modules = listRouteModules(childDirectory)
      .map((path) => relative(childDirectory, path))
      .sort();

    expect(basename(join(currentDirectory, "pos.tsx"))).toBe("pos.tsx");
    expect(modules).toEqual([
      "expense-reports.index.tsx",
      "expense-reports/$reportId.tsx",
      "expense.index.tsx",
      "index.tsx",
      "register.index.tsx",
      "sessions.index.tsx",
      "settings.index.tsx",
      "terminals.index.tsx",
      "terminals/$terminalId.tsx",
      "transactions.index.tsx",
      "transactions/$transactionId.tsx",
    ]);

    await loadParentRoute();
    const parentRoute = (await import("./pos")).Route as { path: string };
    expect(parentRoute.path).toBe(
      "/_authed/$orgUrlSlug/store/$storeUrlSlug/pos",
    );
  });

  it("mounts one host with the child outlet for a live route", async () => {
    const options = await loadParentRoute();
    const Component = options.component as ComponentType;
    render(<Component />);

    expect(screen.getByTestId("pos-telemetry-host")).toBeInTheDocument();
    expect(screen.getByTestId("pos-child-outlet")).toBeInTheDocument();
  });

  it.each([
    ["resolving", { fixture: undefined, isResolving: true }],
    ["authored", { fixture: { authored: true }, isResolving: false }],
  ])("keeps the %s fixture state free of live telemetry ownership", async (_name, state) => {
    mocks.fixtureName = "wednesday-hub-manager";
    mocks.fixtureState = state;
    const options = await loadParentRoute();
    const Component = options.component as ComponentType;
    render(<Component />);

    expect(screen.queryByTestId("pos-telemetry-host")).not.toBeInTheDocument();
    expect(screen.getByTestId("pos-child-outlet")).toBeInTheDocument();
  });

  it("reports an unexpected route failure once and preserves recovery", async () => {
    const options = await loadParentRoute();
    const ErrorComponent = options.errorComponent as ComponentType<{
      error: Error;
      reset: () => void;
    }>;
    const error = new Error("render exploded");
    const view = render(<ErrorComponent error={error} reset={vi.fn()} />);
    view.rerender(<ErrorComponent error={error} reset={vi.fn()} />);

    expect(screen.getByText("recovery: render exploded")).toBeInTheDocument();
    await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledTimes(1));
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: "route_render_error",
        operation: "route_render",
      }),
    );
  });

  it("delegates coded expected route outcomes without telemetry", async () => {
    const options = await loadParentRoute();
    const ErrorComponent = options.errorComponent as ComponentType<{
      error: Error & { data: { code: string } };
      reset: () => void;
    }>;
    const error = Object.assign(new Error("session ended"), {
      data: { code: "shared_demo_session_expired" },
    });
    render(<ErrorComponent error={error} reset={vi.fn()} />);

    await Promise.resolve();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(screen.getByText("recovery: session ended")).toBeInTheDocument();
  });

  it("keeps authored-fixture route recovery free of telemetry", async () => {
    mocks.fixtureName = "wednesday-hub-manager";
    mocks.fixtureState = { fixture: { authored: true }, isResolving: false };
    window.history.replaceState(
      {},
      "",
      "/acme/store/osu/pos?fixture=wednesday-hub-manager",
    );
    const options = await loadParentRoute();
    const Component = options.component as ComponentType;
    const ErrorComponent = options.errorComponent as ComponentType<{
      error: Error;
      reset: () => void;
    }>;
    const view = render(<Component />);
    view.unmount();
    render(
      <ErrorComponent
        error={new Error("fixture render failed")}
        reset={vi.fn()}
      />,
    );

    await Promise.resolve();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(screen.getByText("recovery: fixture render failed")).toBeInTheDocument();
  });
});
